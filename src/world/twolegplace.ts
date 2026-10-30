// The Twolegplace: a little street of Twoleg dens just outside the clan's
// border, a fully furnished kittypet home, and the rusty animal-control
// building far away where caught cats are kept.
import * as THREE from 'three';
import type { Terrain } from './terrain';
import type { Territories } from './territory';
import type { Collider } from './chunks';
import { RNG } from '../core/rng';
import { buildVehicle, Vehicle } from './twolegModel';
import { ENTRANCE_ANGLE } from './camp';

export interface P2 { x: number; z: number }

export interface TownLayout {
  c: P2; // street centre
  dir: P2; // along the street
  nrm: P2; // across the street, pointing toward clan land
  len: number;
  home: { x: number; z: number; rot: number; y: number };
  neighbours: { x: number; z: number; rot: number; y: number }[];
  nest: { loner: P2; rogue: P2 };
  facility: { x: number; z: number; y: number };
}

// ------------------------------------------------------------------ textures
function tex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, rep = true) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
const noiseDots = (c: CanvasRenderingContext2D, w: number, h: number, n: number, cols: string[], a = 0.15, size = 2) => {
  for (let i = 0; i < n; i++) { c.globalAlpha = a * Math.random(); c.fillStyle = cols[i % cols.length]; c.fillRect(Math.random() * w, Math.random() * h, size, size); }
  c.globalAlpha = 1;
};

const T: Record<string, THREE.CanvasTexture> = {};
export function textures() {
  if (T.siding) return T;
  T.siding = tex(128, 128, (c) => {
    c.fillStyle = '#e8e0cc'; c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) { c.fillStyle = 'rgba(0,0,0,0.13)'; c.fillRect(0, y + 13, 128, 3); c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(0, y, 128, 2); }
    noiseDots(c, 128, 128, 300, ['#000'], 0.06);
  });
  T.wallpaper = tex(128, 128, (c) => {
    c.fillStyle = '#efe4cf'; c.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 32) { c.fillStyle = 'rgba(160,120,90,0.12)'; c.fillRect(x, 0, 14, 128); }
    for (let y = 8; y < 128; y += 32) for (let x = 23; x < 128; x += 32) { c.fillStyle = 'rgba(200,110,110,0.35)'; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
  });
  T.planks = tex(128, 128, (c) => {
    for (let i = 0; i < 8; i++) { c.fillStyle = ['#a8763f', '#9a6a36', '#b58450', '#8f6232'][i % 4]; c.fillRect(0, i * 16, 128, 16); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, i * 16, 128, 1); c.fillRect(((i * 53) % 128), i * 16, 1, 16); }
    noiseDots(c, 128, 128, 500, ['#5a3a1a', '#d8a870'], 0.15, 3);
  });
  T.tiles = tex(64, 64, (c) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.fillStyle = (x + y) % 2 ? '#e8e8e2' : '#3a3a40'; c.fillRect(x * 16, y * 16, 16, 16); }
    c.strokeStyle = 'rgba(0,0,0,0.2)'; for (let i = 0; i <= 64; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 64); c.moveTo(0, i); c.lineTo(64, i); c.stroke(); }
  });
  T.shingles = tex(128, 128, (c) => {
    c.fillStyle = '#5a3a32'; c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 12) for (let x = (y / 12) % 2 ? -8 : 0; x < 128; x += 16) { c.fillStyle = ['#6a4038', '#56342c', '#704a40'][Math.floor(Math.random() * 3)]; c.fillRect(x + 1, y + 1, 14, 10); }
  });
  T.asphalt = tex(64, 256, (c) => {
    c.fillStyle = '#3c3e42'; c.fillRect(0, 0, 64, 256);
    noiseDots(c, 64, 256, 1600, ['#000', '#777'], 0.25, 1);
    c.fillStyle = '#e8c84a'; c.fillRect(30, 20, 4, 90); c.fillRect(30, 148, 4, 90);
    c.fillStyle = '#e8e8e2'; c.fillRect(2, 0, 2, 256); c.fillRect(60, 0, 2, 256);
  });
  T.concrete = tex(64, 64, (c) => {
    c.fillStyle = '#b8b6ae'; c.fillRect(0, 0, 64, 64);
    noiseDots(c, 64, 64, 400, ['#000', '#fff'], 0.12, 1);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 0, 64, 1); c.fillRect(0, 0, 1, 64);
  });
  T.rust = tex(128, 128, (c) => {
    // corrugated metal, streaked and eaten by rust
    for (let x = 0; x < 128; x += 8) { const g = c.createLinearGradient(x, 0, x + 8, 0); g.addColorStop(0, '#6a6460'); g.addColorStop(0.5, '#9a948c'); g.addColorStop(1, '#5a5450'); c.fillStyle = g; c.fillRect(x, 0, 8, 128); }
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 128, y = Math.random() * 128, r = 4 + Math.random() * 14;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(140,60,20,0.85)'); g.addColorStop(1, 'rgba(140,70,30,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 14; i++) { c.fillStyle = 'rgba(120,50,15,0.35)'; c.fillRect(Math.random() * 128, Math.random() * 60, 2, 30 + Math.random() * 60); }
  });
  T.stained = tex(128, 128, (c) => {
    c.fillStyle = '#8a8880'; c.fillRect(0, 0, 128, 128);
    noiseDots(c, 128, 128, 900, ['#000', '#fff'], 0.1, 2);
    for (let i = 0; i < 10; i++) { const x = Math.random() * 128, y = Math.random() * 128, r = 6 + Math.random() * 16; const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(60,40,20,0.4)'); g.addColorStop(1, 'rgba(60,40,20,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); }
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, 63, 128, 2); c.fillRect(63, 0, 2, 128);
  });
  T.rug = tex(128, 96, (c) => {
    c.fillStyle = '#8a2f2f'; c.fillRect(0, 0, 128, 96);
    c.strokeStyle = '#e0b84a'; c.lineWidth = 4; c.strokeRect(8, 8, 112, 80);
    c.strokeStyle = '#2d3d5c'; c.lineWidth = 3; c.strokeRect(18, 18, 92, 60);
    c.fillStyle = '#e0b84a'; c.beginPath(); c.moveTo(64, 28); c.lineTo(84, 48); c.lineTo(64, 68); c.lineTo(44, 48); c.fill();
  }, false);
  T.books = tex(64, 32, (c) => {
    let x = 0;
    while (x < 64) { const w = 3 + Math.random() * 4; c.fillStyle = ['#8a2f2f', '#2d3d5c', '#4f8a4a', '#e0b84a', '#6e5a8a', '#d8d0c0'][Math.floor(Math.random() * 6)]; c.fillRect(x, 4 + Math.random() * 6, w - 0.6, 32); x += w; }
  }, false);
  return T;
}

function uvScale(g: THREE.BufferGeometry, sx: number, sy: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  return g;
}

const lam = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

