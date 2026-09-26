// Scent sense (tracking): sniffing reveals drifting scent trails toward
// nearby prey, danger, herbs and cats.
import * as THREE from 'three';
import type { Game } from '../game';
import { dist2 } from '../core/math';

interface Trail { from: THREE.Vector3; to: THREE.Vector3; color: THREE.Color; life: number; seed: number }

export function bearing(dx: number, dz: number): string {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return dirs[Math.round(((a + 360) % 360) / 45) % 8];
}

export class ScentSystem {
  private trails: Trail[] = [];
  private points: THREE.Points;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private N = 600;
  lastSniff = -99;
  lastFound: string[] = [];

  constructor(private game: Game) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(this.N * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(this.N * 4), 4);
    g.setAttribute('position', this.pos);
    g.setAttribute('aCol', this.col);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec4 aCol; varying vec4 vC; void main(){ vC = aCol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = 22.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5 || vC.a < 0.01) discard; gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - d * 2.0)); }`,
    }));
    this.points.frustumCulled = false;
    game.scene.add(this.points);
  }

  sniff() {
    const game = this.game;
    const p = game.player.pos;
    const found: { label: string; pos: THREE.Vector3; color: number; d: number }[] = [];
    const skill = game.clan.player.skills.tracking;
    const range = 30 + skill * 0.5;
    const prey = [...game.prey.list].filter((pr) => pr.state !== 'gone').sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p)).slice(0, 3);
    for (const pr of prey) if (pr.pos.distanceTo(p) < range) found.push({ label: pr.info.name, pos: pr.pos, color: 0xffd070, d: pr.pos.distanceTo(p) });
    for (const c of game.creatures.list) if (c.pos.distanceTo(p) < range * 1.6) found.push({ label: c.name.toLowerCase(), pos: c.pos, color: 0xff5040, d: c.pos.distanceTo(p) });
    for (const a of game.npcs.agents.values()) {
      if (a.cat.clan !== 'home' && a.pos.distanceTo(p) < range * 1.4) found.push({ label: `${a.cat.clan === 'loner' ? 'loner' : game.territories.rivals[a.cat.clan as number].name} cat`, pos: a.pos, color: 0xc070ff, d: a.pos.distanceTo(p) });
      if (a.activity === 'stranded') found.push({ label: `${a.name} (in trouble!)`, pos: a.pos, color: 0x70c0ff, d: a.pos.distanceTo(p) });
    }
    for (const it of game.chunks.interactablesNear(p.x, p.z, 25)) {
      if (it.type === 'herb') found.push({ label: it.kind as string, pos: new THREE.Vector3(it.x, it.y, it.z), color: 0x90ff90, d: dist2(it.x, it.z, p.x, p.z) });
    }
    const stale = game.events.staleScents(p.x, p.z);
    this.lastSniff = game.clock;
    this.lastFound = found.map((f) => f.label);
    game.audio.sniff();
    if (!found.length) {
      game.ui.toast(stale || 'You scent nothing but earth and leaves.', 'info');
      return;
    }
    for (const f of found.slice(0, 7)) {
      this.trails.push({ from: p.clone().add(new THREE.Vector3(0, 0.15, 0)), to: f.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), color: new THREE.Color(f.color), life: 6, seed: Math.random() * 10 });
    }
    const desc = found.slice(0, 4).map((f) => `${f.label} (${f.d < 10 ? 'very close' : f.d < 30 ? 'near' : 'far'}, ${bearing(f.pos.x - p.x, f.pos.z - p.z)})`).join('; ');
    game.ui.toast(`You scent: ${desc}${stale ? '. ' + stale : ''}`, 'info');
    game.clan.player.skills.tracking = Math.min(99, skill + 0.4);
    game.objectives.onSniff(found.map((f) => f.label));
  }

  update(dt: number) {
    const P = this.pos.array as Float32Array, C = this.col.array as Float32Array;
    this.trails = this.trails.filter((t) => (t.life -= dt) > 0);
    let i = 0;
    const t = this.game.clock;
    for (const tr of this.trails) {
      const n = Math.min(80, Math.floor(tr.from.distanceTo(tr.to) * 3));
      const a = Math.min(1, tr.life / 2) * 0.8;
      for (let k = 0; k < n && i < this.N; k++, i++) {
        const u = ((k / n) + t * 0.08 + tr.seed) % 1;
        const x = tr.from.x + (tr.to.x - tr.from.x) * u + Math.sin(u * 12 + tr.seed + t) * 0.25;
        const z = tr.from.z + (tr.to.z - tr.from.z) * u + Math.cos(u * 10 + tr.seed + t) * 0.25;
        const y = this.game.groundAt(x, z) + 0.15 + Math.sin(u * 20 + t * 2) * 0.05;
        P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
        C[i * 4] = tr.color.r; C[i * 4 + 1] = tr.color.g; C[i * 4 + 2] = tr.color.b; C[i * 4 + 3] = a * (0.4 + 0.6 * Math.sin(u * Math.PI));
      }
    }
    for (; i < this.N; i++) C[i * 4 + 3] = 0;
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}
