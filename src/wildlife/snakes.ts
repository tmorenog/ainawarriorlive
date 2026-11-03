// Adders: slithering snakes that coil in the warm grass and strike when you come too close.
// A bite poisons you (or a clanmate). Swipe at one and it slithers away.
import * as THREE from 'three';
import type { Game } from '../game';
import { simRng } from '../core/rng';

const SEGS = 12;

class Snake {
  root = new THREE.Group();
  segs: THREE.Mesh[] = [];
  pos = new THREE.Vector3();
  heading = simRng.range(0, Math.PI * 2);
  state: 'slither' | 'coil' | 'strike' | 'flee' = 'slither';
  timer = simRng.range(3, 8);
  t = Math.random() * 10;
  strikeCd = 0;
  constructor(scene: THREE.Scene) {
    const body = new THREE.MeshLambertMaterial({ color: 0x6b5a3a });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2218 });
    for (let i = 0; i < SEGS; i++) {
      const r = i === 0 ? 0.034 : 0.03 * (1 - i / (SEGS * 1.15));
      const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.008, r), 8, 6), i % 2 ? dark : body); // zig-zag adder markings
      m.scale.set(1.5, 0.75, 1);
      this.segs.push(m);
      this.root.add(m);
    }
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8b020 });
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.007, 5, 4), eyeMat); e.position.set(0.025, 0.012, s * 0.016); this.segs[0].add(e); }
    scene.add(this.root);
  }
}

export class SnakeManager {
  list: Snake[] = [];
  private spawnT = 5;
  constructor(private game: Game) {}

  private spawn() {
    const g = this.game;
    const p = g.player.pos;
    for (let tries = 0; tries < 6; tries++) {
      const a = simRng.range(0, Math.PI * 2), r = simRng.range(18, 45);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (Math.hypot(x, z) < 22 || g.chunks.waterDepthAt(x, z) > 0) continue; // not in camp or water
      const s = new Snake(g.scene);
      s.pos.set(x, g.groundAt(x, z), z);
      this.list.push(s);
      return;
    }
  }

  update(dt: number) {
    const g = this.game;
    if (g.state !== 'playing') return;
    const p = g.player.pos;
    const warm = g.time.season !== 'winter' && !g.time.isNight;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 12; if (warm && this.list.length < 3 && simRng.chance(0.5)) this.spawn(); }
    const pc = g.clan.player;
    for (const s of [...this.list]) {
      const d = Math.hypot(s.pos.x - p.x, s.pos.z - p.z);
      if (d > 90 || (!warm && d > 30)) { this.remove(s); continue; }
      s.t += dt; s.timer -= dt; s.strikeCd -= dt;
      // you swipe at it: it flees
      if (d < 1.6 && g.input.anyPressed('Mouse0', 'KeyF')) { s.state = 'flee'; s.timer = 4; g.ui.toast('🐍 You swipe at the adder — it hisses and slithers away!', 'good'); }
      const ghost = !!pc?.ghost;
      if (s.state !== 'flee' && !ghost && d < 1.3 && s.strikeCd <= 0) {
        s.state = 'strike'; s.timer = 0.35; s.strikeCd = 5;
        s.heading = Math.atan2(p.z - s.pos.z, p.x - s.pos.x);
        if (simRng.chance(0.6)) this.bite();
        else g.ui.toast('🐍 An adder strikes at you — and just misses!', 'danger');
      } else if (s.state === 'strike' && s.timer <= 0) { s.state = 'coil'; s.timer = 3; }
      else if (s.state === 'coil' && s.timer <= 0) { s.state = 'slither'; s.timer = simRng.range(4, 9); }
      else if (s.state === 'slither' && s.timer <= 0) { s.state = 'coil'; s.timer = simRng.range(4, 10); }
      else if (s.state === 'flee' && s.timer <= 0) { this.remove(s); continue; }
      // clanmates who stumble on it can be bitten too
      for (const a of g.npcs.agents.values()) {
        if (s.strikeCd > 0 || a.cat.clan !== 'home' || a.cat.poisoned !== undefined) continue;
        if (Math.hypot(a.pos.x - s.pos.x, a.pos.z - s.pos.z) < 0.7 && simRng.chance(0.4)) {
          s.strikeCd = 8; a.cat.poisoned = 0; a.cat.health = Math.max(5, a.cat.health - 15);
          a.say('Ow! A snake bit me!', 3);
          if (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 25) g.ui.toast(`🐍 An adder bit ${a.name}! Get the medicine cat!`, 'danger');
        }
      }
      // move
      const speed = s.state === 'flee' ? 1.6 : s.state === 'slither' ? 0.45 : 0;
      if (speed > 0) {
        if (s.state === 'flee') s.heading = Math.atan2(s.pos.z - p.z, s.pos.x - p.x);
        else s.heading += Math.sin(s.t * 0.7) * dt * 0.8;
        s.pos.x += Math.cos(s.heading) * speed * dt;
        s.pos.z += Math.sin(s.heading) * speed * dt;
      }
      s.pos.y = g.groundAt(s.pos.x, s.pos.z);
      // body: an S-shaped wave while moving, a tight coil while resting, raised head when striking
      s.root.position.copy(s.pos);
      s.root.rotation.y = -s.heading;
      for (let i = 0; i < SEGS; i++) {
        const m = s.segs[i];
        if (s.state === 'coil' || s.state === 'strike') {
          const ang = i * 0.75, rad = 0.03 + i * 0.006;
          const lift = s.state === 'strike' && i < 3 ? (3 - i) * 0.05 : i < 2 ? 0.035 : 0.01;
          m.position.set(i < 2 && s.state === 'strike' ? 0.12 - i * 0.05 : Math.cos(ang) * rad, lift + 0.02, Math.sin(ang) * rad);
        } else {
          m.position.set(-i * 0.045, 0.025, Math.sin(s.t * 6 - i * 0.7) * 0.03 * (i / SEGS + 0.3));
        }
      }
    }
  }

  private bite() {
    const g = this.game;
    const pc = g.clan.player;
    g.player.poison = Math.max(g.player.poison, 1);
    pc.health = Math.max(5, pc.health - 15);
    g.audio.hit(true);
    g.ui.hurtFlash();
    g.ui.toast('🐍 An adder bites you! Its venom burns — find the medicine cat before the poison spreads!', 'danger');
  }

  private remove(s: Snake) {
    this.game.scene.remove(s.root);
    this.list.splice(this.list.indexOf(s), 1);
  }
}