/** A box placed in a parent group. */
function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cyl(parent: THREE.Object3D, rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function ball(parent: THREE.Object3D, r: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Local → world for a group at (x,z) rotated by `rot` around Y. */
export function toWorld(o: { x: number; z: number; rot: number }, lx: number, lz: number): P2 {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c };
}
export function toLocal(o: { x: number; z: number; rot: number }, wx: number, wz: number): P2 {
  const dx = wx - o.x, dz = wz - o.z;
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

// ------------------------------------------------------------------ layout
export function planTown(seed: number, terrain: Terrain, terr: Territories): TownLayout {
  const rng = new RNG(seed ^ 0x7a11);
  // straight out in front of the camp entrance, a little way past the border
  const front = ENTRANCE_ANGLE;
  let best: { a: number; d: number; score: number } | null = null;
  for (let i = 0; i <= 28; i++) {
    const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.04;
    const a = front + off;
    for (const extra of [62, 72, 84]) {
      const d = terr.homeRadiusAt(a) + extra;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
      const dir = { x: -Math.sin(a), z: Math.cos(a) };
      let score = 0;
      for (let k = -6; k <= 6; k++) {
        for (const o of [0, -17, 17]) {
          const px = cx + dir.x * k * 17 - Math.cos(a) * o, pz = cz + dir.z * k * 17 - Math.sin(a) * o;
          const s = terrain.sample(px, pz);
          score -= (s.river + s.lake + s.stream * 0.6 + s.mountain + s.marsh * 0.5 + s.bank * 0.4) * 10;
          if (s.h < 1.5) score -= 5;
          if (typeof terr.ownerAt(px, pz) === 'number') score -= 12;
          if (Math.hypot(px - terr.council.x, pz - terr.council.z) < 30) score -= 20;
        }
      }
      score -= Math.abs(off) * 40 + (extra - 62) * 0.05;
      if (!best || score > best.score) best = { a, d, score };
    }
  }
  const { a, d } = best!;
  const c = { x: Math.cos(a) * d, z: Math.sin(a) * d };
  const nrm = { x: -Math.cos(a), z: -Math.sin(a) }; // toward home
  const dir = { x: -Math.sin(a), z: Math.cos(a) };
  const len = 200;
  const rot = Math.atan2(-nrm.x, -nrm.z); // houses on the home side face the street
  const rotFar = Math.atan2(nrm.x, nrm.z);
  const at = (along: number, across: number) => ({ x: c.x + dir.x * along + nrm.x * across, z: c.z + dir.z * along + nrm.z * across });
  const hp = at(0, 17);
  const home = { ...hp, rot, y: 0 };
  const neighbours = [
    { ...at(-27, 17), rot, y: 0 }, { ...at(27, 17), rot, y: 0 },
    { ...at(-14, -17), rot: rotFar, y: 0 }, { ...at(14, -17), rot: rotFar, y: 0 }, { ...at(42, -17), rot: rotFar, y: 0 },
  ];
  // the animal-control building: far away, on dry flat land
  let fac = { x: 2400, z: 2400, y: 0 };
  for (let i = 0; i < 200; i++) {
    const fa = rng.range(0, Math.PI * 2), fd = rng.range(1500, 2600);
    const x = Math.cos(fa) * fd, z = Math.sin(fa) * fd;
    let ok = true;
    for (const [ox, oz] of [[0, 0], [12, 12], [-12, 12], [12, -12], [-12, -12]]) {
      const s = terrain.sample(x + ox, z + oz);
      if (s.river > 0 || s.lake > 0 || s.stream > 0.05 || s.mountain > 0.15 || s.h < 2.5 || s.bank > 0.1) { ok = false; break; }
    }
    if (ok) { fac = { x, z, y: 0 }; break; }
  }
  return {
    c, dir, nrm, len, home, neighbours, facility: fac,
    nest: { loner: at(len / 2 + 18, 30), rogue: at(-len / 2 - 18, 30) },
  };
}

/** Flatten the ground for the town and return the zones where nothing should grow. */
export function shapeTown(L: TownLayout, terrain: Terrain): { x: number; z: number; r: number }[] {
  const clear: { x: number; z: number; r: number }[] = [];
  const seg = 20;
  let prevH: number | undefined;
  for (let s = -L.len / 2 - 10; s < L.len / 2 + 10; s += seg) {
    const x = L.c.x + L.dir.x * s, z = L.c.z + L.dir.z * s;
    const x2 = x + L.dir.x * seg, z2 = z + L.dir.z * seg;
    // the road follows the land gently: average the natural height a little
    prevH = terrain.addStrip(x, z, x2, z2, 6.5, prevH);
  }
  for (let s = -L.len / 2; s <= L.len / 2; s += 6) clear.push({ x: L.c.x + L.dir.x * s, z: L.c.z + L.dir.z * s, r: 7 });
  for (const hs of [L.home, ...L.neighbours]) {
    const h = terrain.height(hs.x, hs.z);
    terrain.addMod(hs.x, hs.z, 11, 'flat', h);
    hs.y = h;
    clear.push({ x: hs.x, z: hs.z, r: 12.5 });
  }
  // the driveway between the house and the road
  const dw = toWorld(L.home, 10.5, 6);
  clear.push({ x: dw.x, z: dw.z, r: 5 });
  const fh = terrain.height(L.facility.x, L.facility.z);
  terrain.addMod(L.facility.x, L.facility.z, 18, 'flat', fh);
  L.facility.y = fh;
  clear.push({ x: L.facility.x, z: L.facility.z, r: 24 });
  for (const n of [L.nest.loner, L.nest.rogue]) clear.push({ x: n.x, z: n.z, r: 3 });
  return clear;
}

// ------------------------------------------------------------------ walls
interface Opening { a: number; b: number; y0: number; y1: number }

/**
 * A wall from a→b along local X (axis 'x', at z=pos) or local Z (axis 'z', at x=pos),
 * cut around doors and windows; returns colliders for the gaps that stay solid.
 */
function wall(parent: THREE.Group, axis: 'x' | 'z', pos: number, a: number, b: number, H: number, mats: THREE.Material[], openings: Opening[], cols: P2[], th = 0.16) {
  const ops = openings.slice().sort((p, q) => p.a - q.a);
  const piece = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
    const len = s1 - s0, h = y1 - y0, mid = (s0 + s1) / 2;
    const g = axis === 'x' ? new THREE.BoxGeometry(len, h, th) : new THREE.BoxGeometry(th, h, len);
    uvScale(g, len / 2, h / 2);
    const m = new THREE.Mesh(g, mats);
    if (axis === 'x') m.position.set(mid, y0 + h / 2, pos); else m.position.set(pos, y0 + h / 2, mid);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
  };
  let cur = a;
  for (const o of ops) {
    piece(cur, o.a, 0, H);
    piece(o.a, o.b, 0, o.y0);
    piece(o.a, o.b, o.y1, H);
    cur = o.b;
  }
  piece(cur, b, 0, H);
  // colliders every 0.3m, skipping openings that reach the floor
  for (let s = a; s <= b + 0.001; s += 0.3) {
    if (ops.some((o) => o.y0 < 0.3 && s > o.a + 0.05 && s < o.b - 0.05)) continue;
    cols.push(axis === 'x' ? { x: s, z: pos } : { x: pos, z: s });
  }
}

/** Glass for windows, shared so it can glow warmly at night. */
export const glassMat = new THREE.MeshBasicMaterial({ color: '#a8c8e0', transparent: true, opacity: 0.32, depthWrite: false });

function windowFrame(parent: THREE.Group, axis: 'x' | 'z', pos: number, at: number, y0: number, w: number, h: number, curtains = true) {
  const frame = lam('#f4f1ea');
  const g = axis === 'x' ? new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat) : new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
  if (axis === 'x') g.position.set(at, y0 + h / 2, pos); else { g.position.set(pos, y0 + h / 2, at); g.rotation.y = Math.PI / 2; }
  (g.material as THREE.Material).side = THREE.DoubleSide;
  parent.add(g);
  const bars: [number, number, number, number, number, number][] = [
    [w + 0.1, 0.08, 0.22, 0, y0 - 0.04, 0], [w + 0.1, 0.08, 0.22, 0, y0 + h + 0.04, 0],
    [0.06, h, 0.2, 0, y0 + h / 2, 0], [0.04, h, 0.18, -w / 2, y0 + h / 2, 0], [0.04, h, 0.18, w / 2, y0 + h / 2, 0],
    [w, 0.04, 0.18, 0, y0 + h / 2, 0],
  ];
  for (const [bw, bh, bd, ox, oy] of bars) {
    if (axis === 'x') box(parent, bw, bh, bd, frame, at + ox, oy, pos);
    else box(parent, bd, bh, bw, frame, pos, oy, at + ox);
  }
  if (curtains) {
    const cm = lam('#c86a6a');
    for (const side of [-1, 1]) {
      const o = side * (w / 2 + 0.12);
      if (axis === 'x') box(parent, 0.22, h + 0.3, 0.04, cm, at + o, y0 + h / 2 + 0.05, pos + (pos > 0 ? -0.14 : 0.14));
      else box(parent, 0.04, h + 0.3, 0.22, cm, pos + (pos > 0 ? -0.14 : 0.14), y0 + h / 2 + 0.05, at + o);
    }
  }
}

function gableRoof(parent: THREE.Group, W: number, D: number, H: number, rise: number, color: string) {
  const roof = new THREE.Group();
  const t = textures();
  const shMat = new THREE.MeshLambertMaterial({ map: t.shingles, color });
  const over = 0.45;
  const half = D / 2 + over;
  const slope = Math.hypot(half, rise);
  const ang = Math.atan2(rise, half);
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(W + over * 2, 0.12, slope);
    uvScale(g, (W + 1) / 2, slope / 2);
    const m = new THREE.Mesh(g, shMat);
    m.position.set(0, H + rise / 2 - 0.05, side * half / 2);
    m.rotation.x = side * ang;
    m.castShadow = true;
    roof.add(m);
  }
  // gable ends
  const shape = new THREE.Shape();
  shape.moveTo(-D / 2, 0); shape.lineTo(D / 2, 0); shape.lineTo(0, rise); shape.lineTo(-D / 2, 0);
  const sid = new THREE.MeshLambertMaterial({ map: t.siding });
  for (const x of [-W / 2, W / 2]) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    uvScale(g, 0.25, 0.25);
    const m = new THREE.Mesh(g, sid);
    m.position.set(x - 0.08, H, 0);
    m.castShadow = true;
    roof.add(m);
  }
  parent.add(roof);
  return roof;
}

