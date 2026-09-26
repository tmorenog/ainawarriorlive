// Prey animals: spawned around the player by biome, each species with its own
// senses and escape behaviour. Stealth, wind and weather decide whether the
// player gets close enough to pounce.
import * as THREE from 'three';
import type { Game } from '../game';
import { PreyKind, preyGeometry, preyMaterial } from './models';
import { simRng } from '../core/rng';
import { angleDiff, clamp, dist2 } from '../core/math';
import type { Biome } from '../world/terrain';

export interface PreyInfo {
  name: string;
  value: number; // food value
  slots: number; // carry slots
  hear: number; // hearing radius at full noise
  sight: number; // radius at which movement is seen
  smell: number;
  speed: number;
  escape: 'dart' | 'zigzag' | 'fly' | 'climb' | 'dive' | 'hop';
  color: number;
  night?: boolean;
}

export const PREY: Record<PreyKind, PreyInfo> = {
  mouse: { name: 'mouse', value: 1, slots: 1, hear: 7, sight: 2.5, smell: 5, speed: 4.2, escape: 'dart', color: 0x8a7a68, night: true },
  vole: { name: 'vole', value: 1, slots: 1, hear: 6, sight: 2.5, smell: 5, speed: 3.6, escape: 'dart', color: 0x6a5040 },
  rabbit: { name: 'rabbit', value: 2, slots: 2, hear: 13, sight: 8, smell: 9, speed: 8.5, escape: 'zigzag', color: 0x9a8266 },
  bird: { name: 'thrush', value: 1, slots: 1, hear: 6, sight: 9, smell: 0, speed: 6, escape: 'fly', color: 0x7a5a40 },
  squirrel: { name: 'squirrel', value: 1.5, slots: 2, hear: 9, sight: 6, smell: 5, speed: 6, escape: 'climb', color: 0xa8542a },
  fish: { name: 'fish', value: 1.5, slots: 1, hear: 2.5, sight: 2.2, smell: 0, speed: 3, escape: 'dive', color: 0x7a9aa8 },
  frog: { name: 'frog', value: 0.5, slots: 1, hear: 4, sight: 3, smell: 2, speed: 3, escape: 'hop', color: 0x5a8a3a, night: true },
};

const BIOME_PREY: Record<Biome, [PreyKind, number][]> = {
  forest: [['mouse', 4], ['vole', 2], ['bird', 3], ['squirrel', 3]],
  pine: [['squirrel', 4], ['mouse', 2], ['bird', 2]],
  meadow: [['rabbit', 4], ['mouse', 3], ['vole', 3], ['bird', 2]],
  marsh: [['frog', 5], ['vole', 3], ['bird', 2]],
  hills: [['rabbit', 4], ['mouse', 2], ['bird', 2]],
  mountain: [['mouse', 2], ['bird', 2]],
  rocky: [['mouse', 3], ['bird', 1], ['rabbit', 1]],
  farmland: [['mouse', 5], ['rabbit', 2], ['bird', 3]],
};

export type PreyState = 'idle' | 'alert' | 'flee' | 'gone';

export class Prey {
  mesh: THREE.Mesh;
  pos = new THREE.Vector3();
  heading = simRng.range(0, Math.PI * 2);
  state: PreyState = 'idle';
  awareness = 0;
  timer = simRng.range(1, 3);
  vel = new THREE.Vector3();
  zig = 0;
  hop = 0;
  climbTree: { x: number; z: number } | null = null;
  info: PreyInfo;
  id = Math.random().toString(36).slice(2);
  hidden = false;
  scent = 1;
  constructor(public kind: PreyKind, scene: THREE.Scene) {
    this.info = PREY[kind];
    this.mesh = new THREE.Mesh(preyGeometry(kind), preyMaterial);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }
  dispose() { this.mesh.parent?.remove(this.mesh); }
}

export class PreyManager {
  list: Prey[] = [];
  private spawnT = 0;
  max = 16;

  constructor(private game: Game) {}

  update(dt: number) {
    const game = this.game;
    const p = game.player;
    this.spawnT -= dt;
    const abundance = game.events.preyAbundance();
    if (this.spawnT <= 0) {
      this.spawnT = 1.2;
      const target = Math.round(this.max * abundance * (game.time.isNight ? 0.7 : 1) * (game.weather.p.rain > 0.5 ? 0.6 : 1) * (game.weather.p.snow > 0.5 ? 0.5 : 1));
      if (this.list.length < target) this.spawn();
    }
    for (const pr of [...this.list]) {
      const d = dist2(pr.pos.x, pr.pos.z, p.pos.x, p.pos.z);
      if (d > 85 || pr.state === 'gone') { this.remove(pr); continue; }
      this.think(pr, dt, d);
      pr.mesh.visible = d < 70 && !pr.hidden;
      pr.mesh.position.copy(pr.pos);
      pr.mesh.position.y += pr.hop;
      pr.mesh.rotation.y = -pr.heading;
    }
  }

