// Modular procedural cat model. Body proportions, fur pattern textures, ear
// and tail shapes, fur length and life stage all combine so that generated
// cats look genuinely different rather than recoloured copies.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Accessory, Appearance, LifeStage } from './types';
import { RNG, hashString } from '../core/rng';

export type Pose = 'stand' | 'walk' | 'sit' | 'lie' | 'sleep' | 'crouch' | 'pounce' | 'fight' | 'groom' | 'eat' | 'swim';
export type Mood = 'neutral' | 'happy' | 'angry' | 'afraid' | 'alert' | 'sad';

const STAGE_SCALE: Record<LifeStage, number> = { kit: 0.42, apprentice: 0.7, warrior: 1, elder: 0.97 };
const HEAD_SCALE: Record<LifeStage, number> = { kit: 1.5, apprentice: 1.14, warrior: 1, elder: 1 };

function col(hex: string) { return new THREE.Color(hex); }
function mix(a: string, b: string, t: number) { return '#' + col(a).lerp(col(b), t).getHexString(); }

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function furNoise(ctx: CanvasRenderingContext2D, w: number, h: number, rng: RNG, amt = 0.08) {
  // fine fur strokes
  for (let i = 0; i < w * h * 0.03; i++) {
    const x = rng.range(0, w), y = rng.range(0, h);
    const l = rng.chance(0.5);
    ctx.fillStyle = l ? `rgba(255,255,255,${amt})` : `rgba(0,0,0,${amt})`;
    ctx.fillRect(x, y, 1, rng.range(2, 5));
  }
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rng: RNG) {
  ctx.beginPath();
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.65, 1.25);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.8;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

interface Textures { torso: THREE.CanvasTexture; head: THREE.CanvasTexture; leg: THREE.CanvasTexture; tail: THREE.CanvasTexture }
const texCache = new Map<string, Textures>();

