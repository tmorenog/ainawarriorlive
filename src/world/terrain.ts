// Deterministic procedural terrain: heights, biomes, rivers, lakes, roads.
// Everything is a pure function of (seed, x, z) so chunks can be streamed
// in any order and always match.
import { Simplex2 } from '../core/noise';
import { RNG } from '../core/rng';
import { clamp, lerp, smoothstep } from '../core/math';

export const CHUNK_SIZE = 64;
export const BASE_WATER = 0;

export type Biome =
  | 'forest'
  | 'pine'
  | 'meadow'
  | 'marsh'
  | 'hills'
  | 'mountain'
  | 'rocky'
  | 'farmland';

export const BIOME_NAMES: Record<Biome, string> = {
  forest: 'Dense Forest',
  pine: 'Pine Forest',
  meadow: 'Open Meadow',
  marsh: 'Marshland',
  hills: 'Rolling Hills',
  mountain: 'Mountains',
  rocky: 'Rocky Ground',
  farmland: 'Tallfolk Fields',
};

export interface TerrainSample {
  h: number;
  biome: Biome;
  river: number; // 0..1 how much this point is river channel
  bank: number; // 0..1 near river/lake edge
  lake: number;
  stream: number;
  road: number;
  human: number;
  moist: number;
  elev: number;
  mountain: number;
  marsh: number;
  campDist: number;
}

export class Terrain {
  readonly seed: number;
  private nElev: Simplex2;
  private nMoist: Simplex2;
  private nHuman: Simplex2;
  private nDetail: Simplex2;
  private nRiver: Simplex2;
  private nWarp: Simplex2;
  private nLake: Simplex2;
  private nRoad: Simplex2;
  private nRock: Simplex2;
  private nStream: Simplex2;
  private ox = 0;
  private oz = 0;
  private riverShift = 0;
  private streamShift = 0;
  campHeight = 0;
  private mods: { x: number; z: number; r: number; kind: 'pond' | 'flat'; h0: number }[] = [];

  constructor(seed: number) {
    this.seed = seed;
    this.nElev = new Simplex2(seed + 1);
    this.nMoist = new Simplex2(seed + 2);
    this.nHuman = new Simplex2(seed + 3);
    this.nDetail = new Simplex2(seed + 4);
    this.nRiver = new Simplex2(seed + 5);
    this.nWarp = new Simplex2(seed + 6);
    this.nLake = new Simplex2(seed + 7);
    this.nRoad = new Simplex2(seed + 8);
    this.nRock = new Simplex2(seed + 9);
    this.nStream = new Simplex2(seed + 10);
    this.pickCampOrigin();
    this.riverShift = this.riverRaw(60, 0);
    this.streamShift = this.streamRaw(-45, 70);
    this.campHeight = Math.max(this.rawHeight(0, 0).h, BASE_WATER + 5);
  }

  /** Search for a pleasant forest location to use as the clan camp origin. */
  private pickCampOrigin() {
    const rng = new RNG(this.seed ^ 0x9e3779b9);
    let best = { x: 0, z: 0, score: -1e9 };
    for (let i = 0; i < 400; i++) {
      const x = rng.range(-20000, 20000);
      const z = rng.range(-20000, 20000);
      const elev = this.nElev.fbm(x / 700, z / 700, 4);
      const moist = this.nMoist.fbm(x / 450 + 100, z / 450, 3);
      const human = this.nHuman.fbm(x / 900, z / 900, 2);
      let score = 0;
      score -= Math.abs(elev - 0.0) * 3;
      score -= Math.abs(moist - 0.05) * 2;
      score -= Math.max(0, human + 0.1) * 4;
      // Prefer a mountain range somewhere within reach for variety.
      const far = this.nElev.fbm((x + 500) / 700, z / 700, 4);
      score += far > 0.3 ? 0.4 : 0;
      if (score > best.score) best = { x, z, score };
    }
    this.ox = best.x;
    this.oz = best.z;
  }

  private riverRaw(x: number, z: number) {
    const wx = x + this.ox, wz = z + this.oz;
    const warp = this.nWarp.noise(wx / 160, wz / 160) * 0.35;
    return this.nRiver.fbm(wx / 420 + warp, wz / 420 - warp, 3);
  }

  private streamRaw(x: number, z: number) {
    const wx = x + this.ox, wz = z + this.oz;
    const warp = this.nWarp.noise(wx / 90 + 30, wz / 90) * 0.4;
    return this.nStream.fbm(wx / 220 + warp, wz / 220, 2);
  }