/** A plain Twoleg den for the neighbours (closed, with glowing windows). */
export function buildNeighbour(scene: THREE.Scene, o: { x: number; z: number; rot: number; y: number }, rng: RNG, cols: Collider[]) {
  const g = new THREE.Group();
  g.position.set(o.x, o.y, o.z);
  g.rotation.y = o.rot;
  const t = textures();
  const tint = rng.pick(['#f0e6d0', '#d8e4ec', '#f0d8c8', '#dce8d0', '#e8e0f0']);
  const sid = new THREE.MeshLambertMaterial({ map: t.siding, color: tint });
  const W = rng.range(9, 11), D = rng.range(7, 8.5), H = 2.8;
  const g2 = new THREE.BoxGeometry(W, H, D);
  uvScale(g2, W / 2, H / 2);
  const body = new THREE.Mesh(g2, sid);
  body.position.y = H / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  gableRoof(g, W, D, H, 1.7, rng.pick(['#ffffff', '#c8b8b0', '#a8b0c0']));
  box(g, 1.0, 2.1, 0.06, lam(rng.pick(['#8a2f2f', '#2d3d5c', '#4f6a3a', '#5a3a28'])), -W * 0.2, 1.05, D / 2 + 0.03);
  box(g, 1.6, 0.16, 0.9, lam('#9a9890'), -W * 0.2, 0.08, D / 2 + 0.45);
  for (const x of [W * 0.15, W * 0.35, -W * 0.38]) windowFrame(g, 'x', D / 2 + 0.02, x, 1.0, 1.0, 1.1, false);
  for (const x of [-W * 0.25, W * 0.25]) windowFrame(g, 'x', -D / 2 - 0.02, x, 1.0, 1.0, 1.1, false);
  box(g, 0.6, 1.6, 0.6, lam('#7a4a3a'), W * 0.28, H + 1.3, 0);
  // little front garden: fence, mailbox, a bush or two
  const fm = lam('#f4f1ea');
  for (let x = -W / 2 - 1; x <= W / 2 + 1; x += 0.5) if (Math.abs(x + W * 0.2) > 0.7) box(g, 0.08, 0.8, 0.06, fm, x, 0.4, D / 2 + 4.6);
  box(g, W + 2, 0.07, 0.04, fm, 0, 0.62, D / 2 + 4.6);
  cyl(g, 0.04, 0.04, 1.0, lam('#5a5a60'), -W * 0.2 - 1.2, 0.5, D / 2 + 5.1);
  box(g, 0.25, 0.22, 0.45, lam('#2d3d5c'), -W * 0.2 - 1.2, 1.05, D / 2 + 5.1);
  const bush = lam('#4f7a3a');
  for (const x of [W * 0.2, W * 0.32, -W * 0.38]) ball(g, 0.45, bush, x, 0.35, D / 2 + 0.6);
  scene.add(g);
  // colliders: a ring of circles around the walls
  const o2 = { x: o.x, z: o.z, rot: o.rot };
  for (let x = -W / 2; x <= W / 2; x += 0.5) for (const z of [-D / 2, D / 2]) { const p = toWorld(o2, x, z); cols.push({ x: p.x, z: p.z, r: 0.3 }); }
  for (let z = -D / 2; z <= D / 2; z += 0.5) for (const x of [-W / 2, W / 2]) { const p = toWorld(o2, x, z); cols.push({ x: p.x, z: p.z, r: 0.3 }); }
  const inner = toWorld(o2, 0, 0);
  cols.push({ x: inner.x, z: inner.z, r: Math.min(W, D) / 2 - 0.2 });
  return g;
}

// ------------------------------------------------------------------ the kittypet home
export interface HomeSpots {
  food: P2; water: P2; bed: P2; flap: P2; flapOut: P2; tree: P2; sofa: P2; tv: P2; window: P2; yarn: P2;
  frontIn: P2; frontOut: P2; gate: P2; kitchen: P2; ownerBed: P2; desk: P2; fire: P2; car: P2;
}

export interface HomeBuild {
  group: THREE.Group;
  roof: THREE.Object3D[];
  ceiling: THREE.Mesh;
  wallMats: THREE.MeshLambertMaterial[];
  colliders: Collider[];
  doorColliders: Collider[];
  spots: HomeSpots;
  kibble: THREE.Mesh;
  flap: THREE.Group;
  door: THREE.Group;
  tvMat: THREE.MeshBasicMaterial;
  fireMat: THREE.MeshBasicMaterial;
  lampMat: THREE.MeshBasicMaterial;
  yarn: THREE.Mesh;
  nameBowl: THREE.Mesh;
  car: Vehicle;
  frame: { x: number; z: number; rot: number };
  inside(x: number, z: number): boolean;
  setName(name: string): void;
}

