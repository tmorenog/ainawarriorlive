// Dangerous animals: foxes, badgers and Tallfolk dogs. They wander, notice
// cats, telegraph their attacks and flee once badly hurt.
import * as THREE from 'three';
import type { Game } from '../game';
import type { Fighter } from '../player/combat';
import { BADGER, DOG, FOX, QuadModel, QuadSpec } from './models';
import { simRng } from '../core/rng';
import { angleDiff, clamp, dist2 } from '../core/math';

export type CreatureKind = 'fox' | 'badger' | 'dog';

const DEFS: Record<CreatureKind, { name: string; spec: QuadSpec; hp: number; power: number; speed: number; notice: number; reach: number; aggression: number; chaseTime: number }> = {
  fox: { name: 'Fox', spec: FOX, hp: 55, power: 8, speed: 5.2, notice: 16, reach: 0.75, aggression: 0.6, chaseTime: 25 },
  badger: { name: 'Badger', spec: BADGER, hp: 140, power: 15, speed: 2.9, notice: 12, reach: 0.8, aggression: 0.9, chaseTime: 40 },
  dog: { name: 'Dog', spec: DOG, hp: 95, power: 10, speed: 7.2, notice: 28, reach: 0.9, aggression: 0.7, chaseTime: 18 },
};

export class Creature implements Fighter {
  kind: 'creature' = 'creature';
  faction: 'wild' = 'wild';
  id = 'cr' + Math.random().toString(36).slice(2);
  pos = new THREE.Vector3();
  heading = simRng.range(0, Math.PI * 2);
  radius = 0.35;
  hp: number;
  maxHp: number;
  power: number;
  defense = 0.1;
  name: string;
  model: QuadModel;
  state: 'wander' | 'stalk' | 'fight' | 'flee' | 'goal' = 'wander';
  target: { x: number; z: number } | null = null;
  fightTarget: Fighter | null = null;
  windup = 0;
  cd = 0;
  timer = 0;
  chase = 0;
  speed = 0;
  goal: { x: number; z: number } | null = null;
  barkT = 0;
  eventTag: string | null = null;
  constructor(public type: CreatureKind, scene: THREE.Scene) {
    const d = DEFS[type];
    this.hp = this.maxHp = d.hp;
    this.power = d.power;
    this.name = d.name;
    this.model = new QuadModel(d.spec);
    scene.add(this.model.root);
    if (type === 'badger') this.defense = 0.25;
  }
  get alive() { return this.hp > 0 && this.state !== 'flee'; }
  get def() { return DEFS[this.type]; }
}

export class CreatureManager {
  list: Creature[] = [];
  private ambientT = 30;
  constructor(private game: Game) {}

  spawn(type: CreatureKind, x: number, z: number, opts: { goal?: { x: number; z: number }; hunt?: boolean; tag?: string } = {}): Creature {
    const c = new Creature(type, this.game.scene);
    c.pos.set(x, this.game.groundAt(x, z), z);
    if (opts.goal) { c.goal = opts.goal; c.state = 'goal'; }
    c.eventTag = opts.tag ?? null;
    this.list.push(c);
    return c;
  }

  get(id: string) { return this.list.find((c) => c.id === id); }

  driveOff(id: string, by: Fighter) {
    const c = this.get(id);
    if (!c) return;
    c.state = 'flee';
    c.fightTarget = null;
    c.hp = Math.max(1, c.hp);
    const ax = c.pos.x - by.pos.x, az = c.pos.z - by.pos.z;
    const l = Math.hypot(ax, az) || 1;
    c.target = { x: c.pos.x + (ax / l) * 80, z: c.pos.z + (az / l) * 80 };
    c.timer = 12;
    this.game.audio.yelp();
    this.game.events.creatureDrivenOff(c, by);
  }

  remove(c: Creature) {
    c.model.dispose();
    this.game.combat.disengage(c);
    this.list.splice(this.list.indexOf(c), 1);
  }

  /** Occasional ambient predators outside the camp. */
  private ambientSpawn() {
    const game = this.game;
    const p = game.player.pos;
    if (Math.hypot(p.x, p.z) < 30) return;
    if (this.list.length >= 2) return;
    const biome = game.chunks.biomeAt(p.x, p.z);
    const houses = game.chunks.structuresNear(p.x, p.z, 60).some((s) => s.type === 'house');
    let type: CreatureKind | null = null;
    if (houses && simRng.chance(0.5)) type = 'dog';
    else if (game.time.isNight && simRng.chance(0.25)) type = simRng.chance(0.3) ? 'badger' : 'fox';
    else if ((biome === 'forest' || biome === 'pine') && simRng.chance(0.12)) type = 'fox';
    if (!type) return;
    const a = simRng.range(0, Math.PI * 2);
    const r = simRng.range(35, 55);
    this.spawn(type, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
  }

  update(dt: number) {
    const game = this.game;
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = simRng.range(45, 110);
      this.ambientSpawn();
    }
    for (const c of [...this.list]) {
      const d = dist2(c.pos.x, c.pos.z, game.player.pos.x, game.player.pos.z);
      if (d > 140 || (c.state === 'flee' && (c.timer -= dt) <= 0)) { this.remove(c); continue; }
      this.think(c, dt);
      this.move(c, dt);
      c.model.root.position.copy(c.pos);
      c.model.root.rotation.y = -c.heading;
      c.model.speed = c.speed;
      c.model.crouch = c.windup > 0 ? 1 : c.state === 'stalk' ? 0.5 : 0;
      c.model.lunge = Math.max(0, c.model.lunge - dt * 4);
      c.model.root.visible = d < 110;
      if (d < 70) c.model.update(dt);
    }
  }

