// Chunk streaming: only chunks near the player exist. Each chunk is rebuilt
// deterministically from the world seed plus persistent world modifications.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2, RNG } from '../core/rng';
import { clamp, lerp, smoothstep } from '../core/math';
import { Biome, CHUNK_SIZE, BASE_WATER, Terrain } from './terrain';
import { Territories, Landmark } from './territory';
import { assets, prep } from './assets';
import { Season, WorldMods } from './worldState';

const SEG = 32;
const STEP = CHUNK_SIZE / SEG;
const BIOMES: Biome[] = ['forest', 'pine', 'meadow', 'marsh', 'hills', 'mountain', 'rocky', 'farmland'];

export interface Collider { x: number; z: number; r: number }
export type HerbKind = 'silverleaf' | 'sunpetal' | 'bitterroot';
export const HERB_INFO: Record<HerbKind, { name: string; color: [number, number, number]; use: string }> = {
  silverleaf: { name: 'Silverleaf', color: [0.85, 0.9, 1.0], use: 'soothes wounds' },
  sunpetal: { name: 'Sunpetal', color: [1.0, 0.8, 0.2], use: 'eases fever and cough' },
  bitterroot: { name: 'Bitterroot', color: [0.7, 0.35, 0.8], use: 'fights sickness' },
};

export type TreasureKind = 'feather' | 'shell' | 'shinyStone' | 'acorn' | 'pinecone' | 'snailShell' | 'blueEgg' | 'mossyStick';
export const TREASURE_INFO: Record<TreasureKind, { name: string; color: [number, number, number] }> = {
  feather: { name: 'jay feather', color: [0.35, 0.55, 0.95] },
  shell: { name: 'river shell', color: [0.97, 0.93, 0.85] },
  shinyStone: { name: 'shiny stone', color: [0.8, 0.85, 0.95] },
  acorn: { name: 'perfect acorn', color: [0.6, 0.4, 0.2] },
  pinecone: { name: 'pinecone', color: [0.45, 0.3, 0.18] },
  snailShell: { name: 'swirly snail shell', color: [0.9, 0.75, 0.55] },
  blueEgg: { name: 'empty robin egg', color: [0.55, 0.8, 0.85] },
  mossyStick: { name: 'mossy stick', color: [0.4, 0.55, 0.3] },
};

export interface Interactable {
  key: string;
  type: 'herb' | 'moss' | 'berries' | 'treasure';
  kind: HerbKind | 'moss' | 'deathberry' | TreasureKind;
  x: number; y: number; z: number;
  mesh: THREE.InstancedMesh;
  index: number;
  matrix: THREE.Matrix4;
}

export interface SpawnPoint { x: number; z: number; biome: Biome; water: boolean }
export interface Structure { type: 'house' | 'ruin' | 'cave' | 'clearing'; x: number; z: number; r: number; name: string }

export interface WorldContext {
  terrain: Terrain;
  territories: Territories;
  mods: WorldMods;
  season: Season;
  day: number;
  seed: number;
}

const TREASURE_GEO = new THREE.IcosahedronGeometry(0.045, 0);

class InstBuilder {
  mats: number[] = [];
  cols: number[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  add(x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, c: [number, number, number], tiltX = 0, tiltZ = 0) {
    this.e.set(tiltX, rotY, tiltZ);
    this.q.setFromEuler(this.e);
    this.p.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.p, this.q, this.s);
    this.mats.push(...this.m.elements);
    this.cols.push(c[0], c[1], c[2]);
  }
  get count() { return this.cols.length / 3; }
  build(geo: THREE.BufferGeometry, mat: THREE.Material, castShadow: boolean, receiveShadow = true): THREE.InstancedMesh | null {
    const n = this.count;
    if (!n) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.array.set(this.mats);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cols), 3);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    return mesh;
  }
}

function jitterColor(c: [number, number, number], r: RNG, amt = 0.08): [number, number, number] {
  const k = 1 + r.range(-amt, amt);
  return [clamp(c[0] * k + r.range(-0.02, 0.02), 0, 1.5), clamp(c[1] * k, 0, 1.5), clamp(c[2] * k, 0, 1.5)];
}

const CANOPY: Record<Season, [number, number, number][]> = {
  spring: [[0.48, 0.74, 0.3], [0.56, 0.78, 0.34], [0.42, 0.66, 0.28], [0.5, 0.72, 0.32], [0.46, 0.7, 0.3], [0.52, 0.76, 0.3], [0.54, 0.74, 0.34], [0.44, 0.68, 0.3], [0.5, 0.7, 0.28], [1.0, 0.9, 0.92]],
  summer: [[0.3, 0.55, 0.2], [0.26, 0.5, 0.2], [0.36, 0.58, 0.22], [0.32, 0.52, 0.18]],
  autumn: [[0.9, 0.45, 0.14], [0.94, 0.7, 0.2], [0.75, 0.3, 0.12], [0.6, 0.55, 0.2], [0.85, 0.55, 0.15]],
  winter: [[0.5, 0.38, 0.25], [0.45, 0.35, 0.28]],
};
const GRASS_TINT: Record<Season, [number, number, number]> = {
  spring: [0.46, 0.74, 0.3],
  summer: [0.42, 0.62, 0.24],
  autumn: [0.66, 0.6, 0.3],
  winter: [0.52, 0.5, 0.38],
};

export class Chunk {
  group = new THREE.Group();
  detail: THREE.Group | null = null;
  colliders: Collider[] = [];
  interactables: Interactable[] = [];
  spawns: SpawnPoint[] = [];
  structures: Structure[] = [];
  heights = new Float32Array((SEG + 1) * (SEG + 1));
  biomes = new Uint8Array((SEG + 1) * (SEG + 1));
  flags = new Uint8Array((SEG + 1) * (SEG + 1)); // bit0 water-ish, bit1 road, bit2 bank, bit3 burned, bit4 marsh
  minH = Infinity;
  maxH = -Infinity;
  water: THREE.Mesh | null = null;
  windows: THREE.Mesh | null = null;
  dominant: Biome = 'forest';
  lodHi: THREE.Object3D[] = [];
  lodLo: THREE.Object3D[] = [];
  setLod(near: boolean) {
    for (const m of this.lodHi) m.visible = near;
    for (const m of this.lodLo) m.visible = !near;
  }
  clearZones: { x: number; z: number; r: number }[] = [];
  constructor(public cx: number, public cz: number) {}
  get x0() { return this.cx * CHUNK_SIZE; }
  get z0() { return this.cz * CHUNK_SIZE; }

  heightAt(x: number, z: number): number {
    const lx = clamp((x - this.x0) / STEP, 0, SEG - 0.0001);
    const lz = clamp((z - this.z0) / STEP, 0, SEG - 0.0001);
    const ix = Math.floor(lx), iz = Math.floor(lz);
    const fx = lx - ix, fz = lz - iz;
    const W = SEG + 1;
    const h00 = this.heights[iz * W + ix], h10 = this.heights[iz * W + ix + 1];
    const h01 = this.heights[(iz + 1) * W + ix], h11 = this.heights[(iz + 1) * W + ix + 1];
    // match PlaneGeometry-style triangulation
    if (fx + fz < 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  nearestIndex(x: number, z: number): number {
    const ix = clamp(Math.round((x - this.x0) / STEP), 0, SEG);
    const iz = clamp(Math.round((z - this.z0) / STEP), 0, SEG);
    return iz * (SEG + 1) + ix;
  }
  biomeAt(x: number, z: number): Biome {
    return BIOMES[this.biomes[this.nearestIndex(x, z)]];
  }
  flagAt(x: number, z: number): number {
    return this.flags[this.nearestIndex(x, z)];
  }
  dispose() {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        if (!(m as any).sharedGeo) m.geometry.dispose();
      }
    });
    this.disposeDetail();
  }
  disposeDetail() {
    if (!this.detail) return;
    this.detail.parent?.remove(this.detail);
    this.detail = null;
    this.interactables = [];
  }
}