export function buildHome(scene: THREE.Scene, o: { x: number; z: number; rot: number; y: number }): HomeBuild {
  const t = textures();
  const g = new THREE.Group();
  g.position.set(o.x, o.y, o.z);
  g.rotation.y = o.rot;
  const W = 12, D = 9, H = 2.7;
  const hw = W / 2, hd = D / 2;
  const sid = new THREE.MeshLambertMaterial({ map: t.siding, color: '#f2e2c0', transparent: true });
  const pap = new THREE.MeshLambertMaterial({ map: t.wallpaper, transparent: true });
  const pap2 = new THREE.MeshLambertMaterial({ map: t.wallpaper, color: '#d8e8f0', transparent: true });
  const edge = new THREE.MeshLambertMaterial({ color: '#d8d0c0', transparent: true });
  const wallMats = [sid, pap, pap2, edge];
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  const front = [edge, edge, edge, edge, sid, pap];
  const back = [edge, edge, edge, edge, pap, sid];
  const left = [pap, sid, edge, edge, edge, edge];
  const right = [sid, pap2, edge, edge, edge, edge];
  const part = [pap2, pap, edge, edge, edge, edge];
  const lc: P2[] = [];
  // front wall: door at x -2..-1, windows
  wall(g, 'x', hd, -hw, hw, H, front, [{ a: -2.0, b: -1.0, y0: 0, y1: 2.15 }, { a: -4.75, b: -3.65, y0: 0.9, y1: 2.05 }, { a: 3.0, b: 4.2, y0: 0.9, y1: 2.05 }], lc);
  // back wall: the cat flap (low and narrow), windows
  wall(g, 'x', -hd, -hw, hw, H, back, [{ a: -4.8, b: -4.2, y0: 0, y1: 0.45 }, { a: -2.3, b: -1.1, y0: 1.2, y1: 2.05 }, { a: 3.0, b: 4.2, y0: 1.2, y1: 2.05 }], lc);
  wall(g, 'z', -hw, -hd, hd, H, left, [{ a: -2.6, b: -1.6, y0: 1.0, y1: 2.0 }], lc);
  wall(g, 'z', hw, -hd, hd, H, right, [{ a: 0.0, b: 1.2, y0: 0.9, y1: 2.05 }], lc);
  // inner wall between the bedroom and the living room, with a doorway
  wall(g, 'z', 1.5, -hd, hd, H, part, [{ a: 0.4, b: 1.4, y0: 0, y1: 2.1 }], lc, 0.12);
  windowFrame(g, 'x', hd + 0.02, -4.2, 0.9, 1.1, 1.15);
  windowFrame(g, 'x', hd + 0.02, 3.6, 0.9, 1.2, 1.15);
  windowFrame(g, 'x', -hd - 0.02, -1.7, 1.2, 1.2, 0.85);
  windowFrame(g, 'x', -hd - 0.02, 3.6, 1.2, 1.2, 0.85);
  windowFrame(g, 'z', -hw - 0.02, -2.1, 1.0, 1.0, 1.0);
  windowFrame(g, 'z', hw + 0.02, 0.6, 0.9, 1.2, 1.15);
  // floors
  const planks = new THREE.MeshLambertMaterial({ map: t.planks });
  const tiles = new THREE.MeshLambertMaterial({ map: t.tiles });
  const fl = (x0: number, x1: number, z0: number, z1: number, m: THREE.Material, rep: number) => {
    const gg = new THREE.BoxGeometry(x1 - x0, 0.1, z1 - z0);
    uvScale(gg, (x1 - x0) / rep, (z1 - z0) / rep);
    const mesh = new THREE.Mesh(gg, m);
    mesh.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  fl(-hw, 1.5, 0, hd, planks, 2);
  fl(-hw, 1.5, -hd, 0, tiles, 1);
  fl(1.5, hw, -hd, hd, planks, 2);
  // ceiling (seen from inside in first person)
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), lam('#f4f1ea', { side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H - 0.01;
  g.add(ceiling);
  const roof = gableRoof(g, W, D, H, 1.9, '#ffffff');
  const chimney = box(g, 0.7, 2.4, 0.7, lam('#8a4a3a'), -hw + 0.4, H + 1.4, 2.6);
  roof.add(chimney);
  g.remove(chimney);

  // ---------------- living room
  const wood = lam('#7a5232'), darkWood = lam('#4a3020'), fabric = lam('#7a98c0'), cushion = lam('#a8c0e0');
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), new THREE.MeshLambertMaterial({ map: t.rug }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-2.8, 0.036, 2.6);
  rug.receiveShadow = true;
  g.add(rug);
  // sofa (facing the TV on the front wall)
  box(g, 2.3, 0.42, 0.9, fabric, -2.85, 0.21, 1.2);
  box(g, 2.3, 0.75, 0.22, fabric, -2.85, 0.6, 0.78);
  for (const x of [-3.9, -1.8]) box(g, 0.22, 0.6, 0.9, fabric, x, 0.35, 1.2);
  for (const x of [-3.35, -2.35]) box(g, 0.95, 0.12, 0.75, cushion, x, 0.48, 1.25);
  box(g, 0.45, 0.35, 0.12, lam('#e0b84a'), -3.55, 0.65, 0.95).rotation.z = 0.2;
  // armchair
  box(g, 0.9, 0.42, 0.85, lam('#8a5a3a'), 0.4, 0.21, 2.3);
  box(g, 0.2, 0.75, 0.85, lam('#8a5a3a'), 0.85, 0.55, 2.3);
  for (const z of [1.92, 2.68]) box(g, 0.9, 0.55, 0.15, lam('#8a5a3a'), 0.4, 0.4, z);
  // coffee table with a mug, the remote and a magazine
  box(g, 1.2, 0.06, 0.6, wood, -2.85, 0.42, 2.6);
  for (const [x, z] of [[-3.35, 2.4], [-2.35, 2.4], [-3.35, 2.8], [-2.35, 2.8]]) box(g, 0.05, 0.4, 0.05, wood, x, 0.2, z);
  cyl(g, 0.04, 0.035, 0.09, lam('#f4f1ea'), -2.6, 0.5, 2.55);
  box(g, 0.05, 0.02, 0.16, lam('#1a1a1e'), -3.1, 0.46, 2.65);
  box(g, 0.3, 0.01, 0.22, lam('#c8463c'), -2.95, 0.455, 2.75).rotation.y = 0.3;
  // TV on its stand against the front wall
  box(g, 1.5, 0.5, 0.45, darkWood, -2.85, 0.25, 4.15);
  box(g, 1.3, 0.75, 0.06, lam('#121214'), -2.85, 0.95, 4.25);
  const tvMat = new THREE.MeshBasicMaterial({ color: '#1a2a3a' });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.66), tvMat);
  scr.position.set(-2.85, 0.95, 4.215);
  scr.rotation.y = Math.PI;
  g.add(scr);
  box(g, 0.25, 0.12, 0.2, lam('#2a2a2e'), -3.3, 0.56, 4.1);
  // fireplace on the left wall
  box(g, 0.5, 1.2, 1.5, lam('#9a5a42'), -hw + 0.25, 0.6, 2.6);
  box(g, 0.52, 0.55, 0.8, lam('#1a1412'), -hw + 0.27, 0.32, 2.6);
  box(g, 0.75, 0.1, 1.7, lam('#d8d0c0'), -hw + 0.36, 1.22, 2.6);
  box(g, 0.6, 0.05, 1.6, lam('#7a7470'), -hw + 0.5, 0.02, 2.6);
  const fireMat = new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.9 });
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 6), fireMat);
  fire.position.set(-hw + 0.35, 0.25, 2.6);
  g.add(fire);
  for (let i = 0; i < 3; i++) box(g, 0.08, 0.08, 0.5, darkWood, -hw + 0.32, 0.08 + i * 0.03, 2.5 + i * 0.08).rotation.y = i * 0.6;
  // photos and a clock on the mantel
  box(g, 0.05, 0.25, 0.2, lam('#e0b84a'), -hw + 0.4, 1.4, 2.2);
  box(g, 0.05, 0.2, 0.25, lam('#c8c8c8'), -hw + 0.4, 1.38, 3.0);
  // cat bed by the fire: a round cushion inside a padded ring
  const bedMat = lam('#b8506a');
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.11, 8, 20), bedMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(-4.9, 0.11, 1.0);
  g.add(ring);
  cyl(g, 0.32, 0.32, 0.08, lam('#f0d8e0'), -4.9, 0.06, 1.0, 20);
  // floor lamp
  cyl(g, 0.15, 0.18, 0.04, darkWood, -5.5, 0.02, 4.0);
  cyl(g, 0.02, 0.02, 1.6, lam('#3a3a40'), -5.5, 0.8, 4.0);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff0c8' });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.32, 14, 1, true), lampMat);
  shade.position.set(-5.5, 1.65, 4.0);
  (shade.material as THREE.Material).side = THREE.DoubleSide;
  g.add(shade);
  // bookshelf on the inner wall
  box(g, 0.32, 1.8, 1.1, wood, 1.27, 0.9, 3.6);
  const books = new THREE.MeshLambertMaterial({ map: t.books });
  for (let i = 0; i < 4; i++) {
    box(g, 0.34, 0.03, 1.1, darkWood, 1.27, 0.2 + i * 0.45, 3.6);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.32), books);
    b.position.set(1.1, 0.38 + i * 0.45, 3.6);
    b.rotation.y = -Math.PI / 2;
    g.add(b);
  }
  // cat tree: carpeted posts, platforms and a little cubby house
  const sisal = lam('#c9b27a'), carpet = lam('#8a7a9a');
  cyl(g, 0.07, 0.07, 1.6, sisal, 0.35, 0.8, 4.0);
  cyl(g, 0.07, 0.07, 1.0, sisal, -0.2, 0.5, 3.8);
  box(g, 0.9, 0.08, 0.7, carpet, 0.15, 0.04, 3.9);
  box(g, 0.6, 0.45, 0.55, carpet, -0.15, 1.2, 3.9);
  box(g, 0.62, 0.06, 0.6, carpet, 0.35, 1.62, 3.95);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), lam('#2a2228'));
  hole.position.set(-0.15, 1.18, 3.62);
  hole.rotation.y = Math.PI;
  g.add(hole);
  const toyM = lam('#e0b84a');
  const toy = ball(g, 0.05, toyM, 0.55, 1.4, 3.7);
  void toy;
  // houseplant and a picture or two
  cyl(g, 0.2, 0.15, 0.4, lam('#b8603a'), -0.6, 0.2, 4.1);
  for (let i = 0; i < 6; i++) ball(g, 0.18, lam('#3f7a3a'), -0.6 + Math.cos(i) * 0.15, 0.55 + (i % 3) * 0.12, 4.1 + Math.sin(i) * 0.15);
  box(g, 0.7, 0.5, 0.03, lam('#3a6ea8'), -2.85, 1.85, 4.33);
  // yarn ball to bat around
  const yarn = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), lam('#d0405a'));
  yarn.position.set(-1.2, 0.08, 2.4);
  yarn.castShadow = true;
  g.add(yarn);

  // ---------------- kitchen
  const cab = lam('#e8e4da'), counterTop = lam('#5a5a60');
  box(g, 4.6, 0.88, 0.6, cab, -1.25, 0.44, -hd + 0.38);
  box(g, 4.7, 0.05, 0.66, counterTop, -1.25, 0.9, -hd + 0.38);
  for (let i = 0; i < 6; i++) box(g, 0.02, 0.15, 0.02, lam('#8a8a90'), -3.3 + i * 0.8, 0.75, -hd + 0.69);
  box(g, 4.0, 0.7, 0.35, cab, -1.25, 1.85, -hd + 0.25);
  // sink with a tap
  box(g, 0.7, 0.05, 0.45, lam('#b8bcc2'), -1.7, 0.93, -hd + 0.4);
  cyl(g, 0.02, 0.02, 0.3, lam('#b8bcc2'), -1.7, 1.05, -hd + 0.2);
  box(g, 0.02, 0.02, 0.15, lam('#b8bcc2'), -1.7, 1.2, -hd + 0.27);
  // stove with burners and an oven window
  box(g, 0.75, 0.9, 0.62, lam('#2a2a2e'), 0.4, 0.45, -hd + 0.38);
  for (const [dx, dz] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.12], [0.18, 0.12]]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 14), lam('#5a5a60'));
    r.rotation.x = -Math.PI / 2;
    r.position.set(0.4 + dx, 0.92, -hd + 0.38 + dz);
    g.add(r);
  }
  box(g, 0.5, 0.3, 0.02, lam('#1a1a1e'), 0.4, 0.45, -hd + 0.7);
  cyl(g, 0.12, 0.1, 0.12, lam('#b8bcc2'), 0.22, 0.99, -hd + 0.26);
  // fridge with magnets
  box(g, 0.8, 1.9, 0.75, lam('#f4f4f2'), -hw + 0.45, 0.95, -1.2);
  box(g, 0.03, 0.5, 0.04, lam('#8a8a90'), -hw + 0.86, 1.3, -0.95);
  for (let i = 0; i < 4; i++) box(g, 0.02, 0.06, 0.06, lam(['#c8463c', '#e0b84a', '#3a6ea8', '#4f8a4a'][i]), -hw + 0.86, 1.1 + i * 0.13, -1.4 + (i % 2) * 0.15);
  // dining table and chairs, fruit bowl
  box(g, 1.4, 0.06, 0.9, wood, -2.4, 0.76, -1.9);
  for (const [x, z] of [[-3.0, -2.25], [-1.8, -2.25], [-3.0, -1.55], [-1.8, -1.55]]) box(g, 0.06, 0.74, 0.06, wood, x, 0.37, z);
  for (const [x, z, r] of [[-2.8, -1.1, 0], [-2.0, -1.1, 0], [-2.8, -2.7, Math.PI], [-2.0, -2.7, Math.PI]] as [number, number, number][]) {
    box(g, 0.42, 0.05, 0.42, wood, x, 0.45, z);
    for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) box(g, 0.04, 0.45, 0.04, wood, x + dx, 0.22, z + dz);
    box(g, 0.42, 0.5, 0.04, wood, x, 0.72, z + (r ? -0.2 : 0.2));
  }
  cyl(g, 0.16, 0.1, 0.08, lam('#d8d0c0'), -2.4, 0.83, -1.9);
  for (let i = 0; i < 4; i++) ball(g, 0.05, lam(['#c8463c', '#e0b84a', '#7ac04a', '#e8792a'][i]), -2.43 + (i % 2) * 0.07, 0.88, -1.93 + Math.floor(i / 2) * 0.07);
  // the kitchen clock
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20), lam('#f4f1ea'));
  clock.position.set(-1.25, 2.35, -hd + 0.09);
  g.add(clock);
  // the cat's bowls on a little mat — with the cat's name on the food bowl
  box(g, 0.9, 0.01, 0.5, lam('#4f8a4a'), -4.3, 0.036, -2.9);
  const bowlFood = cyl(g, 0.13, 0.1, 0.07, lam('#c8463c'), -4.55, 0.035, -2.9, 16);
  cyl(g, 0.13, 0.1, 0.07, lam('#3a6ea8'), -4.05, 0.035, -2.9, 16);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: '#7ab0d8' }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(-4.05, 0.06, -2.9);
  g.add(water);
  const kibble = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), lam('#9a6a36'));
  kibble.scale.y = 0.4;
  kibble.position.set(-4.55, 0.05, -2.9);
  g.add(kibble);
  const nameTex = { cv: document.createElement('canvas'), tex: null as THREE.CanvasTexture | null };
  nameTex.cv.width = 128; nameTex.cv.height = 32;
  nameTex.tex = new THREE.CanvasTexture(nameTex.cv);
  nameTex.tex.colorSpace = THREE.SRGBColorSpace;
  const nameBowl = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), new THREE.MeshBasicMaterial({ map: nameTex.tex, transparent: true }));
  nameBowl.position.set(-4.55, 0.04, -2.76);
  nameBowl.rotation.x = -0.25;
  g.add(nameBowl);
  void bowlFood;
  // a bag of kibble
  box(g, 0.3, 0.45, 0.18, lam('#e0b84a'), -5.4, 0.22, -3.6).rotation.y = 0.3;
  // the cat flap swings on a hinge at the top
  const flap = new THREE.Group();
  flap.position.set(-4.5, 0.45, -hd);
  const flapPane = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 0.02), new THREE.MeshLambertMaterial({ color: '#d8e0e8', transparent: true, opacity: 0.6 }));
  flapPane.position.y = -0.21;
  flap.add(flapPane);
  g.add(flap);
  box(g, 0.66, 0.04, 0.2, lam('#f4f1ea'), -4.5, 0.47, -hd);

  // ---------------- bedroom
  box(g, 1.7, 0.35, 2.2, darkWood, 4.4, 0.175, -3.3);
  box(g, 1.6, 0.2, 2.1, lam('#f4f1ea'), 4.4, 0.45, -3.3);
  box(g, 1.65, 0.08, 1.5, lam('#6e5a8a'), 4.4, 0.58, -2.95);
  for (const x of [4.0, 4.8]) box(g, 0.55, 0.14, 0.35, lam('#ffffff'), x, 0.62, -4.1);
  box(g, 1.7, 1.1, 0.1, darkWood, 4.4, 0.55, -hd + 0.08);
  for (const x of [3.25, 5.55]) {
    box(g, 0.45, 0.5, 0.4, wood, x, 0.25, -4.1);
    cyl(g, 0.08, 0.1, 0.25, lam('#e0b84a'), x, 0.62, -4.1);
  }
  box(g, 0.6, 2.0, 1.4, wood, hw - 0.35, 1.0, 2.6);
  box(g, 0.02, 1.9, 0.02, darkWood, hw - 0.66, 1.0, 2.6);
  const rug2 = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), lam('#c9b27a'));
  rug2.rotation.x = -Math.PI / 2;
  rug2.position.set(4.4, 0.036, -1.6);
  g.add(rug2);
  // a desk with a glowing laptop by the window
  box(g, 1.3, 0.05, 0.6, wood, 2.6, 0.75, hd - 0.4);
  for (const [x, z] of [[2.0, hd - 0.65], [3.2, hd - 0.65], [2.0, hd - 0.15], [3.2, hd - 0.15]]) box(g, 0.05, 0.75, 0.05, wood, x, 0.37, z);
  box(g, 0.4, 0.02, 0.28, lam('#b8bcc2'), 2.6, 0.79, hd - 0.42);
  const lap = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.24), new THREE.MeshBasicMaterial({ color: '#7ab8ff' }));
  lap.position.set(2.6, 0.92, hd - 0.56);
  lap.rotation.x = -0.25;
  lap.rotation.y = Math.PI;
  g.add(lap);
  // a toy box spilling a teddy and blocks
  box(g, 0.7, 0.45, 0.45, lam('#3aa0a0'), 2.3, 0.22, 0.2);
  ball(g, 0.12, lam('#9a6a36'), 2.3, 0.55, 0.2);
  for (let i = 0; i < 3; i++) box(g, 0.1, 0.1, 0.1, lam(['#c8463c', '#e0b84a', '#3a6ea8'][i]), 2.0 + i * 0.25, 0.05, 0.75).rotation.y = i;

  // ---------------- outside
  const step = lam('#a8a49c');
  box(g, 1.6, 0.16, 1.0, step, -1.5, 0.08, hd + 0.5);
  box(g, 1.2, 0.08, 0.6, lam('#7a5a3a'), -1.5, 0.2, hd + 0.4);
  // porch roof on posts
  box(g, 2.2, 0.08, 1.3, lam('#f4f1ea'), -1.5, 2.45, hd + 0.6);
  for (const x of [-2.5, -0.5]) cyl(g, 0.05, 0.05, 2.4, lam('#f4f1ea'), x, 1.2, hd + 1.15);
  const porchLight = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lampMat);
  porchLight.position.set(-0.75, 2.0, hd + 0.1);
  g.add(porchLight);
  // the front door swings open on its hinge
  const door = new THREE.Group();
  door.position.set(-2.0, 0, hd);
  const dm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.15, 0.06), lam('#8a2f2f'));
  dm.position.set(0.5, 1.075, 0);
  dm.castShadow = true;
  door.add(dm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), lam('#e0b84a'));
  knob.position.set(0.88, 1.0, 0.05);
  door.add(knob);
  for (const y of [0.55, 1.45]) { const pn = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.02), lam('#7a2828')); pn.position.set(0.5, y, 0.035); door.add(pn); }
  g.add(door);
  // garden path to the gate and the street
  const path = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 5.0), new THREE.MeshLambertMaterial({ map: t.concrete }));
  path.rotation.x = -Math.PI / 2;
  path.position.set(-1.5, 0.02, hd + 3.4);
  path.receiveShadow = true;
  g.add(path);
  // picket fence around the garden (cats hop right over it)
  const pick = lam('#f4f1ea');
  for (let x = -hw - 1.6; x <= hw + 1.6; x += 0.32) if (Math.abs(x + 1.5) > 0.7) {
    box(g, 0.07, 0.75, 0.04, pick, x, 0.37, hd + 5.9);
  }
  box(g, W + 3.2, 0.06, 0.03, pick, 0, 0.55, hd + 5.9);
  box(g, W + 3.2, 0.06, 0.03, pick, 0, 0.25, hd + 5.9);
  for (const side of [-1, 1]) for (let z = -hd - 2.5; z <= hd + 5.9; z += 0.32) box(g, 0.04, 0.75, 0.07, pick, side * (hw + 1.6), 0.37, z);
  for (let x = -hw - 1.6; x <= hw + 1.6; x += 0.32) box(g, 0.07, 0.75, 0.04, pick, x, 0.37, -hd - 2.5);
  // mailbox, flower beds, a garden tree, bins, a bird feeder and a gnome
  cyl(g, 0.04, 0.04, 1.0, lam('#5a5a60'), -2.9, 0.5, hd + 6.4);
  box(g, 0.25, 0.25, 0.48, lam('#c8463c'), -2.9, 1.08, hd + 6.4);
  box(g, 0.02, 0.15, 0.04, lam('#e0b84a'), -2.75, 1.25, hd + 6.3);
  const soil = lam('#4a3626');
  for (const [x0, x1] of [[-hw + 0.2, -2.4], [-0.6, hw - 0.2]]) {
    box(g, x1 - x0, 0.1, 0.9, soil, (x0 + x1) / 2, 0.05, hd + 0.75);
    for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.45) {
      ball(g, 0.16, lam('#3f7a3a'), x, 0.2, hd + 0.75);
      ball(g, 0.07, lam(['#e07a9a', '#e0b84a', '#c8463c', '#b07aff', '#ffffff'][Math.floor(Math.abs(x * 7)) % 5]), x + 0.05, 0.36, hd + 0.7);
    }
  }
  cyl(g, 0.16, 0.22, 2.4, lam('#5a3a24'), -hw - 0.3, 1.2, hd + 3.6);
  for (let i = 0; i < 7; i++) ball(g, 0.8 + (i % 3) * 0.15, lam(i % 2 ? '#4f7a3a' : '#5f8a44'), -hw - 0.3 + Math.cos(i * 1.7) * 0.7, 2.7 + (i % 3) * 0.35, hd + 3.6 + Math.sin(i * 1.7) * 0.7);
  for (const [i, c] of [[0, '#3a6a3a'], [1, '#3a3a40']] as [number, string][]) {
    box(g, 0.6, 1.0, 0.65, lam(c), hw + 0.6, 0.5, -2.2 + i * 0.75);
    box(g, 0.62, 0.06, 0.68, lam(c), hw + 0.6, 1.03, -2.2 + i * 0.75);
  }
  cyl(g, 0.04, 0.04, 1.6, darkWood, 3.6, 0.8, -hd - 1.6);
  box(g, 0.4, 0.04, 0.4, darkWood, 3.6, 1.6, -hd - 1.6);
  box(g, 0.45, 0.25, 0.04, darkWood, 3.6, 1.82, -hd - 1.6).rotation.z = 0.0;
  cyl(g, 0.1, 0.13, 0.2, lam('#3a6ea8'), 5.2, 0.1, hd + 3.0);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 8), lam('#c8463c'));
  hat.position.set(5.2, 0.33, hd + 3.0);
  g.add(hat);
  ball(g, 0.07, lam('#f1d0b5'), 5.2, 0.23, hd + 3.06);
  // a little garden shed
  box(g, 1.6, 1.6, 1.3, lam('#6a8a5a'), -4.2, 0.8, -hd - 1.4);
  box(g, 1.8, 0.1, 1.5, lam('#5a3a32'), -4.2, 1.65, -hd - 1.4);
  // driveway with the family car
  const dw = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 9), new THREE.MeshLambertMaterial({ map: t.concrete }));
  dw.rotation.x = -Math.PI / 2;
  dw.position.set(hw + 4.5, 0.02, 4.8);
  dw.receiveShadow = true;
  g.add(dw);
  const car = buildVehicle('car', '#3a6ea8');
  car.root.position.set(hw + 4.5, 0, 3.5);
  car.root.rotation.y = Math.PI / 2;
  g.add(car.root);

  scene.add(g);
  const frame = { x: o.x, z: o.z, rot: o.rot };
  const W2 = (lx: number, lz: number) => toWorld(frame, lx, lz);
  const colliders: Collider[] = lc.map((p) => { const w = W2(p.x, p.z); return { x: w.x, z: w.z, r: 0.17 }; });
  // furniture colliders (cats walk around sofas and tables)
  const furn: [number, number, number][] = [
    [-3.4, 1.2, 0.42], [-2.3, 1.2, 0.42], [-2.85, 2.6, 0.3], [0.4, 2.3, 0.42], [-hw + 0.3, 2.6, 0.45], [1.27, 3.3, 0.25], [1.27, 3.9, 0.25],
    [-2.85, 4.15, 0.3], [-3.4, 4.15, 0.25], [-2.3, 4.15, 0.25], [-hw + 0.45, -1.2, 0.45], [5.6, 2.3, 0.35], [5.6, 2.9, 0.35],
    [-3.8, -hd + 0.4, 0.33], [-3.2, -hd + 0.4, 0.33], [-2.5, -hd + 0.4, 0.33], [-1.8, -hd + 0.4, 0.33], [-1.1, -hd + 0.4, 0.33], [-0.4, -hd + 0.4, 0.33], [0.3, -hd + 0.4, 0.33], [0.7, -hd + 0.4, 0.33],
    [3.8, -3.3, 0.5], [4.4, -3.3, 0.5], [5.0, -3.3, 0.5], [4.4, -2.5, 0.45], [2.3, 0.2, 0.3], [-0.6, 4.1, 0.22], [-4.2, -hd - 1.4, 0.8],
    [hw + 4.5, 2.2, 0.9], [hw + 4.5, 3.5, 0.9], [hw + 4.5, 4.8, 0.9], [-hw - 0.3, hd + 3.6, 0.22], [hw + 0.6, -1.85, 0.4],
  ];
  for (const [x, z, r] of furn) { const w = W2(x, z); colliders.push({ x: w.x, z: w.z, r }); }
  const doorColliders: Collider[] = [];
  for (let x = -1.9; x <= -1.1; x += 0.27) { const w = W2(x, hd); doorColliders.push({ x: w.x, z: w.z, r: 0.17 }); }
  const spots: HomeSpots = {
    food: W2(-4.55, -2.6), water: W2(-4.05, -2.6), bed: W2(-4.9, 1.0), flap: W2(-4.5, -hd + 0.5), flapOut: W2(-4.5, -hd - 0.6),
    tree: W2(0.15, 3.4), sofa: W2(-2.85, 1.2), tv: W2(-2.85, 3.4), window: W2(-4.2, 3.95), yarn: W2(-1.2, 2.4),
    frontIn: W2(-1.5, hd - 0.8), frontOut: W2(-1.5, hd + 1.4), gate: W2(-1.5, hd + 6.3), kitchen: W2(-1.5, -hd + 1.1),
    ownerBed: W2(4.4, -3.3), desk: W2(2.6, hd - 1.0), fire: W2(-hw + 0.9, 2.6), car: W2(hw + 4.5, 3.5),
  };
  return {
    group: g, roof: [roof], ceiling, wallMats, colliders, doorColliders, spots, kibble, flap, door, tvMat, fireMat, lampMat, yarn, nameBowl, car, frame,
    inside: (x, z) => { const l = toLocal(frame, x, z); return Math.abs(l.x) < hw - 0.05 && Math.abs(l.z) < hd - 0.05; },
    setName: (name: string) => {
      const c = nameTex.cv.getContext('2d')!;
      c.clearRect(0, 0, 128, 32);
      c.fillStyle = '#ffffff';
      c.font = 'bold 22px sans-serif';
      c.textAlign = 'center';
      c.fillText(name.toUpperCase(), 64, 24);
      nameTex.tex!.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ the street
export interface StreetBuild { group: THREE.Group; lampMats: THREE.MeshBasicMaterial; posterSpots: P2[]; posters: THREE.Group }

export function buildStreet(scene: THREE.Scene, L: TownLayout, height: (x: number, z: number) => number): StreetBuild {
  const t = textures();
  const group = new THREE.Group();
  const ribbon = (off0: number, off1: number, lift: number, mat: THREE.Material, vRep: number) => {
    const n = Math.ceil(L.len / 3);
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = -L.len / 2 + (i / n) * L.len;
      for (const [k, off] of [[0, off0], [1, off1]] as [number, number][]) {
        const x = L.c.x + L.dir.x * s + L.nrm.x * off, z = L.c.z + L.dir.z * s + L.nrm.z * off;
        pos.push(x, height(x, z) + lift, z);
        uv.push(k, s / vRep);
      }
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure the faces point up
    const nrm = g.getAttribute('normal');
    if (nrm.getY(0) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
  };
  ribbon(-3.6, 3.6, 0.05, new THREE.MeshLambertMaterial({ map: t.asphalt }), 9);
  const conc = new THREE.MeshLambertMaterial({ map: t.concrete });
  ribbon(3.6, 5.3, 0.1, conc, 1.7);
  ribbon(-5.3, -3.6, 0.1, conc, 1.7);
  // zebra crossing in front of the kittypet home
  const zm = lam('#e8e8e2');
  for (let k = -3; k <= 3; k++) {
    const s = -1.5, off = k * 1.0;
    const x = L.c.x + L.dir.x * s + L.nrm.x * off, z = L.c.z + L.dir.z * s + L.nrm.z * off;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), zm);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(L.dir.x, L.dir.z) + Math.PI / 2;
    m.position.set(x, height(x, z) + 0.065, z);
    group.add(m);
  }
  // street lamps, a hydrant, a bench and signs
  const lampMats = new THREE.MeshBasicMaterial({ color: '#4a4a44' });
  const pole = lam('#3a3a40');
  const posterSpots: P2[] = [];
  for (let s = -L.len / 2 + 10; s < L.len / 2; s += 30) {
    for (const side of [1, -1]) {
      const off = side * 5.6;
      const x = L.c.x + L.dir.x * (s + (side < 0 ? 15 : 0)) + L.nrm.x * off, z = L.c.z + L.dir.z * (s + (side < 0 ? 15 : 0)) + L.nrm.z * off;
      const y = height(x, z);
      cyl(group, 0.06, 0.09, 4.2, pole, x, y + 2.1, z, 8);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.2), pole);
      arm.position.set(x - L.nrm.x * side * 0.6, y + 4.2, z - L.nrm.z * side * 0.6);
      arm.rotation.y = Math.atan2(L.nrm.x, L.nrm.z);
      group.add(arm);
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.25), lampMats);
      bulb.position.set(x - L.nrm.x * side * 1.15, y + 4.12, z - L.nrm.z * side * 1.15);
      bulb.rotation.y = Math.atan2(L.dir.x, L.dir.z);
      group.add(bulb);
      if (side > 0) posterSpots.push({ x, z });
    }
  }
  const hx = L.c.x + L.dir.x * 8 + L.nrm.x * 4.8, hz = L.c.z + L.dir.z * 8 + L.nrm.z * 4.8;
  const hy = height(hx, hz);
  cyl(group, 0.14, 0.16, 0.6, lam('#c8302a'), hx, hy + 0.3, hz, 10);
  ball(group, 0.15, lam('#c8302a'), hx, hy + 0.62, hz);
  const bx = L.c.x - L.dir.x * 30 - L.nrm.x * 4.8, bz = L.c.z - L.dir.z * 30 - L.nrm.z * 4.8;
  const by = height(bx, bz);
  const bench = new THREE.Group();
  bench.position.set(bx, by, bz);
  bench.rotation.y = Math.atan2(L.dir.x, L.dir.z) + Math.PI / 2;
  box(bench, 1.8, 0.06, 0.45, lam('#7a5232'), 0, 0.45, 0);
  box(bench, 1.8, 0.4, 0.05, lam('#7a5232'), 0, 0.75, -0.22);
  for (const x of [-0.8, 0.8]) box(bench, 0.06, 0.45, 0.45, pole, x, 0.22, 0);
  group.add(bench);
  // a yellow "cat crossing" sign at each end
  const signTex = tex(64, 64, (c) => {
    c.fillStyle = '#e8c84a'; c.translate(32, 32); c.rotate(Math.PI / 4); c.fillRect(-21, -21, 42, 42); c.rotate(-Math.PI / 4);
    c.fillStyle = '#1a1a1e'; c.beginPath(); c.arc(0, 4, 9, 0, 7); c.fill(); c.beginPath(); c.arc(0, -8, 6, 0, 7); c.fill();
    c.beginPath(); c.moveTo(-6, -12); c.lineTo(-4, -18); c.lineTo(-1, -12); c.fill(); c.beginPath(); c.moveTo(6, -12); c.lineTo(4, -18); c.lineTo(1, -12); c.fill();
  }, false);
  for (const s of [-L.len / 2 + 4, L.len / 2 - 4]) {
    const x = L.c.x + L.dir.x * s + L.nrm.x * 5.2, z = L.c.z + L.dir.z * s + L.nrm.z * 5.2;
    const y = height(x, z);
    cyl(group, 0.04, 0.04, 2.2, pole, x, y + 1.1, z, 6);
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshLambertMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide }));
    sg.position.set(x, y + 2.2, z);
    sg.rotation.y = Math.atan2(L.dir.x, L.dir.z);
    group.add(sg);
  }
  const posters = new THREE.Group();
  group.add(posters);
  scene.add(group);
  return { group, lampMats, posterSpots, posters };
}