/** Body texture: canvas x = circumference (0.5 = spine, edges = belly), canvas y = tail(top)->chest(bottom). */
function makeTextures(app: Appearance, elder: boolean): Textures {
  const key = JSON.stringify(app) + elder;
  const cached = texCache.get(key);
  if (cached) return cached;
  const rng = new RNG(hashString(key));
  let base = app.base;
  if (elder) base = mix(base, '#9a9a98', 0.22);
  const second = app.second;
  const light = mix(base, '#ffffff', 0.3);
  const W = 256, H = 128;
  const [tc, t] = canvas(W, H);
  t.fillStyle = base;
  t.fillRect(0, 0, W, H);
  // dorsal shading & belly counter-shading
  const g = t.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, light);
  g.addColorStop(0.25, base);
  g.addColorStop(0.5, mix(base, '#000000', 0.12));
  g.addColorStop(0.75, base);
  g.addColorStop(1, light);
  t.fillStyle = g;
  t.fillRect(0, 0, W, H);

  const stripeCol = second;
  const drawStripes = (count: number, thick: number) => {
    t.strokeStyle = stripeCol;
    t.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const y0 = ((i + 0.5) / count) * H;
      t.lineWidth = thick * rng.range(0.7, 1.2);
      t.beginPath();
      for (let x = W * 0.12; x <= W * 0.88; x += 6) {
        const y = y0 + Math.sin(x * 0.07 + i) * 3 + Math.sin(x * 0.19) * 1.5;
        if (x === W * 0.12) t.moveTo(x, y);
        else t.lineTo(x, y);
      }
      t.stroke();
    }
  };
  switch (app.pattern) {
    case 'tabby':
      drawStripes(7, 7);
      t.fillStyle = stripeCol;
      t.fillRect(W * 0.47, 0, W * 0.06, H);
      break;
    case 'mackerel':
      drawStripes(12, 4);
      t.fillStyle = stripeCol;
      t.fillRect(W * 0.48, 0, W * 0.04, H);
      break;
    case 'spotted':
      t.fillStyle = stripeCol;
      for (let i = 0; i < 38; i++) blob(t, rng.range(W * 0.15, W * 0.85), rng.range(0, H), rng.range(4, 8), rng);
      break;
    case 'ticked':
      for (let i = 0; i < 1400; i++) {
        t.fillStyle = rng.chance(0.5) ? mix(stripeCol, base, 0.4) : mix(base, '#ffffff', 0.25);
        t.fillRect(rng.range(0, W), rng.range(0, H), 1.5, 3);
      }
      break;
    case 'smoke': {
      const sg = t.createLinearGradient(0, 0, W, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0.45)');
      sg.addColorStop(0.35, 'rgba(0,0,0,0)');
      sg.addColorStop(0.65, 'rgba(0,0,0,0)');
      sg.addColorStop(1, 'rgba(255,255,255,0.45)');
      t.fillStyle = second;
      t.fillRect(W * 0.3, 0, W * 0.4, H);
      t.fillStyle = sg;
      t.fillRect(0, 0, W, H);
      break;
    }
    case 'tortie':
      t.fillStyle = second;
      for (let i = 0; i < 16; i++) blob(t, rng.range(0, W), rng.range(0, H), rng.range(10, 24), rng);
      t.fillStyle = mix(base, second, 0.5);
      for (let i = 0; i < 8; i++) blob(t, rng.range(0, W), rng.range(0, H), rng.range(6, 12), rng);
      break;
    case 'calico':
      t.fillStyle = second;
      for (let i = 0; i < 6; i++) blob(t, rng.range(W * 0.25, W * 0.75), rng.range(0, H), rng.range(14, 26), rng);
      t.fillStyle = base === '#2b2725' ? '#d9823b' : '#d9823b';
      for (let i = 0; i < 4; i++) blob(t, rng.range(W * 0.25, W * 0.75), rng.range(0, H), rng.range(12, 20), rng);
      break;
    case 'colorpoint': {
      const cg = t.createLinearGradient(0, 0, 0, H);
      cg.addColorStop(0, second);
      cg.addColorStop(0.2, 'rgba(0,0,0,0)');
      cg.addColorStop(0.85, 'rgba(0,0,0,0)');
      cg.addColorStop(1, mix(second, base, 0.4));
      t.fillStyle = cg;
      t.fillRect(0, 0, W, H);
      break;
    }
    default:
      break;
  }
  // white areas
  let white = app.white;
  if (app.pattern === 'tuxedo') white = Math.max(white, 0.3);
  if (white > 0.01) {
    t.fillStyle = '#f4f1ea';
    const band = W * white * 0.55;
    for (const side of [0, 1]) {
      t.beginPath();
      for (let y = 0; y <= H; y += 4) {
        const chest = (y / H) * band * 0.9; // more white toward the chest
        const bw = band * 0.6 + chest + Math.sin(y * 0.2 + side * 3) * 5;
        const x = side === 0 ? bw : W - bw;
        if (y === 0) t.moveTo(side === 0 ? 0 : W, 0);
        t.lineTo(x, y);
      }
      t.lineTo(side === 0 ? 0 : W, H);
      t.closePath();
      t.fill();
    }
    if (app.pattern === 'bicolor' && white > 0.55) {
      for (let i = 0; i < 3; i++) blob(t, rng.range(W * 0.3, W * 0.7), rng.range(H * 0.3, H), rng.range(10, 20), rng);
    }
  }
  furNoise(t, W, H, rng);

  // Head texture: sphere UV, forward (+x) is u=0.5, top is v=1 (canvas top)
  const [hc, h] = canvas(128, 64);
  const headBase = app.pattern === 'colorpoint' ? mix(base, second, 0.35) : base;
  h.fillStyle = headBase;
  h.fillRect(0, 0, 128, 64);
  if (app.pattern === 'colorpoint') {
    h.fillStyle = second;
    blob(h, 64, 36, 18, rng);
  }
  if (app.pattern === 'tabby' || app.pattern === 'mackerel' || app.pattern === 'ticked' || app.pattern === 'spotted') {
    h.strokeStyle = second;
    h.lineWidth = 2.5;
    for (const dx of [-9, -3, 3, 9]) {
      h.beginPath();
      h.moveTo(64 + dx, 8);
      h.lineTo(64 + dx * 0.8, 22);
      h.stroke();
    }
    // cheek lines
    h.lineWidth = 2;
    for (const s of [-1, 1]) {
      h.beginPath();
      h.moveTo(64 + s * 20, 30);
      h.lineTo(64 + s * 34, 28);
      h.stroke();
    }
  }
  if (app.pattern === 'tortie' || app.pattern === 'calico') {
    h.fillStyle = second;
    blob(h, 64 + rng.range(-20, 20), rng.range(10, 40), 14, rng);
  }
  if (white > 0.15 || app.pattern === 'tuxedo') {
    h.fillStyle = '#f4f1ea';
    h.beginPath();
    h.moveTo(64, 20);
    h.lineTo(76, 64);
    h.lineTo(52, 64);
    h.closePath();
    h.fill();
    blob(h, 64, 52, 12, rng);
  }
  if (elder) {
    h.fillStyle = 'rgba(200,200,200,0.35)';
    blob(h, 64, 44, 16, rng);
  }
  furNoise(h, 128, 64, rng, 0.06);

  // Leg texture: top of canvas = top of leg
  const [lc, l] = canvas(32, 64);
  const legCol = app.pattern === 'colorpoint' ? second : app.pattern === 'tuxedo' ? base : base;
  l.fillStyle = legCol;
  l.fillRect(0, 0, 32, 64);
  if (app.pattern === 'tabby' || app.pattern === 'mackerel') {
    l.fillStyle = second;
    for (let y = 8; y < 56; y += 11) l.fillRect(0, y, 32, 4);
  }
  if (app.pattern === 'tortie' || app.pattern === 'calico') {
    l.fillStyle = second;
    blob(l, rng.range(0, 32), rng.range(10, 50), 10, rng);
  }
  if (white > 0.05 || app.pattern === 'tuxedo') {
    l.fillStyle = '#f4f1ea';
    const sock = 64 - Math.min(60, 12 + white * 70);
    l.fillRect(0, sock, 32, 64 - sock);
  }
  furNoise(l, 32, 64, rng, 0.06);

  // Tail texture: rings for tabbies, darker tip for colorpoint
  const [ac, a] = canvas(32, 64);
  a.fillStyle = app.pattern === 'colorpoint' ? second : app.pattern === 'smoke' ? second : base;
  a.fillRect(0, 0, 32, 64);
  if (app.pattern === 'tabby' || app.pattern === 'mackerel' || app.pattern === 'ticked') {
    a.fillStyle = second;
    for (let y = 4; y < 64; y += 16) a.fillRect(0, y, 32, 7);
  }
  if (app.pattern === 'tortie' || app.pattern === 'calico') {
    a.fillStyle = second;
    blob(a, 16, rng.range(10, 50), 12, rng);
  }
  furNoise(a, 32, 64, rng, 0.06);

  const res = { torso: tex(tc), head: tex(hc), leg: tex(lc), tail: tex(ac) };
  if (texCache.size > 120) texCache.clear();
  texCache.set(key, res);
  return res;
}

