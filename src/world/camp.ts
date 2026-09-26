// The home clan camp: a sheltered hollow ringed with brambles, dens, the
// High Rock where the leader speaks, and the fresh-kill pile.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain } from './terrain';
import { assets, prep } from './assets';
import { Collider } from './chunks';
import { Simplex2 } from '../core/noise';
import { RNG } from '../core/rng';

export type DenName = 'leader' | 'warriors' | 'apprentices' | 'nursery' | 'elders' | 'medicine';

export interface DenDef {
  name: DenName;
  label: string;
  x: number;
  z: number;
  radius: number;
  facing: number; // angle the opening faces
  beds: { x: number; z: number }[];
}

const noise = new Simplex2(42);

const DEN_LAYOUT: { name: DenName; label: string; angle: number; r: number; radius: number }[] = [
  { name: 'leader', label: "Leader's den", angle: -Math.PI / 2 + 0.28, r: 12.2, radius: 1.9 },
  { name: 'warriors', label: "Warriors' den", angle: -Math.PI / 2 - 0.8, r: 10.5, radius: 3.1 },
  { name: 'apprentices', label: "Apprentices' den", angle: -Math.PI / 2 + 0.95, r: 10.2, radius: 2.4 },
  { name: 'medicine', label: 'Medicine den', angle: 0.35, r: 10.5, radius: 2.3 },
  { name: 'nursery', label: 'Nursery', angle: Math.PI - 0.55, r: 10.2, radius: 2.7 },
  { name: 'elders', label: "Elders' den", angle: Math.PI + 0.25, r: 10.6, radius: 2.5 },
];

export const CAMP_RADIUS = 14.5;
export const ENTRANCE_ANGLE = Math.PI / 2;

export class Camp {
  group = new THREE.Group();
  dens: Record<DenName, DenDef> = {} as any;
  colliders: Collider[] = [];
  highRock = { x: 0, z: -9, top: 0 };
  pile = { x: 3.2, z: 1.5 };
  center = { x: 0, z: -2.5 };
  entrance = { x: 0, z: 17 };
  floorY = 0;
  private pileMesh: THREE.InstancedMesh;
  private fireflyAnchor = new THREE.Vector3();

  constructor(private terrain: Terrain, scene: THREE.Scene) {
    this.floorY = terrain.height(0, 0);
    const rng = new RNG(99);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const parts: THREE.BufferGeometry[] = [];
    const A = assets();

    // High Rock
    const hr = new THREE.DodecahedronGeometry(1, 1);
    const pos = hr.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + noise.noise(x * 2, z * 2 + y) * 0.15;
      pos.setXYZ(i, x * k * 3.2, (y > 0 ? y * 3 : y * 1) * k, z * k * 2.6);
    }
    hr.computeVertexNormals();
    const hy = terrain.height(this.highRock.x, this.highRock.z);
    hr.translate(this.highRock.x, hy + 0.3, this.highRock.z);
    this.highRock.top = hy + 3.1;
    parts.push(prep(hr, (x, y, z) => {
      const v = 0.55 + (y - hy) * 0.06 + noise.noise(x * 3, z * 3) * 0.05;
      const moss = y - hy > 2.4 ? 0.1 : 0;
      return [v - moss, v + moss * 0.5, v * 0.92 - moss];
    }));
    this.colliders.push({ x: this.highRock.x, z: this.highRock.z, r: 2.6 });
    this.colliders.push({ x: this.highRock.x - 1.8, z: this.highRock.z + 0.3, r: 1.6 });
    this.colliders.push({ x: this.highRock.x + 1.8, z: this.highRock.z + 0.3, r: 1.6 });