  private nearestCat(c: Creature, r: number): Fighter | null {
    const game = this.game;
    let best: Fighter | null = null, bd = r;
    const pl = game.player;
    if (pl.alive) {
      const d = dist2(c.pos.x, c.pos.z, pl.pos.x, pl.pos.z) * (pl.crouching ? 1.6 : 1);
      if (d < bd) { bd = d; best = pl; }
    }
    for (const a of game.npcs.agents.values()) {
      if (!a.alive || a.activity === 'sleep' && Math.hypot(a.pos.x, a.pos.z) < 16 && c.type !== 'badger') continue;
      const d = dist2(c.pos.x, c.pos.z, a.pos.x, a.pos.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  private think(c: Creature, dt: number) {
    const game = this.game;
    const def = c.def;
    c.cd -= dt;
    c.barkT -= dt;
    if (c.type === 'dog' && c.state !== 'wander' && c.barkT <= 0) {
      c.barkT = simRng.range(0.8, 2);
      game.audio.bark(c.pos);
    }
    switch (c.state) {
      case 'goal': {
        if (c.goal && dist2(c.pos.x, c.pos.z, c.goal.x, c.goal.z) > 3) c.target = c.goal;
        else c.state = 'wander';
        const t = this.nearestCat(c, def.notice * 0.8);
        if (t) { c.state = 'fight'; c.fightTarget = t; game.combat.engage(c, t); }
        break;
      }
      case 'wander': {
        c.timer -= dt;
        if (!c.target || c.timer <= 0) {
          const a = simRng.range(0, Math.PI * 2);
          c.target = { x: c.pos.x + Math.cos(a) * 10, z: c.pos.z + Math.sin(a) * 10 };
          c.timer = simRng.range(4, 10);
        }
        const t = this.nearestCat(c, def.notice * game.weather.visibility);
        if (t && simRng.chance(def.aggression * dt * 2)) {
          c.state = 'stalk';
          c.fightTarget = t;
          c.chase = def.chaseTime;
          if (t.kind === 'player') game.ui.toast(`A ${def.name.toLowerCase()} has noticed you!`, 'danger');
        }
        break;
      }
      case 'stalk': {
        const t = c.fightTarget;
        if (!t || !t.alive) { c.state = 'wander'; break; }
        c.target = { x: t.pos.x, z: t.pos.z };
        if (dist2(c.pos.x, c.pos.z, t.pos.x, t.pos.z) < 4) { c.state = 'fight'; game.combat.engage(c, t); }
        break;
      }
      case 'fight': {
        const t = c.fightTarget;
        c.chase -= dt;
        if (!t || !t.alive || c.chase <= 0) {
          game.combat.disengage(c);
          c.fightTarget = null;
          c.state = 'wander';
          if (c.type === 'dog') { c.state = 'flee'; c.timer = 8; c.target = { x: c.pos.x + (c.pos.x - game.player.pos.x) * 5, z: c.pos.z + (c.pos.z - game.player.pos.z) * 5 }; }
          break;
        }
        if (c.hp < c.maxHp * 0.3) { this.driveOff(c.id, t); break; }
        const d = dist2(c.pos.x, c.pos.z, t.pos.x, t.pos.z);
        c.heading += angleDiff(c.heading, Math.atan2(t.pos.z - c.pos.z, t.pos.x - c.pos.x)) * Math.min(1, dt * 8);
        if (c.windup > 0) {
          c.windup -= dt;
          c.target = null;
          if (c.windup <= 0) {
            c.model.lunge = 1;
            // lunge forward
            c.pos.x += Math.cos(c.heading) * 0.35;
            c.pos.z += Math.sin(c.heading) * 0.35;
            game.combat.resolveAttack(c, t, d < def.reach + 0.5 ? 1 : 0);
            c.cd = simRng.range(1.2, 2.2) * (c.type === 'badger' ? 1.2 : 1);
          }
        } else if (d > def.reach) {
          c.target = { x: t.pos.x, z: t.pos.z };
        } else {
          c.target = null;
          if (c.cd <= 0) {
            c.windup = c.type === 'badger' ? 0.75 : 0.55;
            game.combat.telegraph(c);
          }
        }
        break;
      }
      case 'flee':
        break;
    }
  }

  private move(c: Creature, dt: number) {
    if (!c.target) { c.speed = Math.max(0, c.speed - dt * 8); return; }
    const dx = c.target.x - c.pos.x, dz = c.target.z - c.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) { c.target = null; return; }
    const want = Math.atan2(dz, dx);
    c.heading += clamp(angleDiff(c.heading, want), -dt * 5, dt * 5);
    let sp = c.state === 'wander' ? 1.2 : c.state === 'goal' ? c.def.speed * 0.6 : c.def.speed;
    if (c.state === 'stalk') sp *= 0.7;
    if (this.game.chunks.waterDepthAt(c.pos.x, c.pos.z) > 0.3) sp *= 0.4;
    const step = Math.min(sp * dt, d);
    c.pos.x += Math.cos(c.heading) * step;
    c.pos.z += Math.sin(c.heading) * step;
    for (const col of this.game.collidersNear(c.pos.x, c.pos.z)) {
      const ox = c.pos.x - col.x, oz = c.pos.z - col.z;
      const od = Math.hypot(ox, oz);
      if (od < col.r + c.radius && od > 1e-4) {
        c.pos.x = col.x + (ox / od) * (col.r + c.radius);
        c.pos.z = col.z + (oz / od) * (col.r + c.radius);
      }
    }
    c.pos.y = Math.max(this.game.groundAt(c.pos.x, c.pos.z), this.game.chunks.waterSurfaceAt(c.pos.x, c.pos.z) - 0.2);
    c.speed = step / Math.max(dt, 1e-4);
  }

  clear() { for (const c of [...this.list]) this.remove(c); }
}