/** "LOST CAT" posters with the cat's colours, taped to the lamp posts. */
export function makePoster(name: string, base: string, second: string): THREE.CanvasTexture {
  return tex(64, 96, (c) => {
    c.fillStyle = '#f8f6ee'; c.fillRect(0, 0, 64, 96);
    c.fillStyle = '#c8302a'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center'; c.fillText('LOST CAT', 32, 15);
    c.fillStyle = base; c.beginPath(); c.ellipse(32, 50, 17, 13, 0, 0, 7); c.fill();
    c.beginPath(); c.arc(32, 34, 10, 0, 7); c.fill();
    c.beginPath(); c.moveTo(24, 30); c.lineTo(25, 20); c.lineTo(30, 27); c.fill(); c.beginPath(); c.moveTo(40, 30); c.lineTo(39, 20); c.lineTo(34, 27); c.fill();
    c.fillStyle = second; c.fillRect(22, 46, 20, 3); c.fillRect(24, 54, 16, 3);
    c.fillStyle = '#1a1a1e'; c.font = 'bold 11px sans-serif'; c.fillText(name.toUpperCase(), 32, 77);
    c.font = '7px sans-serif'; c.fillText('PLEASE CALL', 32, 88);
  }, false);
}

// ------------------------------------------------------------------ animal control
export interface Cage { x: number; z: number; door: THREE.Group; open: boolean; inner: P2; front: P2; colliders: Collider[]; doorColliders: Collider[]; bowl: P2 }
export interface FacilityBuild {
  group: THREE.Group;
  colliders: Collider[];
  cages: Cage[];
  vent: { pos: P2; cover: THREE.Group; inside: P2 };
  desk: P2; door: P2; tubeMats: THREE.MeshBasicMaterial[];
  frame: { x: number; z: number; rot: number };
  inside(x: number, z: number): boolean;
  y: number;
}