function vc(geo: THREE.BufferGeometry, c: THREE.Color | ((x: number, y: number, z: number) => THREE.Color)) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const cc = typeof c === 'function' ? c(p.getX(i), p.getY(i), p.getZ(i)) : c;
    arr[i * 3] = cc.r;
    arr[i * 3 + 1] = cc.g;
    arr[i * 3 + 2] = cc.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const faceMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
const whiskerMat = new THREE.LineBasicMaterial({ color: 0xf4f2ea, transparent: true, opacity: 0.7 });

export class CatModel {
  root = new THREE.Group();
  body = new THREE.Group();
  headPivot = new THREE.Group();
  head = new THREE.Group();
  tailPivot = new THREE.Group();
  legs: THREE.Group[] = [];
  tailSegs: THREE.Group[] = [];
  ears: THREE.Mesh | null = null;
  eyes: THREE.Mesh | null = null;
  carryMesh: THREE.Mesh | null = null;
  shadowBlob: THREE.Mesh | null = null;
  private meshes: THREE.Mesh[] = [];
  private extraGeos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private phase = Math.random() * 10;
  private blinkT = Math.random() * 4;
  private earT = Math.random() * 5;
  private t = Math.random() * 100;
  pose: Pose = 'stand';
  mood: Mood = 'neutral';
  speed = 0;
  lookYaw = 0;
  lookPitch = 0;
  scale = 1;
  legLen = 0.16;
  shoulderY = 0.26;
  eyeHeight = 0.3;
  private poseBlend = { bodyY: 0, pitch: 0, legF: 0, legB: 0, headP: 0, tailUp: 0, lie: 0 };
  private stage: LifeStage;
  private app: Appearance;

  constructor(app: Appearance, stage: LifeStage) {
    this.app = app;
    this.stage = stage;
    this.root.add(this.body);
    this.build();
  }

  setStage(stage: LifeStage) {
    if (stage === this.stage) return;
    this.stage = stage;
    this.rebuild();
  }

  setAppearance(app: Appearance) {
    this.app = app;
    this.rebuild();
  }

  private rebuild() {
    this.disposeParts();
    this.body.clear();
    if (this.shadowBlob) { this.root.remove(this.shadowBlob); this.shadowBlob = null; }
    this.headPivot = new THREE.Group();
    this.head = new THREE.Group();
    this.tailPivot = new THREE.Group();
    this.legs = [];
    this.tailSegs = [];
    const carrying = this.carryMesh;
    this.carryMesh = null;
    this.build();
    if (carrying) this.setCarry(carrying.userData.color);
  }

