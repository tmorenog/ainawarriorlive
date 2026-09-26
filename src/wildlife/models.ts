// Stylised low-poly wildlife models built from primitives with vertex colours.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const mat = new THREE.MeshLambertMaterial({ vertexColors: true });

function colored(g: THREE.BufferGeometry, c: number | ((x: number, y: number, z: number) => number)): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const p = geo.getAttribute('position');
  const arr = new Float32Array(p.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    tmp.setHex(typeof c === 'number' ? c : c(p.getX(i), p.getY(i), p.getZ(i)));
    arr[i * 3] = tmp.r; arr[i * 3 + 1] = tmp.g; arr[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export interface QuadSpec {
  length: number;
  height: number;
  width: number;
  legLen: number;
  legR: number;
  headR: number;
  snout: number;
  body: number;
  belly: number;
  legColor: number;
  headColor: (x: number, y: number, z: number) => number;
  ear: 'point' | 'round' | 'flop';
  tail: { len: number; r: number; color: number; tip?: number; up?: number };
}

export class QuadModel {
  root = new THREE.Group();
  body = new THREE.Group();
  head = new THREE.Group();
  legs: THREE.Group[] = [];
  tail = new THREE.Group();
  phase = Math.random() * 6;
  t = 0;
  speed = 0;
  lunge = 0;
  crouch = 0;
  private spec: QuadSpec;
  private geos: THREE.BufferGeometry[] = [];

  constructor(spec: QuadSpec) {
    this.spec = spec;
    const s = spec;
    this.root.add(this.body);
    this.body.position.y = s.legLen + s.height * 0.4;
    const bg = new THREE.SphereGeometry(1, 14, 10);
    bg.scale(s.length / 2, s.height / 2, s.width / 2);
    this.add(this.body, colored(bg, (x, y) => (y < -s.height * 0.15 ? s.belly : s.body)));
    // head
    this.head.position.set(s.length * 0.48, s.height * 0.28, 0);
    this.body.add(this.head);
    const parts: THREE.BufferGeometry[] = [];
    const hg = new THREE.SphereGeometry(s.headR, 12, 9);
    parts.push(colored(hg, s.headColor));
    const sn = new THREE.ConeGeometry(s.headR * 0.55, s.snout, 8);
    sn.rotateZ(-Math.PI / 2);
    sn.translate(s.headR * 0.7 + s.snout / 2, -s.headR * 0.25, 0);
    parts.push(colored(sn, (x, y, z) => s.headColor(x, y, z)));
    const nose = new THREE.SphereGeometry(s.headR * 0.14, 6, 5);
    nose.translate(s.headR * 0.7 + s.snout, -s.headR * 0.25, 0);
    parts.push(colored(nose, 0x151212));
    for (const z of [-1, 1]) {
      const eye = new THREE.SphereGeometry(s.headR * 0.12, 6, 5);
      eye.translate(s.headR * 0.62, s.headR * 0.25, z * s.headR * 0.45);
      parts.push(colored(eye, 0x201a14));
      let ear: THREE.BufferGeometry;
      if (s.ear === 'flop') {
        ear = new THREE.SphereGeometry(s.headR * 0.45, 6, 5);
        ear.scale(0.5, 1.1, 0.3);
        ear.translate(-s.headR * 0.1, s.headR * 0.2, z * s.headR * 0.95);
      } else {
        ear = new THREE.ConeGeometry(s.headR * (s.ear === 'round' ? 0.35 : 0.38), s.headR * (s.ear === 'round' ? 0.5 : 0.9), 5);
        ear.translate(-s.headR * 0.1, s.headR * (s.ear === 'round' ? 0.95 : 1.15), z * s.headR * 0.5);
      }
      parts.push(colored(ear, s.ear === 'flop' ? s.legColor : s.headColor(0, 1, 0)));
    }
    this.add(this.head, mergeGeometries(parts)!);
    // legs
    for (const [lx, lz] of [[0.32, 1], [0.32, -1], [-0.32, 1], [-0.32, -1]]) {
      const lg = new THREE.Group();
      lg.position.set(lx * s.length, -s.height * 0.2, lz * s.width * 0.32);
      this.body.add(lg);
      const leg = new THREE.CylinderGeometry(s.legR, s.legR * 0.85, s.legLen + s.height * 0.2, 6);
      leg.translate(0, -(s.legLen + s.height * 0.2) / 2, 0);
      this.add(lg, colored(leg, s.legColor));
      this.legs.push(lg);
    }
    // tail
    this.tail.position.set(-s.length * 0.48, s.height * 0.1, 0);
    this.body.add(this.tail);
    const tg = new THREE.CylinderGeometry(s.tail.r * 0.5, s.tail.r, s.tail.len, 7);
    tg.rotateZ(Math.PI / 2);
    tg.translate(-s.tail.len / 2, 0, 0);
    this.add(this.tail, colored(tg, (x) => (s.tail.tip !== undefined && x < -s.tail.len * 0.75 ? s.tail.tip : s.tail.color)));
    this.tail.rotation.z = s.tail.up ?? 0.4;
  }

  private add(parent: THREE.Object3D, g: THREE.BufferGeometry) {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    parent.add(m);
    this.geos.push(g);
  }

  update(dt: number) {
    this.t += dt;
    const sp = this.speed;
    this.phase += dt * (sp > 0.05 ? 4 + sp * 1.6 : 0);
    const amp = sp > 0.05 ? Math.min(0.9, 0.3 + sp * 0.1) : 0;
    const offs = sp > 4 ? [0, 0.3, Math.PI, Math.PI + 0.3] : [0, Math.PI, Math.PI, 0];
    this.legs.forEach((l, i) => (l.rotation.z = Math.sin(this.phase + offs[i]) * amp + (i < 2 ? this.lunge * 0.8 : -this.lunge * 0.5)));
    this.body.position.y = this.spec.legLen + this.spec.height * 0.4 - this.crouch * this.spec.legLen * 0.4 + (sp > 0.05 ? Math.abs(Math.sin(this.phase)) * 0.02 : 0);
    this.body.rotation.z = this.lunge * 0.25 - this.crouch * 0.15;
    this.tail.rotation.y = Math.sin(this.t * 2) * 0.25;
    this.head.rotation.z = -this.crouch * 0.3;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const g of this.geos) g.dispose();
  }
}

export const FOX: QuadSpec = {
  length: 0.62, height: 0.24, width: 0.2, legLen: 0.26, legR: 0.025, headR: 0.1, snout: 0.12,
  body: 0xc8622a, belly: 0xf0e6d8, legColor: 0x2a1c14,
  headColor: (x, y) => (y < -0.02 && x > 0.02 ? 0xf0e6d8 : 0xc8622a), ear: 'point',
  tail: { len: 0.45, r: 0.07, color: 0xc8622a, tip: 0xf4efe6, up: 0.1 },
};
export const BADGER: QuadSpec = {
  length: 0.75, height: 0.3, width: 0.38, legLen: 0.12, legR: 0.045, headR: 0.12, snout: 0.1,
  body: 0x6d6a66, belly: 0x2a2826, legColor: 0x1e1c1a,
  headColor: (x, y, z) => (Math.abs(z) < 0.035 || Math.abs(z) > 0.085 ? 0xf2f0ea : 0x1c1a18), ear: 'round',
  tail: { len: 0.12, r: 0.04, color: 0x6d6a66, up: -0.2 },
};
export const DOG: QuadSpec = {
  length: 0.8, height: 0.32, width: 0.28, legLen: 0.4, legR: 0.04, headR: 0.13, snout: 0.14,
  body: 0x8a5a34, belly: 0xd8c4a4, legColor: 0x7a4e2c,
  headColor: (x, y) => (y < -0.03 ? 0xd8c4a4 : 0x8a5a34), ear: 'flop',
  tail: { len: 0.35, r: 0.04, color: 0x8a5a34, up: -0.5 },
};

// ---------------------------------------------------------------- prey
export type PreyKind = 'mouse' | 'vole' | 'rabbit' | 'bird' | 'squirrel' | 'fish' | 'frog';

const preyGeoCache = new Map<PreyKind, THREE.BufferGeometry>();
export function preyGeometry(kind: PreyKind): THREE.BufferGeometry {
  const cached = preyGeoCache.get(kind);
  if (cached) return cached;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: number) => parts.push(colored(g, c));
  switch (kind) {
    case 'mouse': case 'vole': {
      const c = kind === 'mouse' ? 0x8a7a68 : 0x6a5040;
      const b = new THREE.SphereGeometry(0.04, 8, 6); b.scale(1.5, 0.9, 1); b.translate(0, 0.035, 0); add(b, c);
      const h = new THREE.SphereGeometry(0.025, 7, 5); h.translate(0.055, 0.045, 0); add(h, c);
      for (const z of [-1, 1]) { const e = new THREE.SphereGeometry(0.014, 6, 4); e.scale(0.4, 1, 1); e.translate(0.048, 0.07, z * 0.018); add(e, 0xd8a8a0); }
      const t = new THREE.CylinderGeometry(0.003, 0.005, kind === 'mouse' ? 0.08 : 0.04, 4); t.rotateZ(Math.PI / 2 - 0.2); t.translate(-0.09, 0.03, 0); add(t, 0xc8a898);
      break;
    }
    case 'rabbit': {
      const c = 0x9a8266;
      const b = new THREE.SphereGeometry(0.09, 10, 8); b.scale(1.3, 1, 1); b.translate(0, 0.09, 0); add(b, c);
      const h = new THREE.SphereGeometry(0.05, 8, 6); h.translate(0.1, 0.15, 0); add(h, c);
      for (const z of [-1, 1]) { const e = new THREE.CylinderGeometry(0.012, 0.018, 0.11, 5); e.rotateX(z * 0.2); e.translate(0.085, 0.22, z * 0.02); add(e, 0x8a7258); }
      const t = new THREE.SphereGeometry(0.03, 6, 5); t.translate(-0.12, 0.11, 0); add(t, 0xf4f0ea);
      break;
    }
    case 'bird': {
      const b = new THREE.SphereGeometry(0.04, 8, 6); b.scale(1.4, 1, 1); b.translate(0, 0.05, 0); add(b, 0x7a5a40);
      const breast = new THREE.SphereGeometry(0.032, 7, 5); breast.translate(0.02, 0.04, 0); add(breast, 0xd88a50);
      const h = new THREE.SphereGeometry(0.024, 7, 5); h.translate(0.05, 0.08, 0); add(h, 0x6a4a34);
      const beak = new THREE.ConeGeometry(0.008, 0.025, 4); beak.rotateZ(-Math.PI / 2); beak.translate(0.08, 0.078, 0); add(beak, 0xe0b040);
      const tl = new THREE.BoxGeometry(0.05, 0.005, 0.03); tl.translate(-0.07, 0.06, 0); add(tl, 0x5a4030);
      break;
    }
    case 'squirrel': {
      const c = 0xa8542a;
      const b = new THREE.SphereGeometry(0.06, 8, 6); b.scale(1.3, 1, 0.9); b.translate(0, 0.06, 0); add(b, c);
      const h = new THREE.SphereGeometry(0.035, 7, 5); h.translate(0.075, 0.09, 0); add(h, c);
      const t = new THREE.SphereGeometry(0.05, 7, 6); t.scale(0.7, 1.8, 0.7); t.translate(-0.08, 0.13, 0); add(t, 0xb8643a);
      for (const z of [-1, 1]) { const e = new THREE.ConeGeometry(0.01, 0.025, 4); e.translate(0.07, 0.13, z * 0.015); add(e, c); }
      break;
    }
    case 'fish': {
      const b = new THREE.SphereGeometry(0.05, 8, 6); b.scale(2.2, 0.8, 0.5); add(b, 0x7a9aa8);
      const t = new THREE.ConeGeometry(0.035, 0.06, 4); t.rotateZ(Math.PI / 2); t.translate(-0.13, 0, 0); add(t, 0x6a8a98);
      break;
    }
    case 'frog': {
      const b = new THREE.SphereGeometry(0.035, 8, 6); b.scale(1.2, 0.8, 1.1); b.translate(0, 0.03, 0); add(b, 0x5a8a3a);
      for (const z of [-1, 1]) { const e = new THREE.SphereGeometry(0.012, 6, 4); e.translate(0.03, 0.055, z * 0.02); add(e, 0xd8d060); }
      break;
    }
  }
  const g = mergeGeometries(parts)!;
  preyGeoCache.set(kind, g);
  return g;
}
export const preyMaterial = mat;
