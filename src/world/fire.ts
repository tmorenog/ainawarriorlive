// Forest fires: a spreading fire front with flames, smoke and a glow light.
// When a fire dies it leaves a burn scar that permanently changes the forest
// (until it slowly regrows).
import * as THREE from 'three';
import type { Game } from '../game';
import { simRng } from '../core/rng';

export interface Fire { x: number; z: number; r: number; maxR: number; burnHours: number; dying: number }

export class FireSystem {
  fires: Fire[] = [];
  private flames: THREE.Points;
  private smoke: THREE.Points;
  private fp: THREE.BufferAttribute;
  private fa: THREE.BufferAttribute;
  private sp: THREE.BufferAttribute;
  private sa: THREE.BufferAttribute;
  private light: THREE.PointLight;
  private FN = 700;
  private SN = 400;
  private seeds: Float32Array;

  constructor(private game: Game) {
    const mk = (n: number, flame: boolean) => {
      const g = new THREE.BufferGeometry();
      const p = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
      const a = new THREE.BufferAttribute(new Float32Array(n), 1);
      g.setAttribute('position', p);
      g.setAttribute('aA', a);
      const pts = new THREE.Points(g, new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: flame ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uTime: game.uTime },
        vertexShader: `attribute float aA; varying float vA; varying float vH; uniform float uTime;
          void main(){ vA = aA; vH = fract(position.x * 13.1 + position.z * 7.7);
            vec4 mv = modelViewMatrix * vec4(position,1.0);
            gl_PointSize = ${flame ? '520.0' : '1400.0'} * (0.6 + vH * 0.6) / -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: flame
          ? `varying float vA; varying float vH; void main(){ vec2 c = gl_PointCoord - 0.5; c.y *= 0.7; float d = length(c); if (d > 0.5 || vA < 0.01) discard;
              vec3 col = mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 0.35, 0.05), smoothstep(0.0, 0.5, d + (1.0 - gl_PointCoord.y) * 0.3));
              gl_FragColor = vec4(col, vA * pow(1.0 - d * 2.0, 1.2)); }`
          : `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5 || vA < 0.01) discard; gl_FragColor = vec4(0.25, 0.23, 0.22, vA * (1.0 - d * 2.0) * 0.5); }`,
      }));
      pts.frustumCulled = false;
      game.scene.add(pts);
      return { pts, p, a };
    };
    const f = mk(this.FN, true);
    this.flames = f.pts; this.fp = f.p; this.fa = f.a;
    const s = mk(this.SN, false);
    this.smoke = s.pts; this.sp = s.p; this.sa = s.a;
    this.seeds = new Float32Array((this.FN + this.SN) * 3);
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = Math.random();
    this.light = new THREE.PointLight(0xff7a2a, 0, 40, 1.5);
    game.scene.add(this.light);
  }

  start(x: number, z: number, maxR: number) {
    this.fires.push({ x, z, r: 2, maxR, burnHours: 0, dying: 0 });
  }

  get active() { return this.fires.length > 0; }

  /** Distance from point to nearest burning area edge (negative if inside). */
  distanceTo(x: number, z: number): number {
    let best = Infinity;
    for (const f of this.fires) best = Math.min(best, Math.hypot(x - f.x, z - f.z) - f.r);
    return best;
  }

  tickHour() {
    const w = this.game.weather;
    for (const f of [...this.fires]) {
      const growth = (4 + w.p.wind * 6) * (1 - w.p.rain);
      if (f.r < f.maxR && f.dying === 0) f.r = Math.min(f.maxR, f.r + growth);
      else f.burnHours++;
      if (w.p.rain > 0.4) f.dying += w.p.rain * 0.5;
      if (f.burnHours > 3) f.dying += 0.35;
      if (f.dying >= 1) this.extinguish(f);
    }
  }

  extinguish(f: Fire) {
    this.fires.splice(this.fires.indexOf(f), 1);
    this.game.mods.burned.push({ x: f.x, z: f.z, r: f.r + 2, day: this.game.time.day });
    this.game.chunks.invalidateArea(f.x, f.z, f.r + 4);
    this.game.events.fireEnded(f);
  }

  update(dt: number) {
    const game = this.game;
    const P = this.fp.array as Float32Array, A = this.fa.array as Float32Array;
    const SP = this.sp.array as Float32Array, SA = this.sa.array as Float32Array;
    const t = game.clock;
    const pl = game.player.pos;
    let fi = 0, si = 0;
    let nearest = Infinity;
    let nearestPos: { x: number; z: number } | null = null;
    for (const f of this.fires) {
      const intensity = 1 - f.dying;
      const nF = Math.min(this.FN - fi, Math.floor(this.FN / this.fires.length));
      for (let k = 0; k < nF; k++, fi++) {
        const s0 = this.seeds[fi * 3], s1 = this.seeds[fi * 3 + 1], s2 = this.seeds[fi * 3 + 2];
        const ang = s0 * Math.PI * 2;
        const rr = f.r * (0.55 + 0.45 * Math.sqrt(s1));
        const x = f.x + Math.cos(ang) * rr, z = f.z + Math.sin(ang) * rr;
        const life = (t * (0.8 + s2) + s1 * 10) % 1;
        const y = game.groundAt(x, z) + life * (1.2 + s2 * 2.5);
        P[fi * 3] = x + Math.sin(t * 3 + s0 * 20) * 0.1; P[fi * 3 + 1] = y; P[fi * 3 + 2] = z;
        A[fi] = (1 - life) * intensity * 0.9;
      }
      const nS = Math.min(this.SN - si, Math.floor(this.SN / this.fires.length));
      for (let k = 0; k < nS; k++, si++) {
        const s0 = this.seeds[(this.FN + si) * 3], s1 = this.seeds[(this.FN + si) * 3 + 1];
        const ang = s0 * Math.PI * 2;
        const rr = f.r * Math.sqrt(s1);
        const life = (t * 0.12 + s1 * 7) % 1;
        const x = f.x + Math.cos(ang) * rr + life * game.windDir.x * 25, z = f.z + Math.sin(ang) * rr + life * game.windDir.y * 25;
        SP[si * 3] = x; SP[si * 3 + 1] = game.groundAt(f.x, f.z) + 2 + life * 30; SP[si * 3 + 2] = z;
        SA[si] = Math.sin(life * Math.PI) * intensity;
      }
      const d = Math.hypot(pl.x - f.x, pl.z - f.z) - f.r;
      if (d < nearest) { nearest = d; nearestPos = { x: f.x + ((pl.x - f.x) / (d + f.r)) * f.r, z: f.z + ((pl.z - f.z) / (d + f.r)) * f.r }; }
      // hurt cats inside
      for (const a of game.npcs.agents.values()) {
        if (Math.hypot(a.pos.x - f.x, a.pos.z - f.z) < f.r * 0.9) {
          a.cat.health -= dt * 4;
          if (a.activity !== 'flee') { a.activity = 'flee'; a.mood = 'afraid'; a.setTarget(a.pos.x + (a.pos.x - f.x) * 3, a.pos.z + (a.pos.z - f.z) * 3); }
          if (a.cat.health <= 0) game.clan.kill(a.cat, 'the fire');
        }
      }
    }
    for (; fi < this.FN; fi++) A[fi] = 0;
    for (; si < this.SN; si++) SA[si] = 0;
    this.fp.needsUpdate = this.fa.needsUpdate = this.sp.needsUpdate = this.sa.needsUpdate = true;
    this.flames.visible = this.smoke.visible = this.fires.length > 0;
    // light & damage to player
    if (nearestPos && nearest < 40) {
      this.light.position.set(nearestPos.x, game.groundAt(nearestPos.x, nearestPos.z) + 2, nearestPos.z);
      this.light.intensity = (2 + Math.sin(t * 17) * 0.4 + Math.sin(t * 7) * 0.4) * 8;
    } else this.light.intensity = 0;
    this.nearestDist = nearest;
    if (nearest < -0.5 && game.player.alive) {
      const c = game.clan.player;
      c.health -= dt * 9;
      game.player.shake = Math.max(game.player.shake, 0.4);
      if (simRng.chance(dt * 1.5)) game.ui.toast('The flames scorch your fur — get out!', 'danger');
      if (c.health <= 0) game.clan.kill(c, 'the fire');
    }
  }

  nearestDist = Infinity;

  serialize() { return this.fires.map((f) => ({ ...f })); }
  load(data: Fire[]) { this.fires = data.map((f) => ({ ...f })); }
}
