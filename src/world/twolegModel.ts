// Twolegs (humans): a jointed procedural body with clothes, hair and the
// phones and other devices they never seem to put down.
import * as THREE from 'three';

export type TwolegPose = 'stand' | 'walk' | 'phone' | 'crouch' | 'pet' | 'sit' | 'lie' | 'carry' | 'wave' | 'run' | 'call' | 'photo';
export type Device = 'phone' | 'tablet' | 'headphones' | 'watch' | 'earbuds' | 'none';
export type Hair = 'short' | 'long' | 'ponytail' | 'bun' | 'bald' | 'cap' | 'curly';

export interface TwolegLook {
  skin: string;
  hair: string;
  hairStyle: Hair;
  shirt: string;
  pants: string;
  shoes: string;
  height: number; // 1 = adult
  devices: Device[];
  uniform?: boolean; // animal control worker
  skirt?: boolean;
}

const SKINS = ['#f1d0b5', '#e2b38f', '#c68b62', '#a0694a', '#7a4b33', '#5a3726', '#f5dccb'];
const HAIRS = ['#2a1d16', '#4a3020', '#7a5232', '#c9a060', '#e3c88a', '#1a1a1a', '#8a8a8a', '#a8452a', '#d8d4cc'];
const SHIRTS = ['#3a6ea8', '#c8463c', '#4f8a4a', '#e0b84a', '#f0ece4', '#6e5a8a', '#2b2b30', '#e07a9a', '#3aa0a0', '#d9823b'];
const PANTS = ['#2d3d5c', '#3a3a40', '#5a4a3a', '#20283a', '#7a6a50', '#2b2b30'];

export function randomLook(r: () => number, kid = false): TwolegLook {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const devs: Device[] = [];
  const roll = r();
  if (roll < 0.55) devs.push('phone'); else if (roll < 0.7) devs.push('tablet'); else if (roll < 0.82) devs.push('headphones', 'phone');
  if (r() < 0.3) devs.push('watch');
  if (r() < 0.2 && !devs.includes('headphones')) devs.push('earbuds');
  return {
    skin: pick(SKINS), hair: pick(HAIRS), hairStyle: pick(['short', 'long', 'ponytail', 'bun', 'bald', 'cap', 'curly'] as Hair[]),
    shirt: pick(SHIRTS), pants: pick(PANTS), shoes: pick(['#f0ece4', '#2b2b30', '#7a4a2a', '#c8463c']),
    height: kid ? 0.62 + r() * 0.12 : 0.94 + r() * 0.12, devices: devs, skirt: r() < 0.2,
  };
}

function lam(color: string) { return new THREE.MeshLambertMaterial({ color }); }

/** A canvas texture for a glowing screen (phone, tablet, TV…). */
export function screenTexture(kind: 'phone' | 'tablet'): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 64;
  const c = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, kind === 'phone' ? '#6fb0ff' : '#ffd27a');
  g.addColorStop(1, kind === 'phone' ? '#b07aff' : '#ff8a6a');
  c.fillStyle = g; c.fillRect(0, 0, 32, 64);
  // little app icons / a video of a cat, obviously
  for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) {
    c.fillStyle = ['#ffffff', '#ffe07a', '#7affc0', '#ff7a9a'][(x + y) % 4];
    c.globalAlpha = 0.8;
    c.fillRect(4 + x * 9, 8 + y * 12, 6, 6);
  }
  c.globalAlpha = 1;
  c.fillStyle = '#ffffff';
  c.fillRect(10, 58, 12, 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let _phoneTex: THREE.CanvasTexture | null = null;
let _tabTex: THREE.CanvasTexture | null = null;

/** A plastic cat carrier with a wire-grate door. */
export function buildCarrier(color = '#9aa3ab'): THREE.Group {
  const g = new THREE.Group();
  const shell = lam(color);
  const top = lam('#d8dde2');
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.34), shell);
  body.position.y = 0.15;
  g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.36), top);
  lid.position.y = 0.32;
  g.add(lid);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), lam('#3a3a40'));
  handle.position.y = 0.35;
  g.add(handle);
  // grate door
  const wire = lam('#5a6068');
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.24, 0.012), wire);
    b.position.set(0.255, 0.16, -0.12 + i * 0.06);
    g.add(b);
  }
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.28), wire);
    b.position.set(0.255, 0.06 + i * 0.1, 0);
    g.add(b);
  }
  // air holes
  for (let i = 0; i < 3; i++) {
    const hole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.01), lam('#2a2a2e'));
    hole.position.set(-0.12 + i * 0.1, 0.2, 0.172);
    g.add(hole);
  }
  return g;
}