    // Dens
    for (const d of DEN_LAYOUT) {
      const x = Math.cos(d.angle) * d.r, z = Math.sin(d.angle) * d.r;
      const facing = Math.atan2(-z, -x); // open toward camp centre
      const beds: { x: number; z: number }[] = [];
      const nb = d.name === 'leader' ? 1 : d.name === 'warriors' ? 12 : 8;
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * Math.PI * 2 + 0.3;
        const rr = nb === 1 ? 0 : d.radius * (i % 2 ? 0.35 : 0.62);
        beds.push({ x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr });
      }
      this.dens[d.name] = { name: d.name, label: d.label, x, z, radius: d.radius, facing, beds };
      const gy = terrain.height(x, z);
      if (d.name === 'medicine' || d.name === 'leader') {
        // rock cleft
        for (let i = 0; i < 5; i++) {
          const a = facing + Math.PI + (i - 2) * 0.55;
          const rx = x + Math.cos(a) * d.radius, rz = z + Math.sin(a) * d.radius;
          const rg = A.rocks[i % 3].clone();
          const s = rng.range(1.6, 2.4);
          rg.scale(s, s * 1.3, s);
          rg.translate(rx, terrain.height(rx, rz) - 0.2, rz);
          parts.push(rg);
          this.colliders.push({ x: rx, z: rz, r: s * 0.36 });
        }
        if (d.name === 'medicine') {
          // herb bundles drying
          for (let i = 0; i < 6; i++) {
            const hb = new THREE.SphereGeometry(0.12, 5, 4);
            hb.scale(1, 0.6, 1);
            const a = facing + Math.PI + (i - 2.5) * 0.35;
            hb.translate(x + Math.cos(a) * d.radius * 0.6, gy + 0.08, z + Math.sin(a) * d.radius * 0.6);
            parts.push(prep(hb, i % 2 ? [0.55, 0.7, 0.35] : [0.8, 0.7, 0.3]));
          }
        }
      } else {
        const opening = d.name === 'nursery' ? 1.0 : 1.3;
        const g = new THREE.SphereGeometry(d.radius, 18, 9, 0, Math.PI * 2 - opening, 0, Math.PI / 2);
        // rotate so the gap faces `facing`
        g.rotateY(Math.PI + opening / 2 - facing);
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
          const k = 1 + noise.noise(px * 2.5 + d.r, pz * 2.5 + py * 2) * 0.16;
          p.setXYZ(i, px * k, py * k * (d.name === 'elders' ? 0.7 : 0.85), pz * k);
        }
        g.computeVertexNormals();
        g.translate(x, gy - 0.15, z);
        const thorny = d.name === 'nursery';
        parts.push(prep(g, (px, py, pz) => {
          const n = noise.noise(px * 4, pz * 4 + py * 3);
          const v = 0.55 + (py - gy) / d.radius * 0.35 + n * 0.1;
          return thorny ? [v * 0.42, v * 0.52, v * 0.3] : [v * 0.4 + n * 0.05, v * 0.55, v * 0.28];
        }));
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          let dA = Math.abs(a - facing) % (Math.PI * 2);
          if (dA > Math.PI) dA = Math.PI * 2 - dA;
          if (dA < opening / 2 + 0.25) continue;
          this.colliders.push({ x: x + Math.cos(a) * d.radius, z: z + Math.sin(a) * d.radius, r: 0.55 });
        }
        if (d.name === 'elders') {
          const lg = A.log.clone();
          lg.scale(d.radius * 2.4, 0.9, 0.9);
          lg.rotateY(facing + Math.PI / 2);
          lg.translate(x - Math.cos(facing) * d.radius * 0.8, gy + d.radius * 0.55, z - Math.sin(facing) * d.radius * 0.8);
          parts.push(lg);
        }
      }
      // moss beds
      for (const b of beds) {
        const m = A.moss.clone();
        m.scale(2.2, 1, 2.2);
        m.translate(b.x, terrain.height(b.x, b.z) + 0.01, b.z);
        parts.push(m);
      }
    }

    // Bramble wall
    const brambles: THREE.BufferGeometry[] = [];
    for (let row = 0; row < 2; row++) {
      const r = 16.2 + row * 1.7;
      const n = Math.floor((Math.PI * 2 * r) / 1.3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + row * 0.1;
        let dA = Math.abs(a - ENTRANCE_ANGLE);
        if (dA > Math.PI) dA = Math.PI * 2 - dA;
        if (dA < 0.2) continue;
        const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
        const s = rng.range(1.2, 2.1);
        const bg = A.bush.clone();
        bg.scale(s, s * rng.range(0.9, 1.4), s);
        bg.rotateY(rng.range(0, 6));
        bg.translate(bx, terrain.height(bx, bz) - 0.2, bz);
        const cc = bg.getAttribute('color');
        for (let k = 0; k < cc.count; k++) {
          const v = cc.getX(k);
          cc.setXYZ(k, v * 0.33, v * 0.48, v * 0.26);
        }
        brambles.push(bg);
        if (row === 0) this.colliders.push({ x: bx, z: bz, r: 0.95 });
      }
    }
    // entrance ferns / tunnel posts
    for (const side of [-1, 1]) {
      const a = ENTRANCE_ANGLE + side * 0.24;
      for (let r = 15.5; r < 20; r += 1.4) {
        const fx = Math.cos(a) * r, fz = Math.sin(a) * r;
        const fg = A.fern.clone();
        fg.scale(1.6, 1.8, 1.6);
        fg.translate(fx, terrain.height(fx, fz), fz);
        parts.push(prep(fg, [0.3, 0.55, 0.25]));
      }
    }
    this.entrance = { x: Math.cos(ENTRANCE_ANGLE) * 19, z: Math.sin(ENTRANCE_ANGLE) * 19 };

    const campMesh = new THREE.Mesh(mergeGeometries(parts)!, mat);
    campMesh.castShadow = true;
    campMesh.receiveShadow = true;
    this.group.add(campMesh);
    const bm = new THREE.Mesh(mergeGeometries(brambles)!, A.mat.bush);
    bm.castShadow = true;
    bm.receiveShadow = true;
    this.group.add(bm);

    // Fresh-kill pile
    const preyGeo = new THREE.SphereGeometry(0.08, 7, 5);
    preyGeo.scale(1.6, 0.8, 1);
    const pileGeo = prep(preyGeo, [1, 1, 1]);
    this.pileMesh = new THREE.InstancedMesh(pileGeo, A.mat.static, 20);
    const py = terrain.height(this.pile.x, this.pile.z);
    const m = new THREE.Matrix4();
    const cols = [[0.55, 0.45, 0.35], [0.45, 0.4, 0.38], [0.6, 0.55, 0.5], [0.4, 0.3, 0.22]];
    for (let i = 0; i < 20; i++) {
      const a = i * 2.39, r = 0.12 * Math.sqrt(i);
      m.makeRotationY(a);
      m.setPosition(this.pile.x + Math.cos(a) * r, py + 0.05 + Math.floor(i / 8) * 0.07, this.pile.z + Math.sin(a) * r);
      this.pileMesh.setMatrixAt(i, m);
      const c = cols[i % 4];
      this.pileMesh.setColorAt(i, new THREE.Color(c[0], c[1], c[2]));
    }
    this.pileMesh.castShadow = true;
    this.pileMesh.count = 0;
    this.group.add(this.pileMesh);

    scene.add(this.group);
    void this.fireflyAnchor;
  }

  setPileCount(food: number) {
    this.pileMesh.count = Math.max(0, Math.min(20, Math.ceil(food)));
  }

  isInCamp(x: number, z: number) {
    return Math.hypot(x, z) < CAMP_RADIUS + 1;
  }

  randomCampPoint(rng: () => number): { x: number; z: number } {
    const a = rng() * Math.PI * 2, r = 3 + rng() * 8;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.9 + 1 };
  }

  denAt(x: number, z: number): DenDef | null {
    for (const d of Object.values(this.dens)) if (Math.hypot(x - d.x, z - d.z) < d.radius + 0.4) return d;
    return null;
  }
}