  private disposeParts() {
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of this.mats) m.dispose();
    for (const g of this.extraGeos) g.dispose();
    this.extraGeos = [];
    this.meshes = [];
    this.mats = [];
  }

  dispose() {
    this.disposeParts();
    this.root.parent?.remove(this.root);
  }

  private addMesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, shared = false): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    parent.add(m);
    this.meshes.push(m);
    if (!shared) this.mats.push(mat);
    return m;
  }

  private build() {
    const app = this.app;
    const stage = this.stage;
    const tx = makeTextures(app, stage === 'elder');
    const s = STAGE_SCALE[stage] * app.size;
    this.scale = s;
    const bodyW = { slender: 0.86, average: 1, stocky: 1.14, large: 1.1 }[app.body];
    const bodyL = { slender: 1.06, average: 1, stocky: 0.95, large: 1.1 }[app.body];
    const legK = ({ slender: 1.08, average: 1, stocky: 0.92, large: 1.06 }[app.body]) * (stage === 'kit' ? 0.82 : 1);
    const fluff = app.fur === 'long' ? 1.14 : app.fur === 'medium' ? 1.06 : 1;
    const headK = HEAD_SCALE[stage];

    // ---- Body: cute kitten proportions — shorter, chubbier body.
    // Authored in "design units" (body ≈ 1 unit long) and scaled by K into metres.
    const K = 0.36;
    const safe = (v: number, fb: number) => (Number.isFinite(v) && v > 0 ? v : fb);
    const buildScale = { slender: 0.92, average: 1, stocky: 1.06, large: 1.1 }[app.body];
    const bodyLen = Math.max(0.35, safe(0.62 * buildScale, 0.62));
    const bodyR = Math.max(0.1, safe(0.22 * fluff * buildScale, 0.22));
    const widthK = bodyW / buildScale; // slender/stocky width variation on top of build

    const legLen = 0.13 * legK;
    this.legLen = legLen;
    const torsoH = bodyR * K; // half-height of the body in metres
    const torsoY = legLen + torsoH * 0.62;
    this.shoulderY = torsoY;
    this.body.position.set(0, torsoY, 0);

    const torsoMat = new THREE.MeshLambertMaterial({ map: tx.torso });
    const legMat = new THREE.MeshLambertMaterial({ map: tx.leg });
    const tailMat = new THREE.MeshLambertMaterial({ map: tx.tail });
    const headMat = new THREE.MeshLambertMaterial({ map: tx.head });
    const bellyC = app.white > 0.15 || app.pattern === 'tuxedo' || app.pattern === 'bicolor' || app.pattern === 'calico'
      ? col('#f4f1ea') : col(app.pattern === 'colorpoint' ? app.base : app.base).lerp(col('#ffffff'), 0.3);
    const bellyMat = new THREE.MeshLambertMaterial({ color: bellyC });
    this.mats.push(torsoMat, legMat, tailMat, headMat, bellyMat);

    const bodyParts = new THREE.Group();
    bodyParts.scale.set(K, K, K * widthK);
    this.body.add(bodyParts);
    // spheres with poles along the spine so the fur texture wraps like the body
    const sphere = (r: number, ws: number, hs: number) => { const g = new THREE.SphereGeometry(r, ws, hs); g.rotateZ(Math.PI / 2); return g; };
    // cylinder seam placed under the belly so the dorsal stripe sits on top
    const cyl = (r0: number, r1: number, h: number, seg: number) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, false, -Math.PI / 2);
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rotZ = 0, scl?: [number, number, number]) => {
      const m = this.addMesh(bodyParts, geo, mat, true);
      m.position.set(...pos);
      m.rotation.z = rotZ;
      if (scl) m.scale.set(...scl);
      return m;
    };
    // main body — short, chubby cylinder + sphere caps, slight downward tilt toward the rear
    part(cyl(bodyR, bodyR, bodyLen, 24), torsoMat, [0, 0, 0], Math.PI / 2 + 0.06);
    part(sphere(bodyR, 22, 18), torsoMat, [bodyLen * 0.5, 0.02, 0]);
    part(sphere(bodyR, 22, 18), torsoMat, [-bodyLen * 0.5, -0.05, 0]);
    // shoulders
    part(sphere(bodyR * 1.06, 18, 14), torsoMat, [bodyLen * 0.4, 0.04, 0]);
    // lower-back haunches — sit lower than shoulders for a real cat profile
    part(sphere(bodyR * 1.2, 22, 16), torsoMat, [-bodyLen * 0.42, -0.06, 0], 0, [0.78, 0.95, 1.08]);
    // fluffy belly
    part(cyl(bodyR * 0.78, bodyR * 0.78, bodyLen * 0.85, 14), bellyMat, [0, -bodyR * 0.45, 0], Math.PI / 2, [1, 0.95, 0.78]);
    // soft chest fluff just below where the neck meets the body
    part(sphere(bodyR * 0.78, 16, 14), bellyMat, [bodyLen * 0.42, -0.05, 0], 0, [0.85, 0.95, 1.0]);
    // short, chubby neck
    part(cyl(bodyR * 0.78, bodyR * 0.92, 0.16, 14), torsoMat, [bodyLen * 0.55, 0.16, 0], -0.55);
    if (app.fur === 'long') part(sphere(bodyR * 0.95, 14, 12), torsoMat, [bodyLen * 0.5, 0.1, 0], 0, [0.8, 1, 1.15]);
    // accessories worn around the neck (a cat can wear several)
    const accList = accessoriesOf(app);
    const neckItems = accList.filter((x) => NECK_ITEMS.includes(x));
    neckItems.forEach((acc, idx) => {
      const accC = col(app.accessoryColor && idx === 0 ? app.accessoryColor : ACC_DEFAULT_COLOR[acc]);
      const accMat = new THREE.MeshLambertMaterial({ color: accC });
      this.mats.push(accMat);
      const neck = new THREE.Group();
      // stack several neck items a little apart along the neck
      neck.position.set(bodyLen * 0.58 + idx * 0.02, 0.19 + idx * 0.035, 0);
      neck.rotation.z = -0.55;
      bodyParts.add(neck);
      const ringR = bodyR * (0.95 - idx * 0.05);
      if (acc === 'collar' || acc === 'bellCollar' || acc === 'berryCharm') {
        const tg = new THREE.TorusGeometry(ringR, 0.024, 8, 22);
        tg.rotateX(Math.PI / 2);
        this.addMesh(neck, tg, accMat);
        if (acc === 'bellCollar') {
          const bellMat = new THREE.MeshPhongMaterial({ color: 0xe8c44a, shininess: 90, specular: 0xffffff });
          this.mats.push(bellMat);
          const bl = this.addMesh(neck, new THREE.SphereGeometry(0.034, 10, 8), bellMat);
          bl.position.set(ringR + 0.02, -0.03, 0);
        }
        if (acc === 'berryCharm') {
          const bm = new THREE.MeshPhongMaterial({ color: 0x7a1e5a, shininess: 60 });
          this.mats.push(bm);
          for (const dz of [-0.018, 0, 0.018]) { const bb = this.addMesh(neck, new THREE.SphereGeometry(0.013, 8, 6), bm); bb.position.set(ringR + 0.012, -0.018 - Math.abs(dz) * 0.4, dz); }
        }
      } else if (acc === 'leafScarf') {
        for (let i = 0; i < 12; i++) {
          const an = (i / 12) * Math.PI * 2;
          const lg = new THREE.SphereGeometry(0.03, 6, 4);
          lg.scale(1, 0.35, 0.6);
          const l = this.addMesh(neck, lg, accMat);
          l.position.set(Math.cos(an) * ringR, -0.01, Math.sin(an) * ringR);
          l.rotation.y = -an;
        }
      } else if (acc === 'shellNecklace' || acc === 'clawNecklace') {
        for (let i = 0; i < 14; i++) {
          const an = (i / 14) * Math.PI * 2;
          const sg = acc === 'clawNecklace' ? new THREE.ConeGeometry(0.008, 0.03, 5) : new THREE.SphereGeometry(0.012, 6, 5);
          if (acc === 'shellNecklace') sg.scale(1, 0.7, 1);
          const sh2 = this.addMesh(neck, sg, accMat);
          sh2.position.set(Math.cos(an) * ringR, acc === 'clawNecklace' ? -0.025 : -0.012, Math.sin(an) * ringR);
          if (acc === 'clawNecklace') sh2.rotation.z = Math.PI;
        }
      }
    });

    // soft contact shadow under the cat (keeps small kits grounded visually)
    const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), shadowMat);
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.006;
    sh.scale.set(bodyLen * 0.7 * K * 1.6, bodyR * 1.6 * K * widthK * 1.3, 1);
    sh.renderOrder = 1;
    this.root.add(sh);
    this.meshes.push(sh);
    this.shadowBlob = sh;

    // head sits on top of the neck
    const neckTop: [number, number] = [bodyLen * 0.55 + Math.sin(0.55) * 0.08, 0.16 + Math.cos(0.55) * 0.08];
    this.headPivot.position.set(neckTop[0] * K, neckTop[1] * K, 0);
    this.body.add(this.headPivot);
    this.headPivot.add(this.head);
    this.head.position.set(0.04, 0.022, 0);
    this.head.scale.setScalar(headK);
    const hg = new THREE.SphereGeometry(0.072, 16, 12);
    hg.scale(1.05, 0.92, 1 * (app.fur === 'long' ? 1.08 : 1));
    this.addMesh(this.head, hg, headMat, true);

    // face bits (merged): muzzle, nose, ears, cheek fluff
    const whiteMuzzle = app.white > 0.15 || app.pattern === 'tuxedo' || app.pattern === 'bicolor';
    const baseC = col(app.pattern === 'colorpoint' ? app.second : app.base);
    const muzzleC = whiteMuzzle ? col('#f4f1ea') : col(app.base).lerp(col('#ffffff'), 0.25);
    const parts: THREE.BufferGeometry[] = [];
    const mz = new THREE.SphereGeometry(0.036, 10, 8);
    mz.scale(1, 0.72, 1.25);
    mz.translate(0.058, -0.022, 0);
    parts.push(vc(mz, muzzleC));
    const nose = new THREE.SphereGeometry(0.011, 6, 5);
    nose.scale(0.8, 0.7, 1.2);
    nose.translate(0.092, -0.008, 0);
    parts.push(vc(nose, col(app.base === '#2b2725' ? '#3a2a2a' : '#d98c8c')));
    if (app.fur === 'long') {
      for (const sz of [-1, 1]) {
        const ch = new THREE.SphereGeometry(0.035, 8, 6);
        ch.scale(0.8, 0.8, 1);
        ch.translate(0.01, -0.025, sz * 0.06);
        parts.push(vc(ch, baseC));
      }
    }
    this.addMesh(this.head, mergeGeometries(parts)!, faceMat, true);
    const earParts: THREE.BufferGeometry[] = [];
    const earOuter = app.pattern === 'colorpoint' ? col(app.second) : baseC;
    for (const sz of [-1, 1]) {
      let eg: THREE.BufferGeometry;
      const eh = app.ears === 'rounded' ? 0.042 : app.ears === 'folded' ? 0.03 : 0.056;
      const er = app.ears === 'rounded' ? 0.03 : 0.026;
      eg = new THREE.ConeGeometry(er, eh, 4, 1);
      eg.scale(0.55, 1, 1);
      if (app.ears === 'folded') eg.rotateZ(-1.1);
      eg.rotateX(sz * 0.32);
      eg.translate(-0.005, 0.06 + eh * 0.35, sz * 0.042);
      earParts.push(vc(eg, (x, y) => (x > 0.004 && y < 0.09 + eh * 0.5 ? col('#e8a5a0') : earOuter)));
      if (app.ears === 'tufted') {
        const tuft = new THREE.ConeGeometry(0.006, 0.03, 3);
        tuft.translate(-0.005, 0.06 + eh + 0.01, sz * 0.05);
        earParts.push(vc(tuft, col(app.second)));
      }
    }
    this.ears = this.addMesh(this.head, mergeGeometries(earParts)!, faceMat, true);

    // eyes with slit pupils
    const eyeC = col(app.eye);
    const eyeParts: THREE.BufferGeometry[] = [];
    for (const sz of [-1, 1]) {
      const ec = sz === 1 && app.eye2 ? col(app.eye2) : eyeC;
      const eg = new THREE.SphereGeometry(0.0145, 10, 8);
      eg.scale(0.7, 1, 1);
      eyeParts.push(vc(eg.translate(0.055, 0, sz * 0.03), (x, y, z) => {
        const lz = z - sz * 0.03;
        return x > 0.062 && Math.abs(lz) < 0.004 ? col('#111111') : x > 0.059 ? ec : ec.clone().multiplyScalar(0.7);
      }));
    }
    const eyeMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 120, specular: 0xffffff, emissive: eyeC.clone().multiplyScalar(0.18) });
    this.eyes = this.addMesh(this.head, mergeGeometries(eyeParts)!, eyeMat);
    this.eyes.position.set(0, 0.018, 0);

    // whiskers
    const wp: number[] = [];
    for (const sz of [-1, 1]) for (let i = 0; i < 3; i++) {
      wp.push(0.07, -0.02, sz * 0.025, 0.04, -0.028 + i * 0.012 - 0.01, sz * 0.12);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    const wl = new THREE.LineSegments(wg, whiskerMat);
    this.head.add(wl);
    const headMatOf = (c: string) => { const m = new THREE.MeshLambertMaterial({ color: col(c), side: THREE.DoubleSide }); this.mats.push(m); return m; };
    for (const acc of accList) {
      if (acc === 'flowerCrown') {
        const fc = ['#f2a3c4', '#f5e16a', '#ffffff', '#b79cf0', '#f28a6a'];
        for (let i = 0; i < 9; i++) {
          const an = (i / 9) * Math.PI * 2;
          const f = this.addMesh(this.head, new THREE.SphereGeometry(0.012, 7, 5), headMatOf(app.accessoryColor && i % 2 === 0 ? app.accessoryColor : fc[i % fc.length]));
          f.position.set(-0.005 + Math.cos(an) * 0.045, 0.058, Math.sin(an) * 0.052);
        }
      } else if (acc === 'feather') {
        const fg = new THREE.SphereGeometry(0.03, 8, 6);
        fg.scale(0.35, 1.6, 0.12);
        const f = this.addMesh(this.head, fg, headMatOf(ACC_DEFAULT_COLOR.feather));
        f.position.set(-0.03, 0.07, 0.05);
        f.rotation.set(0.3, 0, 0.7);
      } else if (acc === 'bow') {
        const bm = headMatOf(app.accessoryColor ?? ACC_DEFAULT_COLOR.bow);
        for (const sz of [-1, 1]) {
          const lg = new THREE.ConeGeometry(0.018, 0.035, 8);
          lg.rotateX(sz * Math.PI / 2);
          const l = this.addMesh(this.head, lg, bm);
          l.position.set(-0.01, 0.07, -0.04 + sz * 0.02);
        }
        const k = this.addMesh(this.head, new THREE.SphereGeometry(0.009, 6, 5), bm);
        k.position.set(-0.01, 0.07, -0.04);
      } else if (acc === 'flowerEar') {
        const petals = headMatOf(ACC_DEFAULT_COLOR.flowerEar);
        const centre = headMatOf('#f2c94c');
        for (let i = 0; i < 5; i++) {
          const an = (i / 5) * Math.PI * 2;
          const pg = new THREE.SphereGeometry(0.009, 6, 4);
          pg.scale(1, 0.4, 1);
          const pm = this.addMesh(this.head, pg, petals);
          pm.position.set(-0.02 + Math.cos(an) * 0.011, 0.06, -0.055 + Math.sin(an) * 0.011);
        }
        const cm = this.addMesh(this.head, new THREE.SphereGeometry(0.007, 6, 4), centre);
        cm.position.set(-0.02, 0.062, -0.055);
      }
    }
    this.extraGeos.push(wg);

    // legs
    const legR = 0.022 * (app.body === 'stocky' || app.body === 'large' ? 1.15 : 1) * (app.fur === 'long' ? 1.1 : 1);
    const hipX = bodyLen * 0.42 * K, hipZ = bodyR * 0.55 * K * widthK;
    const pawC = app.white > 0.05 || app.pattern === 'tuxedo' ? '#f4f1ea' : app.pattern === 'colorpoint' ? app.second : app.base;
    const pawMat = new THREE.MeshLambertMaterial({ color: col(pawC) });
    this.mats.push(pawMat);
    const legLocal = legLen + torsoH * 0.45;
    for (const [lx, lz] of [[hipX, hipZ], [hipX, -hipZ], [-hipX, hipZ], [-hipX, -hipZ]]) {
      const pivot = new THREE.Group();
      pivot.position.set(lx + (lx < 0 ? -0.004 : 0.004), -torsoH * 0.35 + (lx < 0 ? -0.05 * K : 0), lz);
      this.body.add(pivot);
      const lg = new THREE.CylinderGeometry(legR * (lx < 0 ? 1.25 : 1), legR * 0.85, legLocal, 7);
      lg.translate(0, -legLocal / 2, 0);
      this.addMesh(pivot, lg, legMat, true);
      const pg = new THREE.SphereGeometry(legR * 1.15, 8, 6);
      pg.scale(1.5, 0.7, 1.1);
      pg.translate(0.008, -legLocal + 0.004, 0);
      this.addMesh(pivot, pg, pawMat, true);
      this.legs.push(pivot);
    }

    // tail
    this.tailPivot.position.set(-(bodyLen * 0.5 + bodyR * 0.85) * K, 0.0, 0);
    this.body.add(this.tailPivot);
    const segN = app.tail === 'short' ? 3 : 7;
    const segL = (app.tail === 'short' ? 0.03 : 0.042) * (stage === 'kit' ? 0.8 : 1);
    const tailR = (app.tail === 'bushy' ? 0.03 : 0.019) * (app.fur === 'long' ? 1.25 : 1);
    let parent: THREE.Object3D = this.tailPivot;
    for (let i = 0; i < segN; i++) {
      const seg = new THREE.Group();
      if (i > 0) seg.position.set(-segL, 0, 0);
      parent.add(seg);
      const r0 = tailR * (1 - (i / segN) * 0.45), r1 = tailR * (1 - ((i + 1) / segN) * 0.45);
      const cg = new THREE.CylinderGeometry(r1, r0, segL * 1.15, 7);
      cg.rotateZ(Math.PI / 2);
      cg.translate(-segL / 2, 0, 0);
      this.addMesh(seg, cg, tailMat, true);
      if (i === segN - 1) {
        const tip = new THREE.SphereGeometry(r1, 7, 5);
        tip.translate(-segL, 0, 0);
        this.addMesh(seg, tip, tailMat, true);
      }
      this.tailSegs.push(seg);
      parent = seg;
    }
    if (app.tail === 'kinked' && this.tailSegs[4]) this.tailSegs[4].userData.kink = 0.9;

    this.root.scale.setScalar(s);
    this.eyeHeight = (torsoY + (neckTop[1] + 0.06) * K + 0.03 * headK) * s;
  }

  setCarry(color: number | null) {
    if (this.carryMesh) {
      this.carryMesh.parent?.remove(this.carryMesh);
      this.carryMesh.geometry.dispose();
      (this.carryMesh.material as THREE.Material).dispose();
      this.carryMesh = null;
    }
    if (color === null) return;
    const g = new THREE.SphereGeometry(0.03, 8, 6);
    g.scale(1.8, 0.8, 0.9);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
    m.position.set(0.085, -0.04, 0.02);
    m.rotation.y = 1.3;
    m.userData.color = color;
    m.castShadow = true;
    this.head.add(m);
    this.carryMesh = m;
  }

  setVisibleHead(v: boolean) {
    this.head.visible = v;
  }

  setShadows(on: boolean) {
    for (const m of this.meshes) m.castShadow = on && m !== this.shadowBlob;
  }

  /** Animate. `speed` in m/s (world units). */
  update(dt: number) {
    this.t += dt;
    const pose = this.pose;
    const sp = this.speed / Math.max(0.3, this.scale);
    const moving = sp > 0.05 && (pose === 'walk' || pose === 'crouch' || pose === 'stand' || pose === 'fight' || pose === 'swim');
    const running = sp > 3.2;
    this.phase += dt * (moving ? Math.min(16, 3 + sp * 2.1) : 0);

    // target pose values
    let bodyY = 0, pitch = 0, legF = 0, legB = 0, headP = 0, tailUp = -0.45, lie = 0;
    switch (pose) {
      case 'crouch':
        bodyY = -this.legLen * 0.38; legF = 0.75; legB = -0.75; headP = -0.1; tailUp = 0.05;
        break;
      case 'pounce':
        bodyY = 0.02; pitch = 0.25; legF = 1.0; legB = -1.0; tailUp = -0.1;
        break;
      case 'sit':
        pitch = 0.62; bodyY = -this.legLen * 0.38; legF = -0.62; legB = -1.3; headP = -0.45; tailUp = 0.25;
        break;
      case 'lie': case 'sleep':
        bodyY = -this.legLen * 0.95; legF = 1.45; legB = -1.45; headP = pose === 'sleep' ? 0.45 : 0.05; tailUp = 0.3; lie = 1;
        break;
      case 'groom':
        pitch = 0.5; bodyY = -this.legLen * 0.38; legF = -0.5; legB = -1.3; headP = 0.8; tailUp = 0.25;
        break;
      case 'eat':
        bodyY = -this.legLen * 0.3; legF = 0.5; legB = -0.5; headP = 0.8; pitch = -0.1;
        break;
      case 'fight':
        bodyY = -this.legLen * 0.15; legF = 0.3; legB = -0.3; tailUp = -0.8; headP = -0.1;
        break;
      case 'swim':
        bodyY = -this.legLen * 0.8; headP = -0.3; tailUp = 0.1;
        break;
    }
    if (this.mood === 'afraid') tailUp = 0.3;
    if (this.mood === 'happy' && pose !== 'sleep' && pose !== 'lie') tailUp = -1.1;
    const pb = this.poseBlend;
    const k = 1 - Math.exp(-dt * 8);
    pb.bodyY += (bodyY - pb.bodyY) * k;
    pb.pitch += (pitch - pb.pitch) * k;
    pb.legF += (legF - pb.legF) * k;
    pb.legB += (legB - pb.legB) * k;
    pb.headP += (headP - pb.headP) * k;
    pb.tailUp += (tailUp - pb.tailUp) * k;
    pb.lie += (lie - pb.lie) * k;

    const swingAmp = moving ? Math.min(0.9, 0.35 + sp * 0.12) * (pose === 'crouch' ? 0.5 : 1) : 0;
    const ph = this.phase;
    const bob = moving ? Math.abs(Math.sin(ph)) * 0.012 * Math.min(1, sp / 2) : Math.sin(this.t * 1.6) * 0.002;
    this.body.position.y = this.shoulderY + pb.bodyY + bob;
    this.body.rotation.z = pb.pitch + (running ? Math.sin(ph) * 0.08 : 0);
    // legs: FL, FR, BL, BR
    const offs = running ? [0, 0.4, Math.PI, Math.PI + 0.4] : [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const base = front ? pb.legF - pb.pitch * (pose === 'sit' || pose === 'groom' ? 1 : 0) : pb.legB;
      this.legs[i].rotation.z = base + Math.sin(ph + offs[i]) * swingAmp;
    }
    // head
    const hy = this.lookYaw;
    this.headPivot.rotation.y += (hy - this.headPivot.rotation.y) * k;
    const hpTarget = -pb.headP - this.lookPitch - (pose === 'sit' ? -pb.pitch * 0.6 : 0) + (moving ? Math.sin(ph * 2) * 0.03 : 0);
    this.headPivot.rotation.z += (hpTarget - this.headPivot.rotation.z) * k;
    // tail
    const sway = Math.sin(this.t * (this.mood === 'angry' ? 5 : 1.4)) * (this.mood === 'angry' ? 0.35 : 0.18);
    this.tailPivot.rotation.z = pb.tailUp;
    this.tailSegs.forEach((seg, i) => {
      const f = i / this.tailSegs.length;
      seg.rotation.y = sway * (0.3 + f) + (pb.lie > 0.5 ? 0.35 : 0);
      seg.rotation.z = (running ? 0.02 : -0.12 + f * 0.1) + (seg.userData.kink ?? 0) + (pb.lie > 0.5 ? 0.05 : 0);
    });
    // ears
    this.earT -= dt;
    if (this.ears) {
      const back = this.mood === 'angry' || this.mood === 'afraid' ? 0.5 : 0;
      let tw = 0;
      if (this.earT < 0) { tw = Math.sin(-this.earT * 30) * 0.15; if (this.earT < -0.2) this.earT = 2 + Math.random() * 6; }
      this.ears.rotation.z = back + tw;
    }
    // blink
    this.blinkT -= dt;
    if (this.eyes) {
      const closed = pose === 'sleep';
      let sy = closed ? 0.1 : 1;
      if (!closed && this.blinkT < 0) {
        sy = 0.15;
        if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 5;
      }
      this.eyes.scale.y = sy;
    }
  }
}

const NECK_ITEMS: Accessory[] = ['collar', 'bellCollar', 'berryCharm', 'leafScarf', 'shellNecklace', 'clawNecklace'];
const ACC_DEFAULT_COLOR: Record<Accessory, string> = {
  none: '#ffffff', collar: '#b8323a', bellCollar: '#2f5fb8', berryCharm: '#6b4a2b', leafScarf: '#4f8a3a', shellNecklace: '#f3ead8',
  clawNecklace: '#efe6d2', flowerCrown: '#f2a3c4', feather: '#e9e2d0', bow: '#e05c8a', flowerEar: '#ffffff',
};
/** Everything a cat is wearing (supports old single-accessory saves). */
export function accessoriesOf(app: Appearance): Accessory[] {
  if (app.accessories?.length) return app.accessories.filter((a) => a !== 'none');
  return app.accessory && app.accessory !== 'none' ? [app.accessory] : [];
}