export class TwolegModel {
  root = new THREE.Group();
  look: TwolegLook;
  pose: TwolegPose = 'stand';
  speed = 0;
  private t = Math.random() * 10;
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  handR = new THREE.Group();
  handL = new THREE.Group();
  private phone: THREE.Object3D | null = null;
  private screenMat: THREE.MeshBasicMaterial | null = null;
  carrier: THREE.Group | null = null;
  private flash = 0;

  constructor(look: TwolegLook) {
    this.look = look;
    const s = look.height;
    const skin = lam(look.skin), shirt = lam(look.shirt), pants = lam(look.pants), shoes = lam(look.shoes), hair = lam(look.hair);
    this.root.add(this.hips);
    this.hips.position.y = 0.92;
    // legs
    const mkLeg = (leg: THREE.Group, knee: THREE.Group, x: number) => {
      leg.position.set(x, 0, 0);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 4, 8), pants);
      thigh.position.y = -0.22;
      leg.add(thigh);
      knee.position.y = -0.45;
      leg.add(knee);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.34, 4, 8), look.skirt ? skin : pants);
      shin.position.y = -0.21;
      knee.add(shin);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.24), shoes);
      shoe.position.set(0, -0.44, 0.05);
      knee.add(shoe);
      this.hips.add(leg);
    };
    mkLeg(this.legL, this.kneeL, -0.1);
    mkLeg(this.legR, this.kneeR, 0.1);
    if (look.skirt) {
      const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.27, 0.36, 12), pants);
      sk.position.y = -0.14;
      this.hips.add(sk);
    }
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.2), pants);
    this.hips.add(pelvis);
    // torso
    this.hips.add(this.torso);
    this.torso.position.y = 0.06;
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.32, 4, 10), shirt);
    chest.scale.set(1.15, 1, 0.7);
    chest.position.y = 0.28;
    this.torso.add(chest);
    if (look.uniform) {
      // reflective stripes and a badge
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.25), new THREE.MeshBasicMaterial({ color: '#e8d84a' }));
      stripe.position.y = 0.2;
      this.torso.add(stripe);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.02), lam('#d8c060'));
      badge.position.set(-0.08, 0.38, 0.12);
      this.torso.add(badge);
    }
    // neck & head
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), skin);
    neck.position.y = 0.6;
    this.torso.add(neck);
    this.head.position.y = 0.73;
    this.torso.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), skin);
    skull.scale.set(0.92, 1.08, 1);
    this.head.add(skull);
    const eyeM = lam('#1c1c22');
    for (const x of [-0.04, 0.04]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 6), eyeM);
      e.position.set(x, 0.015, 0.105);
      this.head.add(e);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.01), hair);
      brow.position.set(x, 0.045, 0.108);
      this.head.add(brow);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.04, 6), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.01, 0.12);
    this.head.add(nose);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.01), lam('#9a4a4a'));
    mouth.position.set(0, -0.05, 0.106);
    this.head.add(mouth);
    for (const x of [-0.115, 0.115]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), skin);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(x, 0, 0);
      this.head.add(ear);
    }
    // hair styles
    const st = look.hairStyle;
    if (st !== 'bald') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 10, 0, Math.PI * 2, 0, st === 'curly' ? Math.PI * 0.62 : Math.PI * 0.5), hair);
      cap.position.y = 0.012;
      cap.rotation.x = -0.25;
      if (st === 'curly') cap.scale.set(1.15, 1.15, 1.15);
      this.head.add(cap);
      if (st === 'long') {
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.28, 0.08), hair);
        back.position.set(0, -0.1, -0.08);
        this.head.add(back);
      }
      if (st === 'ponytail') {
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16, 4, 6), hair);
        tail.position.set(0, -0.04, -0.15);
        tail.rotation.x = 0.5;
        this.head.add(tail);
      }
      if (st === 'bun') {
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), hair);
        bun.position.set(0, 0.1, -0.08);
        this.head.add(bun);
      }
      if (st === 'cap') {
        const hat = new THREE.Mesh(new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), lam(look.uniform ? '#2d3d5c' : look.shirt));
        hat.position.y = 0.02;
        this.head.add(hat);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.1), lam(look.uniform ? '#2d3d5c' : look.shirt));
        brim.position.set(0, 0.03, 0.14);
        this.head.add(brim);
      }
    }
    // arms
    const mkArm = (arm: THREE.Group, elbow: THREE.Group, hand: THREE.Group, x: number) => {
      arm.position.set(x, 0.48, 0);
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.24, 4, 8), shirt);
      up.position.y = -0.15;
      arm.add(up);
      elbow.position.y = -0.31;
      arm.add(elbow);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 4, 8), look.uniform ? shirt : skin);
      fore.position.y = -0.13;
      elbow.add(fore);
      hand.position.y = -0.29;
      elbow.add(hand);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 6), skin);
      palm.scale.set(0.8, 1.1, 0.6);
      hand.add(palm);
      this.torso.add(arm);
    };
    mkArm(this.armL, this.elbowL, this.handL, -0.24);
    mkArm(this.armR, this.elbowR, this.handR, 0.24);
    // devices
    if (look.devices.includes('phone') || look.devices.includes('tablet')) {
      const tab = !look.devices.includes('phone');
      const tex = tab ? (_tabTex ??= screenTexture('tablet')) : (_phoneTex ??= screenTexture('phone'));
      const dev = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(tab ? 0.2 : 0.075, tab ? 0.27 : 0.15, 0.012), lam('#1a1a1e'));
      dev.add(body);
      this.screenMat = new THREE.MeshBasicMaterial({ map: tex });
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(tab ? 0.18 : 0.065, tab ? 0.25 : 0.135), this.screenMat);
      scr.position.z = 0.007;
      dev.add(scr);
      dev.position.set(0, -0.06, 0.05);
      dev.rotation.x = -1.2;
      this.handR.add(dev);
      this.phone = dev;
    }
    if (look.devices.includes('headphones')) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.014, 6, 16, Math.PI), lam('#e04a4a'));
      band.position.y = 0.02;
      this.head.add(band);
      for (const x of [-0.125, 0.125]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 10), lam('#2a2a2e'));
        cup.rotation.z = Math.PI / 2;
        cup.position.set(x, 0, 0);
        this.head.add(cup);
      }
    }
    if (look.devices.includes('earbuds')) for (const x of [-0.118, 0.118]) {
      const bud = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), lam('#f4f4f4'));
      bud.position.set(x, -0.01, 0.01);
      this.head.add(bud);
    }
    if (look.devices.includes('watch')) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), lam('#1a1a1e'));
      w.position.set(0, -0.24, 0.03);
      this.elbowL.add(w);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.035), new THREE.MeshBasicMaterial({ color: '#7affc0' }));
      face.position.set(0, -0.24, 0.046);
      this.elbowL.add(face);
    }
    this.root.scale.setScalar(s);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  }

  holdCarrier(on: boolean, color?: string) {
    if (on && !this.carrier) {
      this.carrier = buildCarrier(color);
      this.carrier.position.set(0, -0.36, 0);
      this.carrier.rotation.y = Math.PI / 2;
      this.handL.add(this.carrier);
    } else if (!on && this.carrier) {
      this.handL.remove(this.carrier);
      this.carrier = null;
    }
  }

  /** Camera flash when a Twoleg takes a picture. */
  snap() { this.flash = 0.25; }

  get phoneOut() { return !!this.phone; }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const p = this.pose;
    const moving = this.speed > 0.15;
    const run = p === 'run' || this.speed > 2.8;
    const freq = run ? 9 : 6.2;
    const sw = moving ? Math.sin(t * freq) * (run ? 0.85 : 0.5) : 0;
    // reset
    this.hips.position.y = 0.92;
    this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.legL.rotation.set(sw, 0, 0);
    this.legR.rotation.set(-sw, 0, 0);
    this.kneeL.rotation.set(moving ? Math.max(0, -Math.sin(t * freq - 1)) * 0.9 : 0, 0, 0);
    this.kneeR.rotation.set(moving ? Math.max(0, Math.sin(t * freq - 1)) * 0.9 : 0, 0, 0);
    this.armL.rotation.set(-sw * 0.7, 0, -0.08);
    this.armR.rotation.set(sw * 0.7, 0, 0.08);
    this.elbowL.rotation.set(run ? -1.3 : -0.15, 0, 0);
    this.elbowR.rotation.set(run ? -1.3 : -0.15, 0, 0);
    if (moving) this.hips.position.y += Math.abs(Math.sin(t * freq)) * (run ? 0.05 : 0.025);
    if (run) this.torso.rotation.x = 0.18;
    const phoneHand = () => { this.armR.rotation.set(-0.5, 0, 0.1); this.elbowR.rotation.set(-1.45, 0, 0); this.head.rotation.x = 0.45; };
    if (this.phone) this.phone.visible = p === 'phone' || p === 'photo' || p === 'call' || (p === 'walk' && !!this.look.devices.length && this.look.devices[0] !== 'headphones');
    switch (p) {
      case 'walk': case 'stand':
        if (this.phone?.visible) phoneHand();
        if (p === 'stand') { this.hips.position.y += Math.sin(t * 1.3) * 0.004; this.head.rotation.y = Math.sin(t * 0.4) * 0.3; }
        break;
      case 'phone': phoneHand(); break;
      case 'call':
        this.armR.rotation.set(-0.3, 0, 1.1); this.elbowR.rotation.set(-2.5, 0, 0);
        this.head.rotation.z = Math.sin(t * 0.8) * 0.08;
        break;
      case 'photo':
        this.armR.rotation.set(-1.45, 0, 0.1); this.elbowR.rotation.set(-0.2, 0, 0);
        this.armL.rotation.set(-1.4, 0, -0.1); this.elbowL.rotation.set(-0.3, 0, 0);
        break;
      case 'wave':
        this.armR.rotation.set(0, 0, 2.6 + Math.sin(t * 8) * 0.3); this.elbowR.rotation.set(-0.3, 0, 0);
        break;
      case 'crouch': case 'pet': {
        this.hips.position.y = 0.45;
        this.legL.rotation.set(-1.35, 0, -0.1); this.legR.rotation.set(-1.0, 0, 0.1);
        this.kneeL.rotation.set(2.3, 0, 0); this.kneeR.rotation.set(2.0, 0, 0);
        this.torso.rotation.x = 0.45;
        this.head.rotation.x = 0.3;
        if (p === 'pet') { this.armR.rotation.set(-1.0 + Math.sin(t * 3) * 0.25, 0, 0); this.elbowR.rotation.set(-0.2, 0, 0); }
        break;
      }
      case 'sit':
        this.hips.position.y = 0.5;
        this.legL.rotation.set(-1.5, 0, 0); this.legR.rotation.set(-1.5, 0, 0);
        this.kneeL.rotation.set(1.5, 0, 0); this.kneeR.rotation.set(1.5, 0, 0);
        this.torso.rotation.x = -0.12;
        if (this.phone) { this.phone.visible = true; phoneHand(); }
        break;
      case 'lie':
        this.hips.position.y = 0.62;
        this.hips.rotation.x = -Math.PI / 2;
        break;
      case 'carry':
        this.armL.rotation.set(-0.1 + sw * 0.15, 0, -0.15);
        this.elbowL.rotation.set(0, 0, 0);
        break;
      case 'run': break;
    }
    if (this.carrier) { this.armL.rotation.set(sw * 0.15, 0, -0.15); this.elbowL.rotation.set(0, 0, 0); }
    if (this.screenMat) {
      this.flash = Math.max(0, this.flash - dt);
      this.screenMat.color.setScalar(this.flash > 0 ? 3 : 1);
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); }
    });
  }
}

