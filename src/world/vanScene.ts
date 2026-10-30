// The ride to the Twoleg pound, in 3D: inside the back of the animal-control
// van, your own cat and your clanmates are locked in rusty cages that rattle
// and bump while streetlights flash past the barred window.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CatModel } from '../cats/model';
import type { Cat } from '../cats/types';
import { displayName } from '../cats/types';
import { textures } from './twolegplace';

export interface VanRider { cat: Cat; isPlayer: boolean }

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = false) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let _plate: THREE.CanvasTexture | null = null;
let _paper: THREE.CanvasTexture | null = null;
/** Rust-streaked diamond-plate floor. */
function plateTex() {
  return _plate ??= canvasTex(128, 128, (c) => {
    c.fillStyle = '#5a5654'; c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < 128; x += 12) {
      c.save(); c.translate(x + 3, y + 3); c.rotate(((x + y) / 12) % 2 ? 0.7 : -0.7);
      c.fillStyle = '#8a8682'; c.fillRect(-4, -1, 8, 2); c.restore();
    }
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * 128, y = Math.random() * 128, r = 6 + Math.random() * 18;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(130,60,20,0.75)'); g.addColorStop(1, 'rgba(130,60,20,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, true);
}
/** Old newspaper lining the cage trays. */
function paperTex() {
  return _paper ??= canvasTex(64, 64, (c) => {
    c.fillStyle = '#d8d2c0'; c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#3a3a3a'; c.fillRect(4, 4, 56, 6);
    for (let y = 14; y < 60; y += 4) { c.fillStyle = 'rgba(40,40,40,0.55)'; c.fillRect(4, y, 26, 1.5); c.fillRect(34, y, 26, 1.5); }
    c.fillStyle = 'rgba(120,90,40,0.35)'; c.beginPath(); c.arc(44, 40, 9, 0, 7); c.fill();
  });
}

const lam = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

/** One detailed, rusty wire cage. Front is +Z. Returns the cage and its door pivot. */
function rustyCage(w: number, h: number, d: number, num: number, mats: { rust: THREE.Material; bar: THREE.Material; dark: THREE.Material; brass: THREE.Material }) {
  const g = new THREE.Group();
  const frame: THREE.BufferGeometry[] = [];
  const bars: THREE.BufferGeometry[] = [];
  const tube = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => { const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(x, y, z); frame.push(b); };
  const t = 0.022;
  // the 12 edges of the frame
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) tube(x, h / 2, z, t, h, t);
  for (const y of [0.01, h]) {
    for (const z of [-d / 2, d / 2]) tube(0, y, z, w, t, t);
    for (const x of [-w / 2, w / 2]) tube(x, y, 0, t, t, d);
  }
  const bar = (x: number, y: number, z: number, len: number, axis: 'x' | 'y' | 'z', bend = 0) => {
    const b = new THREE.CylinderGeometry(0.0055, 0.0055, len, 5);
    if (axis === 'x') b.rotateZ(Math.PI / 2);
    if (axis === 'z') b.rotateX(Math.PI / 2);
    if (bend) b.rotateZ(bend);
    b.translate(x, y, z);
    bars.push(b);
  };
  // back and side bars, with a bent one here and there
  const step = 0.05;
  for (let x = -w / 2 + step; x < w / 2 - 0.01; x += step) bar(x, h / 2, -d / 2, h, 'y', Math.random() < 0.06 ? 0.06 : 0);
  for (let z = -d / 2 + step; z < d / 2 - 0.01; z += step) for (const x of [-w / 2, w / 2]) bar(x, h / 2, z, h, 'y');
  for (const y of [h / 3, (2 * h) / 3]) {
    bar(0, y, -d / 2, w, 'x');
    for (const x of [-w / 2, w / 2]) bar(x, y, 0, d, 'z');
  }
  // top grid
  for (let x = -w / 2 + step; x < w / 2; x += step * 1.4) bar(x, h, 0, d, 'z');
  for (let z = -d / 2 + step; z < d / 2; z += step * 1.4) bar(0, h, z, w, 'x');
  g.add(new THREE.Mesh(mergeGeometries(frame)!, mats.rust));
  g.add(new THREE.Mesh(mergeGeometries(bars)!, mats.bar));
  // a plastic tray lined with old newspaper
  const tray = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, 0.03, d - 0.02), mats.dark);
  tray.position.y = 0.02;
  g.add(tray);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, d * 0.6), new THREE.MeshLambertMaterial({ map: paperTex() }));
  paper.rotation.x = -Math.PI / 2;
  paper.rotation.z = (num % 3) * 0.4 - 0.3;
  paper.position.set(-w * 0.08, 0.037, -d * 0.05);
  g.add(paper);
  // a dented metal bowl, tipped over
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.03, 10, 1, true), lam('#9a9a98', { side: THREE.DoubleSide }));
  bowl.position.set(w * 0.3, 0.06, -d * 0.25);
  bowl.rotation.z = num % 2 ? 1.2 : 0;
  g.add(bowl);
  // the front door: hinged on the left, barred, with a latch, padlock and chain
  const door = new THREE.Group();
  door.position.set(-w / 2, 0, d / 2);
  const dbars: THREE.BufferGeometry[] = [];
  for (let x = step; x < w - 0.01; x += step * 0.9) { const b = new THREE.CylinderGeometry(0.006, 0.006, h - 0.04, 5); b.translate(x, h / 2, 0.01); dbars.push(b); }
  for (const y of [0.04, h / 2, h - 0.04]) { const b = new THREE.BoxGeometry(w, 0.018, 0.018); b.translate(w / 2, y, 0.01); dbars.push(b); }
  door.add(new THREE.Mesh(mergeGeometries(dbars)!, mats.bar));
  for (const y of [0.1, h - 0.1]) { const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), mats.rust); hinge.position.set(0, y, 0.01); door.add(hinge); }
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.03), mats.rust);
  latch.position.set(w - 0.03, h / 2, 0.025);
  door.add(latch);
  const lockBody = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.02), mats.brass);
  lockBody.position.set(w - 0.03, h / 2 - 0.05, 0.045);
  door.add(lockBody);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 6, 12, Math.PI), lam('#9a9a98'));
  shackle.position.set(w - 0.03, h / 2 - 0.025, 0.045);
  door.add(shackle);
  const keyhole = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.016), lam('#1a1a1a'));
  keyhole.position.set(w - 0.03, h / 2 - 0.055, 0.0561);
  door.add(keyhole);
  // a short chain dangling from the lock
  for (let i = 0; i < 5; i++) {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0025, 5, 10), mats.rust);
    link.position.set(w - 0.03 + (i % 2 ? 0.002 : 0), h / 2 - 0.085 - i * 0.014, 0.05);
    link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    door.add(link);
  }
  // a paper tag with a number on it
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.045), new THREE.MeshLambertMaterial({ map: canvasTex(64, 40, (c) => { c.fillStyle = '#e8dcae'; c.fillRect(0, 0, 64, 40); c.fillStyle = '#7a2a1a'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.fillText(`#${100 + num * 7}`, 32, 28); }) }));
  tag.position.set(w * 0.3, h - 0.06, 0.03);
  tag.rotation.z = 0.12;
  door.add(tag);
  g.add(door);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { g, door };
}