  private spawn() {
    const game = this.game;
    const p = game.player.pos;
    const pts = game.chunks.spawnPointsNear(p.x, p.z, 18, 60);
    if (!pts.length) return;
    const sp = simRng.pick(pts);
    let kind: PreyKind;
    if (sp.water && simRng.chance(0.55)) kind = simRng.chance(0.6) ? 'fish' : 'frog';
    else kind = simRng.weighted(BIOME_PREY[sp.biome]);
    if (game.time.isNight && !PREY[kind].night && simRng.chance(0.6)) return;
    if (kind === 'fish') {
      // must be in water
      if (game.chunks.waterDepthAt(sp.x, sp.z) < 0.25) return;
    } else if (game.chunks.waterDepthAt(sp.x, sp.z) > 0.05) return;
    if (Math.hypot(sp.x, sp.z) < 20) return; // not inside camp
    const pr = new Prey(kind, game.scene);
    pr.pos.set(sp.x, this.groundY(pr, sp.x, sp.z), sp.z);
    this.list.push(pr);
  }

  private groundY(pr: Prey, x: number, z: number) {
    if (pr.kind === 'fish') return this.game.chunks.waterSurfaceAt(x, z) - 0.12;
    return this.game.groundAt(x, z);
  }

  remove(pr: Prey) {
    pr.dispose();
    this.list.splice(this.list.indexOf(pr), 1);
  }

  /** Player noise and scent raise awareness. */
  private think(pr: Prey, dt: number, d: number) {
    const game = this.game;
    const pl = game.player;
    const info = pr.info;
    const w = game.weather;
    const skill = game.clan.player?.skills.hunting ?? 30;
    // --- senses
    let stim = 0;
    const noise = pl.noise * w.stealthModifier * (1 - skill * 0.004);
    const hearR = info.hear * noise;
    if (d < hearR) stim += (1 - d / hearR) * 2.2;
    // scent: prey downwind of player
    const wind = game.windDir;
    const dx = (pr.pos.x - pl.pos.x) / Math.max(d, 0.01), dz = (pr.pos.z - pl.pos.z) / Math.max(d, 0.01);
    const downwind = dx * wind.x + dz * wind.y;
    const smellR = info.smell * (0.4 + w.p.wind * 0.8) * (1 - w.p.rain * 0.5);
    if (downwind > 0.55 && d < smellR) stim += (1 - d / smellR) * 1.4;
    // sight of movement
    const sightR = info.sight * w.visibility * (game.time.isNight ? 0.6 : 1);
    if (d < sightR && pl.speed > 0.6) stim += (pl.speed / 3) * (1 - d / sightR) * 1.5;
    if (d < 0.7 && pr.state !== 'flee') stim += 3;
    if (pr.state !== 'flee') {
      pr.awareness = clamp(pr.awareness + stim * dt - dt * 0.25, 0, 1.2);
      if (pr.awareness >= 1) this.startFlee(pr);
      else if (pr.awareness > 0.45) {
        pr.state = 'alert';
        pr.heading += angleDiff(pr.heading, Math.atan2(pl.pos.z - pr.pos.z, pl.pos.x - pr.pos.x)) * dt * 4;
      } else if (pr.state === 'alert' && pr.awareness < 0.2) pr.state = 'idle';
    }
    // --- act
    if (pr.state === 'idle') this.idle(pr, dt);
    else if (pr.state === 'flee') this.flee(pr, dt);
    else pr.hop = 0;
  }

  private idle(pr: Prey, dt: number) {
    pr.timer -= dt;
    if (pr.kind === 'fish') {
      pr.heading += dt * 0.6;
      this.step(pr, 0.4, dt);
      pr.pos.y = this.groundY(pr, pr.pos.x, pr.pos.z) + Math.sin(this.game.clock * 2 + pr.pos.x) * 0.04;
      return;
    }
    if (pr.timer <= 0) {
      pr.timer = simRng.range(0.6, 3);
      pr.heading += simRng.range(-1.5, 1.5);
      pr.vel.x = simRng.chance(0.5) ? 1 : 0;
    }
    if (pr.vel.x > 0) {
      const sp = pr.kind === 'rabbit' || pr.kind === 'frog' || pr.kind === 'bird' ? 0.8 : 0.5;
      this.step(pr, sp, dt);
      if (pr.kind === 'rabbit' || pr.kind === 'frog' || pr.kind === 'bird') pr.hop = Math.abs(Math.sin(this.game.clock * 9)) * 0.04;
    } else pr.hop = 0;
  }