export class ChunkManager {
  chunks = new Map<string, Chunk>();
  root = new THREE.Group();
  radius = 3;
  detailRadius = 1;
  grassDensity = 1;
  private queue: [number, number][] = [];
  private detailQueue: Chunk[] = [];
  private windowMat = new THREE.MeshLambertMaterial({ color: 0x3a3a30, emissive: 0xffc870, emissiveIntensity: 0 });
  private propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private caveMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
  private pondMat: THREE.Material;
  waterLevel = BASE_WATER;
  private lastPcx = 1e9;
  private lastPcz = 1e9;

  constructor(private ctx: WorldContext, scene: THREE.Scene) {
    scene.add(this.root);
    this.pondMat = assets().mat.water;
  }

  key(cx: number, cz: number) { return `${cx},${cz}`; }

  getChunkAt(x: number, z: number): Chunk | undefined {
    return this.chunks.get(this.key(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
  }

  groundHeight(x: number, z: number): number {
    const c = this.getChunkAt(x, z);
    if (c) return c.heightAt(x, z);
    return this.ctx.terrain.height(x, z);
  }

  biomeAt(x: number, z: number): Biome {
    const c = this.getChunkAt(x, z);
    if (c) return c.biomeAt(x, z);
    return this.ctx.terrain.sample(x, z).biome;
  }

  /** Effective water surface at a point (global rivers/lakes or local ponds). */
  waterSurfaceAt(x: number, z: number): number {
    const p = this.ctx.terrain.pondLevelAt(x, z);
    return p !== null ? Math.max(p, this.waterLevel) : this.waterLevel;
  }

  waterDepthAt(x: number, z: number): number {
    return this.waterSurfaceAt(x, z) - this.groundHeight(x, z);
  }

  collidersNear(x: number, z: number, out: Collider[] = []): Collider[] {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.chunks.get(this.key(cx + dx, cz + dz));
        if (!c) continue;
        for (const col of c.colliders) {
          if (Math.abs(col.x - x) < col.r + 3 && Math.abs(col.z - z) < col.r + 3) out.push(col);
        }
      }
    return out;
  }

  interactablesNear(x: number, z: number, r: number): Interactable[] {
    const res: Interactable[] = [];
    for (const c of this.chunks.values()) {
      if (Math.abs(c.x0 + CHUNK_SIZE / 2 - x) > CHUNK_SIZE || Math.abs(c.z0 + CHUNK_SIZE / 2 - z) > CHUNK_SIZE) continue;
      for (const it of c.interactables) {
        if (this.ctx.mods.taken[it.key] !== undefined) continue;
        if (Math.hypot(it.x - x, it.z - z) < r) res.push(it);
      }
    }
    return res;
  }

  structuresNear(x: number, z: number, r: number): Structure[] {
    const res: Structure[] = [];
    for (const c of this.chunks.values()) {
      for (const s of c.structures) if (Math.hypot(s.x - x, s.z - z) < r + s.r) res.push(s);
    }
    return res;
  }

  spawnPointsNear(x: number, z: number, minR: number, maxR: number): SpawnPoint[] {
    const res: SpawnPoint[] = [];
    for (const c of this.chunks.values()) {
      for (const s of c.spawns) {
        const d = Math.hypot(s.x - x, s.z - z);
        if (d > minR && d < maxR) res.push(s);
      }
    }
    return res;
  }

  takeInteractable(it: Interactable) {
    this.ctx.mods.taken[it.key] = this.ctx.day;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    it.mesh.setMatrixAt(it.index, m);
    it.mesh.instanceMatrix.needsUpdate = true;
  }

  setNightLights(v: number) {
    this.windowMat.emissiveIntensity = v;
  }

  setWaterLevel(y: number) {
    this.waterLevel = y;
    for (const c of this.chunks.values()) if (c.water) c.water.position.y = y;
  }

  /** Rebuild every chunk (e.g. season change). Done lazily via the queue. */
  invalidateAll() {
    for (const c of this.chunks.values()) this.unload(c);
    this.chunks.clear();
    this.lastPcx = 1e9;
  }

  invalidateArea(x: number, z: number, r: number) {
    for (const c of [...this.chunks.values()]) {
      const ccx = c.x0 + CHUNK_SIZE / 2, ccz = c.z0 + CHUNK_SIZE / 2;
      if (Math.abs(ccx - x) < r + CHUNK_SIZE && Math.abs(ccz - z) < r + CHUNK_SIZE) {
        this.unload(c);
        this.chunks.delete(this.key(c.cx, c.cz));
      }
    }
    this.lastPcx = 1e9;
  }

  setContext(season: Season, day: number) {
    const changed = season !== this.ctx.season;
    this.ctx.season = season;
    this.ctx.day = day;
    if (changed) this.invalidateAll();
  }

  private unload(c: Chunk) {
    this.root.remove(c.group);
    c.dispose();
  }

  /** Synchronously build everything around a point (used on load). */
  primeAround(x: number, z: number) {
    this.update(x, z, 999);
  }

  update(px: number, pz: number, budget = 1) {
    const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
    if (pcx !== this.lastPcx || pcz !== this.lastPcz) {
      this.lastPcx = pcx;
      this.lastPcz = pcz;
      // unload far chunks
      for (const [k, c] of this.chunks) {
        if (Math.abs(c.cx - pcx) > this.radius + 1 || Math.abs(c.cz - pcz) > this.radius + 1) {
          this.unload(c);
          this.chunks.delete(k);
        } else if (c.detail && (Math.abs(c.cx - pcx) > this.detailRadius + 1 || Math.abs(c.cz - pcz) > this.detailRadius + 1)) {
          c.disposeDetail();
        }
      }
      this.queue = [];
      for (let dx = -this.radius; dx <= this.radius; dx++)
        for (let dz = -this.radius; dz <= this.radius; dz++) {
          if (dx * dx + dz * dz > (this.radius + 0.5) ** 2) continue;
          if (!this.chunks.has(this.key(pcx + dx, pcz + dz))) this.queue.push([pcx + dx, pcz + dz]);
        }
      this.queue.sort((a, b) => (a[0] - pcx) ** 2 + (a[1] - pcz) ** 2 - ((b[0] - pcx) ** 2 + (b[1] - pcz) ** 2));
      for (const c of this.chunks.values()) c.setLod(Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= 1);
    }
    let built = 0;
    while (this.queue.length && built < budget) {
      const [cx, cz] = this.queue.shift()!;
      if (this.chunks.has(this.key(cx, cz))) continue;
      const c = this.buildChunk(cx, cz);
      c.setLod(Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) <= 1);
      this.chunks.set(this.key(cx, cz), c);
      this.root.add(c.group);
      built++;
    }
    // detail layers
    if (built < budget || budget > 50) {
      for (let dx = -this.detailRadius; dx <= this.detailRadius; dx++)
        for (let dz = -this.detailRadius; dz <= this.detailRadius; dz++) {
          const c = this.chunks.get(this.key(pcx + dx, pcz + dz));
          if (c && !c.detail) {
            this.buildDetail(c);
            if (budget < 50) return;
          }
        }
    }
  }

  get pending() { return this.queue.length; }

  // ------------------------------------------------------------------ build

