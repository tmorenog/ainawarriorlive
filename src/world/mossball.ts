// Moss balls in the camp that kits (and playful cats) can bat around.
import * as THREE from 'three';
import type { Game } from '../game';
import type { NpcAgent } from '../ai/npc';
import { CAMP_RADIUS } from './camp';

export interface MossBall { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; r: number; lastKicker: string | null; }

export class MossBalls {
  balls: MossBall[] = [];
  private npcKickT = 0;
  /** The ball the player is carrying in their mouth. */
  held: MossBall | null = null;
  /** A game of catch with a clanmate: whoever drops the moss ball loses. */
  catchGame: { partner: NpcAgent; ball: MossBall; phase: 'playerHas' | 'toNpc' | 'npcHas' | 'toPlayer'; t: number; catches: number; land: { x: number; z: number } } | null = null;
  constructor(private game: Game) {}

  /** Place fresh moss balls near the nursery (called whenever the camp is rebuilt). */
  reset() {
    const g = this.game;
    for (const b of this.balls) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); }
    this.balls = [];
    this.held = null;
    this.catchGame = null;
    const n = g.camp.dens.nursery;
    const mat = new THREE.MeshLambertMaterial({ color: 0x6f9a4a });
    for (let i = 0; i < 2; i++) {
      const r = 0.065;
      const geo = new THREE.IcosahedronGeometry(r, 1);
      // lumpy moss
      const p = geo.attributes.position;
      for (let k = 0; k < p.count; k++) { const s = 0.88 + ((k * 7919) % 13) / 60; p.setXYZ(k, p.getX(k) * s, p.getY(k) * s, p.getZ(k) * s); }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      const x = n.x * 0.75 + (i ? 1.2 : -0.8), z = n.z * 0.75 + (i ? -0.6 : 0.9);
      const pos = new THREE.Vector3(x, g.groundAt(x, z) + r, z);
      mesh.position.copy(pos);
      g.camp.group.add(mesh);
      this.balls.push({ mesh, pos, vel: new THREE.Vector3(), r, lastKicker: null });
    }
  }

  nearest(x: number, z: number, maxD: number): MossBall | null {
    let best: MossBall | null = null, bd = maxD;
    for (const b of this.balls) { if (b === this.held) continue; const d = Math.hypot(b.pos.x - x, b.pos.z - z); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  pickUp(b: MossBall) { this.held = b; b.vel.set(0, 0, 0); }

  /** Toss the carried ball forward. */
  toss(dirX: number, dirZ: number, power: number) {
    const b = this.held;
    if (!b) return;
    this.held = null;
    this.kick(b, dirX, dirZ, power, 'player');
    b.vel.y = 2;
    const cg = this.catchGame;
    if (cg && cg.ball === b) {
      cg.phase = 'toNpc';
      // lob it toward your partner (not perfectly!)
      const err = Math.random() * 1.3, ea = Math.random() * Math.PI * 2;
      const tx = cg.partner.pos.x + Math.cos(ea) * err, tz = cg.partner.pos.z + Math.sin(ea) * err;
      const vy = 3.2, t = 2 * vy / 9.8 + 0.05;
      b.vel.set((tx - b.pos.x) / t, vy, (tz - b.pos.z) / t);
      cg.land = this.landingPoint(b);
      cg.partner.moveSpeed = 3.2;
      cg.partner.setTarget(cg.land.x, cg.land.z);
    }
  }

  /** Where a ball in flight will come down (ignores air friction). */
  private landingPoint(b: MossBall) {
    const gy = this.game.groundAt(b.pos.x, b.pos.z) + b.r;
    const h = Math.max(0, b.pos.y - gy);
    const t = (b.vel.y + Math.sqrt(b.vel.y * b.vel.y + 2 * 9.8 * h)) / 9.8;
    return { x: b.pos.x + b.vel.x * t, z: b.pos.z + b.vel.z * t };
  }

  startCatch(partner: NpcAgent) {
    const g = this.game;
    const p = g.player.pos;
    const ball = this.held ?? this.nearest(p.x, p.z, 40) ?? this.balls[0];
    if (!ball) return;
    this.held = ball;
    ball.vel.set(0, 0, 0);
    const f = g.player.forward();
    partner.activity = 'talkPlayer';
    partner.actTimer = 9999;
    partner.moveSpeed = 3;
    partner.setTarget(p.x + f.x * 4, p.z + f.z * 4);
    this.catchGame = { partner, ball, phase: 'playerHas', t: 0, catches: 0, land: { x: 0, z: 0 } };
    g.ui.toast(`Catch! Toss the moss ball to ${partner.name} (E / ✋). When it comes back, press E to catch it. Whoever drops it loses!`, 'objective');
  }

  /** The player tries to catch the incoming ball. */
  tryCatch(): boolean {
    const cg = this.catchGame;
    if (!cg || !this.canCatchNow()) return false;
    const g = this.game;
    const b = cg.ball;
    this.held = b;
    b.vel.set(0, 0, 0);
    cg.phase = 'playerHas';
    cg.catches++;
    g.audio.pick();
    g.ui.floatText(`Caught! (${cg.catches})`, '#bfe8a0');
    if (Math.random() < 0.3) cg.partner.say(['Nice catch!', 'Ooh, good one!', 'Throw it back!'][Math.floor(Math.random() * 3)], 1.5);
    return true;
  }

  canCatchNow(): boolean {
    const cg = this.catchGame;
    if (!cg || cg.phase !== 'toPlayer') return false;
    const g = this.game;
    const d = Math.hypot(cg.ball.pos.x - g.player.pos.x, cg.ball.pos.z - g.player.pos.z);
    return d < 1.3 * Math.max(0.6, g.player.scale) + 0.3;
  }

  private endCatch(playerWon: boolean, why: string) {
    const g = this.game;
    const cg = this.catchGame!;
    this.catchGame = null;
    const a = cg.partner;
    a.activity = 'idle';
    a.actTimer = 0;
    const pc = g.clan.player;
    g.clan.adjust(a.cat, pc, 4 + Math.min(6, cg.catches), { text: `I played catch with ${pc.given}.`, weight: 2 });
    if (playerWon) {
      a.say(['Aww, I dropped it!', 'No fair! Again!', 'You win this time…'][Math.floor(Math.random() * 3)], 3);
      g.ui.toast(`🏆 ${a.name} dropped the moss ball — you win! (${cg.catches} catches) ${why}`, 'good');
    } else {
      a.say(['Ha! I win!', 'Butterpaws! You dropped it!', 'Too slow!'][Math.floor(Math.random() * 3)], 3);
      g.ui.toast(`You dropped the moss ball — ${a.name} wins! (${cg.catches} catches)`, 'info');
    }
  }

  private catchUpdate(dt: number) {
    const cg = this.catchGame;
    if (!cg) return;
    const g = this.game;
    const a = cg.partner;
    const b = cg.ball;
    const p = g.player.pos;
    if (!g.npcs.agents.has(a.id) || Math.hypot(a.pos.x - p.x, a.pos.z - p.z) > 30) {
      this.catchGame = null;
      if (this.held === b) this.held = null;
      g.ui.toast('The game of catch is over.', 'info');
      return;
    }
    a.actTimer = 9999;
    const gy = g.groundAt(b.pos.x, b.pos.z) + b.r;
    const low = b.pos.y - gy < 0.22 && b.vel.y <= 0;
    if (cg.phase === 'toNpc') {
      a.heading = Math.atan2(b.pos.z - a.pos.z, b.pos.x - a.pos.x);
      if (low) {
        const d = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
        const skill = (a.cat.stage === 'kit' ? 0.8 : 0.9) + (d < 0.5 ? 0.08 : 0);
        if (d < 1.0 && Math.random() < skill) {
          cg.phase = 'npcHas';
          cg.t = 1.1 + Math.random() * 0.8;
          b.vel.set(0, 0, 0);
          if (Math.random() < 0.35) a.say(['Got it!', 'Mine!', '*pounces*'][Math.floor(Math.random() * 3)], 1.4);
        } else this.endCatch(true, d < 1.0 ? 'It slipped through their paws!' : 'They could not reach it!');
      }
    } else if (cg.phase === 'npcHas') {
      a.target = null;
      a.heading = Math.atan2(p.z - a.pos.z, p.x - a.pos.x);
      b.pos.set(a.pos.x + Math.cos(a.heading) * 0.2, a.pos.y + 0.16, a.pos.z + Math.sin(a.heading) * 0.2);
      b.vel.set(0, 0, 0);
      cg.t -= dt;
      if (cg.t <= 0) {
        // throw back toward the player, a little off-target
        const off = 0.2 + Math.random() * (a.cat.stage === 'kit' ? 1.1 : 0.8);
        const ang = Math.random() * Math.PI * 2;
        const tx = p.x + Math.cos(ang) * off, tz = p.z + Math.sin(ang) * off;
        const vy = 3.2, t = 2 * vy / 9.8 + 0.05;
        b.vel.set((tx - b.pos.x) / t, vy, (tz - b.pos.z) / t);
        cg.phase = 'toPlayer';
        cg.land = { x: tx, z: tz };
      }
    } else if (cg.phase === 'toPlayer') {
      if (low && b.pos.y - gy < 0.02) this.endCatch(false, '');
    }
  }


  kick(b: MossBall, dirX: number, dirZ: number, power: number, who: string) {
    const l = Math.hypot(dirX, dirZ) || 1;
    b.vel.x += (dirX / l) * power;
    b.vel.z += (dirZ / l) * power;
    b.vel.y = Math.max(b.vel.y, power * 0.35);
    b.lastKicker = who;
  }

  update(dt: number) {
    const g = this.game;
    if (!this.balls.length) return;
    // NPC kits (and playful young cats) chase and bat the balls
    this.npcKickT -= dt;
    const think = this.npcKickT <= 0;
    if (think) this.npcKickT = 1.5;
    for (const a of g.npcs.agents.values()) {
      const young = a.cat.stage === 'kit' || (a.cat.stage === 'apprentice' && a.cat.traits.includes('playful'));
      if (!young || a.cat.clan !== 'home') continue;
      if (this.catchGame && this.catchGame.partner === a) continue;
      const b = this.nearest(a.pos.x, a.pos.z, 9);
      if (!b || (this.catchGame && this.catchGame.ball === b)) continue;
      const d = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
      if (d < 0.45 + b.r) {
        this.kick(b, b.pos.x - a.pos.x + (Math.random() - 0.5) * 0.6, b.pos.z - a.pos.z + (Math.random() - 0.5) * 0.6, 2.2 + Math.random() * 1.5, a.id);
        if (Math.random() < 0.3) a.say(['Mine!', 'Catch it!', 'Pounce!', '*mrrp!*'][Math.floor(Math.random() * 4)], 1.5);
      } else if (think && a.activity === 'idle' && Math.random() < 0.35) {
        a.setTarget(b.pos.x, b.pos.z);
      }
    }
    // the player pushes the ball by walking into it
    const p = g.player.pos;
    if (this.held) {
      const b = this.held;
      const f = g.player.forward();
      const sc = Math.max(0.5, g.player.scale);
      b.pos.set(p.x + f.x * 0.3 * sc, p.y + 0.18 * sc, p.z + f.z * 0.3 * sc);
      b.mesh.position.copy(b.pos);
    }
    this.catchUpdate(dt);
    for (const b of this.balls) {
      if (b === this.held) continue;
      const inPlay = !!this.catchGame && this.catchGame.ball === b;
      if (inPlay && this.catchGame!.phase === 'npcHas') { b.mesh.position.copy(b.pos); continue; }
      const dx = inPlay ? 99 : b.pos.x - p.x, dz = inPlay ? 99 : b.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      const reach = 0.3 * Math.max(0.6, g.player.scale) + b.r;
      if (d < reach && d > 0.001) {
        const sp = Math.hypot(g.player.vel.x, g.player.vel.z);
        this.kick(b, dx, dz, Math.max(0.8, sp * 1.2), 'player');
        b.pos.x = p.x + (dx / d) * reach;
        b.pos.z = p.z + (dz / d) * reach;
      }
      // physics: roll with friction, bounce off the camp wall
      b.vel.y -= 9.8 * dt;
      b.pos.addScaledVector(b.vel, dt);
      const gy = g.groundAt(b.pos.x, b.pos.z) + b.r;
      if (b.pos.y < gy) { b.pos.y = gy; b.vel.y = Math.abs(b.vel.y) > 0.8 ? -b.vel.y * 0.35 : 0; }
      if (b.pos.y <= gy + 0.01) { const fr = Math.exp(-dt * 1.4); b.vel.x *= fr; b.vel.z *= fr; }
      const rr = Math.hypot(b.pos.x, b.pos.z);
      if (rr > CAMP_RADIUS - 1.2 && rr < CAMP_RADIUS + 0.4) {
        const nx = b.pos.x / rr, nz = b.pos.z / rr;
        const vn = b.vel.x * nx + b.vel.z * nz;
        if (vn > 0) { b.vel.x -= 1.6 * vn * nx; b.vel.z -= 1.6 * vn * nz; }
        b.pos.x = nx * (CAMP_RADIUS - 1.2); b.pos.z = nz * (CAMP_RADIUS - 1.2);
      }
      b.mesh.position.copy(b.pos);
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 0.01) { b.mesh.rotation.z -= (b.vel.x / b.r) * dt; b.mesh.rotation.x += (b.vel.z / b.r) * dt; }
    }
  }
}