  startFlee(pr: Prey) {
    const pl = this.game.player;
    pr.state = 'flee';
    pr.timer = pr.info.escape === 'fly' ? 3 : simRng.range(1.8, 3);
    pr.heading = Math.atan2(pr.pos.z - pl.pos.z, pr.pos.x - pl.pos.x);
    if (pr.info.escape === 'climb') {
      const cols = this.game.collidersNear(pr.pos.x, pr.pos.z);
      let best: { x: number; z: number } | null = null, bd = 12;
      for (const c of cols) { const dd = dist2(c.x, c.z, pr.pos.x, pr.pos.z); if (dd < bd && c.r < 0.6) { bd = dd; best = c; } }
      pr.climbTree = best;
    }
    if (pr.info.escape === 'fly') this.game.audio.wingFlap();
    this.game.audio.preyAlarm(pr.kind, pr.pos);
  }

  private flee(pr: Prey, dt: number) {
    pr.timer -= dt;
    const info = pr.info;
    switch (info.escape) {
      case 'fly':
        pr.pos.y += dt * 3.5;
        pr.pos.x += Math.cos(pr.heading) * info.speed * dt;
        pr.pos.z += Math.sin(pr.heading) * info.speed * dt;
        if (pr.timer <= 0) pr.state = 'gone';
        return;
      case 'climb':
        if (pr.climbTree) {
          const d = dist2(pr.pos.x, pr.pos.z, pr.climbTree.x, pr.climbTree.z);
          if (d > 0.3) {
            pr.heading = Math.atan2(pr.climbTree.z - pr.pos.z, pr.climbTree.x - pr.pos.x);
            this.step(pr, info.speed, dt);
          } else {
            pr.pos.y += dt * 3;
            if (pr.pos.y > this.game.groundAt(pr.pos.x, pr.pos.z) + 5) pr.state = 'gone';
          }
          return;
        }
        break;
      case 'zigzag':
        pr.zig += dt * 6;
        pr.heading += Math.sin(pr.zig) * dt * 5;
        break;
      case 'dive':
        pr.pos.y -= dt * 0.5;
        this.step(pr, info.speed, dt);
        if (pr.timer <= 0) pr.state = 'gone';
        return;
      case 'hop':
        pr.hop = Math.abs(Math.sin(this.game.clock * 10)) * 0.12;
        break;
    }
    this.step(pr, info.speed, dt);
    if (pr.timer <= 0) {
      // bolt into cover
      pr.hidden = true;
      pr.state = 'gone';
    }
  }

  private step(pr: Prey, sp: number, dt: number) {
    const nx = pr.pos.x + Math.cos(pr.heading) * sp * dt;
    const nz = pr.pos.z + Math.sin(pr.heading) * sp * dt;
    const depth = this.game.chunks.waterDepthAt(nx, nz);
    if (pr.kind === 'fish' ? depth < 0.25 : depth > 0.05 && pr.kind !== 'frog') {
      pr.heading += Math.PI * 0.7;
      return;
    }
    pr.pos.x = nx;
    pr.pos.z = nz;
    pr.pos.y = this.groundY(pr, nx, nz);
  }

  /** Try to catch prey at a pounce landing spot. Returns caught prey or null. */
  tryCatch(x: number, z: number, radius: number, precision: number): Prey | null {
    const skill = this.game.clan.player?.skills.hunting ?? 30;
    let best: Prey | null = null, bd = radius;
    for (const pr of this.list) {
      if (pr.state === 'gone' || pr.hidden) continue;
      if (pr.kind === 'bird' && pr.state === 'flee' && pr.pos.y > this.game.groundAt(pr.pos.x, pr.pos.z) + 0.5) continue;
      const d = dist2(pr.pos.x, pr.pos.z, x, z);
      if (d < bd) { bd = d; best = pr; }
    }
    if (!best) return null;
    const stateBonus = best.state === 'idle' ? 0.2 : best.state === 'alert' ? 0 : -0.25;
    const chance = clamp(0.5 + skill / 220 + stateBonus + precision * 0.15 - (bd / radius) * 0.2, 0.1, 0.97);
    if (simRng.chance(chance)) {
      this.remove(best);
      return best;
    }
    this.startFlee(best);
    return null;
  }

  nearestOfKind(x: number, z: number, maxD: number): Prey | null {
    let best: Prey | null = null, bd = maxD;
    for (const pr of this.list) {
      if (pr.state === 'gone') continue;
      const d = dist2(pr.pos.x, pr.pos.z, x, z);
      if (d < bd) { bd = d; best = pr; }
    }
    return best;
  }

  clear() {
    for (const pr of [...this.list]) this.remove(pr);
  }
}
