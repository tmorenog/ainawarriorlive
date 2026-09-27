// Moss balls in the camp that kits (and playful cats) can bat around.
import * as THREE from 'three';
import type { Game } from '../game';
import { CAMP_RADIUS } from './camp';

export interface MossBall { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; r: number; lastKicker: string | null; }

export class MossBalls {
  balls: MossBall[] = [];
  private npcKickT = 0;
  /** The ball the player is carrying in their mouth. */
  held: MossBall | null = null;
  constructor(private game: Game) {}

  /** Place fresh moss balls near the nursery (called whenever the camp is rebuilt). */
  reset() {
    const g = this.game;
    for (const b of this.balls) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); }
    this.balls = [];
    this.held = null;
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
      const b = this.nearest(a.pos.x, a.pos.z, 9);
      if (!b) continue;
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
    for (const b of this.balls) {
      if (b === this.held) continue;
      const dx = b.pos.x - p.x, dz = b.pos.z - p.z;
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
      const f = Math.exp(-dt * 1.4);
      b.vel.x *= f; b.vel.z *= f;
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