export class VanCutscene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.02, 40);
  private van = new THREE.Group();
  private cages: { g: THREE.Group; base: THREE.Vector3; model: CatModel | null; seed: number; name: string; facing: number }[] = [];
  private bulb = new THREE.Group();
  private bulbLight: THREE.PointLight;
  private passLight: THREE.PointLight;
  private tail: THREE.PointLight;
  private window: THREE.MeshBasicMaterial;
  private dust: THREE.Points;
  private t = 0;
  private labels: HTMLElement[] = [];
  private playerCage = 0;

  constructor(riders: VanRider[], private labelLayer: HTMLElement, stowaway: VanRider | null) {
    const sc = this.scene;
    sc.background = new THREE.Color('#06070a');
    sc.fog = new THREE.Fog('#06070a', 6, 14);
    sc.add(this.van);
    sc.add(new THREE.AmbientLight('#5a6478', 2.6));
    sc.add(new THREE.HemisphereLight('#8a98b0', '#3a3028', 1.6));
    const tx = textures();
    const rust = new THREE.MeshLambertMaterial({ map: tx.rust, color: '#b0a49a' });
    const mats = { rust, bar: lam('#7a5a4a'), dark: lam('#2a2a2e'), brass: lam('#b8903a') };
    // ---- the van's metal belly
    const L = 6, W = 2.2, H = 1.9;
    const plate = plateTex();
    plate.repeat.set(6, 2);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 0.06, W), new THREE.MeshLambertMaterial({ map: plate }));
    floor.position.y = -0.03;
    floor.receiveShadow = true;
    this.van.add(floor);
    const wallMat = new THREE.MeshLambertMaterial({ map: tx.rust, color: '#9a8e86', side: THREE.DoubleSide });
    for (const z of [-W / 2, W / 2]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
      wall.position.set(0, H / 2, z);
      if (z > 0) wall.rotation.y = Math.PI;
      wall.receiveShadow = true;
      this.van.add(wall);
      // ribs
      for (let x = -L / 2 + 0.4; x < L / 2; x += 0.55) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, 0.05), rust);
        rib.position.set(x, H / 2, z - Math.sign(z) * 0.02);
        this.van.add(rib);
      }
      // a rail with straps and dangling hooks
      const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.04, 0.04), lam('#5a5a60'));
      rail.position.set(0, H * 0.78, z - Math.sign(z) * 0.06);
      this.van.add(rail);
      for (let i = 0; i < 4; i++) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.01), lam('#c8602a'));
        strap.position.set(-2.2 + i * 1.3, H * 0.78 - 0.25, z - Math.sign(z) * 0.08);
        this.van.add(strap);
      }
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(L, W), lam('#2a2a2e', { side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    this.van.add(ceil);
    // front wall to the cab, with a little grille window glowing red from the dashboard
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
    front.position.set(-L / 2, H / 2, 0);
    front.rotation.y = Math.PI / 2;
    this.van.add(front);
    const cabWin = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({ color: '#5a2a20' }));
    cabWin.position.set(-L / 2 + 0.01, H * 0.72, 0);
    cabWin.rotation.y = Math.PI / 2;
    this.van.add(cabWin);
    for (let i = 0; i < 6; i++) { const gb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.25, 0.012), lam('#1a1a1a')); gb.position.set(-L / 2 + 0.02, H * 0.72, -0.2 + i * 0.08); this.van.add(gb); }
    // rear doors with a small barred window; streetlights slide past outside
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
    rear.position.set(L / 2, H / 2, 0);
    rear.rotation.y = -Math.PI / 2;
    this.van.add(rear);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.04, H, 0.03), rust);
    seam.position.set(L / 2 - 0.02, H / 2, 0);
    this.van.add(seam);
    const winTex = canvasTex(64, 32, (c) => { const g = c.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, '#0a0e18'); g.addColorStop(0.45, '#0a0e18'); g.addColorStop(0.5, '#ffd890'); g.addColorStop(0.55, '#0a0e18'); g.addColorStop(1, '#0a0e18'); c.fillStyle = g; c.fillRect(0, 0, 64, 32); }, true);
    this.window = new THREE.MeshBasicMaterial({ map: winTex });
    for (const z of [-0.5, 0.5]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), this.window);
      w.position.set(L / 2 - 0.01, H * 0.68, z);
      w.rotation.y = -Math.PI / 2;
      this.van.add(w);
      for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), lam('#3a3a3a')); b.position.set(L / 2 - 0.03, H * 0.68, z - 0.15 + i * 0.1); this.van.add(b); }
    }
    // a catch-pole hanging on the wall, a fire extinguisher, boxes and a clipboard
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 6), lam('#8a8a90'));
    pole.rotation.z = Math.PI / 2;
    pole.position.set(-1.6, H * 0.62, W / 2 - 0.1);
    this.van.add(pole);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 14), lam('#2a2a2a'));
    loop.position.set(-0.8, H * 0.62, W / 2 - 0.1);
    this.van.add(loop);
    const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 10), lam('#c02020'));
    ext.position.set(-L / 2 + 0.25, 0.21, W / 2 - 0.25);
    this.van.add(ext);
    for (let i = 0; i < 3; i++) { const bx = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.3), lam(i % 2 ? '#8a6a44' : '#7a5a3a')); bx.position.set(-L / 2 + 0.3 + i * 0.05, 0.13 + i * 0.25, -W / 2 + 0.3); bx.rotation.y = i * 0.2; this.van.add(bx); }
    // ---- the swinging caged bulb
    this.bulb.position.set(0.4, H - 0.02, 0);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4), lam('#111'));
    cord.position.y = -0.15;
    this.bulb.add(cord);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffdc9a' }));
    glass.position.y = -0.33;
    this.bulb.add(glass);
    for (let i = 0; i < 4; i++) { const wire = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.003, 4, 12), lam('#333')); wire.position.y = -0.33; wire.rotation.y = (i * Math.PI) / 4; this.bulb.add(wire); }
    this.bulbLight = new THREE.PointLight('#ffcc88', 14, 8, 1.1);
    this.bulbLight.position.y = -0.36;
    this.bulbLight.castShadow = false;
    this.bulb.add(this.bulbLight);
    this.van.add(this.bulb);
    this.passLight = new THREE.PointLight('#ffb050', 0, 5, 1.6);
    this.van.add(this.passLight);
    this.tail = new THREE.PointLight('#ff2020', 2, 3, 1.5);
    this.tail.position.set(-L / 2 + 0.2, H * 0.7, 0);
    this.van.add(this.tail);
    // ---- cages, with the riders inside
    const slots: [number, number, number, number][] = [ // x, y, z, facing (+1: front toward +z)
      [1.1, 0, -0.68, 1], [1.1, 0, 0.68, -1], [0.25, 0, -0.68, 1], [0.25, 0, 0.68, -1], [-0.6, 0, -0.68, 1], [-0.6, 0, 0.68, -1],
      [0.25, 0.6, -0.68, 1], [-1.45, 0, -0.68, 1],
    ];
    const cw = 0.74, ch = 0.58, cd = 0.56;
    const n = Math.max(riders.length, 4);
    for (let i = 0; i < Math.min(slots.length, n + 2); i++) {
      const [x, y, z, f] = slots[i];
      const { g } = rustyCage(cw, ch, cd, i, mats);
      g.position.set(x, y + 0.002, z);
      g.rotation.y = f > 0 ? 0 : Math.PI;
      this.van.add(g);
      const r = riders[i];
      let model: CatModel | null = null;
      if (r) {
        model = new CatModel({ ...r.cat.app }, r.cat.stage);
        // fit the cat inside the cage
        const fit = Math.min(1, 0.95 / Math.max(0.6, model.scale));
        model.root.scale.multiplyScalar(fit);
        model.mood = 'afraid';
        model.pose = r.isPlayer ? 'crouch' : (['lie', 'sit', 'crouch', 'lie'] as const)[i % 4];
        model.root.position.set(0, 0.036, -0.02);
        model.root.rotation.y = -Math.PI / 2 + (i % 2 ? 0.25 : -0.25); // nose toward the cage door
        g.add(model.root);
        if (r.isPlayer) this.playerCage = i;
      }
      this.cages.push({ g, base: g.position.clone(), model, seed: i * 1.7 + 0.3, name: r ? (r.isPlayer ? 'You' : displayName(r.cat)) : '', facing: f });
    }
    // a stowaway crouches between the cages near the back doors, free
    if (stowaway) {
      const m = new CatModel({ ...stowaway.cat.app }, stowaway.cat.stage);
      m.mood = 'alert';
      m.pose = 'crouch';
      m.root.position.set(1.95, 0, 0.1);
      m.root.rotation.y = Math.PI;
      this.van.add(m.root);
      this.cages.push({ g: new THREE.Group(), base: new THREE.Vector3(), model: m, seed: 9, name: 'You', facing: 0 });
      this.playerCage = this.cages.length - 1;
    }
    // floating dust in the light
    const pts = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i++) { pts[i * 3] = (Math.random() - 0.5) * L; pts[i * 3 + 1] = Math.random() * H; pts[i * 3 + 2] = (Math.random() - 0.5) * W; }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: '#d8c8a0', size: 0.012, transparent: true, opacity: 0.6, depthWrite: false }));
    this.van.add(this.dust);
    this.scene.add(this.camera);
    // name tags
    for (const c of this.cages) {
      const el = document.createElement('div');
      el.className = 'van-tag';
      el.textContent = c.name;
      el.style.display = c.name ? '' : 'none';
      this.labelLayer.appendChild(el);
      this.labels.push(el);
    }
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    // the road: steady rumble plus big bumps now and then
    const bump = Math.sin(t * 13) * 0.006 + Math.sin(t * 7.3) * 0.008 + Math.max(0, Math.sin(t * 2.1) - 0.85) * 0.25 * Math.sin(t * 40);
    this.van.position.y = bump;
    this.van.rotation.x = Math.sin(t * 1.3) * 0.012 + Math.sin(t * 9) * 0.003;
    this.van.rotation.z = Math.sin(t * 0.9) * 0.008;
    // cages rattle and hop a little on their own
    for (const c of this.cages) {
      if (!c.facing) { c.model?.update(dt); continue; }
      const k = Math.max(0, Math.sin(t * 2.1 + c.seed) - 0.82);
      c.g.position.set(c.base.x + Math.sin(t * 31 + c.seed) * 0.003, c.base.y + k * 0.18 * Math.abs(Math.sin(t * 38)), c.base.z + Math.sin(t * 27 + c.seed) * 0.003);
      c.g.rotation.z = Math.sin(t * 23 + c.seed) * 0.01 + k * 0.08 * Math.sin(t * 30);
      if (c.model) {
        // the cats shift and tremble
        c.model.root.position.x = Math.sin(t * 0.7 + c.seed) * 0.04;
        c.model.update(dt);
      }
    }
    // the bulb swings on its cord
    this.bulb.rotation.z = Math.sin(t * 1.7) * 0.35 + bump * 3;
    this.bulb.rotation.x = Math.sin(t * 1.1) * 0.2;
    this.bulbLight.intensity = 14 + (Math.random() < 0.03 ? -10 : 0);
    // streetlights sweeping past the back window and along the walls
    const cyc = (t * 0.75) % 1;
    this.passLight.position.set(3.2 - cyc * 6.6, 1.5, 0);
    this.passLight.intensity = Math.sin(cyc * Math.PI) * 16;
    if (this.window.map) this.window.map.offset.x = -t * 0.75;
    this.tail.intensity = 2 + Math.sin(t * 3) * 0.8;
    const dp = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < dp.count; i++) { let y = dp.getY(i) + Math.sin(t + i) * 0.0008; if (y > 1.9) y = 0; dp.setY(i, y); }
    dp.needsUpdate = true;
    // the camera drifts from your cage along the rows of cages
    const pc = this.cages[this.playerCage];
    const target = pc ? pc.g.position.clone().add(new THREE.Vector3(0, 0.22, 0)) : new THREE.Vector3(1.1, 0.25, -0.68);
    const s = Math.min(1, t / 9);
    const ease = s * s * (3 - 2 * s);
    const camA = new THREE.Vector3(target.x + 0.55, 0.42, target.z > 0 ? target.z - 0.85 : target.z + 0.85);
    const camB = new THREE.Vector3(2.6, 1.25, 0.05);
    this.camera.position.lerpVectors(camA, camB, ease);
    this.camera.position.x += Math.sin(t * 11) * 0.004;
    this.camera.position.y += bump * 0.6;
    const look = target.clone().lerp(new THREE.Vector3(-0.4, 0.3, 0), ease * 0.85);
    this.camera.lookAt(look);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    // name tags follow the cages
    const v = new THREE.Vector3();
    this.cages.forEach((c, i) => {
      const el = this.labels[i];
      if (!c.name) return;
      (c.model ? c.model.root : c.g).getWorldPosition(v);
      v.y += 0.42;
      v.project(this.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
      el.style.display = vis ? '' : 'none';
      el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    });
  }

  dispose() {
    for (const c of this.cages) c.model?.dispose();
    for (const el of this.labels) el.remove();
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh || (o as THREE.Points).isPoints) m.geometry.dispose(); });
  }
}
