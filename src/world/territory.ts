// Clan territories, borders, landmarks and gathering places.
import { RNG } from '../core/rng';
import { Simplex2 } from '../core/noise';
import { CLASSIC_CLANS, CLASSIC_COLORS, CLASSIC_TEMPER, isClassic } from '../lore';

export interface RivalClanDef {
  index: number;
  name: string;
  color: string;
  cx: number;
  cz: number;
  radius: number;
  temperament: 'proud' | 'cautious' | 'hostile' | 'friendly';
}

export type LandmarkKind = 'bigTree' | 'sunRocks' | 'hollow' | 'fallenGiant' | 'oldSett' | 'pond' | 'trainingHollow' | 'councilRocks' | 'borderStone';

export interface Landmark {
  id: string;
  name: string;
  kind: LandmarkKind;
  x: number;
  z: number;
  radius: number;
  home: boolean;
}

export const HOME_RADIUS = 165;

const LANDMARK_NAMES: [LandmarkKind, string[]][] = [
  ['bigTree', ['the Elder Oak', 'the Owl Beech', 'the Split Sycamore', 'the Lightning Ash']],
  ['sunRocks', ['the Sunning Stones', 'the Warm Slabs', 'Basking Ledge']],
  ['hollow', ['Mossy Hollow', 'Whispering Dell', 'Fernshade Hollow']],
  ['fallenGiant', ['the Fallen Giant', 'the Long Log', 'Hollow-Trunk Bridge']],
  ['oldSett', ['the Old Sett', 'the Empty Burrow', 'Digger Mound']],
  ['pond', ['Frog Pool', 'Stillwater Pond', 'Moon Puddle']],
];

export const HOME_CLAN_NAMES = ['ThunderClan', 'WindClan', 'RiverClan', 'ShadowClan', 'SkyClan'];
const RIVAL_NAMES = ['Ashpine', 'Reedwater', 'Stonehollow', 'Frostridge', 'Brightmoor', 'Duskfen', 'Cindergrove'];
const RIVAL_COLORS = ['#c86a3c', '#4f8fb8', '#8b8578', '#a8c8e8', '#e0b84a', '#6e5a8a', '#b8483a'];

export class Territories {
  rivals: RivalClanDef[] = [];
  landmarks: Landmark[] = [];
  homeName: string;
  council: Landmark;
  private n: Simplex2;

  constructor(seed: number, homeName?: string) {
    const rng = new RNG(seed ^ 0x51ed27);
    this.n = new Simplex2(seed + 77);
    const classic = isClassic();
    this.homeName = homeName ?? rng.pick(classic ? CLASSIC_CLANS : HOME_CLAN_NAMES);
    const names = classic ? rng.shuffle(CLASSIC_CLANS.filter((n) => n !== this.homeName)) : rng.shuffle(RIVAL_NAMES.slice());
    const base = rng.range(0, Math.PI * 2);
    const temps: RivalClanDef['temperament'][] = ['proud', 'cautious', 'hostile', 'friendly'];
    for (let i = 0; i < 3; i++) {
      const a = base + (i * Math.PI * 2) / 3 + rng.range(-0.25, 0.25);
      const d = rng.range(390, 430);
      this.rivals.push({
        index: i,
        name: names[i],
        color: classic ? CLASSIC_COLORS[names[i]] : RIVAL_COLORS[(i * 2 + rng.int(0, 6)) % RIVAL_COLORS.length],
        cx: Math.cos(a) * d,
        cz: Math.sin(a) * d,
        radius: rng.range(135, 155),
        temperament: classic ? CLASSIC_TEMPER[names[i]] : rng.pick(temps),
      });
    }
    // Council rocks between rivals 0 and 1
    const a0 = Math.atan2(this.rivals[0].cz, this.rivals[0].cx);
    const a1 = Math.atan2(this.rivals[1].cz, this.rivals[1].cx);
    let mid = (a0 + a1) / 2;
    if (Math.abs(a0 - a1) > Math.PI) mid += Math.PI;
    this.council = {
      id: 'council', name: 'the Council Stones', kind: 'councilRocks',
      x: Math.cos(mid) * 265, z: Math.sin(mid) * 265, radius: 14, home: false,
    };
    this.landmarks.push(this.council);
    // Training hollow near camp
    const ta = rng.range(0, Math.PI * 2);
    this.landmarks.push({
      id: 'training', name: 'the Training Hollow', kind: 'trainingHollow',
      x: Math.cos(ta) * 42, z: Math.sin(ta) * 42, radius: 8, home: true,
    });
    // Home landmarks
    let idx = 0;
    for (const [kind, pool] of LANDMARK_NAMES) {
      const count = kind === 'bigTree' ? 2 : 1;
      for (let c = 0; c < count; c++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(55, 135);
        this.landmarks.push({
          id: `lm${idx++}`, name: pool[c % pool.length], kind,
          x: Math.cos(a) * d, z: Math.sin(a) * d, radius: kind === 'pond' ? 7 : 6, home: true,
        });
      }
    }
    // Border stones around the home territory
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = this.homeRadiusAt(a) - 4;
      this.landmarks.push({
        id: `border${i}`, name: `Border marker ${i + 1}`, kind: 'borderStone',
        x: Math.cos(a) * r, z: Math.sin(a) * r, radius: 3, home: true,
      });
    }
  }

  homeRadiusAt(angle: number): number {
    return HOME_RADIUS + this.n.noise(Math.cos(angle) * 1.3, Math.sin(angle) * 1.3) * 22;
  }

  rivalRadiusAt(r: RivalClanDef, angle: number) {
    return r.radius + this.n.noise(Math.cos(angle) * 1.3 + r.index * 10, Math.sin(angle) * 1.3) * 18;
  }

  /** Returns 'home', a rival index, or 'neutral' / 'wild'. */
  ownerAt(x: number, z: number): 'home' | 'neutral' | 'wild' | number {
    const d = Math.hypot(x, z);
    if (d < this.homeRadiusAt(Math.atan2(z, x))) return 'home';
    for (const r of this.rivals) {
      const dx = x - r.cx, dz = z - r.cz;
      if (Math.hypot(dx, dz) < this.rivalRadiusAt(r, Math.atan2(dz, dx))) return r.index;
    }
    return d > 650 ? 'wild' : 'neutral';
  }

  /** Signed distance to home border (negative inside). */
  homeBorderDist(x: number, z: number): number {
    return Math.hypot(x, z) - this.homeRadiusAt(Math.atan2(z, x));
  }

  ownerName(o: ReturnType<Territories['ownerAt']>): string {
    if (o === 'home') return `${this.homeName} territory`;
    if (o === 'neutral') return 'Unclaimed land';
    if (o === 'wild') return 'The far wilds';
    return `${this.rivals[o].name} territory`;
  }

  landmarksNear(x: number, z: number, r: number): Landmark[] {
    return this.landmarks.filter((l) => Math.hypot(l.x - x, l.z - z) < r + l.radius);
  }
}