export function buildFacility(scene: THREE.Scene, f: { x: number; z: number; y: number }): FacilityBuild {
  const t = textures();
  const g = new THREE.Group();
  g.position.set(f.x, f.y, f.z);
  const W = 16, D = 12, H = 3.4, hw = W / 2, hd = D / 2;
  const rust = new THREE.MeshLambertMaterial({ map: t.rust });
  const rustIn = new THREE.MeshLambertMaterial({ map: t.rust, color: '#c8c0b8' });
  const edge = lam('#5a5450');
  const lc: P2[] = [];
  const front = [edge, edge, edge, edge, rust, rustIn], back = [edge, edge, edge, edge, rustIn, rust];
  const left = [rustIn, rust, edge, edge, edge, edge], right = [rust, rustIn, edge, edge, edge, edge];
  wall(g, 'x', hd, -hw, hw, H, front, [{ a: 6.6, b: 7.2, y0: 2.3, y1: 2.9 }], lc, 0.2);
  wall(g, 'x', -hd, -hw, hw, H, back, [], lc, 0.2);
  wall(g, 'z', -hw, -hd, hd, H, left, [{ a: 2.7, b: 3.3, y0: 0.02, y1: 0.5 }], lc, 0.2);
  wall(g, 'z', hw, -hd, hd, H, right, [{ a: -1, b: 1, y0: 2.0, y1: 2.8 }], lc, 0.2);
  // boarded-up window
  for (let i = 0; i < 3; i++) box(g, 0.06, 0.18, 2.3, lam('#7a5a3a'), hw - 0.12, 2.1 + i * 0.28, 0).rotation.x = (i - 1) * 0.08;
  // stained concrete floor with a drain
  const fg = new THREE.BoxGeometry(W, 0.1, D);
  uvScale(fg, W / 4, D / 4);
  const floor = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: t.stained }));
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  g.add(floor);
  cyl(g, 0.25, 0.25, 0.02, lam('#2a2a2e'), 0, 0.042, 0.5, 12);
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16), new THREE.MeshBasicMaterial({ color: '#4a5a60', transparent: true, opacity: 0.5 }));
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(-2.5, 0.046, 1.8);
  g.add(puddle);
  // ceiling with rusty pipes and buzzing tube lights
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.15, D + 0.4), lam('#4a4440'));
  ceil.position.y = H + 0.07;
  g.add(ceil);
  for (const z of [-hd + 0.4, -hd + 0.7]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, W, 8), lam('#8a4a2a')); p.rotation.z = Math.PI / 2; p.position.set(0, H - 0.3, z); g.add(p); }
  const tubeMats: THREE.MeshBasicMaterial[] = [];
  for (const [x, z] of [[-4, -2], [0, -2], [4, -2], [0, 2.5]]) {
    const m = new THREE.MeshBasicMaterial({ color: '#e8f0e0' });
    tubeMats.push(m);
    box(g, 1.4, 0.08, 0.2, m, x, H - 0.1, z);
  }
  // the exit door (locked) with its glowing sign
  box(g, 1.2, 2.2, 0.08, lam('#5a6068'), 0, 1.1, hd - 0.06);
  box(g, 0.08, 0.08, 0.12, lam('#b8bcc2'), 0.45, 1.05, hd - 0.14);
  const exit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.05), new THREE.MeshBasicMaterial({ color: '#e02a2a' }));
  exit.position.set(0, 2.5, hd - 0.12);
  g.add(exit);
  // desk, chair, old computer, filing cabinet, buckets and a broom
  const metal = lam('#6a7078');
  box(g, 1.8, 0.06, 0.8, metal, 5.2, 0.76, 3.6);
  for (const [x, z] of [[4.4, 3.3], [6.0, 3.3], [4.4, 3.9], [6.0, 3.9]]) box(g, 0.05, 0.76, 0.05, metal, x, 0.38, z);
  box(g, 0.5, 0.4, 0.4, lam('#d8d0c0'), 5.4, 1.0, 3.8);
  const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ color: '#5aa06a' }));
  mon.position.set(5.4, 1.02, 3.59);
  mon.rotation.y = Math.PI;
  g.add(mon);
  box(g, 0.3, 0.02, 0.4, lam('#f4f1ea'), 4.7, 0.8, 3.5).rotation.y = 0.3;
  cyl(g, 0.04, 0.035, 0.1, lam('#f4f1ea'), 4.5, 0.84, 3.7);
  box(g, 0.5, 0.06, 0.5, lam('#2a2a2e'), 5.2, 0.48, 2.9);
  box(g, 0.5, 0.5, 0.06, lam('#2a2a2e'), 5.2, 0.75, 2.66);
  box(g, 0.6, 1.4, 0.6, lam('#7a6a5a'), 7.3, 0.7, 4.0);
  for (let i = 0; i < 3; i++) box(g, 0.5, 0.02, 0.02, lam('#b8bcc2'), 7.3, 0.4 + i * 0.4, 3.68);
  cyl(g, 0.2, 0.16, 0.4, lam('#3a6ea8'), -6.8, 0.2, 4.6);
  cyl(g, 0.2, 0.16, 0.4, lam('#c8b8a0'), -6.3, 0.2, 5.0);
  const broom = cyl(g, 0.02, 0.02, 1.6, lam('#9a6a36'), -7.5, 0.8, 5.4, 6);
  broom.rotation.z = 0.25;
  // cages along the back wall
  const bar = lam('#7a7470');
  const cages: Cage[] = [];
  const frame = { x: f.x, z: f.z, rot: 0 };
  const W2 = (lx: number, lz: number) => toWorld(frame, lx, lz);
  for (let i = 0; i < 7; i++) {
    const cx = -6 + i * 2, cz = -hd + 0.85, cw = 1.7, cd = 1.5, ch = 1.15;
    // floor tray, newspaper, bars, roof
    box(g, cw, 0.06, cd, lam('#5a5a60'), cx, 0.03, cz);
    const np = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), lam('#d8d4c8'));
    np.rotation.x = -Math.PI / 2;
    np.rotation.z = i * 0.7;
    np.position.set(cx - 0.2, 0.065, cz - 0.1);
    g.add(np);
    for (let k = 0; k <= 8; k++) { box(g, 0.025, ch, 0.025, bar, cx - cw / 2, ch / 2, cz - cd / 2 + (k / 8) * cd); box(g, 0.025, ch, 0.025, bar, cx + cw / 2, ch / 2, cz - cd / 2 + (k / 8) * cd); }
    for (let k = 0; k <= 8; k++) box(g, 0.025, 0.025, cd, bar, cx - cw / 2 + (k / 8) * cw, ch, cz);
    box(g, cw, 0.03, 0.03, bar, cx, ch, cz - cd / 2);
    // a hinged front door of bars with a latch
    const door = new THREE.Group();
    door.position.set(cx - cw / 2, 0, cz + cd / 2);
    for (let k = 0; k <= 8; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.025, ch, 0.025), bar); b.position.set((k / 8) * cw, ch / 2, 0); door.add(b); }
    for (const y of [0.05, ch / 2, ch - 0.03]) { const b = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.025, 0.025), bar); b.position.set(cw / 2, y, 0); door.add(b); }
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), lam('#8a4a2a'));
    latch.position.set(cw - 0.05, ch / 2, 0.04);
    door.add(latch);
    g.add(door);
    // food and water bowls
    cyl(g, 0.1, 0.08, 0.05, lam('#b8bcc2'), cx + 0.5, 0.08, cz - 0.4, 10);
    cyl(g, 0.1, 0.08, 0.05, lam('#b8bcc2'), cx + 0.5, 0.08, cz - 0.1, 10);
    const cols: Collider[] = [], dcols: Collider[] = [];
    for (let k = 0; k <= 6; k++) {
      const zz = cz - cd / 2 + (k / 6) * cd;
      for (const xx of [cx - cw / 2, cx + cw / 2]) { const w = W2(xx, zz); cols.push({ x: w.x, z: w.z, r: 0.1 }); }
    }
    for (let k = 0; k <= 7; k++) { const w = W2(cx - cw / 2 + (k / 7) * cw, cz + cd / 2); dcols.push({ x: w.x, z: w.z, r: 0.1 }); }
    cages.push({ x: cx, z: cz, door, open: false, inner: W2(cx - 0.2, cz), front: W2(cx, cz + cd / 2 + 0.55), colliders: cols, doorColliders: dcols, bowl: W2(cx + 0.5, cz - 0.25) });
  }
  // the loose vent in the left wall, low down
  const cover = new THREE.Group();
  cover.position.set(-hw + 0.12, 0.02, 3.0);
  for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.56), lam('#d08a4a')); s.position.set(0, 0.06 + k * 0.09, 0); cover.add(s); }
  for (const z of [-0.29, 0.29]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.04), lam('#7a4a2a')); s.position.set(0, 0.24, z); cover.add(s); }
  g.add(cover);
  // a pale metal frame around the vent, and daylight showing through the slats
  for (const [w, h2, y, z] of [[0.05, 0.6, 0.27, 2.68], [0.05, 0.6, 0.27, 3.32], [0.05, 0.05, 0.56, 3.0], [0.05, 0.05, 0.0, 3.0]] as [number, number, number, number][]) {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.06, h2, z === 3.0 ? 0.7 : w), lam('#c8ccd0'));
    fr.position.set(-hw + 0.13, y, z);
    g.add(fr);
  }
  const ductBack = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.48), new THREE.MeshBasicMaterial({ color: '#7aa8d0' }));
  ductBack.position.set(-hw - 0.05, 0.26, 3.0);
  ductBack.rotation.y = Math.PI / 2;
  g.add(ductBack);
  // the outside: a rusty shed with a faded sign and a chain-link fence
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.8), new THREE.MeshLambertMaterial({ map: tex(256, 40, (c) => { c.fillStyle = '#d8d0c0'; c.fillRect(0, 0, 256, 40); c.fillStyle = '#5a3a2a'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.fillText('ANIMAL  CONTROL', 128, 28); noiseDots(c, 256, 40, 400, ['#8a4a2a'], 0.5, 3); }, false) }));
  sign.position.set(0, H + 0.6, hd + 0.13);
  g.add(sign);
  box(g, W + 1, 0.2, D + 1, lam('#5a4a40'), 0, H + 0.2, 0);
  scene.add(g);
  const colliders: Collider[] = lc.map((p) => { const w = W2(p.x, p.z); return { x: w.x, z: w.z, r: 0.2 }; });
  for (const [x, z, r] of [[5.2, 3.6, 0.5], [4.6, 3.6, 0.4], [5.8, 3.6, 0.4], [7.3, 4.0, 0.4], [-6.6, 4.8, 0.35]] as [number, number, number][]) { const w = W2(x, z); colliders.push({ x: w.x, z: w.z, r }); }
  return {
    group: g, colliders, cages, tubeMats, frame, y: f.y,
    vent: { pos: W2(-hw + 0.1, 3.0), cover, inside: W2(-hw + 0.7, 3.0) },
    desk: W2(5.2, 2.9), door: W2(0, hd - 0.8),
    inside: (x, z) => { const l = toLocal(frame, x, z); return Math.abs(l.x) < hw && Math.abs(l.z) < hd; },
  };
}