// ------------------------------------------------------------------ vehicles
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Vehicle {
  root: THREE.Group;
  wheels: THREE.Mesh[];
  lights: THREE.MeshBasicMaterial;
  beacon?: THREE.MeshBasicMaterial[];
  doors?: THREE.Group[];
  length: number;
}

/** A Twoleg monster: a car, or the white animal-control van with its flashing roof lights. */
export function buildVehicle(kind: 'car' | 'van', color = '#c8463c'): Vehicle {
  const root = new THREE.Group();
  const L = kind === 'van' ? 5.2 : 4.2, W = kind === 'van' ? 2.0 : 1.8;
  const body = lam(kind === 'van' ? '#eeeeea' : color);
  const glass = new THREE.MeshLambertMaterial({ color: '#203040' });
  const dark = lam('#1a1a1e');
  const lower = new THREE.Mesh(new THREE.BoxGeometry(L, 0.7, W), body);
  lower.position.y = 0.65;
  root.add(lower);
  if (kind === 'van') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(L * 0.72, 1.35, W), body);
    box.position.set(-L * 0.14, 1.65, 0);
    root.add(box);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.26, 0.8, W * 0.98), body);
    cab.position.set(L * 0.36, 1.35, 0);
    root.add(cab);
    const ws = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, W * 0.9), glass);
    ws.position.set(L * 0.49, 1.38, 0);
    ws.rotation.z = -0.25;
    root.add(ws);
    for (const z of [-W / 2 - 0.01, W / 2 + 0.01]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(L * 0.18, 0.5, 0.02), glass);
      sw.position.set(L * 0.36, 1.45, z);
      root.add(sw);
    }
    // orange stripe and the ANIMAL CONTROL lettering on both sides
    const tex = canvasTex(256, 64, (c) => {
      c.fillStyle = '#eeeeea'; c.fillRect(0, 0, 256, 64);
      c.fillStyle = '#e8792a'; c.fillRect(0, 44, 256, 12);
      c.fillStyle = '#2d3d5c'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center';
      c.fillText('ANIMAL CONTROL', 128, 32);
      c.fillStyle = '#e8792a'; c.beginPath(); c.arc(18, 22, 10, 0, Math.PI * 2); c.fill();
    });
    for (const z of [-W / 2 - 0.012, W / 2 + 0.012]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.66, 0.8), new THREE.MeshLambertMaterial({ map: tex }));
      sign.position.set(-L * 0.14, 1.6, z);
      if (z < 0) sign.rotation.y = Math.PI;
      root.add(sign);
    }
    // roof beacon
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 1.2), dark);
    bar.position.set(L * 0.36, 1.8, 0);
    root.add(bar);
    const b1 = new THREE.MeshBasicMaterial({ color: '#ffaa22' }), b2 = new THREE.MeshBasicMaterial({ color: '#ffaa22' });
    for (const [z, m] of [[-0.35, b1], [0.35, b2]] as [number, THREE.MeshBasicMaterial][]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.4), m);
      l.position.set(L * 0.36, 1.88, z);
      root.add(l);
    }
    // back doors (hinged so they can swing open)
    const doors: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(-L / 2 - 0.01, 0, side * W / 2);
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, W / 2 - 0.02), body);
      d.position.set(0, 1.3, -side * (W / 4));
      hinge.add(d);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, W / 2 - 0.3), glass);
      win.position.set(0, 1.85, -side * (W / 4));
      hinge.add(win);
      root.add(hinge);
      doors.push(hinge);
    }
    // carriers stacked inside
    for (let i = 0; i < 4; i++) {
      const cr = buildCarrier(i % 2 ? '#9aa3ab' : '#c9b27a');
      cr.position.set(-L / 2 + 0.4 + (i % 2) * 0.6, 1.0 + Math.floor(i / 2) * 0.36, -0.4 + (i % 2) * 0.2);
      root.add(cr);
    }
    const interior = new THREE.Mesh(new THREE.BoxGeometry(L * 0.66, 1.2, W - 0.16), new THREE.MeshLambertMaterial({ color: '#2a2a2e', side: THREE.BackSide }));
    interior.position.set(-L * 0.14, 1.65, 0);
    root.add(interior);
    const v: Vehicle = { root, wheels: [], lights: new THREE.MeshBasicMaterial({ color: '#fff6d8' }), beacon: [b1, b2], doors, length: L };
    addWheelsAndLights(v, L, W, dark);
    return v;
  }
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.5, 0.6, W * 0.92), body);
  cabin.position.set(-0.15, 1.25, 0);
  root.add(cabin);
  for (const [x, rz, w] of [[L * 0.12, -0.5, 0.05], [-L * 0.4, 0.5, 0.05]] as [number, number, number][]) {
    const ws = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, W * 0.86), glass);
    ws.position.set(x, 1.24, 0);
    ws.rotation.z = rz;
    root.add(ws);
  }
  for (const z of [-W * 0.465, W * 0.465]) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(L * 0.44, 0.42, 0.02), glass);
    sw.position.set(-0.15, 1.27, z);
    root.add(sw);
  }
  const v: Vehicle = { root, wheels: [], lights: new THREE.MeshBasicMaterial({ color: '#fff6d8' }), length: L };
  addWheelsAndLights(v, L, W, dark);
  return v;
}

function addWheelsAndLights(v: Vehicle, L: number, W: number, dark: THREE.Material) {
  const hub = lam('#b8bcc2');
  for (const x of [L * 0.32, -L * 0.32]) for (const z of [-W / 2, W / 2]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 14), dark);
    wh.rotation.x = Math.PI / 2;
    wh.position.set(x, 0.36, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.25, 8), hub);
    wh.add(cap);
    v.root.add(wh);
    v.wheels.push(wh);
  }
  for (const z of [-W * 0.35, W * 0.35]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.3), v.lights);
    hl.position.set(L / 2 + 0.01, 0.8, z);
    v.root.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.24), new THREE.MeshBasicMaterial({ color: '#d02020' }));
    tl.position.set(-L / 2 - 0.01, 0.8, z);
    v.root.add(tl);
  }
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, W), dark);
  bumperF.position.set(L / 2, 0.45, 0);
  v.root.add(bumperF);
  const bumperB = bumperF.clone();
  bumperB.position.x = -L / 2;
  v.root.add(bumperB);
  v.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
}