  /** Full height & field computation. */
  rawHeight(x: number, z: number): TerrainSample {
    const wx = x + this.ox, wz = z + this.oz;
    const campDist = Math.sqrt(x * x + z * z);
    const elev = this.nElev.fbm(wx / 700, wz / 700, 4);
    const moist = this.nMoist.fbm(wx / 450 + 100, wz / 450, 3);
    let human = this.nHuman.fbm(wx / 900, wz / 900, 2);
    human -= 0.7 * Math.exp(-(campDist * campDist) / (260 * 260));

    const mountain = smoothstep(0.22, 0.5, elev);
    const base = 4 + elev * 16;
    const hills = this.nDetail.fbm(wx / 130, wz / 130, 3) * (3 + 9 * smoothstep(0.0, 0.3, elev));
    const mount = mountain > 0 ? this.nRock.ridged(wx / 240, wz / 240, 5) * 90 * mountain : 0;
    const detail = this.nDetail.noise(wx / 17, wz / 17) * 0.45;
    let h = base + hills + mount + detail;
    const smoothH = base + hills;

    // Marsh flattening
    const marsh = smoothstep(0.3, 0.45, moist) * (1 - smoothstep(0.05, 0.18, elev)) * smoothstep(90, 140, campDist);
    h = lerp(h, BASE_WATER + 0.25 + this.nDetail.noise(wx / 11, wz / 11) * 0.55, marsh * 0.85);

    // Lakes
    const lk = this.nLake.fbm(wx / 520, wz / 520, 2);
    const lake = smoothstep(0.36, 0.48, lk) * (1 - mountain * 0.8) * smoothstep(70, 130, campDist);
    const lakeBank = smoothstep(0.3, 0.37, lk) * (1 - mountain * 0.8) * smoothstep(70, 130, campDist);
    h = lerp(h, BASE_WATER - 2.8, lake);

    // Rivers
    const rv = Math.abs(this.riverRaw(x, z) - this.riverShift);
    const rw = 0.02;
    let river = 1 - smoothstep(rw * 0.35, rw, rv);
    let bank = 1 - smoothstep(rw, rw * 2.4, rv);
    const campProtect = smoothstep(28, 45, campDist);
    river *= campProtect;
    bank *= campProtect;
    h = lerp(h, Math.min(h, BASE_WATER + 1.2), bank * 0.6);
    h = lerp(h, BASE_WATER - 1.6, river);

    // Small streams (shallow) — more common in wet forest
    const sv = Math.abs(this.streamRaw(x, z) - this.streamShift);
    const sw = 0.011 * (0.6 + smoothstep(-0.3, 0.3, moist) * 0.6);
    const stream = (1 - smoothstep(sw * 0.4, sw, sv)) * (1 - mountain) * smoothstep(24, 36, campDist);
    h = lerp(h, Math.min(h, BASE_WATER - 0.35), stream * 0.95);
    bank = Math.max(bank, (1 - smoothstep(sw, sw * 2.2, sv)) * (1 - mountain) * 0.7 * smoothstep(24, 36, campDist), lakeBank * 0.8);

    // Roads — thin, flat, mostly in Tallfolk land and never through home camp
    const rd = Math.abs(this.nRoad.fbm(wx / 650, wz / 650, 2));
    let road = 1 - smoothstep(0.004, 0.009, rd);
    road *= smoothstep(-0.15, 0.1, human) * smoothstep(190, 240, campDist) * (1 - mountain) * (1 - river) * (1 - lake);
    h = lerp(h, Math.max(smoothH, BASE_WATER + 0.8), road * 0.9);

    // Camp hollow
    if (campDist < 50) {
      const campBlend = 1 - smoothstep(24, 48, campDist);
      h = lerp(h, this.campHeight, campBlend);
      const hollow = 1.4 * (1 - smoothstep(13, 19, campDist));
      h -= hollow;
    }

    // Landmark modifiers (ponds, flattened clearings)
    for (const m of this.mods) {
      const dx = x - m.x, dz = z - m.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > m.r * 1.8) continue;
      if (m.kind === 'flat') h = lerp(h, m.h0, 1 - smoothstep(m.r, m.r * 1.8, d));
      else {
        h = lerp(h, m.h0, 1 - smoothstep(m.r, m.r * 1.8, d));
        h -= 1.1 * (1 - smoothstep(m.r * 0.25, m.r, d));
      }
    }

    // Biome selection
    const rk = this.nRock.noise(wx / 210 + 50, wz / 210);
    let biome: Biome;
    if (mountain > 0.55) biome = 'mountain';
    else if (rk > 0.58 || (elev > 0.16 && rk > 0.3)) biome = 'rocky';
    else if (human > 0.33 && campDist > 230) biome = 'farmland';
    else if (marsh > 0.5) biome = 'marsh';
    else if (elev > 0.14) biome = moist < -0.12 ? 'hills' : 'pine';
    else if (moist < -0.16) biome = 'meadow';
    else biome = 'forest';
    // keep the camp surroundings forested
    if (campDist < 60) biome = 'forest';

    return {
      h, biome, river, bank, lake, stream, road, human, moist, elev, mountain, marsh, campDist,
    };
  }

  /** Add a landmark terrain modifier (pond depression or flattened area). */
  addMod(x: number, z: number, r: number, kind: 'pond' | 'flat') {
    const h0 = this.rawHeight(x, z).h;
    this.mods.push({ x, z, r, kind, h0 });
  }

  /** Local pond surfaces (independent of the global water level). */
  pondLevelAt(x: number, z: number): number | null {
    for (const m of this.mods) {
      if (m.kind !== 'pond') continue;
      if (Math.hypot(x - m.x, z - m.z) < m.r * 0.95) return m.h0 - 0.3;
    }
    return null;
  }

  get ponds() {
    return this.mods.filter((m) => m.kind === 'pond');
  }

  height(x: number, z: number): number {
    return this.rawHeight(x, z).h;
  }

  sample(x: number, z: number): TerrainSample {
    return this.rawHeight(x, z);
  }

  /** Is this position under the current water level? */
  isWater(x: number, z: number, waterLevel: number): boolean {
    return this.height(x, z) < waterLevel - 0.05;
  }

  normalAt(x: number, z: number): [number, number, number] {
    const e = 0.6;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  }

  slopeAt(x: number, z: number): number {
    const n = this.normalAt(x, z);
    return 1 - clamp(n[1], 0, 1);
  }
}