/** A loner's mossy nest or a rogue's bramble den. */
export function buildNest(scene: THREE.Scene, p: P2, y: number, rogue: boolean) {
  const g = new THREE.Group();
  g.position.set(p.x, y, p.z);
  const moss = lam(rogue ? '#5a4a32' : '#5a7a3a');
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.14, 8, 16), moss);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  cyl(g, 0.4, 0.4, 0.05, lam(rogue ? '#4a3a28' : '#7a9a4a'), 0, 0.03, 0, 16);
  if (rogue) {
    for (let i = 0; i < 9; i++) { const b = cyl(g, 0.03, 0.03, 1.4, lam('#3a2a1a'), Math.cos(i) * 0.7, 0.5, Math.sin(i) * 0.7, 5); b.rotation.set(Math.sin(i * 3) * 0.8, 0, Math.cos(i * 2) * 0.8); }
    for (let i = 0; i < 4; i++) { const bone = cyl(g, 0.02, 0.02, 0.18, lam('#e8e0cc'), 0.6 + i * 0.1, 0.03, -0.4 + i * 0.15, 5); bone.rotation.z = Math.PI / 2; bone.rotation.y = i; }
  } else {
    const log = cyl(g, 0.3, 0.32, 2.4, lam('#5a3a24'), 0, 0.55, -0.55, 10);
    log.rotation.z = Math.PI / 2;
    for (let i = 0; i < 5; i++) ball(g, 0.18, lam('#4f7a3a'), -1 + i * 0.5, 0.85, -0.55);
  }
  scene.add(g);
  return g;
}