  private burnAt(x: number, z: number): number {
    let b = 0;
    for (const s of this.ctx.mods.burned) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r) {
        const age = this.ctx.day - s.day;
        const recover = smoothstep(4, 30, age);
        b = Math.max(b, (1 - smoothstep(s.r * 0.75, s.r, d)) * (1 - recover));
      }
    }
    return b;
  }

  private groundColor(biome: Biome, s: ReturnType<Terrain['sample']>, x: number, z: number, burn: number, slope: number): [number, number, number] {
    const season = this.ctx.season;
    const g = GRASS_TINT[season];
    const n = Math.sin(x * 0.13 + Math.cos(z * 0.11) * 2) * 0.5 + Math.sin(z * 0.07 - x * 0.05) * 0.5;
    let c: [number, number, number];
    switch (biome) {
      case 'forest': {
        const leafLitter = season === 'autumn' ? 0.6 : 0.35;
        const t = clamp(0.5 + n * 0.5, 0, 1) * leafLitter;
        c = [lerp(g[0] * 0.78, 0.45, t), lerp(g[1] * 0.78, 0.34, t), lerp(g[2] * 0.7, 0.2, t)];
        break;
      }
      case 'pine':
        c = [lerp(g[0] * 0.65, 0.42, 0.45 + n * 0.2), lerp(g[1] * 0.7, 0.33, 0.45), lerp(g[2] * 0.6, 0.22, 0.45)];
        break;
      case 'meadow':
        c = [g[0] * 1.08 + n * 0.04, g[1] * 1.05, g[2] * 0.9];
        break;
      case 'marsh':
        c = [lerp(0.36, 0.3, n), 0.42, 0.22];
        break;
      case 'hills':
        c = [g[0] * 1.1, g[1] * 1.0, g[2] * 0.85];
        break;
      case 'mountain': {
        c = [0.5, 0.49, 0.46];
        break;
      }
      case 'rocky':
        c = [lerp(0.55, g[0], 0.4 + n * 0.3), lerp(0.53, g[1], 0.4 + n * 0.3), lerp(0.48, g[2], 0.4)];
        break;
      case 'farmland': {
        const stripe = Math.sin((x + z * 0.3) * 0.25) > 0;
        const wheat: [number, number, number] = season === 'winter' ? [0.5, 0.42, 0.3] : season === 'spring' ? [0.5, 0.66, 0.3] : [0.82, 0.7, 0.36];
        c = stripe ? wheat : [g[0] * 1.05, g[1], g[2] * 0.9];
        break;
      }
    }
    // steep slopes show rock
    const rock = smoothstep(0.35, 0.6, slope);
    c = [lerp(c[0], 0.5, rock), lerp(c[1], 0.48, rock), lerp(c[2], 0.44, rock)];
    // snow caps
    if (s.h > 62) {
      const sn = smoothstep(62, 72, s.h);
      c = [lerp(c[0], 0.94, sn), lerp(c[1], 0.96, sn), lerp(c[2], 1.0, sn)];
    }
    // river bank sand / mud
    if (s.bank > 0.01) c = [lerp(c[0], 0.5, s.bank * 0.7), lerp(c[1], 0.44, s.bank * 0.7), lerp(c[2], 0.32, s.bank * 0.7)];
    const wet = Math.max(s.river, s.lake, s.stream);
    if (wet > 0.01) c = [lerp(c[0], 0.36, wet), lerp(c[1], 0.33, wet), lerp(c[2], 0.25, wet)];
    if (s.road > 0.05) {
      const edge = smoothstep(0.1, 0.6, s.road);
      c = [lerp(c[0], 0.36, edge), lerp(c[1], 0.35, edge), lerp(c[2], 0.37, edge)];
    }
    // camp floor: packed earth and sand
    if (s.campDist < 19) {
      const t = 1 - smoothstep(12, 19, s.campDist);
      c = [lerp(c[0], 0.62, t * 0.75), lerp(c[1], 0.48, t * 0.75), lerp(c[2], 0.3, t * 0.75)];
    }
    if (burn > 0) c = [lerp(c[0], 0.16, burn), lerp(c[1], 0.14, burn), lerp(c[2], 0.13, burn)];
    return c;
  }

  private buildChunk(cx: number, cz: number): Chunk {
    const ctx = this.ctx;
    const chunk = new Chunk(cx, cz);
    const x0 = chunk.x0, z0 = chunk.z0;
    const W = SEG + 1;
    // Sample grid with 1-vertex margin for normals
    const MW = W + 2;
    const mh = new Float32Array(MW * MW);
    const samples: ReturnType<Terrain['sample']>[] = new Array(W * W);
    for (let j = -1; j <= SEG + 1; j++)
      for (let i = -1; i <= SEG + 1; i++) {
        const x = x0 + i * STEP, z = z0 + j * STEP;
        const inside = i >= 0 && i <= SEG && j >= 0 && j <= SEG;
        if (inside) {
          const s = ctx.terrain.sample(x, z);
          samples[j * W + i] = s;
          mh[(j + 1) * MW + (i + 1)] = s.h;
        } else mh[(j + 1) * MW + (i + 1)] = ctx.terrain.height(x, z);
      }
    const biomeCount: Record<string, number> = {};
    const positions = new Float32Array(W * W * 3);
    const normals = new Float32Array(W * W * 3);
    const colors = new Float32Array(W * W * 3);
    for (let j = 0; j <= SEG; j++)
      for (let i = 0; i <= SEG; i++) {
        const idx = j * W + i;
        const s = samples[idx];
        const x = x0 + i * STEP, z = z0 + j * STEP;
        const h = s.h;
        chunk.heights[idx] = h;
        chunk.minH = Math.min(chunk.minH, h);
        chunk.maxH = Math.max(chunk.maxH, h);
        chunk.biomes[idx] = BIOMES.indexOf(s.biome);
        biomeCount[s.biome] = (biomeCount[s.biome] ?? 0) + 1;
        const burn = this.burnAt(x, z);
        let f = 0;
        if (s.river > 0.2 || s.lake > 0.2 || s.stream > 0.3 || h < BASE_WATER + 0.1) f |= 1;
        if (s.road > 0.3) f |= 2;
        if (s.bank > 0.3) f |= 4;
        if (burn > 0.3) f |= 8;
        if (s.marsh > 0.5) f |= 16;
        chunk.flags[idx] = f;
        positions[idx * 3] = i * STEP;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = j * STEP;
        const hl = mh[(j + 1) * MW + i], hr = mh[(j + 1) * MW + i + 2];
        const hd = mh[j * MW + i + 1], hu = mh[(j + 2) * MW + i + 1];
        const nx = hl - hr, ny = 2 * STEP, nz = hd - hu;
        const nl = Math.hypot(nx, ny, nz);
        normals[idx * 3] = nx / nl;
        normals[idx * 3 + 1] = ny / nl;
        normals[idx * 3 + 2] = nz / nl;
        const col = this.groundColor(s.biome, s, x, z, burn, 1 - ny / nl);
        colors[idx * 3] = col[0];
        colors[idx * 3 + 1] = col[1];
        colors[idx * 3 + 2] = col[2];
      }
    let best = 0;
    for (const b in biomeCount) if (biomeCount[b] > best) { best = biomeCount[b]; chunk.dominant = b as Biome; }
    const indices: number[] = [];
    for (let j = 0; j < SEG; j++)
      for (let i = 0; i < SEG; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    const terrainMesh = new THREE.Mesh(geo, assets().mat.terrain);
    terrainMesh.position.set(x0, 0, z0);
    terrainMesh.receiveShadow = true;
    chunk.group.add(terrainMesh);

    // Water
    if (chunk.minH < BASE_WATER + 2.6) {
      const wg = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 8, 8);
      wg.rotateX(-Math.PI / 2);
      const wm = new THREE.Mesh(wg, assets().mat.water);
      wm.position.set(x0 + CHUNK_SIZE / 2, this.waterLevel, z0 + CHUNK_SIZE / 2);
      wm.receiveShadow = true;
      wm.renderOrder = 2;
      chunk.water = wm;
      chunk.group.add(wm);
    }

    this.populate(chunk, samples);
    return chunk;
  }

  private blocked(chunk: Chunk, x: number, z: number, pad: number): boolean {
    for (const c of chunk.clearZones) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
    return false;
  }

  private populate(chunk: Chunk, samples: ReturnType<Terrain['sample']>[]) {
    const ctx = this.ctx;
    const A = assets();
    const rng = new RNG(hash2(chunk.cx, chunk.cz, ctx.seed));
    const season = ctx.season;
    const W = SEG + 1;
    const sampleAt = (x: number, z: number) => samples[chunk.nearestIndex(x, z)];

    const trunks = new InstBuilder();
    const canopies = new InstBuilder();
    const pines = new InstBuilder();
    const bushes = new InstBuilder();
    const rocks = [new InstBuilder(), new InstBuilder(), new InstBuilder()];
    const logs = new InstBuilder();
    const dead = new InstBuilder();
    const reeds = new InstBuilder();
    const props: THREE.BufferGeometry[] = [];
    const caveParts: THREE.BufferGeometry[] = [];
    const windowParts: THREE.BufferGeometry[] = [];

    // --- landmarks in this chunk
    const lms: Landmark[] = ctx.territories.landmarks.filter(
      (l) => l.x >= chunk.x0 && l.x < chunk.x0 + CHUNK_SIZE && l.z >= chunk.z0 && l.z < chunk.z0 + CHUNK_SIZE,
    );
    for (const l of lms) {
      const y = chunk.heightAt(l.x, l.z);
      switch (l.kind) {
        case 'bigTree': {
          chunk.clearZones.push({ x: l.x, z: l.z, r: 6 });
          const col = CANOPY[season][0];
          trunks.add(l.x, y - 0.3, l.z, rng.range(0, 6), 11, 24, 11, [0.5, 0.38, 0.28]);
          if (season !== 'winter') canopies.add(l.x, y + 22, l.z, rng.range(0, 6), 10, 8, 10, col);
          chunk.colliders.push({ x: l.x, z: l.z, r: 1.5 });
          break;
        }
        case 'sunRocks':
          chunk.clearZones.push({ x: l.x, z: l.z, r: 7 });
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2, d = i === 0 ? 0 : rng.range(2.2, 4.5);
            const rx = l.x + Math.cos(a) * d, rz = l.z + Math.sin(a) * d;
            const s = i === 0 ? 5 : rng.range(2, 3.5);
            rocks[i % 3].add(rx, chunk.heightAt(rx, rz) - 0.4, rz, rng.range(0, 6), s, s * 0.45, s, [0.78, 0.74, 0.66]);
            chunk.colliders.push({ x: rx, z: rz, r: s * 0.38 });
          }
          break;
        case 'hollow':
          chunk.clearZones.push({ x: l.x, z: l.z, r: 8 });
          break;
        case 'fallenGiant': {
          chunk.clearZones.push({ x: l.x, z: l.z, r: 8 });
          const rot = rng.range(0, Math.PI);
          logs.add(l.x, y + 0.4, l.z, rot, 13, 1.6, 1.6, [0.9, 0.85, 0.8]);
          for (let t = -5; t <= 5; t += 2.5) chunk.colliders.push({ x: l.x + Math.cos(rot) * t, z: l.z - Math.sin(rot) * t, r: 0.9 });
          break;
        }
        case 'oldSett': {
          chunk.clearZones.push({ x: l.x, z: l.z, r: 6 });
          const m = new THREE.SphereGeometry(3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
          m.scale(1, 0.35, 1);
          m.translate(l.x - chunk.x0, y - 0.2, l.z - chunk.z0);
          props.push(prep(m, (px, py) => [0.42 + py * 0.02, 0.34, 0.22]));
          for (let i = 0; i < 3; i++) {
            const a = i * 2.1;
            const hole = new THREE.CircleGeometry(0.35, 10);
            hole.rotateX(-Math.PI / 2 + 0.6);
            hole.rotateY(-a);
            hole.translate(l.x - chunk.x0 + Math.cos(a) * 2.4, y + 0.45, l.z - chunk.z0 + Math.sin(a) * 2.4);
            props.push(prep(hole, [0.08, 0.06, 0.05]));
          }
          chunk.colliders.push({ x: l.x, z: l.z, r: 2.2 });
          break;
        }
        case 'pond': {
          chunk.clearZones.push({ x: l.x, z: l.z, r: l.radius + 2 });
          const pond = ctx.terrain.ponds.find((p) => Math.hypot(p.x - l.x, p.z - l.z) < 1);
          if (pond) {
            const pg = new THREE.CircleGeometry(l.radius * 1.15, 24);
            pg.rotateX(-Math.PI / 2);
            const pm = new THREE.Mesh(pg, this.pondMat);
            pm.position.set(l.x, pond.h0 - 0.3, l.z);
            pm.renderOrder = 2;
            chunk.group.add(pm);
            for (let i = 0; i < 14; i++) {
              const a = rng.range(0, Math.PI * 2), d = l.radius * rng.range(0.9, 1.3);
              const rx = l.x + Math.cos(a) * d, rz = l.z + Math.sin(a) * d;
              reeds.add(rx, chunk.heightAt(rx, rz), rz, rng.range(0, 6), 1, rng.range(0.8, 1.3), 1, [0.5, 0.7, 0.35]);
            }
          }
          break;
        }
        case 'trainingHollow':
          chunk.clearZones.push({ x: l.x, z: l.z, r: 10 });
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + 0.4;
            const rx = l.x + Math.cos(a) * 7, rz = l.z + Math.sin(a) * 7;
            logs.add(rx, chunk.heightAt(rx, rz) + 0.15, rz, a + Math.PI / 2, 2.5, 0.5, 0.5, [0.9, 0.85, 0.8]);
            chunk.colliders.push({ x: rx, z: rz, r: 0.6 });
          }
          break;
        case 'councilRocks':
          chunk.clearZones.push({ x: l.x, z: l.z, r: 18 });
          rocks[0].add(l.x, y - 0.6, l.z, 0, 5, 2.4, 5, [0.8, 0.78, 0.74]);
          chunk.colliders.push({ x: l.x, z: l.z, r: 2 });
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.3;
            const rx = l.x + Math.cos(a) * 11, rz = l.z + Math.sin(a) * 11;
            rocks[(i + 1) % 3].add(rx, chunk.heightAt(rx, rz) - 0.5, rz, a, 3.5, 5, 3.5, [0.72, 0.7, 0.68]);
            chunk.colliders.push({ x: rx, z: rz, r: 1.5 });
          }
          break;
        case 'borderStone':
          rocks[1].add(l.x, y - 0.1, l.z, rng.range(0, 6), 0.9, 1.3, 0.9, [0.7, 0.66, 0.6]);
          chunk.colliders.push({ x: l.x, z: l.z, r: 0.35 });
          break;
      }
    }

    // --- structures: houses, ruins, caves, hidden clearings
    const centerX = chunk.x0 + CHUNK_SIZE / 2, centerZ = chunk.z0 + CHUNK_SIZE / 2;
    const cs = ctx.terrain.sample(centerX, centerZ);
    const campD = Math.hypot(centerX, centerZ);
    if (chunk.dominant === 'farmland' && campD > 240) {
      const n = rng.int(0, 2);
      for (let k = 0; k < n; k++) {
        const hx = chunk.x0 + rng.range(12, 52), hz = chunk.z0 + rng.range(12, 52);
        const s = sampleAt(hx, hz);
        if (s.road > 0.05 || s.river > 0 || s.lake > 0 || s.bank > 0.2 || this.blocked(chunk, hx, hz, 8)) continue;
        this.buildHouse(chunk, hx, hz, rng, props, windowParts);
      }
    } else if ((chunk.dominant === 'forest' || chunk.dominant === 'pine' || chunk.dominant === 'hills') && campD > 200 && cs.human > -0.25 && rng.chance(0.06)) {
      const hx = chunk.x0 + rng.range(14, 50), hz = chunk.z0 + rng.range(14, 50);
      const s = sampleAt(hx, hz);
      if (s.river === 0 && s.lake === 0 && !this.blocked(chunk, hx, hz, 8)) this.buildRuin(chunk, hx, hz, rng, props);
    }
    if ((chunk.dominant === 'mountain' || chunk.dominant === 'rocky') && rng.chance(0.22)) {
      const hx = chunk.x0 + rng.range(12, 52), hz = chunk.z0 + rng.range(12, 52);
      const s = sampleAt(hx, hz);
      if (s.river === 0 && s.lake === 0 && s.h > BASE_WATER + 2 && !this.blocked(chunk, hx, hz, 7)) this.buildCave(chunk, hx, hz, rng, caveParts);
    }
    if ((chunk.dominant === 'forest' || chunk.dominant === 'pine') && campD > 60 && rng.chance(0.07)) {
      const hx = chunk.x0 + rng.range(16, 48), hz = chunk.z0 + rng.range(16, 48);
      if (!this.blocked(chunk, hx, hz, 10) && sampleAt(hx, hz).river === 0) {
        chunk.clearZones.push({ x: hx, z: hz, r: 11 });
        chunk.structures.push({ type: 'clearing', x: hx, z: hz, r: 11, name: 'a hidden clearing' });
      }
    }

    // --- extra world mods: fallen logs, rockslides
    for (const lg of ctx.mods.logs) {
      if (lg.x < chunk.x0 || lg.x >= chunk.x0 + CHUNK_SIZE || lg.z < chunk.z0 || lg.z >= chunk.z0 + CHUNK_SIZE) continue;
      logs.add(lg.x, chunk.heightAt(lg.x, lg.z) + 0.3, lg.z, lg.rot, lg.len, 0.9, 0.9, [0.95, 0.85, 0.75]);
      for (let t = -lg.len / 2; t <= lg.len / 2; t += 1.2) chunk.colliders.push({ x: lg.x + Math.cos(lg.rot) * t, z: lg.z - Math.sin(lg.rot) * t, r: 0.55 });
      chunk.clearZones.push({ x: lg.x, z: lg.z, r: 2 });
    }
    for (const rs of ctx.mods.rockslides) {
      if (Math.abs(rs.x - centerX) > CHUNK_SIZE / 2 + rs.r || Math.abs(rs.z - centerZ) > CHUNK_SIZE / 2 + rs.r) continue;
      const rr = new RNG(hash2(Math.floor(rs.x), Math.floor(rs.z), 99));
      for (let i = 0; i < 18; i++) {
        const a = rr.range(0, Math.PI * 2), d = rr.range(0, rs.r);
        const rx = rs.x + Math.cos(a) * d, rz = rs.z + Math.sin(a) * d;
        if (rx < chunk.x0 || rx >= chunk.x0 + CHUNK_SIZE || rz < chunk.z0 || rz >= chunk.z0 + CHUNK_SIZE) continue;
        const s = rr.range(0.6, 2.2);
        rocks[i % 3].add(rx, chunk.heightAt(rx, rz) - 0.1, rz, rr.range(0, 6), s, s * 0.7, s, [0.66, 0.62, 0.56]);
        if (s > 1.2) chunk.colliders.push({ x: rx, z: rz, r: s * 0.4 });
      }
    }

    // --- trees (4m grid)
    const cell = 4;
    for (let gz = 0; gz < CHUNK_SIZE / cell; gz++)
      for (let gx = 0; gx < CHUNK_SIZE / cell; gx++) {
        const x = chunk.x0 + gx * cell + rng.range(0.3, cell - 0.3);
        const z = chunk.z0 + gz * cell + rng.range(0.3, cell - 0.3);
        const r0 = rng.next(), r1 = rng.next(), r2 = rng.next();
        const s = sampleAt(x, z);
        if (s.river > 0.05 || s.lake > 0.05 || s.stream > 0.2 || s.road > 0.05 || s.bank > 0.5) continue;
        if (s.campDist < 23) continue;
        if (this.blocked(chunk, x, z, 1.5)) continue;
        const y = chunk.heightAt(x, z);
        if (y < this.waterLevel + 0.1) continue;
        const burn = this.burnAt(x, z);
        let pDecid = 0, pPine = 0, pBirch = 0;
        switch (s.biome) {
          case 'forest': pDecid = 0.42; pBirch = 0.07; pPine = 0.04; break;
          case 'pine': pPine = 0.5; pDecid = 0.05; break;
          case 'meadow': pDecid = 0.025; break;
          case 'marsh': pDecid = 0.06; break;
          case 'hills': pDecid = 0.06; pPine = 0.05; break;
          case 'mountain': pPine = s.h < 55 ? 0.14 : 0.02; break;
          case 'rocky': pPine = 0.07; pDecid = 0.03; break;
          case 'farmland': pDecid = 0.02; break;
        }
        // denser ring around camp for enclosure
        if (s.campDist < 40) pDecid += 0.25;
        const rot = rng.range(0, Math.PI * 2);
        const lean = rng.range(-0.05, 0.05);
        if (burn > 0.4 && r0 < pDecid + pPine + pBirch) {
          const hgt = rng.range(6, 12);
          dead.add(x, y - 0.1, z, rot, hgt * 0.9, hgt, hgt * 0.9, [0.16, 0.13, 0.12], lean, lean);
          chunk.colliders.push({ x, z, r: 0.35 });
          continue;
        }
        if (r0 < pDecid) {
          const hgt = rng.range(9, 16) * (s.biome === 'marsh' ? 0.7 : 1);
          const w = hgt * rng.range(0.85, 1.15);
          trunks.add(x, y - 0.2, z, rot, w, hgt, w, jitterColor([0.46, 0.35, 0.26], rng, 0.12), lean, lean);
          const col = jitterColor(rng.pick(CANOPY[season]), rng, 0.1);
          const cr = hgt * rng.range(0.32, 0.42);
          if (season !== 'winter' || r2 < 0.25) canopies.add(x, y + hgt * 0.86, z, rot, cr, cr * rng.range(0.75, 0.95), cr, season === 'winter' ? [0.45, 0.36, 0.26] : col);
          chunk.colliders.push({ x, z, r: 0.18 * w / 1.2 + 0.1 });
        } else if (r0 < pDecid + pBirch) {
          const hgt = rng.range(8, 13);
          trunks.add(x, y - 0.2, z, rot, hgt * 0.6, hgt, hgt * 0.6, [0.95, 0.93, 0.88], lean, lean);
          const cr = hgt * 0.26;
          if (season !== 'winter') canopies.add(x, y + hgt * 0.88, z, rot, cr, cr * 1.3, cr, season === 'autumn' ? [0.95, 0.8, 0.25] : jitterColor([0.55, 0.72, 0.3], rng));
          chunk.colliders.push({ x, z, r: 0.14 });
        } else if (r0 < pDecid + pBirch + pPine) {
          const hgt = rng.range(10, 20) * (s.biome === 'mountain' ? 0.7 : 1);
          pines.add(x, y - 0.2, z, rot, hgt * rng.range(0.85, 1.1), hgt, hgt * rng.range(0.85, 1.1), jitterColor(season === 'winter' ? [0.2, 0.32, 0.24] : [0.24, 0.42, 0.25], rng, 0.1), lean, lean);
          chunk.colliders.push({ x, z, r: 0.25 });
        } else if (r1 < 0.03 && (s.biome === 'forest' || s.biome === 'pine')) {
          logs.add(x, y + 0.15, z, rot, rng.range(2, 5), 0.35, 0.35, [0.9, 0.85, 0.8]);
        }
      }

    // --- bushes & rocks (2m grid)
    const c2 = 2;
    for (let gz = 0; gz < CHUNK_SIZE / c2; gz++)
      for (let gx = 0; gx < CHUNK_SIZE / c2; gx++) {
        const x = chunk.x0 + gx * c2 + rng.range(0, c2);
        const z = chunk.z0 + gz * c2 + rng.range(0, c2);
        const r0 = rng.next();
        const s = sampleAt(x, z);
        if (s.road > 0.05 || s.campDist < 21) continue;
        const y = chunk.heightAt(x, z);
        const inWater = s.river > 0.1 || s.lake > 0.1 || y < this.waterLevel;
        if (this.blocked(chunk, x, z, 0.5)) continue;
        let pBush = 0, pRock = 0, pReed = 0;
        switch (s.biome) {
          case 'forest': pBush = 0.05; pRock = 0.006; break;
          case 'pine': pBush = 0.015; pRock = 0.012; break;
          case 'meadow': pBush = 0.008; pRock = 0.004; break;
          case 'marsh': pReed = 0.12; pBush = 0.01; break;
          case 'hills': pBush = 0.012; pRock = 0.02; break;
          case 'mountain': pRock = 0.05; break;
          case 'rocky': pRock = 0.07; pBush = 0.01; break;
          case 'farmland': pBush = 0.004; break;
        }
        if (s.bank > 0.3) { pReed += 0.08; pRock += 0.02; }
        if (s.campDist < 30) pBush += 0.12;
        if (inWater && !(s.bank > 0.2 && pReed > 0)) { if (r0 < 0.01) rocks[1].add(x, y - 0.2, z, r0 * 600, 1, 0.6, 1, [0.55, 0.55, 0.5]); continue; }
        const burn = this.burnAt(x, z);
        if (burn > 0.5) continue;
        if (r0 < pBush) {
          const sc = rng.range(0.7, 1.6);
          const col = season === 'autumn' ? jitterColor([0.6, 0.45, 0.2], rng) : season === 'winter' ? [0.35, 0.3, 0.22] as [number, number, number] : jitterColor([0.3, 0.52, 0.22], rng);
          bushes.add(x, y - 0.1, z, rng.range(0, 6), sc, sc * rng.range(0.7, 1), sc, col);
        } else if (r0 < pBush + pRock) {
          const sc = rng.range(0.4, 2.2) * (s.biome === 'mountain' ? 1.8 : 1);
          rocks[rng.int(0, 2)].add(x, y - sc * 0.15, z, rng.range(0, 6), sc, sc * rng.range(0.6, 1.1), sc, jitterColor([0.72, 0.7, 0.66], rng, 0.1));
          if (sc > 1.1) chunk.colliders.push({ x, z, r: sc * 0.38 });
        } else if (r0 < pBush + pRock + pReed) {
          reeds.add(x, y - 0.1, z, rng.range(0, 6), 1, rng.range(0.7, 1.4), 1, season === 'winter' ? [0.6, 0.5, 0.35] : jitterColor([0.5, 0.66, 0.32], rng));
        }
      }

    // --- spawn points for wildlife
    for (let i = 0; i < 26; i++) {
      const x = chunk.x0 + rng.range(2, CHUNK_SIZE - 2), z = chunk.z0 + rng.range(2, CHUNK_SIZE - 2);
      const s = sampleAt(x, z);
      const y = chunk.heightAt(x, z);
      if (s.road > 0.1) continue;
      const water = y < this.waterLevel + 0.3 && y > this.waterLevel - 1.2;
      if (y < this.waterLevel - 0.2 && !water) continue;
      chunk.spawns.push({ x, z, biome: s.biome, water: water || s.bank > 0.4 });
    }

    // --- build meshes
    const add = (m: THREE.InstancedMesh | null) => { if (m) { (m as any).sharedGeo = true; chunk.group.add(m); } };
    add(trunks.build(A.trunk, A.mat.trunk, true));
    const cHi = canopies.build(A.canopy, A.mat.canopy, true);
    const cLo = canopies.build(A.canopyLo, A.mat.canopy, true);
    add(cHi);
    add(cLo);
    if (cHi && cLo) { chunk.lodHi.push(cHi); chunk.lodLo.push(cLo); }
    add(pines.build(A.pine, A.mat.pine, true));
    const bHi = bushes.build(A.bush, A.mat.bush, true);
    const bLo = bushes.build(A.bushLo, A.mat.bush, false);
    add(bHi);
    add(bLo);
    if (bHi && bLo) { chunk.lodHi.push(bHi); chunk.lodLo.push(bLo); }
    rocks.forEach((r, i) => add(r.build(A.rocks[i], A.mat.rock, true)));
    add(logs.build(A.log, A.mat.static, true));
    add(dead.build(A.deadTree, A.mat.static, true));
    add(reeds.build(A.reed, A.mat.reed, false));
    if (props.length) {
      const pm = new THREE.Mesh(mergeGeometries(props)!, this.propMat);
      pm.position.set(chunk.x0, 0, chunk.z0);
      pm.castShadow = true;
      pm.receiveShadow = true;
      chunk.group.add(pm);
    }
    if (caveParts.length) {
      const cm = new THREE.Mesh(mergeGeometries(caveParts)!, this.caveMat);
      cm.position.set(chunk.x0, 0, chunk.z0);
      cm.castShadow = true;
      cm.receiveShadow = true;
      chunk.group.add(cm);
    }
    if (windowParts.length) {
      const wm = new THREE.Mesh(mergeGeometries(windowParts)!, this.windowMat);
      wm.position.set(chunk.x0, 0, chunk.z0);
      chunk.windows = wm;
      chunk.group.add(wm);
    }
    void W;
  }

  private buildHouse(chunk: Chunk, hx: number, hz: number, rng: RNG, props: THREE.BufferGeometry[], windows: THREE.BufferGeometry[]) {
    const w = rng.range(7, 10), d = rng.range(6, 8), h = rng.range(3.2, 4.2);
    let y = Infinity;
    for (const [ox, oz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) y = Math.min(y, chunk.heightAt(hx + ox, hz + oz));
    const rot = rng.range(0, Math.PI);
    const lx = hx - chunk.x0, lz = hz - chunk.z0;
    const wallCol: [number, number, number] = rng.pick([[0.92, 0.86, 0.74], [0.75, 0.42, 0.32], [0.85, 0.82, 0.78], [0.7, 0.66, 0.55]]);
    const roofCol: [number, number, number] = rng.pick([[0.45, 0.2, 0.16], [0.3, 0.3, 0.34], [0.36, 0.26, 0.2]]);
    const place = (g: THREE.BufferGeometry, col: [number, number, number] | null, target = props) => {
      g.rotateY(rot);
      g.translate(lx, y, lz);
      target.push(col ? prep(g, col) : prep(g, [1, 1, 1]));
    };
    const walls = new THREE.BoxGeometry(w, h, d);
    walls.translate(0, h / 2 - 0.3, 0);
    place(walls, wallCol);
    const roof = new THREE.CylinderGeometry(0.01, 1, 1, 4, 1);
    roof.rotateY(Math.PI / 4);
    roof.scale(w * 0.78, 2.2, d * 0.78);
    roof.translate(0, h - 0.3 + 1.1, 0);
    place(roof, roofCol);
    const chim = new THREE.BoxGeometry(0.6, 2, 0.6);
    chim.translate(w * 0.28, h + 1.2, 0);
    place(chim, [0.5, 0.3, 0.25]);
    const door = new THREE.BoxGeometry(1.1, 2.1, 0.1);
    door.translate(0, 0.75, d / 2 + 0.02);
    place(door, [0.35, 0.22, 0.14]);
    for (const sx of [-w / 3, w / 3]) {
      for (const sz of [d / 2 + 0.03, -d / 2 - 0.03]) {
        const win = new THREE.BoxGeometry(1, 0.9, 0.06);
        win.translate(sx, h * 0.55, sz);
        place(win, null, windows);
      }
    }
    // fence around the garden
    const fr = Math.max(w, d) * 0.9 + 2;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      if (Math.abs(Math.sin(a - rot) - 1) < 0.1) continue; // gap
      const fx = Math.cos(a) * fr, fz = Math.sin(a) * fr;
      const post = new THREE.BoxGeometry(0.12, 1, 0.12);
      post.translate(lx + fx, chunk.heightAt(hx + fx, hz + fz) + 0.4, lz + fz);
      props.push(prep(post, [0.55, 0.42, 0.3]));
    }
    const cr = Math.max(w, d) / 2;
    for (let t = -1; t <= 1; t += 0.5) {
      const ca = Math.cos(rot), sa = Math.sin(rot);
      chunk.colliders.push({ x: hx + ca * t * (w / 2 - 1), z: hz - sa * t * (w / 2 - 1), r: Math.min(w, d) / 2 });
    }
    chunk.clearZones.push({ x: hx, z: hz, r: cr + 3 });
    chunk.structures.push({ type: 'house', x: hx, z: hz, r: fr, name: 'a Tallfolk den' });
  }

  private buildRuin(chunk: Chunk, hx: number, hz: number, rng: RNG, props: THREE.BufferGeometry[]) {
    const w = rng.range(6, 9), d = rng.range(5, 7);
    const y = chunk.heightAt(hx, hz);
    const rot = rng.range(0, Math.PI);
    const lx = hx - chunk.x0, lz = hz - chunk.z0;
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const segs: [number, number, number, number][] = [
      [0, -d / 2, w, 0], [0, d / 2, w, 0], [-w / 2, 0, d, Math.PI / 2], [w / 2, 0, d, Math.PI / 2],
    ];
    segs.forEach(([ox, oz, len, r], i) => {
      const pieces = 3;
      for (let p = 0; p < pieces; p++) {
        if (rng.chance(0.3) && i !== 0) continue;
        const ph = rng.range(0.6, 2.6);
        const g = new THREE.BoxGeometry(len / pieces - 0.1, ph, 0.45);
        g.translate((p - (pieces - 1) / 2) * (len / pieces), ph / 2 - 0.2, 0);
        g.rotateY(r);
        g.translate(ox, 0, oz);
        g.rotateY(rot);
        g.translate(lx, y, lz);
        props.push(prep(g, (_x, py) => (py - y > ph - 0.35 ? [0.35, 0.5, 0.28] : [0.6, 0.58, 0.54])));
        const wx = (p - (pieces - 1) / 2) * (len / pieces);
        let px = r ? ox : ox + wx, pz = r ? oz + wx : oz;
        chunk.colliders.push({ x: hx + px * ca + pz * sa, z: hz - px * sa + pz * ca, r: len / pieces / 2 });
      }
    });
    chunk.clearZones.push({ x: hx, z: hz, r: Math.max(w, d) / 2 + 2 });
    chunk.structures.push({ type: 'ruin', x: hx, z: hz, r: Math.max(w, d) / 2 + 1, name: 'an abandoned Tallfolk barn' });
  }

  private buildCave(chunk: Chunk, hx: number, hz: number, rng: RNG, parts: THREE.BufferGeometry[]) {
    const R = rng.range(5, 7);
    const y = chunk.heightAt(hx, hz);
    const rot = rng.range(0, Math.PI * 2);
    const opening = 1.1;
    const g = new THREE.SphereGeometry(R, 20, 10, opening / 2, Math.PI * 2 - opening, 0, Math.PI / 2);
    displace2(g, 0.12);
    g.scale(1, 0.75, 1);
    g.rotateY(rot);
    g.translate(hx - chunk.x0, y - 0.6, hz - chunk.z0);
    parts.push(prep(g, (x, py, z) => {
      const v = 0.45 + (py - y) * 0.03 + Math.sin(x * 2.1 + z * 1.7) * 0.03;
      return [v, v * 0.97, v * 0.92];
    }));
    const floor = new THREE.CircleGeometry(R * 0.95, 16);
    floor.rotateX(-Math.PI / 2);
    floor.translate(hx - chunk.x0, y + 0.05, hz - chunk.z0);
    parts.push(prep(floor, [0.2, 0.18, 0.16]));
    // glowing cave mushrooms
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2), dd = rng.range(1, R * 0.8);
      const m = new THREE.SphereGeometry(0.06, 5, 3);
      m.translate(hx - chunk.x0 + Math.cos(a) * dd, y + 0.08, hz - chunk.z0 + Math.sin(a) * dd);
      parts.push(prep(m, [0.5, 0.9, 1.0]));
    }
    // colliders around the wall except the opening (opening faces angle PI - rot)
    const openA = Math.PI - rot;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      let dA = Math.abs(a - openA) % (Math.PI * 2);
      if (dA > Math.PI) dA = Math.PI * 2 - dA;
      if (dA < opening / 2 + 0.3) continue;
      chunk.colliders.push({ x: hx + Math.cos(a) * R, z: hz + Math.sin(a) * R, r: 0.9 });
    }
    chunk.clearZones.push({ x: hx, z: hz, r: R + 2 });
    chunk.structures.push({ type: 'cave', x: hx, z: hz, r: R * 0.9, name: 'a hidden cave' });
  }

  // -------------------------------------------------------------- detail layer

  private buildDetail(chunk: Chunk) {
    const ctx = this.ctx;
    const A = assets();
    const rng = new RNG(hash2(chunk.cx, chunk.cz, ctx.seed + 31));
    const season = ctx.season;
    const detail = new THREE.Group();
    const grass = new InstBuilder();
    const ferns = new InstBuilder();
    const flowers = new InstBuilder();
    const mush = new InstBuilder();
    const herbs = new InstBuilder();
    const moss = new InstBuilder();
    const herbData: { kind: HerbKind; x: number; y: number; z: number }[] = [];
    const mossData: { x: number; y: number; z: number }[] = [];
    const gt = GRASS_TINT[season];
    const cell = 1.1 / Math.sqrt(this.grassDensity);
    const n = Math.floor(CHUNK_SIZE / cell);
    const flowerCols: [number, number, number][] =
      season === 'spring' ? [[1, 0.95, 0.5], [0.95, 0.6, 0.8], [0.7, 0.75, 1], [1, 1, 1]]
        : season === 'summer' ? [[1, 0.85, 0.3], [0.9, 0.35, 0.3], [0.8, 0.6, 1]]
          : season === 'autumn' ? [[0.95, 0.6, 0.25], [0.8, 0.5, 0.9]] : [];
    for (let gz = 0; gz < n; gz++)
      for (let gx = 0; gx < n; gx++) {
        const x = chunk.x0 + (gx + rng.next()) * cell;
        const z = chunk.z0 + (gz + rng.next()) * cell;
        const r0 = rng.next();
        const idx = chunk.nearestIndex(x, z);
        const f = chunk.flags[idx];
        if (f & 3) continue; // water or road
        const biome = BIOMES[chunk.biomes[idx]];
        const y = chunk.heightAt(x, z);
        if (y < this.waterLevel + 0.05) continue;
        const campD = Math.hypot(x, z);
        if (campD < 12) continue;
        if (f & 8) { if (r0 < 0.04) grass.add(x, y, z, r0 * 100, 0.2, 0.2, 0.2, [0.3, 0.45, 0.2]); continue; }
        let pGrass = 0, pFern = 0, pFlower = 0, pMush = 0, hMul = 1;
        switch (biome) {
          case 'forest': pGrass = 0.35; pFern = 0.07; pFlower = 0.015; pMush = 0.01; hMul = 0.7; break;
          case 'pine': pGrass = 0.15; pFern = 0.05; pMush = 0.012; hMul = 0.6; break;
          case 'meadow': pGrass = 0.85; pFlower = 0.08; hMul = 1.25; break;
          case 'marsh': pGrass = 0.55; hMul = 1.3; break;
          case 'hills': pGrass = 0.7; pFlower = 0.03; hMul = 0.9; break;
          case 'mountain': pGrass = y > 55 ? 0.02 : 0.2; hMul = 0.5; break;
          case 'rocky': pGrass = 0.2; hMul = 0.6; break;
          case 'farmland': pGrass = 0.7; hMul = 1.1; break;
        }
        if (campD < 20) { pGrass *= 0.25; pFern = 0; pFlower = 0; }
        for (const cz of chunk.clearZones) {
          if (Math.hypot(x - cz.x, z - cz.z) < cz.r) {
            const cl = chunk.structures.find((s) => s.type === 'clearing' && s.x === cz.x);
            if (cl) { pFlower = 0.3; pGrass = 0.7; }
          }
        }
        if (season === 'winter') { pFlower = 0; pFern *= 0.3; }
        if (r0 < pFlower && flowerCols.length) {
          flowers.add(x, y, z, rng.range(0, 6), 1, rng.range(0.7, 1.4), 1, rng.pick(flowerCols));
        } else if (r0 < pFlower + pFern) {
          const s = rng.range(0.4, 0.9);
          ferns.add(x, y, z, rng.range(0, 6), s, s, s, season === 'autumn' ? [0.7, 0.5, 0.2] : jitterColor([0.35, 0.58, 0.24], rng));
        } else if (r0 < pFlower + pFern + pMush) {
          mush.add(x, y, z, 0, 1, 1, 1, rng.pick([[0.85, 0.3, 0.2], [0.9, 0.8, 0.6], [0.7, 0.5, 0.3]] as [number, number, number][]));
        } else if (r0 < pFlower + pFern + pMush + pGrass) {
          const h = rng.range(0.18, 0.42) * hMul;
          const tint: [number, number, number] = biome === 'marsh' ? [0.48, 0.55, 0.3] : biome === 'farmland' && season !== 'spring' ? [0.8, 0.7, 0.4] : gt;
          grass.add(x, y - 0.02, z, rng.range(0, 6), rng.range(0.7, 1.2), h, rng.range(0.7, 1.2), jitterColor(tint, rng, 0.12));
        }
      }
    // Herbs & moss: a few special interactables per chunk
    const nh = rng.int(1, 4);
    for (let i = 0; i < nh + 3; i++) {
      const x = chunk.x0 + rng.range(2, CHUNK_SIZE - 2), z = chunk.z0 + rng.range(2, CHUNK_SIZE - 2);
      const idx = chunk.nearestIndex(x, z);
      if (chunk.flags[idx] & 11) continue;
      if (Math.hypot(x, z) < 22) continue;
      const biome = BIOMES[chunk.biomes[idx]];
      const y = chunk.heightAt(x, z);
      if (y < this.waterLevel + 0.05) continue;
      if (i < nh) {
        if (season === 'winter' && rng.chance(0.6)) continue;
        const kind: HerbKind = biome === 'marsh' ? 'bitterroot' : biome === 'meadow' || biome === 'hills' ? 'sunpetal' : rng.pick(['silverleaf', 'silverleaf', 'bitterroot', 'sunpetal'] as HerbKind[]);
        herbData.push({ kind, x, y, z });
      } else if (biome === 'forest' || biome === 'pine' || biome === 'marsh') {
        mossData.push({ x, y, z });
      }
    }
    const regrow = 3;
    herbData.forEach((h, i) => {
      const key = `${chunk.cx},${chunk.cz},h${i}`;
      const taken = ctx.mods.taken[key];
      if (taken !== undefined && ctx.day - taken >= regrow) delete ctx.mods.taken[key];
      const hidden = ctx.mods.taken[key] !== undefined;
      herbs.add(h.x, h.y, h.z, i, hidden ? 0 : 1.6, hidden ? 0 : 1.6, hidden ? 0 : 1.6, HERB_INFO[h.kind].color);
    });
    mossData.forEach((m, i) => {
      const key = `${chunk.cx},${chunk.cz},m${i}`;
      const taken = ctx.mods.taken[key];
      if (taken !== undefined && ctx.day - taken >= 2) delete ctx.mods.taken[key];
      const hidden = ctx.mods.taken[key] !== undefined;
      moss.add(m.x, m.y, m.z, i, hidden ? 0 : 1.4, hidden ? 0 : 1.4, hidden ? 0 : 1.4, [1, 1, 1]);
    });
    // Deathberry bushes (yew): bright red, deadly poisonous
    const berries = new InstBuilder();
    const berryData: { x: number; y: number; z: number }[] = [];
    const brng = new RNG(hash2(chunk.cx, chunk.cz, ctx.seed + 77));
    const nb = brng.chance(0.55) ? brng.int(1, 2) : 0;
    for (let i = 0; i < nb; i++) {
      const x = chunk.x0 + brng.range(3, CHUNK_SIZE - 3), z = chunk.z0 + brng.range(3, CHUNK_SIZE - 3);
      const idx = chunk.nearestIndex(x, z);
      const biome = BIOMES[chunk.biomes[idx]];
      if (chunk.flags[idx] & 11 || Math.hypot(x, z) < 24 || !(biome === 'forest' || biome === 'pine' || biome === 'marsh')) continue;
      const y = chunk.heightAt(x, z);
      if (y < this.waterLevel + 0.05) continue;
      berryData.push({ x, y, z });
    }
    berryData.forEach((b, i) => {
      const key = `${chunk.cx},${chunk.cz},b${i}`;
      const taken = ctx.mods.taken[key];
      if (taken !== undefined && ctx.day - taken >= 4) delete ctx.mods.taken[key];
      const k = ctx.mods.taken[key] !== undefined ? 0 : 1;
      berries.add(b.x, b.y, b.z, i * 1.7, k, k, k, [1, 1, 1]);
    });
    // Little treasures to collect and give as gifts
    const treasures = new InstBuilder();
    const treasureData: { kind: TreasureKind; x: number; y: number; z: number }[] = [];
    const trng = new RNG(hash2(chunk.cx, chunk.cz, ctx.seed + 991));
    const nt = trng.chance(0.6) ? trng.int(1, 3) : 0;
    const tkinds = Object.keys(TREASURE_INFO) as TreasureKind[];
    for (let i = 0; i < nt; i++) {
      const x = chunk.x0 + trng.range(2, CHUNK_SIZE - 2), z = chunk.z0 + trng.range(2, CHUNK_SIZE - 2);
      const idx = chunk.nearestIndex(x, z);
      const y = chunk.heightAt(x, z);
      const kind = trng.pick(tkinds);
      if (chunk.flags[idx] & 2 || y < this.waterLevel + 0.02 || Math.hypot(x, z) < 15) { trng.next(); continue; }
      treasureData.push({ kind, x, y, z });
    }
    treasureData.forEach((t, i) => {
      const key = `${chunk.cx},${chunk.cz},t${i}`;
      const taken = ctx.mods.taken[key];
      if (taken !== undefined && ctx.day - taken >= 12) delete ctx.mods.taken[key];
      const k = ctx.mods.taken[key] !== undefined ? 0 : 1;
      treasures.add(t.x, t.y + 0.03, t.z, i * 2.1, k * 1.2, k * (t.kind === 'feather' || t.kind === 'mossyStick' ? 0.35 : 0.8), k * (t.kind === 'feather' || t.kind === 'mossyStick' ? 2.2 : 1), TREASURE_INFO[t.kind].color);
    });
    const add = (m: THREE.InstancedMesh | null) => { if (m) { (m as any).sharedGeo = true; detail.add(m); } return m; };
    const tm = add(treasures.build(TREASURE_GEO, A.mat.static, false));
    const bm = add(berries.build(A.deathberry, A.mat.bush, false));
    add(grass.build(A.grass, A.mat.grass, false));
    add(ferns.build(A.fern, A.mat.fern, false));
    add(flowers.build(A.flower, A.mat.flower, false));
    add(mush.build(A.mushroom, A.mat.static, false));
    const hm = add(herbs.build(A.herb, A.mat.herb, false));
    const mm = add(moss.build(A.moss, A.mat.static, false));
    chunk.interactables = [];
    const tmp = new THREE.Matrix4();
    if (hm) herbData.forEach((h, i) => {
      hm.getMatrixAt(i, tmp);
      chunk.interactables.push({ key: `${chunk.cx},${chunk.cz},h${i}`, type: 'herb', kind: h.kind, x: h.x, y: h.y, z: h.z, mesh: hm, index: i, matrix: tmp.clone() });
    });
    if (mm) mossData.forEach((m, i) => {
      mm.getMatrixAt(i, tmp);
      chunk.interactables.push({ key: `${chunk.cx},${chunk.cz},m${i}`, type: 'moss', kind: 'moss', x: m.x, y: m.y, z: m.z, mesh: mm, index: i, matrix: tmp.clone() });
    });
    if (bm) berryData.forEach((b, i) => {
      bm.getMatrixAt(i, tmp);
      chunk.interactables.push({ key: `${chunk.cx},${chunk.cz},b${i}`, type: 'berries', kind: 'deathberry', x: b.x, y: b.y, z: b.z, mesh: bm, index: i, matrix: tmp.clone() });
    });
    if (tm) treasureData.forEach((t, i) => {
      tm.getMatrixAt(i, tmp);
      chunk.interactables.push({ key: `${chunk.cx},${chunk.cz},t${i}`, type: 'treasure', kind: t.kind, x: t.x, y: t.y, z: t.z, mesh: tm, index: i, matrix: tmp.clone() });
    });
    chunk.detail = detail;
    chunk.group.add(detail);
  }
}

function displace2(g: THREE.BufferGeometry, amt: number) {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + Math.sin(x * 1.3 + z * 0.7) * amt + Math.cos(z * 1.9 - y) * amt * 0.5;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
}
