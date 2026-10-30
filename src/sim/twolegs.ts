// Twoleg life around the Twolegplace: walkers glued to their phones, traffic
// on the Thunderpath, the kittypet's family and home, lost-cat posters,
// animal-control vans with carriers, and the rusty pound you must escape.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const mergeGeometriesSafe = (l: THREE.BufferGeometry[]) => mergeGeometries(l)!;
import type { Game } from '../game';
import type { Collider } from '../world/chunks';
import { TwolegModel, randomLook, buildVehicle, Vehicle, TwolegLook } from '../world/twolegModel';
import {
  TownLayout, planTown, shapeTown, buildHome, buildStreet, buildNeighbour, buildFacility, buildNest, toLocal, toWorld, glassMat, makePoster,
  HomeBuild, StreetBuild, FacilityBuild, P2,
} from '../world/twolegplace';
import type { Terrain } from '../world/terrain';
import type { Territories } from '../world/territory';
import { RNG, simRng } from '../core/rng';
import { clamp } from '../core/math';
import { CatModel } from '../cats/model';
import { Cat, displayName, Lifestyle } from '../cats/types';
import { createCat, makeEpithet, randomAppearance } from '../cats/generate';
import { isClassic, lifestyleLabel, loreText } from '../lore';
import type { Prompt } from './interactions';
import { VanCutscene } from '../world/vanScene';

const STRAY_NAMES = ['Scraps', 'Biscuit', 'Tiny', 'Pepper', 'Muffin', 'Socks', 'Ginger', 'Patch', 'Bella', 'Max', 'Tigger', 'Oreo', 'Milo', 'Luna', 'Smokey', 'Daisy', 'Jasper', 'Princess', 'Noodle', 'Pickles', 'Bean', 'Toffee'];

interface Bubble { text: string; until: number }
interface Walker {
  model: TwolegModel; pos: THREE.Vector3; heading: number; speed: number;
  kind: 'street' | 'yard'; center?: P2; side: number; dirSign: number; s: number;
  mode: 'walk' | 'stop' | 'photo' | 'run'; timer: number; bubble: Bubble | null; name: string; kid: boolean; noticed: boolean; target?: P2;
}
interface Car { v: Vehicle; s: number; sign: number; speed: number; van: boolean; state: 'drive' | 'stop' | 'leave'; stopS: number; timer: number; honked: number; doors: number; catcher: Catcher | null; family?: 'leave' | 'arrive'; bait?: { mesh: THREE.Group; x: number; z: number } }
interface Catcher { model: TwolegModel; pos: THREE.Vector3; heading: number; state: 'out' | 'search' | 'chase' | 'return'; timer: number; target: Target | null; bubble: Bubble | null; caught: number; lost: number; stun?: number; hurt?: number }
type Target = { kind: 'player' } | { kind: 'npc'; id: string } | { kind: 'town'; idx: number };
interface Owner {
  model: TwolegModel; pos: THREE.Vector3; heading: number; kid: boolean; name: string;
  path: P2[]; task: string; timer: number; bubble: Bubble | null; away: boolean; still: string | null; petT: number;
}
interface TownCat { cat: Cat; model: CatModel; pos: THREE.Vector3; heading: number; home: P2; sitY: number; kind: 'fence' | 'stray'; target: P2 | null; timer: number; gone: boolean }
interface Occupant { cat: Cat; model: CatModel | null; cage: number; freed: boolean; pos: THREE.Vector3; heading: number; stray: boolean; player: boolean }

export class TwolegSystem {
  L!: TownLayout;
  home!: HomeBuild;
  street!: StreetBuild;
  fac!: FacilityBuild;
  private groups: THREE.Object3D[] = [];
  private cols: Collider[] = [];
  private homeCols: Collider[] = [];
  private facCols: Collider[] = [];
  private walkers: Walker[] = [];
  private cars: Car[] = [];
  owners: Owner[] = [];
  private townCats: TownCat[] = [];
  private occupants: Occupant[] = [];
  private worker: { model: TwolegModel; pos: THREE.Vector3; heading: number; state: 'desk' | 'round' | 'chase' | 'away'; timer: number; wp: number; bubble: Bubble | null; stun?: number } | null = null;
  /** The player's escape from the pound. */
  ac: { cage: number | null; latch: number; need: number; vent: number; ventOpen: boolean; since: number; fedAt: number; seen: number; ownerCame: boolean } | null = null;
  private light = new THREE.PointLight('#ffd9a0', 0, 22, 1.2);
  private carTimer = 4;
  private walkerTimer = 0;
  private bellT = 0;
  private leashLine: THREE.Line | null = null;
  leash: { t: number; phase: number; path: P2[]; warned: boolean } | null = null;
  private bowlFull = true;
  private yarnVel = new THREE.Vector2();
  private yarnPos = new THREE.Vector2();
  private flapAng = 0;
  private doorAng = 0;
  private tvT = 0;
  private flashEl: HTMLElement | null = null;
  private postersUp = false;
  private cutscene = false;
  private lastPetDay = -1;
  private reunionPending = false;
  private leashAsked = -1;
  private lastVan = -99;
  private trap: { g: THREE.Group; door: THREE.Group; x: number; z: number; dirX: number; dirZ: number; sprung: boolean } | null = null;
  private baitHint = false;
  private outageHere = false;
  /** A power cut in the Twolegplace or the pound: everything goes black but cats' eyes. */
  outage: { until: number; start: number; where: 'town' | 'pound' } | null = null;
  private outageApplied = false;

  constructor(private game: Game) {}

  // ------------------------------------------------------------------ world setup
  /** Plan the town and shape the ground (before the forest chunks are built). */
  plan(seed: number, terrain: Terrain, terr: Territories) {
    this.L = planTown(seed, terrain, terr);
    return shapeTown(this.L, terrain);
  }

  build() {
    const g = this.game;
    for (const o of this.groups) g.scene.remove(o);
    this.groups = [];
    this.reset();
    const rng = new RNG(g.seed ^ 0x51a7);
    this.cols = [];
    this.home = buildHome(g.scene, this.L.home);
    this.groups.push(this.home.group);
    this.homeCols = this.home.colliders;
    this.street = buildStreet(g.scene, this.L, (x, z) => g.terrain.height(x, z));
    this.groups.push(this.street.group);
    for (const n of this.L.neighbours) this.groups.push(buildNeighbour(g.scene, n, rng, this.cols));
    this.fac = buildFacility(g.scene, this.L.facility);
    this.groups.push(this.fac.group);
    this.facCols = this.fac.colliders;
    for (const [p, rogue] of [[this.L.nest.loner, false], [this.L.nest.rogue, true]] as [P2, boolean][]) this.groups.push(buildNest(g.scene, p, g.terrain.height(p.x, p.z), rogue));
    if (!this.light.parent) g.scene.add(this.light);
    this.yarnPos.set(-1.2, 2.4);
    this.spawnTownCats();
  }

  reset() {
    for (const w of this.walkers) w.model.dispose();
    for (const c of this.cars) { c.v.root.parent?.remove(c.v.root); c.catcher?.model.dispose(); }
    for (const o of this.owners) o.model.dispose();
    for (const t of this.townCats) t.model.dispose();
    for (const o of this.occupants) o.model?.dispose();
    this.worker?.model.dispose();
    this.walkers = []; this.cars = []; this.owners = []; this.townCats = []; this.occupants = []; this.worker = null;
    this.ac = null; this.leash = null; this.cutscene = false;
    if (this.trap) { this.trap.g.parent?.remove(this.trap.g); this.trap = null; }
    this.lastVan = -99;
    if (this.leashLine) { this.leashLine.parent?.remove(this.leashLine); this.leashLine = null; }
    this.postersUp = false;
    if (this.street) this.street.posters.clear();
    if (this.home) this.home.car.root.visible = true;
  }

  collidersNear(x: number, z: number, out: Collider[]) {
    if (!this.L) return;
    const push = (list: Collider[]) => { for (const c of list) if (Math.abs(c.x - x) < c.r + 3 && Math.abs(c.z - z) < c.r + 3) out.push(c); };
    if (Math.hypot(x - this.L.home.x, z - this.L.home.z) < 20) {
      push(this.homeCols);
      if (this.doorAng < 0.3) push(this.home.doorColliders);
    }
    if (Math.hypot(x - this.L.c.x, z - this.L.c.z) < this.L.len / 2 + 40) push(this.cols);
    if (Math.hypot(x - this.fac.frame.x, z - this.fac.frame.z) < 14) {
      push(this.facCols);
      for (const c of this.fac.cages) { push(c.colliders); if (!c.open) push(c.doorColliders); }
    }
  }

  // ------------------------------------------------------------------ helpers
  private st(s: number, off: number): P2 { const L = this.L; return { x: L.c.x + L.dir.x * s + L.nrm.x * off, z: L.c.z + L.dir.z * s + L.nrm.z * off }; }
  /** Street coordinates (along, across) of a world point. */
  streetCoords(x: number, z: number) { const L = this.L; const dx = x - L.c.x, dz = z - L.c.z; return { s: dx * L.dir.x + dz * L.dir.z, off: dx * L.nrm.x + dz * L.nrm.z }; }
  private onRoad(x: number, z: number) { const c = this.streetCoords(x, z); return Math.abs(c.s) < this.L.len / 2 && Math.abs(c.off) < 3.6; }
  /** Somewhere a clan cat shouldn't be: the Thunderpath and right next to Twoleg dens. */
  dangerAt(x: number, z: number): 'road' | 'den' | null {
    if (!this.L) return null;
    if (this.onRoad(x, z)) return 'road';
    for (const h of [this.L.home, ...this.L.neighbours]) if (Math.hypot(x - h.x, z - h.z) < 9) return 'den';
    return null;
  }
  nearTown(x: number, z: number, r = 60) { const c = this.streetCoords(x, z); return Math.abs(c.s) < this.L.len / 2 + r && Math.abs(c.off) < r; }
  inHome(x: number, z: number) { return !!this.home && this.home.inside(x, z); }
  inFacility(x: number, z: number) { return !!this.fac && this.fac.inside(x, z); }
  private yAt(x: number, z: number) { return this.game.groundAt(x, z); }
  private get pc() { return this.game.clan.player; }
  get lifestyle(): Lifestyle { return this.pc?.lifestyle ?? 'clan'; }
  get isKittypet() { return this.pc?.lifestyle === 'kittypet'; }
  private twoleg(s: string) { return loreText(s); }
  private headTo(model: { pos: THREE.Vector3; heading: number }, tx: number, tz: number, speed: number, dt: number) {
    const dx = tx - model.pos.x, dz = tz - model.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const step = Math.min(d, speed * dt);
    model.pos.x += (dx / d) * step;
    model.pos.z += (dz / d) * step;
    model.heading = Math.atan2(dx, dz);
    return d < 0.15;
  }

  // ------------------------------------------------------------------ town cats
  private spawnTownCats() {
    const g = this.game;
    const rng = new RNG(g.seed ^ 0x5ca7);
    // the neighbours' plump kittypet sitting on the fence
    const n = this.L.neighbours[1];
    const fp = toWorld(n, -1.5, 4.6 + 4.15);
    const smudge = createCat({ age: 30, sex: 'tom', given: isClassic() ? 'Smudge' : 'Pumpkin', rng, day: g.time.day });
    smudge.app = { ...smudge.app, base: '#1e1c1c', second: '#111', pattern: 'tuxedo', white: 0.42, body: 'stocky', size: 1.08, eye: '#e2a02c', fur: 'short', accessories: ['bellCollar'], accessoryColor: '#3a6ea8' };
    smudge.clan = 'loner';
    smudge.lifestyle = 'kittypet';
    smudge.traits = ['friendly', 'lazy'];
    this.addTownCat(smudge, fp, 'fence', 0.82);
    // a hungry stray who raids the bins
    const st = createCat({ age: 22, given: rng.pick(STRAY_NAMES), rng, day: g.time.day });
    st.clan = 'loner';
    st.lifestyle = 'loner';
    st.app = { ...st.app, accessories: [] };
    const bins = toWorld(this.L.home, 6.6 + 1.2, -1.8);
    this.addTownCat(st, bins, 'stray', 0);
  }

  private addTownCat(cat: Cat, p: P2, kind: 'fence' | 'stray', sitY: number) {
    const model = new CatModel(cat.app, cat.stage);
    model.root.visible = false;
    this.game.scene.add(model.root);
    this.townCats.push({ cat, model, pos: new THREE.Vector3(p.x, 0, p.z), heading: 0, home: p, sitY, kind, target: null, timer: 0, gone: false });
  }

  private updateTownCats(dt: number) {
    const pp = this.game.player.pos;
    for (const t of this.townCats) {
      const d = Math.hypot(t.pos.x - pp.x, t.pos.z - pp.z);
      t.model.root.visible = !t.gone && d < 80;
      if (t.gone || d > 80) continue;
      if (t.kind === 'stray') {
        t.timer -= dt;
        if (!t.target || t.timer <= 0) { t.target = { x: t.home.x + simRng.range(-4, 4), z: t.home.z + simRng.range(-4, 4) }; t.timer = simRng.range(4, 12); }
        const arrived = this.headToCat(t, t.target.x, t.target.z, 1.1, dt);
        t.model.pose = arrived ? (t.timer > 6 ? 'sit' : 'groom') : 'walk';
        t.model.speed = arrived ? 0 : 1.1;
      } else {
        t.model.pose = d < 4 ? 'sit' : (Math.sin(this.game.clock * 0.05) > 0.3 ? 'lie' : 'sit');
        t.heading = Math.atan2(pp.z - t.pos.z, pp.x - t.pos.x);
      }
      t.pos.y = this.yAt(t.pos.x, t.pos.z) + t.sitY;
      t.model.root.position.copy(t.pos);
      t.model.root.rotation.y = -t.heading;
      t.model.update(dt);
    }
  }
  private headToCat(t: { pos: THREE.Vector3; heading: number }, tx: number, tz: number, speed: number, dt: number) {
    const dx = tx - t.pos.x, dz = tz - t.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    const step = Math.min(d, speed * dt);
    t.pos.x += (dx / d) * step;
    t.pos.z += (dz / d) * step;
    t.heading = Math.atan2(dz, dx);
    return false;
  }

  // ------------------------------------------------------------------ main update
  update(dt: number) {
    const g = this.game;
    if (!this.L || !g.clan.player) return;
    const pp = g.player.pos;
    const nearTown = this.nearTown(pp.x, pp.z, 110);
    const inFac = this.inFacility(pp.x, pp.z);
    const inHome = this.inHome(pp.x, pp.z);
    // indoors: no rain, roof lifted away so you can see
    g.weather.indoors = inHome || inFac;
    const third = g.player.thirdPerson;
    this.home.roof.forEach((r) => (r.visible = !inHome));
    this.home.ceiling.visible = inHome && !third;
    const cam = g.camera.position;
    const camOut = !this.home.inside(cam.x, cam.z);
    for (const m of this.home.wallMats) m.opacity = inHome && third && camOut ? 0.3 : 1;
    // night lights
    const dark = g.time.darkness;
    const awake = this.owners.some((o) => !o.away && o.task !== 'sleep');
    this.street.lampMats.color.set(dark > 0.3 ? '#fff2c0' : '#4a4a44');
    this.home.lampMat.color.set(dark > 0.3 && awake ? '#fff0c8' : '#8a8478');
    glassMat.color.set(dark > 0.35 ? '#ffd890' : '#a8c8e0');
    glassMat.opacity = dark > 0.35 ? 0.7 : 0.32;
    this.updateLight(inFac);
    this.updateOutage(inFac, nearTown);
    if (nearTown) {
      this.updateHomeProps(dt);
      this.updateOwners(dt);
      this.updateWalkers(dt);
      this.updateTownCats(dt);
      this.updateLeash(dt);
      this.updateKittypet(dt);
    } else if (this.walkers.length) { for (const w of this.walkers) w.model.dispose(); this.walkers = []; }
    this.updateCars(dt, nearTown);
    this.updateYardWalkers(dt);
    // flashlights come out after dark and in power cuts
    const darkOut = g.time.darkness > 0.45 || this.outageHere;
    for (const w of this.walkers) w.model.setFlashlight(darkOut && !w.kid);
    for (const o of this.owners) o.model.setFlashlight(this.outageHere && !o.away && o.task !== 'sleep' && !o.kid);
    for (const c of this.cars) c.catcher?.model.setFlashlight(darkOut);
    if (this.worker) this.worker.model.setFlashlight(this.outageHere && this.worker.state !== 'away');
    // the smell of the bait
    const bait = this.cars.find((c) => c.bait)?.bait;
    if (bait && !this.baitHint && Math.hypot(pp.x - bait.x, pp.z - bait.z) < 16) { this.baitHint = true; g.ui.toast('🐟 Something smells AMAZING by the back of the monster… fish!', 'info'); }
    if (!bait) this.baitHint = false;
    if (inFac || this.ac) this.updateFacility(dt);
  }

  private updateLight(inFac: boolean) {
    const g = this.game;
    const pp = g.player.pos;
    if (inFac) {
      const w = toWorld(this.fac.frame, 0, -0.5);
      this.light.position.set(w.x, this.fac.y + 3.0, w.z);
      const night = this.worker?.state === 'away';
      const flick = Math.random() < 0.04 ? 0.2 : 1;
      this.light.intensity = (night ? 6 : 26) * flick;
      this.light.color.set('#d8f0d0');
      this.fac.tubeMats.forEach((m, i) => m.color.set(night && i > 0 ? '#3a3a38' : i === 2 && flick < 1 ? '#5a5a58' : '#e8f0e0'));
    } else if (Math.hypot(pp.x - this.L.home.x, pp.z - this.L.home.z) < 40) {
      const w = toWorld(this.L.home, -2.2, 1.5);
      this.light.position.set(w.x, this.L.home.y + 2.4, w.z);
      const awake = this.owners.some((o) => !o.away && o.task !== 'sleep');
      const fire = this.fireOn();
      this.light.color.set(fire ? '#ffb070' : '#ffe0b0');
      this.light.intensity = (g.time.darkness > 0.3 ? (awake ? 5 : fire ? 2 : 0.6) : 1.5) * (fire ? 0.9 + Math.random() * 0.2 : 1);
    } else this.light.intensity = 0;
  }

  /** Start a power cut (lights flicker, then die). */
  powerCut(seconds = 90) {
    const g = this.game;
    const pp = g.player.pos;
    const where = this.inFacility(pp.x, pp.z) ? 'pound' : 'town';
    this.outage = { until: g.clock + seconds, start: g.clock, where };
    g.audio.crash();
    g.ui.toast(where === 'pound'
      ? '⚡ POWER CUT! The pound goes pitch black — only cats\' eyes glow in the dark. The worker can\'t see a thing. Now\'s your chance!'
      : this.twoleg('⚡ Power cut! Every Tallfolk light goes out. In the darkness, only cats\' eyes shine.'), where === 'pound' ? 'good' : 'event');
    for (const o of this.owners) if (!o.away && simRng.chance(0.6)) this.say(o, simRng.pick(['Ugh, a power cut!', 'Where are the candles?', 'Who turned the lights off?!']), 3);
    if (this.worker && where === 'pound') this.say(this.worker, 'Hey! Who turned the lights out?! I can\'t see a thing!', 4);
  }

  private updateOutage(inFac: boolean, nearTown: boolean) {
    const g = this.game;
    const o = this.outage;
    if (o && g.clock > o.until) {
      this.outage = null;
      if (inFac || nearTown) { g.ui.toast('💡 The lights flicker back on.', 'info'); g.audio.click(); }
    }
    const here = !!this.outage && ((this.outage.where === 'pound' && inFac) || (this.outage.where === 'town' && nearTown && !inFac));
    this.outageHere = here;
    if (here) {
      const t = g.clock - this.outage!.start, left = this.outage!.until - g.clock;
      // flicker at the start and the end
      const flick = (t < 1.6 && Math.sin(t * 40) > 0.2) || (left < 1.2 && Math.sin(left * 35) > 0.4);
      g.renderer.toneMappingExposure = flick ? 0.7 : 0.045;
      CatModel.setEyeGlow(flick ? 1 : 55);
      this.light.intensity = flick ? this.light.intensity : 0;
      this.street.lampMats.color.set('#2a2a26');
      this.home.lampMat.color.set('#2a2622');
      this.home.tvMat.color.set('#05080a');
      glassMat.color.set('#202830');
      this.fac.tubeMats.forEach((m) => m.color.set('#1a1a18'));
      this.outageApplied = true;
    } else if (this.outageApplied) {
      this.outageApplied = false;
      g.renderer.toneMappingExposure = 1.05;
      CatModel.setEyeGlow(1);
    }
  }

  private fireOn() {
    const g = this.game;
    const h = g.time.hour;
    return (g.time.season === 'winter' || g.time.season === 'autumn') && (h > 17 || h < 7) && this.owners.some((o) => !o.away);
  }

  private updateHomeProps(dt: number) {
    const g = this.game;
    const pp = g.player.pos;
    const hm = this.home;
    hm.kibble.visible = this.bowlFull;
    // cat flap swings when a cat pushes through it
    const fl = hm.spots.flap, flo = hm.spots.flapOut;
    const mid = { x: (fl.x + flo.x) / 2, z: (fl.z + flo.z) / 2 };
    const dp = Math.hypot(pp.x - mid.x, pp.z - mid.z);
    let want = 0;
    if (dp < 0.8) {
      const l = toLocal(hm.frame, pp.x, pp.z);
      want = l.z < -4.5 ? 1.1 : -1.1;
      if (Math.abs(this.flapAng) < 0.1) g.audio.click();
    }
    this.flapAng += (want - this.flapAng) * Math.min(1, dt * (want ? 10 : 4));
    hm.flap.rotation.x = this.flapAng * (want ? 1 : Math.cos(g.clock * 9) * 0.6 + 0.4);
    // front door opens for the Twolegs
    const doorPt = toWorld(hm.frame, -1.5, 4.5);
    const near = this.owners.some((o) => !o.away && Math.hypot(o.pos.x - doorPt.x, o.pos.z - doorPt.z) < 1.8) || !!this.leash;
    this.doorAng += ((near ? 1.45 : 0) - this.doorAng) * Math.min(1, dt * 3);
    hm.door.rotation.y = this.doorAng;
    // TV glow when someone is watching
    const tvOn = this.owners.some((o) => o.task === 'tv' && o.still === 'sit');
    this.tvT -= dt;
    if (tvOn && this.tvT <= 0) { this.tvT = 0.25 + Math.random() * 0.4; hm.tvMat.color.setHSL(Math.random(), 0.5, 0.45 + Math.random() * 0.2); }
    if (!tvOn) hm.tvMat.color.set('#1a2a3a');
    const fire = this.fireOn();
    hm.fireMat.opacity = fire ? 0.75 + Math.random() * 0.25 : 0;
    // the yarn ball rolls and slows down
    if (this.yarnVel.lengthSq() > 0.0001) {
      this.yarnPos.addScaledVector(this.yarnVel, dt);
      this.yarnVel.multiplyScalar(Math.max(0, 1 - dt * 1.6));
      if (Math.abs(this.yarnPos.x + 2.25) > 3.6) { this.yarnVel.x *= -0.6; this.yarnPos.x = clamp(this.yarnPos.x, -5.8, 1.3); }
      if (Math.abs(this.yarnPos.y) > 4.2) { this.yarnVel.y *= -0.6; this.yarnPos.y = clamp(this.yarnPos.y, -4.2, 4.2); }
      hm.yarn.position.set(this.yarnPos.x, 0.08, this.yarnPos.y);
      hm.yarn.rotation.x += this.yarnVel.y * dt * 10;
      hm.yarn.rotation.z -= this.yarnVel.x * dt * 10;
    }
  }

  // ------------------------------------------------------------------ the family (owners)
  private ensureOwners() {
    if (this.owners.length) return;
    const g = this.game;
    const rng = new RNG(g.seed ^ 0x0a11);
    const mk = (kid: boolean, name: string) => {
      const look = randomLook(() => rng.next(), kid);
      if (!kid) look.devices = ['phone', 'watch'];
      else look.devices = ['tablet'];
      const model = new TwolegModel(look);
      g.scene.add(model.root);
      const p = this.home.spots.kitchen;
      this.owners.push({ model, pos: new THREE.Vector3(p.x, this.L.home.y, p.z), heading: 0, kid, name, path: [], task: 'idle', timer: 0, bubble: null, away: false, still: null, petT: 0 });
    };
    mk(false, 'Twoleg');
    mk(true, 'Twoleg kit');
  }

  ownerLabel(o: Owner) { return this.twoleg(o.kid ? 'the little Tallfolk' : 'your Tallfolk'); }

  /** Path between two local points in the house, through doorways. */
  private route(from: P2, to: P2): P2[] {
    const fr = this.home.frame;
    const a = toLocal(fr, from.x, from.z), b = toLocal(fr, to.x, to.z);
    const outside = (p: P2) => Math.abs(p.x) > 6 || Math.abs(p.z) > 4.5;
    const bed = (p: P2) => !outside(p) && p.x > 1.5;
    const pts: P2[] = [];
    const W = (x: number, z: number) => toWorld(fr, x, z);
    if (outside(a) && !outside(b)) { pts.push(W(-1.5, 6.0), W(-1.5, 3.6)); }
    if (bed(a) && !bed(b)) pts.push(W(2.2, 0.9), W(0.8, 0.9));
    if (!outside(a) && outside(b)) { if (bed(a)) pts.push(W(2.2, 0.9), W(0.8, 0.9)); pts.push(W(-1.5, 3.6), W(-1.5, 6.0)); }
    if (!bed(a) && bed(b) && !outside(a)) pts.push(W(0.8, 0.9), W(2.2, 0.9));
    if (outside(a) && bed(b)) pts.push(W(0.8, 0.9), W(2.2, 0.9));
    pts.push(to);
    return pts;
  }

  private send(o: Owner, to: P2, task: string, still: string | null = null) {
    o.path = this.route({ x: o.pos.x, z: o.pos.z }, to);
    o.task = task;
    o.still = null;
    o.timer = 0;
    (o as any).nextStill = still;
  }

  private say(o: { bubble: Bubble | null }, text: string, s = 4) { o.bubble = { text: this.twoleg(text), until: this.game.clock + s }; }

  private updateOwners(dt: number) {
    const g = this.game;
    this.ensureOwners();
    const h = g.time.hour;
    const weekday = g.time.day % 7 < 5;
    const pc = this.pc;
    const name = pc.given;
    const pp = g.player.pos;
    for (const o of this.owners) {
      // the schedule
      const wantAway = o.kid ? weekday && h >= 8.5 && h < 15 : weekday && h >= 8.2 && h < 17;
      if (wantAway && !o.away && o.task !== 'leave' && !(this.leash && !o.kid)) {
        this.send(o, o.kid ? this.st(-this.L.len / 2, 4.4) : this.home.spots.car, 'leave');
        if (simRng.chance(0.6)) this.say(o, o.kid ? 'Bye kitty! Off to school!' : `Bye ${name}, be good!`);
      }
      if (o.away && !wantAway) {
        o.away = false;
        o.model.root.visible = true;
        const p = o.kid ? this.st(-this.L.len / 2 + 2, 4.4) : this.home.spots.car;
        o.pos.set(p.x, 0, p.z);
        if (!o.kid) { this.home.car.root.visible = true; this.spawnFamilyCar('arrive'); }
        this.send(o, this.home.spots.kitchen, 'idle');
        if (this.isKittypet) this.say(o, o.kid ? `${name}! I'm home!` : `Hello ${name}, I'm home!`);
      }
      if (o.away) { o.model.root.visible = false; continue; }
      // walk the path
      if (o.path.length) {
        const p = o.path[0];
        const run = o.task === 'chase';
        if (this.headTo(o, p.x, p.z, run ? 2.6 : 1.3, dt)) o.path.shift();
        o.model.pose = 'walk';
        o.model.speed = 1.3;
        if (!o.path.length) {
          o.still = (o as any).nextStill ?? 'stand';
          o.timer = 0;
          if (o.task === 'leave') {
            o.away = true;
            o.model.root.visible = false;
            if (!o.kid) { this.home.car.root.visible = false; this.spawnFamilyCar('leave'); }
          }
          if (o.task === 'feed') {
            this.bowlFull = true;
            g.audio.drop();
            this.say(o, h < 12 ? `Breakfast time, ${name}!` : `Dinner time, ${name}! *shakes the box*`);
          }
        }
      } else {
        o.timer += dt;
        o.model.speed = 0;
        this.idleOwner(o, dt, h);
      }
      // poses while still
      if (!o.path.length) {
        if (o.petT > 0) { o.petT -= dt; o.model.pose = 'pet'; }
        else if (o.still === 'sit') o.model.pose = 'sit';
        else if (o.still === 'lie') o.model.pose = 'lie';
        else if (o.still === 'crouch') o.model.pose = 'crouch';
        else if (o.still === 'call') o.model.pose = 'call';
        else if (o.still === 'phone') o.model.pose = 'phone';
        else o.model.pose = 'stand';
      }
      const inside = this.inHome(o.pos.x, o.pos.z);
      o.pos.y = inside ? this.L.home.y : this.yAt(o.pos.x, o.pos.z);
      if (o.still === 'sit') o.pos.y = this.L.home.y + (o.task === 'tv' ? 0.0 : 0);
      o.model.root.position.copy(o.pos);
      if (o.still === 'lie') { o.model.root.position.y += 0.0; }
      o.model.root.rotation.y = o.heading;
      // face the cat when close and petting / calling
      if ((o.petT > 0 || o.still === 'crouch') && Math.hypot(pp.x - o.pos.x, pp.z - o.pos.z) < 3) o.heading = Math.atan2(pp.x - o.pos.x, pp.z - o.pos.z);
      o.model.update(dt);
      if (o.bubble && o.bubble.until < g.clock) o.bubble = null;
    }
  }

  private idleOwner(o: Owner, dt: number, h: number) {
    const g = this.game;
    const s = this.home.spots;
    const pc = this.pc;
    const name = pc.given;
    if (o.task === 'leave' || o.task === 'leash') return;
    // night: sleep in the big bed
    if ((h >= 22.5 || h < 6.5)) {
      if (o.task !== 'sleep') this.send(o, o.kid ? toWorld(this.home.frame, 4.0, -3.4) : toWorld(this.home.frame, 4.8, -3.4), 'sleep', 'lie');
      else { o.heading = Math.PI + this.home.frame.rot; }
      return;
    }
    // feeding at breakfast and dinner (only if they have a cat!)
    const feedTime = (h >= 7 && h < 7.5) || (h >= 18 && h < 18.5);
    if (feedTime && !o.kid && !this.bowlFull && this.isKittypet && o.task !== 'feed') {
      this.send(o, toWorld(this.home.frame, -4.55, -2.3), 'feed', 'crouch');
      this.say(o, `${name}! Food!`, 3);
      return;
    }
    // kittypet away for a long time: stand in the garden and call for them
    const away = this.isKittypet && !this.ac && Math.hypot(g.player.pos.x - this.L.home.x, g.player.pos.z - this.L.home.z) > 60;
    if (away && h > 18.5 && h < 21.5 && !o.kid) {
      if (o.task !== 'call') this.send(o, s.gate, 'call', 'call');
      else if (o.timer > 6) { o.timer = 0; this.say(o, simRng.pick([`${name}! ${name}! Where are you?`, `Here ${name}, ${name}, ${name}…`, `*shakes the treat bag* ${name}!`]), 4); }
      return;
    }
    // evening TV on the sofa
    if (h >= 19 && h < 22.5 && o.task !== 'tv') { this.send(o, toWorld(this.home.frame, o.kid ? -3.3 : -2.4, 1.15), 'tv', 'sit'); return; }
    if (o.task === 'tv' && h >= 19 && h < 22.5) {
      o.heading = this.home.frame.rot;
      if (o.timer > 20 && simRng.chance(dt * 0.05)) this.say(o, simRng.pick(['*laughs at the glowing box*', 'One more episode…', 'Ooh, a cat video!', `Come sit with me, ${name}.`]));
      return;
    }
    // daytime chores: wander between the kitchen, the desk, the garden, the phone
    if (o.timer > (o.task === 'idle' ? 2 : simRng.range(14, 30))) {
      o.timer = 0;
      const r = simRng.next();
      if (o.kid) {
        if (r < 0.35) { this.send(o, toWorld(this.home.frame, this.yarnPos.x + 0.6, this.yarnPos.y), 'yarn', 'crouch'); }
        else if (r < 0.6 && this.isKittypet && this.inHome(g.player.pos.x, g.player.pos.z)) { this.send(o, { x: g.player.pos.x + 0.8, z: g.player.pos.z + 0.4 }, 'cuddle', 'crouch'); this.say(o, simRng.pick(['KITTY!', `${name}! Come here!`, 'Can I hold you?'])); }
        else if (r < 0.8) this.send(o, toWorld(this.home.frame, 2.6, 3.6), 'tablet', 'phone');
        else this.send(o, toWorld(this.home.frame, simRng.range(-3, 3), simRng.range(6, 9)), 'play', 'stand');
      } else {
        if (r < 0.3) this.send(o, s.kitchen, 'cook', 'stand');
        else if (r < 0.5) this.send(o, s.desk, 'desk', 'phone');
        else if (r < 0.65) this.send(o, toWorld(this.home.frame, simRng.range(-5, 5), simRng.range(5.5, 9)), 'garden', 'crouch');
        else if (r < 0.85) { this.send(o, s.sofa, 'phone', 'sit'); }
        else this.send(o, toWorld(this.home.frame, simRng.range(-5, 0.5), simRng.range(-3, 3.5)), 'tidy', 'phone');
      }
    }
    if (o.task === 'yarn' && o.timer > 1.5 && o.timer < 1.6) { this.yarnVel.set(simRng.range(-2, 2), simRng.range(-2, 2)); this.say(o, 'Get the ball, kitty!', 2); }
    if (o.task === 'cuddle' && o.timer > 1 && o.timer < 1.05 && Math.hypot(g.player.pos.x - o.pos.x, g.player.pos.z - o.pos.z) < 2) { o.petT = 3; g.audio.purr(); }
  }

  /** The family car pulls out of (or into) the driveway. */
  private spawnFamilyCar(mode: 'leave' | 'arrive') {
    const c = this.streetCoords(this.home.spots.car.x, this.home.spots.car.z);
    const v = buildVehicle('car', '#3a6ea8');
    this.game.scene.add(v.root);
    const sign = 1;
    this.cars.push({ v, s: mode === 'leave' ? c.s : -this.L.len / 2 - 15, sign, speed: mode === 'leave' ? 3 : 10, van: false, state: 'drive', stopS: c.s, timer: 0, honked: 0, doors: 0, catcher: null, family: mode });
  }

  // ------------------------------------------------------------------ kittypet life
  private updateKittypet(dt: number) {
    const g = this.game;
    const pc = this.pc;
    if (!this.isKittypet) return;
    const pp = g.player.pos;
    const atHome = Math.hypot(pp.x - this.L.home.x, pp.z - this.L.home.z) < 14;
    if (atHome) {
      if (this.postersUp || this.reunionPending) this.reunion();
      pc.homeSeen = g.time.totalHours;
    }
    // the bell on your collar jingles as you walk — prey hear you coming
    const acc = pc.app.accessories ?? [];
    if (acc.includes('bellCollar') && g.player.speed > 0.8) {
      this.bellT -= dt * g.player.speed;
      g.player.noise = Math.min(1.2, g.player.noise + 0.25);
      if (this.bellT <= 0) { this.bellT = 1.6; g.audio.bell(); }
    }
  }

  private reunion() {
    const g = this.game;
    this.postersUp = false;
    this.reunionPending = false;
    this.street.posters.clear();
    const o = this.owners.find((x) => !x.away && !x.kid) ?? this.owners.find((x) => !x.away);
    if (o) { this.say(o, `${this.pc.given}!! There you are! I was so worried! *hugs you*`, 6); o.petT = 4; }
    g.audio.purr();
    g.ui.toast(this.twoleg('🏠 Your Tallfolk scoop you up and hug you. They missed you! The LOST CAT posters come down.'), 'good');
    this.bowlFull = true;
  }

  // ------------------------------------------------------------------ leash walks
  private startLeash() {
    const g = this.game;
    const o = this.owners.find((x) => !x.kid && !x.away);
    if (!o) return;
    const fr = this.home.frame;
    const pathOut: P2[] = [toWorld(fr, -1.5, 3.6), toWorld(fr, -1.5, 6.0), this.home.spots.gate, this.st(-1.5, 4.4), this.st(55, 4.4), this.st(55, 4.6), this.st(-1.5, 4.4), this.home.spots.gate, toWorld(fr, -1.5, 6.0), toWorld(fr, -1.5, 3.0)];
    this.leash = { t: 0, phase: 0, path: pathOut, warned: false };
    o.task = 'leash';
    o.path = [];
    const mat = new THREE.LineBasicMaterial({ color: '#c8302a' });
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.leashLine = new THREE.Line(geo, mat);
    g.scene.add(this.leashLine);
    g.ui.toast(this.twoleg('🦮 Your Tallfolk clips a jingly leash to your collar. Walkies! You can\'t go further than the leash lets you.'), 'info');
    g.audio.bell();
  }

  private updateLeash(dt: number) {
    const g = this.game;
    if (!this.leash) return;
    const o = this.owners.find((x) => x.task === 'leash');
    if (!o || !this.isKittypet || this.ac) { this.endLeash(); return; }
    const L = this.leash;
    L.t += dt;
    const p = L.path[L.phase];
    if (!p) { this.endLeash(true); return; }
    // the Twoleg waits for a dawdling cat
    const pp = g.player.pos;
    const dist = Math.hypot(pp.x - o.pos.x, pp.z - o.pos.z);
    const speed = dist > 2.0 ? 0.3 : 1.2;
    if (this.headTo(o, p.x, p.z, speed, dt)) { L.phase++; if (L.phase === 5) this.say(o, simRng.pick(['Isn\'t this nice?', 'Good kitty! Look at you walking!', 'Everyone\'s staring at us 😄'])); }
    o.model.pose = 'walk';
    o.model.speed = speed;
    o.pos.y = this.inHome(o.pos.x, o.pos.z) ? this.L.home.y : this.yAt(o.pos.x, o.pos.z);
    o.model.root.position.copy(o.pos);
    o.model.root.rotation.y = o.heading;
    // the leash pulls you along
    const hand = new THREE.Vector3();
    o.model.handR.getWorldPosition(hand);
    const max = 2.3;
    if (dist > max) {
      const k = max / dist;
      pp.x = o.pos.x + (pp.x - o.pos.x) * k;
      pp.z = o.pos.z + (pp.z - o.pos.z) * k;
      if (!L.warned) { L.warned = true; g.ui.toast('The leash tugs at your collar! *jingle*', 'info'); }
    }
    const pts = [hand, new THREE.Vector3(pp.x, pp.y + 0.22 * g.player.scale, pp.z)];
    (this.leashLine!.geometry as THREE.BufferGeometry).setFromPoints(pts);
    if (L.t > 140) this.endLeash(true);
  }

  private endLeash(good = false) {
    const g = this.game;
    if (this.leashLine) { this.leashLine.parent?.remove(this.leashLine); this.leashLine.geometry.dispose(); this.leashLine = null; }
    const o = this.owners.find((x) => x.task === 'leash');
    if (o) { o.task = 'idle'; o.timer = 0; if (good) { this.say(o, 'Good kitty! Here\'s a treat!', 4); o.petT = 2; } }
    if (good) { const pc = this.pc; pc.hunger = Math.min(100, pc.hunger + 20); g.ui.toast('The walk is over. Your Twoleg gives you a crunchy treat!', 'good'); }
    this.leash = null;
  }

  // ------------------------------------------------------------------ walkers with phones
  private spawnWalker(kind: 'street' | 'yard', center?: P2) {
    const g = this.game;
    const kid = simRng.chance(0.2);
    const look = randomLook(() => simRng.next(), kid);
    const model = new TwolegModel(look);
    g.scene.add(model.root);
    const dirSign = simRng.chance(0.5) ? 1 : -1;
    const side = simRng.chance(0.5) ? 1 : -1;
    const s = -dirSign * (this.L.len / 2 - 1);
    let p: P2;
    if (kind === 'street') p = this.st(s + simRng.range(0, 30) * dirSign, side * 4.4);
    else p = { x: center!.x + simRng.range(-9, 9), z: center!.z + simRng.range(-9, 9) };
    const w: Walker = { model, pos: new THREE.Vector3(p.x, 0, p.z), heading: 0, speed: kid ? 1.5 : 1.25, kind, center, side, dirSign, s, mode: 'walk', timer: simRng.range(5, 20), bubble: null, name: kid ? 'Tallfolk kit' : 'Tallfolk', kid, noticed: false };
    this.walkers.push(w);
    return w;
  }

  private updateWalkers(dt: number) {
    const g = this.game;
    const day = g.time.hour > 7 && g.time.hour < 21;
    const street = this.walkers.filter((w) => w.kind === 'street');
    this.walkerTimer -= dt;
    if (day && street.length < 4 && this.walkerTimer <= 0) { this.walkerTimer = simRng.range(4, 14); this.spawnWalker('street'); }
    for (const w of [...this.walkers]) if (w.kind === 'street') this.tickWalker(w, dt);
  }

  private updateYardWalkers(dt: number) {
    const g = this.game;
    const pp = g.player.pos;
    const day = g.time.hour > 8 && g.time.hour < 20;
    // Twolegs pottering around the scattered dens in the wild
    const yard = this.walkers.filter((w) => w.kind === 'yard');
    if (day && yard.length < 2 && simRng.chance(dt * 0.2)) {
      const h = g.chunks.structuresNear(pp.x, pp.z, 70).find((s) => s.type === 'house' && !yard.some((w) => w.center && Math.hypot(w.center.x - s.x, w.center.z - s.z) < 1));
      if (h && Math.hypot(h.x - pp.x, h.z - pp.z) > 20) this.spawnWalker('yard', { x: h.x, z: h.z });
    }
    for (const w of yard) {
      if (!w.center || Math.hypot(w.center.x - pp.x, w.center.z - pp.z) > 100 || !day) { this.removeWalker(w); continue; }
      this.tickWalker(w, dt);
    }
  }

  private removeWalker(w: Walker) { w.model.dispose(); this.walkers.splice(this.walkers.indexOf(w), 1); }

  private tickWalker(w: Walker, dt: number) {
    const g = this.game;
    const pp = g.player.pos;
    const dPlayer = Math.hypot(pp.x - w.pos.x, pp.z - w.pos.z);
    w.timer -= dt;
    // Twolegs spot cats and pull out their phones
    if (!w.noticed && dPlayer < 6 && !g.player.crouching && !this.cutscene) {
      w.noticed = true;
      if (w.kid && simRng.chance(0.6)) { w.mode = 'run'; w.timer = 3.5; this.say(w, simRng.pick(['KITTY!!', 'A cat! Come here, kitty!', 'Mum, look! A kitty!'])); }
      else if (simRng.chance(0.55)) {
        w.mode = 'photo'; w.timer = 2.4;
        this.say(w, simRng.pick(['Aww, look at the kitty! 📸', 'Is that a wild cat?! *click*', 'Hold still, kitty… *click*', this.leash ? 'A cat on a leash?! 😂 *click*' : 'So fluffy! Gotta post this.']));
        setTimeout(() => { if (w.mode === 'photo') { w.model.snap(); this.flash(dPlayer); g.audio.camera(); } }, 900);
      } else this.say(w, simRng.pick(['Hi kitty!', '*doesn\'t look up from the phone*', 'Pspspsps…', '…yeah, I\'ll be home soon.']));
    }
    if (dPlayer > 14) w.noticed = false;
    if (w.mode === 'run') {
      if (w.bubble && /OW|Ouch|Get away|wild|Argh|Yow/i.test(w.bubble.text)) this.headTo(w, w.pos.x + (w.pos.x - pp.x), w.pos.z + (w.pos.z - pp.z), 3, dt);
      else this.headTo(w, pp.x, pp.z, 2.4, dt);
      w.model.pose = 'run';
      if (w.timer <= 0 || dPlayer < 1.2) { w.mode = 'walk'; if (dPlayer < 1.5) this.say(w, 'Aww, it ran away…'); }
    } else if (w.mode === 'photo') {
      w.heading = Math.atan2(pp.x - w.pos.x, pp.z - w.pos.z);
      w.model.pose = 'photo';
      if (w.timer <= 0) w.mode = 'walk';
    } else if (w.mode === 'stop') {
      w.model.pose = simRng.chance(0.001) ? 'call' : w.model.pose === 'call' ? 'call' : 'phone';
      if (w.timer <= 0) { w.mode = 'walk'; w.timer = simRng.range(8, 20); }
    } else {
      // stroll along the pavement, or around a den
      if (w.kind === 'street') {
        w.s += w.dirSign * w.speed * dt;
        const p = this.st(w.s, w.side * 4.4);
        this.headTo(w, p.x, p.z, 4, dt);
        w.heading = Math.atan2(this.L.dir.x * w.dirSign, this.L.dir.z * w.dirSign);
        if (Math.abs(w.s) > this.L.len / 2) { this.removeWalker(w); return; }
      } else {
        if (!w.target || this.headTo(w, w.target.x, w.target.z, w.speed, dt)) w.target = { x: w.center!.x + simRng.range(-11, 11), z: w.center!.z + simRng.range(-11, 11) };
      }
      w.model.pose = 'walk';
      if (w.timer <= 0) { w.mode = 'stop'; w.timer = simRng.range(3, 9); w.model.pose = simRng.chance(0.4) ? 'call' : 'phone'; if (w.model.pose === 'call') this.say(w, simRng.pick(['…no, I said the BLUE one.', 'Hello? Can you hear me?', '…uh huh… uh huh…', 'I\'m almost there!']), 4); }
    }
    w.model.speed = w.mode === 'walk' ? w.speed : w.mode === 'run' ? 2.4 : 0;
    w.pos.y = this.yAt(w.pos.x, w.pos.z) + (this.onRoad(w.pos.x, w.pos.z) || Math.abs(this.streetCoords(w.pos.x, w.pos.z).off) < 5.4 ? 0.1 : 0);
    w.model.root.position.copy(w.pos);
    w.model.root.rotation.y = w.heading;
    w.model.update(dt);
    if (w.bubble && w.bubble.until < g.clock) w.bubble = null;
  }

  private flash(d: number) {
    if (d > 9) return;
    if (!this.flashEl) { this.flashEl = document.createElement('div'); this.flashEl.className = 'photo-flash'; document.body.appendChild(this.flashEl); }
    const el = this.flashEl;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  // ------------------------------------------------------------------ traffic & vans
  private carPos(c: Car): P2 { return this.st(c.s, -c.sign * 1.8); }

  private updateCars(dt: number, nearTown: boolean) {
    const g = this.game;
    const pp = g.player.pos;
    const day = g.time.hour > 6 && g.time.hour < 23;
    this.carTimer -= dt;
    if (nearTown && this.carTimer <= 0 && this.cars.filter((c) => !c.van && !c.family).length < 3) {
      this.carTimer = day ? simRng.range(5, 16) : simRng.range(18, 45);
      const sign = simRng.chance(0.5) ? 1 : -1;
      const v = buildVehicle('car', simRng.pick(['#c8463c', '#3a6ea8', '#e0e0dc', '#2b2b30', '#e0b84a', '#4f8a4a', '#8a8a90']));
      g.scene.add(v.root);
      this.cars.push({ v, s: -sign * (this.L.len / 2 + 15), sign, speed: simRng.range(9, 13), van: false, state: 'drive', stopS: 0, timer: 0, honked: 0, doors: 0, catcher: null });
    }
    const pcS = this.streetCoords(pp.x, pp.z);
    for (const c of [...this.cars]) {
      const target = c.van && c.state === 'drive' ? (Math.abs(c.s - c.stopS) < 12 ? Math.max(1.2, Math.abs(c.s - c.stopS) * 0.8) : 9)
        : c.family === 'arrive' ? (Math.abs(c.s - c.stopS) < 10 ? Math.max(0.8, Math.abs(c.s - c.stopS)) : 9) : c.family === 'leave' ? 9 : c.state === 'leave' ? 10 : 11;
      let want = c.state === 'stop' ? 0 : target;
      // brake for a cat on the Thunderpath
      const ahead = (pcS.s - c.s) * c.sign;
      const inLane = Math.abs(pcS.off + c.sign * 1.8) < 1.6 && Math.abs(pcS.s) < this.L.len / 2 + 10;
      if (inLane && ahead > 0 && ahead < 16 && !this.cutscene) {
        want = Math.min(want, ahead < 7 ? 0 : 3);
        if (g.clock - c.honked > 3) { c.honked = g.clock; g.audio.honk(); }
      }
      c.speed += (want - c.speed) * Math.min(1, dt * (want < c.speed ? 2.5 : 0.8));
      c.s += c.sign * c.speed * dt;
      const p = this.carPos(c);
      const y = this.yAt(p.x, p.z) + 0.05;
      c.v.root.position.set(p.x, y, p.z);
      c.v.root.rotation.y = Math.atan2(-c.sign * this.L.dir.z, c.sign * this.L.dir.x);
      for (const w of c.v.wheels) w.rotation.y += (c.speed * dt) / 0.36 * c.sign;
      c.v.lights.color.set(g.time.darkness > 0.3 ? '#fff6d8' : '#c8c4b8');
      // a moving monster hits a cat that darts in front of it
      if (c.speed > 4 && Math.abs(ahead) < c.v.length / 2 + 0.3 && inLane && g.clan.player.alive && !this.cutscene) this.hitByCar(c);
      if (c.van) this.updateVan(c, dt);
      if (c.family === 'arrive' && Math.abs(c.s - c.stopS) < 0.6) { this.removeCar(c); continue; }
      if (Math.abs(c.s) > this.L.len / 2 + 25) this.removeCar(c);
    }
  }

  private removeCar(c: Car) {
    c.v.root.parent?.remove(c.v.root);
    if (c.catcher) c.catcher.model.dispose();
    this.cars.splice(this.cars.indexOf(c), 1);
  }

  private hitByCar(c: Car) {
    const g = this.game;
    const pc = g.clan.player;
    if (g.clock - ((this as any).hitT ?? -99) < 3) return;
    (this as any).hitT = g.clock;
    g.audio.honk();
    g.audio.hit(true);
    g.player.shake = 1;
    const dmg = 28 + c.speed * 2;
    pc.health -= dmg;
    pc.injury = clamp(pc.injury + 30, 0, 100);
    const n = this.L.nrm;
    const side = this.streetCoords(g.player.pos.x, g.player.pos.z).off > 0 ? 1 : -1;
    g.player.vel.set(n.x * side * 6, 3, n.z * side * 6);
    g.ui.toast('💥 A monster on the Thunderpath slammed into you! Stay off the Thunderpath!', 'danger');
    if (pc.health <= 0) g.clan.kill(pc, 'a monster on the Thunderpath');
  }

  /** Bring an animal-control van to the street. */
  callVan(aimS?: number) {
    const g = this.game;
    if (this.cars.some((c) => c.van) || this.cutscene || this.ac) return false;
    const pp = g.player.pos;
    const ps = this.streetCoords(pp.x, pp.z).s;
    const stopS = clamp(aimS ?? ps, -this.L.len / 2 + 15, this.L.len / 2 - 15);
    const sign = simRng.chance(0.5) ? 1 : -1;
    const v = buildVehicle('van');
    g.scene.add(v.root);
    this.cars.push({ v, s: -sign * (this.L.len / 2 + 15), sign, speed: 9, van: true, state: 'drive', stopS, timer: 0, honked: 0, doors: 0, catcher: null });
    g.audio.engine(0.04);
    return true;
  }

  private vanBack(c: Car): P2 { return this.st(c.s - c.sign * (c.v.length / 2 + 0.8), -c.sign * 1.8); }

  private updateVan(c: Car, dt: number) {
    const g = this.game;
    const pp = g.player.pos;
    // flashing roof lights
    const blink = Math.sin(g.clock * 10) > 0;
    c.v.beacon![0].color.set(blink ? '#ffcc33' : '#5a3a10');
    c.v.beacon![1].color.set(blink ? '#5a3a10' : '#ffcc33');
    if (c.state === 'drive' && Math.abs(c.s - c.stopS) < 0.5 && c.speed < 1.5) {
      c.state = 'stop'; c.timer = 0;
      g.ui.toast(this.twoleg('🚐 A white monster with flashing lights has stopped on the Thunderpath. A Tallfolk climbs out holding a CAT CARRIER! Run!'), 'danger');
      g.audio.alarm();
    }
    const doorTarget = c.state === 'stop' ? 1 : 0;
    c.doors += (doorTarget - c.doors) * Math.min(1, dt * 2);
    c.v.doors![0].rotation.y = c.doors * 1.6;
    c.v.doors![1].rotation.y = -c.doors * 1.6;
    if (c.state === 'stop') {
      c.timer += dt;
      if (!c.catcher && c.timer > 1.2) {
        const look: TwolegLook = { ...randomLook(() => simRng.next()), shirt: '#4a5a6a', pants: '#2d3d5c', hairStyle: 'cap', uniform: true, devices: ['phone'], height: 1.05 };
        const model = new TwolegModel(look);
        model.holdCarrier(true);
        g.scene.add(model.root);
        const b = this.vanBack(c);
        c.catcher = { model, pos: new THREE.Vector3(b.x, 0, b.z), heading: 0, state: 'out', timer: 0, target: null, bubble: null, caught: 0, lost: 0 };
        // a smelly can of tuna set out as bait just behind the open doors
        const bp = this.st(c.s - c.sign * (c.v.length / 2 + 3.2), -c.sign * 1.8 + simRng.range(-0.6, 0.6));
        const mesh = this.baitMesh();
        mesh.position.set(bp.x, this.yAt(bp.x, bp.z) + 0.06, bp.z);
        g.scene.add(mesh);
        c.bait = { mesh, x: bp.x, z: bp.z };
      }
      if (c.catcher) this.updateCatcher(c, c.catcher, dt);
      if (c.timer > 75 && c.catcher?.state !== 'chase') { this.vanLeave(c); }
    }
    // far from the player: just drive on
    if (Math.hypot(pp.x - c.v.root.position.x, pp.z - c.v.root.position.z) > 160 && c.state !== 'leave') this.vanLeave(c);
  }

  private vanLeave(c: Car) {
    if (c.catcher) { c.catcher.model.dispose(); c.catcher = null; }
    if (c.bait) { c.bait.mesh.parent?.remove(c.bait.mesh); c.bait = undefined; }
    c.state = 'leave';
  }

  private catchables(from: P2): { t: Target; pos: P2; d: number; name: string }[] {
    const g = this.game;
    const out: { t: Target; pos: P2; d: number; name: string }[] = [];
    const pp = g.player.pos;
    if (!this.inHome(pp.x, pp.z) && !g.player.sleeping) out.push({ t: { kind: 'player' }, pos: { x: pp.x, z: pp.z }, d: Math.hypot(pp.x - from.x, pp.z - from.z), name: 'you' });
    for (const a of g.npcs.agents.values()) {
      const d = Math.hypot(a.pos.x - from.x, a.pos.z - from.z);
      if (d < 35 && a.activity !== 'fight') out.push({ t: { kind: 'npc', id: a.id }, pos: { x: a.pos.x, z: a.pos.z }, d, name: a.name });
    }
    this.townCats.forEach((t, i) => { if (!t.gone && t.kind === 'stray') out.push({ t: { kind: 'town', idx: i }, pos: { x: t.pos.x, z: t.pos.z }, d: Math.hypot(t.pos.x - from.x, t.pos.z - from.z), name: t.cat.given }); });
    return out.sort((a, b) => a.d - b.d);
  }

  private targetPos(t: Target): P2 | null {
    const g = this.game;
    if (t.kind === 'player') return { x: g.player.pos.x, z: g.player.pos.z };
    if (t.kind === 'npc') { const a = g.npcs.agents.get(t.id); return a ? { x: a.pos.x, z: a.pos.z } : null; }
    const tc = this.townCats[t.idx];
    return tc && !tc.gone ? { x: tc.pos.x, z: tc.pos.z } : null;
  }

  private updateCatcher(c: Car, k: Catcher, dt: number) {
    const g = this.game;
    k.timer += dt;
    const back = this.vanBack(c);
    if ((k.stun ?? 0) > 0) {
      // clutching a bitten hand
      k.stun! -= dt;
      k.model.pose = 'crouch';
      k.model.speed = 0;
      k.pos.y = this.yAt(k.pos.x, k.pos.z) + (Math.abs(this.streetCoords(k.pos.x, k.pos.z).off) < 5.4 ? 0.1 : 0);
      k.model.root.position.copy(k.pos);
      k.model.update(dt);
      if (k.bubble && k.bubble.until < g.clock) k.bubble = null;
      return;
    }
    if (k.state === 'out' || k.state === 'search') {
      if (!k.target || k.timer > 4) {
        const list = this.catchables(back).filter((x) => x.d < 32);
        k.target = list[0]?.t ?? null;
        k.timer = 0;
        if (!k.target) { k.state = 'return'; }
        else { k.state = 'search'; if (simRng.chance(0.5)) this.say(k, simRng.pick(['Here, kitty kitty kitty…', 'Come on, puss. Nobody\'s going to hurt you.', 'Got a report about strays round here…'])); }
      }
      const tp = k.target ? this.targetPos(k.target) : null;
      if (tp) {
        const d = Math.hypot(tp.x - k.pos.x, tp.z - k.pos.z);
        this.headTo(k, tp.x, tp.z, 1.5, dt);
        if (d < 7) { k.state = 'chase'; k.timer = 0; this.say(k, 'Gotcha now…', 2); }
      }
      k.model.pose = 'carry';
      k.model.speed = 1.5;
    } else if (k.state === 'chase') {
      const tp = k.target ? this.targetPos(k.target) : null;
      if (!tp) { k.state = 'search'; k.target = null; }
      else {
        this.headTo(k, tp.x, tp.z, 3.7, dt);
        k.model.pose = 'run';
        k.model.speed = 3.7;
        const d = Math.hypot(tp.x - k.pos.x, tp.z - k.pos.z);
        // a cat that crouches still, far enough away, can be lost
        if (k.target!.kind === 'player' && g.player.crouching && g.player.speed < 0.3 && d > 5.5) { k.lost += dt; if (k.lost > 2.5) { k.state = 'search'; k.target = null; k.timer = 0; this.say(k, 'Where\'d it go?', 3); g.ui.toast('You crouch perfectly still in the shadows… the Twoleg loses sight of you!', 'good'); return; } }
        else k.lost = 0;
        if (d < 0.9) { this.grab(c, k); return; }
        else if (k.timer > 22 || Math.hypot(tp.x - back.x, tp.z - back.z) > 34) { k.state = 'return'; this.say(k, simRng.pick(['Too fast for me…', 'Ugh, forget it.', '*puffs* Next time, kitty.']), 3); }
      }
    } else {
      // back to the van, then drive away
      if (this.headTo(k, back.x, back.z, 1.6, dt)) { this.vanLeave(c); return; }
      k.model.pose = 'carry';
      k.model.speed = 1.6;
    }
    k.pos.y = this.yAt(k.pos.x, k.pos.z) + (Math.abs(this.streetCoords(k.pos.x, k.pos.z).off) < 5.4 ? 0.1 : 0);
    k.model.root.position.copy(k.pos);
    k.model.root.rotation.y = k.heading;
    k.model.update(dt);
    if (k.bubble && k.bubble.until < g.clock) k.bubble = null;
  }

  private grab(c: Car, k: Catcher) {
    const g = this.game;
    const t = k.target!;
    k.target = null;
    k.state = 'return';
    if (t.kind === 'player') {
      // friends close by may be taken too
      const friends: Cat[] = [];
      for (const a of g.npcs.agents.values()) {
        const d = Math.hypot(a.pos.x - g.player.pos.x, a.pos.z - g.player.pos.z);
        if (d < 18 && a.cat.clan === 'home' && a.cat.stage !== 'kit' && simRng.chance(a.activity === 'follow' || g.npcs.isPlayerFriend(a) ? 0.8 : 0.5) && friends.length < 3) friends.push(a.cat);
      }
      for (const f of friends) this.cageCat(f);
      this.vanLeave(c);
      this.captured(friends, false);
      return;
    }
    if (t.kind === 'npc') {
      const a = g.npcs.agents.get(t.id);
      if (!a) return;
      if (simRng.chance(0.45)) { a.say('*twists free and bolts!*', 3); a.setTarget(a.pos.x + (a.pos.x - k.pos.x) * 8, a.pos.z + (a.pos.z - k.pos.z) * 8); a.moveSpeed = 6; this.say(k, 'Argh! Slippery one!'); return; }
      a.say('*yowls* Let me go!!', 3);
      this.cageCat(a.cat);
      g.ui.toast(this.twoleg(`😿 The Tallfolk scooped ${a.name} into a carrier and loaded them into the monster!`), 'danger');
      this.say(k, 'Got one.', 3);
      if (a.cat.clan === 'home') this.rescueObjective(a.cat);
      return;
    }
    const tc = this.townCats[t.idx];
    if (tc) {
      tc.gone = true;
      tc.model.root.visible = false;
      tc.cat.caged = true;
      tc.cat.cagedDay = g.time.day;
      g.ui.toast(this.twoleg(`😿 The Tallfolk caught ${tc.cat.given} the stray and drove off with them.`), 'danger');
    }
  }

  private baitMesh() {
    const g = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14), new THREE.MeshLambertMaterial({ color: '#b8bcc2' }));
    g.add(can);
    const fish = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.012, 14), new THREE.MeshLambertMaterial({ color: '#e89a8a' }));
    fish.position.y = 0.025;
    g.add(fish);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.004, 14), new THREE.MeshLambertMaterial({ color: '#d8dce0' }));
    lid.position.set(0.05, 0.05, 0);
    lid.rotation.z = 1.1;
    g.add(lid);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.071, 0.071, 0.03, 14, 1, true), new THREE.MeshLambertMaterial({ color: '#3a6ea8' }));
    g.add(label);
    return g;
  }

  /** Leave a wire box trap with tuna inside on the pavement. */
  private placeTrap() {
    const g = this.game;
    const ps = this.streetCoords(g.player.pos.x, g.player.pos.z).s;
    const s0 = clamp(ps + simRng.range(-25, 25), -this.L.len / 2 + 10, this.L.len / 2 - 10);
    const side = simRng.chance(0.5) ? 1 : -1;
    const p = this.st(s0, side * 6.3);
    const grp = new THREE.Group();
    const bar = new THREE.MeshLambertMaterial({ color: '#8a8a88' });
    const L = 0.95, W = 0.42, H = 0.42;
    const bars: THREE.BufferGeometry[] = [];
    for (let x = -L / 2; x <= L / 2 + 0.001; x += 0.06) for (const z of [-W / 2, W / 2]) { const b = new THREE.CylinderGeometry(0.004, 0.004, H, 4); b.translate(x, H / 2, z); bars.push(b); }
    for (let x = -L / 2; x <= L / 2 + 0.001; x += 0.06) { const b = new THREE.CylinderGeometry(0.004, 0.004, W, 4); b.rotateX(Math.PI / 2); b.translate(x, H, 0); bars.push(b); }
    for (let y = 0.1; y < H; y += 0.1) for (const z of [-W / 2, W / 2]) { const b = new THREE.CylinderGeometry(0.004, 0.004, L, 4); b.rotateZ(Math.PI / 2); b.translate(0, y, z); bars.push(b); }
    for (let z = -W / 2; z <= W / 2 + 0.001; z += 0.06) { const b = new THREE.CylinderGeometry(0.004, 0.004, H, 4); b.translate(-L / 2, H / 2, z); bars.push(b); }
    const mesh = new THREE.Mesh(mergeGeometriesSafe(bars), bar);
    grp.add(mesh);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 0.01, W), new THREE.MeshLambertMaterial({ color: '#5a5a58' }));
    grp.add(floor);
    const pan = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.2), new THREE.MeshLambertMaterial({ color: '#b8b8b0' }));
    pan.position.set(-0.25, 0.015, 0);
    grp.add(pan);
    const bait = this.baitMesh();
    bait.position.set(-0.36, 0.04, 0);
    bait.scale.setScalar(0.8);
    grp.add(bait);
    // the spring door at the open end, propped up
    const door = new THREE.Group();
    door.position.set(L / 2, H, 0);
    const dbars: THREE.BufferGeometry[] = [];
    for (let z = -W / 2; z <= W / 2 + 0.001; z += 0.06) { const b = new THREE.CylinderGeometry(0.004, 0.004, H, 4); b.translate(0, -H / 2, z); dbars.push(b); }
    door.add(new THREE.Mesh(mergeGeometriesSafe(dbars), bar));
    door.rotation.z = 1.4;
    grp.add(door);
    const ang = Math.atan2(this.L.dir.z, this.L.dir.x);
    grp.rotation.y = -ang;
    grp.position.set(p.x, this.yAt(p.x, p.z) + 0.1, p.z);
    g.scene.add(grp);
    this.trap = { g: grp, door, x: p.x, z: p.z, dirX: this.L.dir.x, dirZ: this.L.dir.z, sprung: false };
  }

  private removeTrap() {
    if (!this.trap) return;
    this.trap.g.parent?.remove(this.trap.g);
    this.trap = null;
  }

  /** You crept into the box trap for the food — SNAP. */
  private springTrap() {
    const g = this.game;
    const t = this.trap!;
    t.sprung = true;
    t.door.rotation.z = 0;
    g.audio.slam();
    g.player.placeAt(t.x - t.dirX * 0.2, t.z - t.dirZ * 0.2);
    g.player.busy = true;
    g.ui.toast('🪤 SNAP! The trap door slams shut behind you! You scrabble at the wire, but it won\'t budge…', 'danger');
    g.audio.meow(1.3, 0.8, 0.06);
    this.lastVan = g.time.totalHours;
    setTimeout(() => {
      g.ui.toast('Headlights. A white monster pulls up, and a Twoleg lifts your trap into the back…', 'danger');
      setTimeout(() => { g.player.busy = false; this.removeTrap(); this.captured([], false); }, 2500);
    }, 3000);
  }

  /** A cat is taken away to the pound. */
  cageCat(cat: Cat) {
    const g = this.game;
    cat.caged = true;
    cat.cagedDay = g.time.day;
    g.npcs.removeAgent(cat.id);
    g.clan.log(`${displayName(cat)} was taken away by a Twoleg monster.`, 'event');
  }

  rescueObjective(cat: Cat) {
    const g = this.game;
    if (g.objectives.has(`tw-rescue-${cat.id}`)) return;
    g.objectives.add({ id: `tw-rescue-${cat.id}`, kind: 'free', title: `Rescue ${displayName(cat)}`, desc: this.twoleg(`${displayName(cat)} was taken by a Tallfolk monster to the rusty pound. Wait on the Thunderpath by the Tallfolk dens for a white monster with flashing lights, and sneak into the back of it to follow them!`), need: 1, data: { rescue: cat.id } });
  }

  // ------------------------------------------------------------------ hourly
  hourTick(hour: number) {
    const g = this.game;
    if (!this.L || !g.clan.player?.alive) return;
    const pc = this.pc;
    const pp = g.player.pos;
    const near = this.nearTown(pp.x, pp.z, 60) && !this.inHome(pp.x, pp.z);
    const vanUp = this.cars.some((c) => c.van);
    const rescue = g.objectives.list.some((o) => o.data?.rescue);
    // vans need a long break between visits (a full day; less when a clanmate needs rescuing)
    const rested = g.time.totalHours - this.lastVan > (rescue ? 8 : 26);
    if (!vanUp && !this.ac && !this.cutscene && near && rested) {
      const night = hour >= 19 || hour < 6;
      const p = rescue ? 0.35 : night ? (this.isKittypet ? 0.16 : 0.22) : (this.isKittypet ? 0.05 : 0.08);
      if (simRng.chance(p) && this.callVan()) this.lastVan = g.time.totalHours;
    }
    // a wire box trap with food in it, left out on the pavement at night
    if (!this.trap && !this.ac && near && (hour >= 20 || hour < 5) && g.time.totalHours - this.lastVan > 12 && simRng.chance(0.1)) this.placeTrap();
    // power cuts: at night or in storms in the Twolegplace, and now and then in the pound
    if (!this.outage) {
      const storm = g.weather.kind === 'thunderstorm';
      const nightT = hour >= 19 || hour < 6;
      if (this.ac && this.inFacility(pp.x, pp.z) && simRng.chance(storm ? 0.25 : 0.07)) this.powerCut(simRng.range(60, 120));
      else if (this.nearTown(pp.x, pp.z, 90) && (nightT || storm) && simRng.chance(storm ? 0.3 : 0.06)) this.powerCut(simRng.range(60, 150));
    }
    // now and then a clanmate who hunts too close to the Thunderpath is taken
    if (!this.ac && simRng.chance(0.004)) {
      const cands = g.clan.home().filter((c) => (c.stage === 'warrior' || c.stage === 'apprentice') && c.role === 'none' && !c.bookId);
      const c = cands.length ? simRng.pick(cands) : null;
      if (c) {
        this.cageCat(c);
        g.ui.toast(this.twoleg(`😿 ${displayName(c)} didn't come back from hunting near the Thunderpath. The patrol found only Tallfolk scent and the tracks of a monster…`), 'danger');
        if (!pc.exiled || pc.lifestyle !== 'clan') this.rescueObjective(c);
      }
    }
    if (hour === 7 && this.trap && !this.trap.sprung) this.removeTrap();
    // caught cats who were never rescued: some escape home, some are taken in by Tallfolk
    if (hour === 7) for (const c of Object.values(g.clan.cats)) {
      if (!c.caged || !c.alive || (this.ac && this.occupants.some((o) => o.cat.id === c.id))) continue;
      if (g.time.day - (c.cagedDay ?? 0) < 7) continue;
      c.caged = false;
      g.objectives.list = g.objectives.list.filter((o) => o.id !== `tw-rescue-${c.id}`);
      if (simRng.chance(0.6)) {
        g.ui.toast(`🐾 ${displayName(c)} limped home! They escaped from the Twolegs all by themselves.`, 'good');
        g.clan.log(`${displayName(c)} escaped from the Twolegs and came home.`, 'event');
      } else {
        c.clan = 'loner';
        c.lifestyle = 'kittypet';
        g.ui.toast(this.twoleg(`💔 News reaches the clan: ${displayName(c)} was taken in by a Tallfolk family. They're a kittypet now.`), 'danger');
        g.clan.log(`${c.given} became a kittypet and never came back.`, 'event');
      }
      g.npcs.syncRoster();
    }
    // kittypet life
    if (this.isKittypet && !this.ac) {
      if ((hour === 8 || hour === 19) && Math.hypot(pp.x - this.L.home.x, pp.z - this.L.home.z) > 20) this.bowlFull = true;
      // away for two days: LOST CAT posters on every lamp post
      const awayH = g.time.totalHours - (pc.homeSeen ?? g.time.totalHours);
      if (awayH > 48 && !this.postersUp) this.putUpPosters();
      // leash walks some mornings and afternoons
      if ((hour === 10 || hour === 16) && this.leashAsked !== g.time.day * 100 + hour && simRng.chance(0.35)) {
        this.leashAsked = g.time.day * 100 + hour;
        const o = this.owners.find((x) => !x.kid && !x.away);
        if (o && Math.hypot(pp.x - this.L.home.x, pp.z - this.L.home.z) < 16 && !this.leash) {
          this.say(o, `Walkies, ${pc.given}! *jingles the leash*`, 5);
          g.ui.choice(this.twoleg('🦮 A walk?'), this.twoleg(`Your Tallfolk holds up a leash and jingles it at you. "Want to go for a walk, ${pc.given}?"`), [
            { label: 'Go for a walk on the leash', action: () => this.startLeash() },
            { label: 'Hide under the bed!', action: () => { this.say(o, 'Oh… maybe later then.', 4); g.ui.toast('You squeeze under the bed until the leash is put away.', 'info'); } },
          ]);
        }
      }
    }
  }

  private putUpPosters() {
    this.postersUp = true;
    const pc = this.pc;
    const tex = makePoster(pc.given, pc.app.base, pc.app.second);
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    for (const p of this.street.posterSpots) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.62), mat);
      const y = this.yAt(p.x, p.z) + 1.5;
      m.position.set(p.x + this.L.nrm.x * 0.1, y, p.z + this.L.nrm.z * 0.1);
      m.rotation.y = Math.atan2(this.L.nrm.x, this.L.nrm.z);
      this.street.posters.add(m);
    }
    this.reunionPending = true;
    this.game.ui.toast(this.twoleg('📄 Your Tallfolk miss you terribly — LOST CAT posters with your picture have appeared all along the Thunderpath.'), 'info');
  }

  // ------------------------------------------------------------------ capture & cutscene
  /** You've been grabbed (or you climbed in as a stowaway): ride to the pound. */
  captured(friends: Cat[], stowaway: boolean) {
    const g = this.game;
    if (this.cutscene) return;
    this.cutscene = true;
    if (this.leash) this.endLeash();
    g.player.busy = true;
    g.player.frozen = true;
    g.combat.disengage(g.player);
    g.ui.closeDialog(false);
    g.input.unlock();
    // who else is already waiting in the pound
    const caged = Object.values(g.clan.cats).filter((c) => c.caged && c.alive && !friends.includes(c));
    const pc = this.pc;
    const riders: Cat[] = [...(stowaway ? [] : [pc]), ...friends];
    const strays = this.townCats.filter((t) => t.cat.caged).map((t) => t.cat);
    const newStrays: Cat[] = [];
    // fill the van: you, the clanmates taken with you, and strays caught on the same round
    const strayRiders = [...strays];
    while (riders.length + strayRiders.length < 3) {
      const st = createCat({ age: simRng.range(10, 40), given: simRng.pick(STRAY_NAMES), day: g.time.day });
      st.clan = 'loner'; st.lifestyle = simRng.chance(0.5) ? 'kittypet' : 'loner'; st.app = randomAppearance(simRng);
      strayRiders.push(st);
    }
    newStrays.push(...strayRiders.filter((x) => !strays.includes(x)));
    const ov = document.createElement('div');
    ov.className = 'van-scene3d';
    ov.innerHTML = `<div class="van-vignette"></div><div class="caption"></div>`;
    document.body.appendChild(ov);
    const scene = new VanCutscene([...riders, ...strayRiders].map((cat) => ({ cat, isPlayer: cat.id === pc.id })), ov, stowaway ? { cat: pc, isPlayer: true } : null, { clank: (v) => g.audio.clank(v), click: () => { g.audio.click(); g.audio.clank(0.6); }, slam: () => g.audio.slam() });
    g.overlay = scene;
    g.ui.showHud(false);
    const cap = ov.querySelector('.caption') as HTMLElement;
    const lines: string[] = stowaway
      ? ['You leap into the back of the monster and hide between the rattling, rusty cages…', 'The doors slam. The monster roars and everything bumps and rattles on the Thunderpath.', 'You hold on with every claw. The air smells of fear and old metal.', 'The monster stops. Cold light. A smell of rust. You slip out unseen…']
      : ['A Tallfolk\'s paws close around you — and you\'re shoved into a rusty cage in the back of the monster!',
        'The monster roars. The cages rattle and bump as it races along the Thunderpath…',
        friends.length ? `${displayName(friends[0])} yowls from the carrier beside you: "${simRng.pick(['We\'ll get out of this, I promise!', 'I\'m scared! Where are they taking us?', 'Stay brave! We\'re together!'])}"` : 'Strange cats cry out from the other cages. You press your nose to the cold, rusty bars.',
        'The monster stops. The doors swing open. Cold light… and the smell of rust and fear.'];
    // a medicine cat caught with you uses whatever they have to help
    const med = friends.find((f) => f.role === 'medicine' || f.role === 'medicineApprentice');
    if (med && !stowaway) {
      const store = g.clan.herbStore;
      const herb = (['sunpetal', 'silverleaf', 'bitterroot'] as const).find((k) => store[k] > 0) ?? null;
      const herbName = herb ? ({ sunpetal: 'a sunpetal leaf', silverleaf: 'some silverleaf', bitterroot: 'a sprig of bitterroot' } as const)[herb] : null;
      lines.splice(lines.length - 1, 0, herbName
        ? `${displayName(med)} squeezes a paw through the bars: "Hold still." They press ${herbName} they had tucked in their fur onto your scratches.`
        : `${displayName(med)} has no herbs with them, but they reach through the bars and lick your wounds clean. "We'll be alright."`);
      (this as any).medHelp = { herb, id: med.id };
    }
    lines.forEach((l, i) => setTimeout(() => { cap.textContent = this.twoleg(l); cap.classList.remove('in'); void cap.offsetWidth; cap.classList.add('in'); }, i * 2600));
    for (let i = 0; i < 5; i++) setTimeout(() => { g.audio.engine(0.05); if (i % 2) g.audio.meow(0.9 + Math.random() * 0.4, 0.5, 0.04); }, i * 2000);
    setTimeout(() => {
      ov.classList.add('out');
      setTimeout(() => { ov.remove(); g.overlay = null; scene.dispose(); g.ui.showHud(true); this.cutscene = false; this.arriveAtPound(friends, caged, [...strays, ...newStrays], stowaway); }, 700);
    }, lines.length * 2600 + 600);
  }

  /** Loaded a save made inside the pound: pick up the escape where it was. */
  resumePound() {
    const caged = Object.values(this.game.clan.cats).filter((c) => c.caged && c.alive);
    this.arriveAtPound([], caged, [], true);
  }

  private arriveAtPound(friends: Cat[], caged: Cat[], strays: Cat[], stowaway: boolean) {
    const g = this.game;
    const pc = this.pc;
    for (const o of this.occupants) o.model?.dispose();
    this.occupants = [];
    const cages = this.fac.cages;
    cages.forEach((c) => (c.open = false));
    const used = new Set<number>();
    const put = (cat: Cat, idx: number, stray: boolean, player = false) => {
      used.add(idx);
      const cg = cages[idx];
      const model = player ? null : new CatModel(cat.app, cat.stage);
      if (model) g.scene.add(model.root);
      this.occupants.push({ cat, model, cage: idx, freed: false, pos: new THREE.Vector3(cg.inner.x + simRng.range(-0.2, 0.2), this.fac.y, cg.inner.z), heading: Math.PI / 2, stray, player });
    };
    if (!stowaway) put(pc, 0, false, true);
    friends.forEach((f, i) => put(f, 1 + i, false));
    let next = 1 + friends.length;
    for (const c of caged) { if (next >= cages.length) break; put(c, next++, false); }
    for (const c of strays) { if (next >= cages.length) break; put(c, next++, true); }
    // always a couple of sad strays waiting here
    while (next < 5) {
      const s = createCat({ age: simRng.range(10, 50), given: simRng.pick(STRAY_NAMES), day: g.time.day });
      s.clan = 'loner';
      s.lifestyle = simRng.chance(0.5) ? 'kittypet' : 'loner';
      s.app = randomAppearance(simRng);
      put(s, next++, true);
    }
    this.ac = { cage: stowaway ? null : 0, latch: 0, need: 9, vent: 0, ventOpen: false, since: g.time.totalHours, fedAt: -99, seen: 0, ownerCame: false };
    this.fac.vent.cover.rotation.z = 0;
    this.fac.vent.cover.position.y = 0.02;
    // the worker
    if (!this.worker) {
      const look: TwolegLook = { ...randomLook(() => simRng.next()), shirt: '#4a5a6a', pants: '#2d3d5c', uniform: true, devices: ['phone'], hairStyle: 'short', height: 1.04 };
      const model = new TwolegModel(look);
      g.scene.add(model.root);
      const d = this.fac.desk;
      this.worker = { model, pos: new THREE.Vector3(d.x, this.fac.y, d.z), heading: 0, state: 'desk', timer: 0, wp: 0, bubble: null };
    }
    g.chunks.primeAround(this.fac.frame.x, this.fac.frame.z);
    if (stowaway) {
      const p = toWorld(this.fac.frame, -6.8, 4.5);
      g.player.placeAt(p.x, p.z, Math.atan2(0, 1));
    } else {
      const cg = cages[0];
      g.player.placeAt(cg.inner.x, cg.inner.z, Math.PI);
      g.player.pitch = -0.12;
    }
    g.player.busy = false;
    g.player.frozen = false;
    g.time.totalHours += 1;
    g.input.lock();
    const n = this.occupants.filter((o) => !o.player).length;
    g.ui.showBanner(this.twoleg(stowaway
      ? `You're inside the rusty Tallfolk pound. ${n} cats are locked in cages along the wall. Open their latches, then find a way out — the old vent in the wall looks loose…`
      : `You've been locked in a cage at the rusty Tallfolk pound! ${n} other cats are caged here too. Wiggle the latch (E) when the Tallfolk isn't looking, free the others, and find a way out.`), 12);
    // the medicine cat's help takes effect
    const mh = (this as any).medHelp as { herb: 'sunpetal' | 'silverleaf' | 'bitterroot' | null; id: string } | undefined;
    if (mh) {
      (this as any).medHelp = undefined;
      const medCat = g.clan.get(mh.id);
      if (mh.herb) {
        g.clan.herbStore[mh.herb] = Math.max(0, g.clan.herbStore[mh.herb] - 1);
        pc.health = Math.min(pc.maxHealth, pc.health + 40);
        pc.injury = Math.max(0, pc.injury - 45);
        pc.sick = Math.max(0, pc.sick - 30);
      } else {
        pc.health = Math.min(pc.maxHealth, pc.health + 15);
        pc.injury = Math.max(0, pc.injury - 15);
      }
      if (medCat) g.clan.adjust(pc, medCat, 8, { text: `${medCat.given} tended my wounds in the Twoleg monster.`, weight: 4 });
      setTimeout(() => g.ui.toast(mh.herb ? `🌿 ${medCat ? displayName(medCat) : 'The medicine cat'}'s herbs ease your pain. (health +40)` : `💛 ${medCat ? displayName(medCat) : 'The medicine cat'} licked your wounds clean. (health +15)`, 'good'), 1500);
    }
    g.objectives.add({ id: 'tw-escape', kind: 'free', title: '🔓 Escape the Twoleg pound', desc: this.twoleg('Wiggle your cage latch while the Tallfolk isn\'t watching (they get distracted by their phone at the desk). Open the other cages, then squeeze out through the loose vent in the wall.'), need: 1 });
    g.objectives.focus('tw-escape');
    g.clan.remember(pc, stowaway ? 'I sneaked into a Twoleg monster to rescue my friends.' : 'I was caught by Twolegs and locked in a cage.', -3);
  }

  // ------------------------------------------------------------------ the pound
  private workerWatching(): boolean {
    const w = this.worker;
    if (!w || w.state === 'away') return false;
    const pp = this.game.player.pos;
    if (this.outage?.where === 'pound') {
      // pitch dark: only the torch beam can find you
      if (!w.model.torchOn || w.state === 'desk') return false;
      const d0 = Math.hypot(pp.x - w.pos.x, pp.z - w.pos.z);
      const dot0 = ((pp.x - w.pos.x) * Math.sin(w.heading) + (pp.z - w.pos.z) * Math.cos(w.heading)) / Math.max(d0, 0.01);
      return d0 < 6.5 && dot0 > 0.88;
    }
    const d = Math.hypot(pp.x - w.pos.x, pp.z - w.pos.z);
    if (w.state === 'desk') return d < 2.5;
    if (d > 7.5) return false;
    const fx = Math.sin(w.heading), fz = Math.cos(w.heading);
    const dot = ((pp.x - w.pos.x) * fx + (pp.z - w.pos.z) * fz) / Math.max(d, 0.01);
    return dot > 0.35;
  }

  private updateFacility(dt: number) {
    const g = this.game;
    const ac = this.ac;
    const pp = g.player.pos;
    const cages = this.fac.cages;
    // cage doors swing
    for (const c of cages) c.door.rotation.y += ((c.open ? -1.7 : 0) - c.door.rotation.y) * Math.min(1, dt * 3);
    if (!ac) return;
    // keep the player inside their cage until the latch gives
    if (ac.cage !== null) {
      const cg = cages[ac.cage];
      const l = toLocal(this.fac.frame, pp.x, pp.z);
      const cx = cg.x, cz = cg.z;
      if (!cg.open) {
        const nx = clamp(l.x, cx - 0.7, cx + 0.7), nz = clamp(l.z, cz - 0.6, cz + 0.6);
        if (nx !== l.x || nz !== l.z) { const w = toWorld(this.fac.frame, nx, nz); pp.x = w.x; pp.z = w.z; }
      } else if (!this.inCage(pp.x, pp.z, ac.cage)) ac.cage = null;
    }
    // the worker
    const w = this.worker!;
    const h = g.time.hour;
    w.timer -= dt;
    const night = h >= 21 || h < 7;
    if (night && w.state !== 'away' && w.state !== 'chase') { w.state = 'away'; this.say(w, 'Night, kitties. *jingles keys*', 3); }
    if (!night && w.state === 'away') { w.state = 'desk'; const d = this.fac.door; w.pos.set(d.x, this.fac.y, d.z); }
    const outside = ac.cage === null || cages[ac.cage].open;
    const pOut = outside && !this.inAnyCage(pp.x, pp.z);
    if (w.state === 'away') { w.model.root.visible = false; }
    else {
      w.model.root.visible = true;
      if (w.state === 'desk') {
        const d = this.fac.desk;
        this.headTo(w, d.x, d.z, 1.3, dt);
        w.model.pose = Math.hypot(d.x - w.pos.x, d.z - w.pos.z) < 0.2 ? 'sit' : 'walk';
        if (w.model.pose === 'sit') w.heading = Math.PI;
        if (w.timer <= 0) { w.state = 'round'; w.wp = 0; w.timer = 40; if (simRng.chance(0.5)) this.say(w, simRng.pick(['Feeding time.', 'Right, let\'s check on you lot.', '*sighs* Another long shift.'])); }
        if (simRng.chance(dt * 0.05)) this.say(w, simRng.pick(['*scrolls on phone*', '*laughs at a video*', '*yawns*', '…yeah, the pound\'s full again.']), 3);
      } else if (w.state === 'round') {
        const xs = [-6, -4, -2, 0, 2, 4, 6];
        const p = toWorld(this.fac.frame, xs[w.wp % 7], -6 + 2.3);
        if (this.headTo(w, p.x, p.z, 1.1, dt)) { w.wp++; if (w.wp >= 7) { w.state = 'desk'; w.timer = simRng.range(25, 50); ac.fedAt = g.time.totalHours; } }
        w.model.pose = 'walk';
      } else if ((w.stun ?? 0) > 0) {
        w.stun! -= dt;
        w.model.pose = 'crouch';
      } else if (w.state === 'chase') {
        this.headTo(w, pp.x, pp.z, 2.5, dt);
        w.model.pose = 'run';
        if (Math.hypot(pp.x - w.pos.x, pp.z - w.pos.z) < 0.8) this.putBack();
        else if (w.timer <= 0) { w.state = 'desk'; w.timer = 20; this.say(w, '*pants* Where did it go…', 3); }
      }
      if (pOut && w.state !== 'chase' && this.workerWatching() && !this.inVent(pp.x, pp.z)) {
        w.state = 'chase'; w.timer = 9;
        this.say(w, simRng.pick(['Hey! How did you get out?!', 'Oi! Back in your cage!', 'Come here, you little escape artist!']), 3);
        g.audio.alarm();
      }
      w.model.speed = w.model.pose === 'run' ? 2.5 : 1.1;
      w.pos.y = this.fac.y;
      w.model.root.position.copy(w.pos);
      w.model.root.rotation.y = w.heading;
      w.model.update(dt);
      if (w.bubble && w.bubble.until < g.clock) w.bubble = null;
    }
    // caged and freed cats
    let i = 0;
    for (const o of this.occupants) {
      if (o.player || !o.model) continue;
      const cg = cages[o.cage];
      if (o.freed) {
        const f = g.player.forward();
        const tx = pp.x - f.x * (1.1 + i * 0.7) + Math.sin(i * 2.3) * 0.5, tz = pp.z - f.z * (1.1 + i * 0.7) + Math.cos(i * 2.3) * 0.5;
        const d = Math.hypot(tx - o.pos.x, tz - o.pos.z);
        const moving = d > 0.4;
        if (moving) this.headToCat(o, tx, tz, Math.min(5, d * 2.2), dt);
        o.model.pose = moving ? 'walk' : 'sit';
        o.model.speed = moving ? Math.min(5, d * 2.2) : 0;
        i++;
      } else {
        o.model.pose = cg.open ? 'stand' : (Math.sin(g.clock * 0.3 + o.cage) > 0.4 ? 'lie' : 'sit');
        o.heading = Math.atan2(pp.z - o.pos.z, pp.x - o.pos.x);
        if (simRng.chance(dt * 0.02)) g.audio.meow(0.8 + Math.random() * 0.5, 0.6, 0.02, o.pos);
      }
      o.pos.y = this.fac.y;
      o.model.root.position.copy(o.pos);
      o.model.root.rotation.y = -o.heading;
      o.model.update(dt);
    }
    // a freed medicine cat following you patches you up when you're hurt
    const medOcc = this.occupants.find((o) => o.freed && (o.cat.role === 'medicine' || o.cat.role === 'medicineApprentice'));
    if (medOcc && this.pc.health < this.pc.maxHealth * 0.6 && g.clock - ((this as any).medT ?? -99) > 45) {
      (this as any).medT = g.clock;
      const store = g.clan.herbStore;
      const herb = (['sunpetal', 'silverleaf', 'bitterroot'] as const).find((k) => store[k] > 0);
      if (herb) store[herb]--;
      this.pc.health = Math.min(this.pc.maxHealth, this.pc.health + (herb ? 30 : 12));
      this.pc.injury = Math.max(0, this.pc.injury - (herb ? 30 : 10));
      g.audio.purr();
      g.ui.toast(herb ? `🌿 ${medOcc.cat.given} pulls a herb from their fur and chews it onto your wounds.` : `💛 ${medOcc.cat.given} has nothing left, but licks your wounds until they sting less.`, 'good');
    }
    // a kittypet's family comes looking for them
    if (this.isKittypet && !ac.ownerCame && g.time.totalHours - ac.since > 20 && !night) {
      ac.ownerCame = true;
      g.ui.choice(this.twoleg('🏠 Your Tallfolk came!'), this.twoleg(`The door bangs open and your own Tallfolk rushes in, waving one of your LOST CAT posters. "${this.pc.given}! Oh, thank goodness!" They can take you home right now — but the other cats would stay locked up.`), [
        { label: 'Go home with them', action: () => this.escape('owner') },
        { label: 'Hide — I have to free the others first', action: () => g.ui.toast('You squeeze to the back of your cage. Your Tallfolk leaves sadly… you\'ll have to find your own way out.', 'info') },
      ]);
    }
    // waiting too long: a family wants to adopt you
    if (!this.isKittypet && ac.cage !== null && g.time.totalHours - ac.since > 60 && !(ac as any).adoptAsked && !night) {
      (ac as any).adoptAsked = true;
      g.ui.choice(this.twoleg('🏠 A Tallfolk family'), this.twoleg('A Tallfolk family stops in front of your cage. The smallest one presses a paw to the wire. "This one! Can we take this one home?"'), [
        { label: 'Purr at them (become a kittypet)', action: () => this.escape('adopted') },
        { label: 'Hiss! I belong in the wild', action: () => g.ui.toast('You hiss and puff up your fur. The family moves on to another cage.', 'info') },
      ]);
    }
  }

  private inCage(x: number, z: number, i: number) {
    const l = toLocal(this.fac.frame, x, z);
    const c = this.fac.cages[i];
    return Math.abs(l.x - c.x) < 0.85 && Math.abs(l.z - c.z) < 0.75;
  }
  private inAnyCage(x: number, z: number) { return this.fac.cages.some((_, i) => this.inCage(x, z, i)); }
  private inVent(x: number, z: number) { return Math.hypot(x - this.fac.vent.inside.x, z - this.fac.vent.inside.z) < 0.6 && !!this.ac?.ventOpen; }

  private putBack() {
    const g = this.game;
    const ac = this.ac!;
    const w = this.worker!;
    const own = this.occupants.find((o) => o.player)?.cage ?? this.fac.cages.findIndex((c, i) => !this.occupants.some((o) => o.cage === i && !o.freed));
    const idx = Math.max(0, own);
    const cg = this.fac.cages[idx];
    cg.open = false;
    ac.cage = idx;
    ac.latch = 0;
    ac.need += 4;
    ac.seen++;
    w.state = 'desk';
    w.timer = 30;
    g.player.placeAt(cg.inner.x, cg.inner.z, Math.PI);
    this.say(w, 'Back you go. And I\'m tying that latch with wire this time.', 4);
    g.ui.toast('The Tallfolk scoops you up and locks you back in your cage — the latch is tighter now.', 'danger');
    g.audio.rattle();
  }

  /** You bite or scratch a Twoleg in front of you. Returns true if you hit one. */
  playerAttack(heavy: boolean, reach: number): boolean {
    const g = this.game;
    if (!this.L) return false;
    const pp = g.player.pos;
    const f = g.player.forward();
    type Hit = { pos: THREE.Vector3; model: TwolegModel; kind: 'catcher' | 'walker' | 'owner' | 'worker'; ref: any };
    const list: Hit[] = [];
    for (const c of this.cars) if (c.catcher) list.push({ pos: c.catcher.pos, model: c.catcher.model, kind: 'catcher', ref: c.catcher });
    for (const w of this.walkers) list.push({ pos: w.pos, model: w.model, kind: 'walker', ref: w });
    for (const o of this.owners) if (!o.away) list.push({ pos: o.pos, model: o.model, kind: 'owner', ref: o });
    if (this.worker && this.worker.state !== 'away') list.push({ pos: this.worker.pos, model: this.worker.model, kind: 'worker', ref: this.worker });
    let best: Hit | null = null, bd = reach;
    for (const h of list) {
      const dx = h.pos.x - pp.x, dz = h.pos.z - pp.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || (d > 0.4 && (dx * f.x + dz * f.z) / d < 0.25)) continue;
      best = h; bd = d;
    }
    if (!best) return false;
    const h = best;
    g.audio.hiss();
    g.audio.hit(heavy);
    g.ui.floatText(heavy ? '*CHOMP!*' : '*SCRATCH!*', '#ff9a7a');
    g.combat.puff(new THREE.Vector3(h.pos.x, h.pos.y + (heavy ? 0.5 : 0.25), h.pos.z), 8, 0.2);
    // the Twoleg stumbles back
    const dx = h.pos.x - pp.x, dz = h.pos.z - pp.z, d = Math.max(0.1, Math.hypot(dx, dz));
    h.pos.x += (dx / d) * 0.5; h.pos.z += (dz / d) * 0.5;
    const ouch = simRng.pick(['OW!', 'Ouch! It bit me!', 'Argh, my ankle!', 'Yow! Bad kitty!']);
    // Twolegs fight back: a kick, a swat, a shove
    const fightBack = (chance: number, dmg: number, what: string) => {
      if (!simRng.chance(chance)) return;
      setTimeout(() => {
        if (g.state !== 'playing') return;
        const p2 = g.player.pos;
        if (Math.hypot(p2.x - h.pos.x, p2.z - h.pos.z) > 2.2) { g.ui.floatText('*dodged!*', '#cfe'); return; }
        const pc = g.clan.player;
        pc.health -= dmg;
        pc.injury = clamp(pc.injury + dmg * 0.8, 0, 100);
        const ex = p2.x - h.pos.x, ez = p2.z - h.pos.z, ed = Math.max(0.1, Math.hypot(ex, ez));
        g.player.vel.set((ex / ed) * 5, 2.4, (ez / ed) * 5);
        g.player.shake = 0.8;
        g.audio.hurt();
        h.model.pose = 'crouch';
        g.ui.toast(what, 'danger');
        if (pc.health <= 0) g.clan.kill(pc, 'a Twoleg\'s kick');
      }, 450);
    };
    if (h.kind === 'catcher') {
      const k = h.ref as Catcher;
      k.hurt = (k.hurt ?? 0) + (heavy ? 2 : 1);
      k.stun = heavy ? 2.2 : 1.3;
      if (k.hurt >= 3 || simRng.chance(heavy ? 0.45 : 0.2)) {
        k.state = 'return'; k.target = null;
        this.say(k, simRng.pick(['Forget it! That one\'s feral!', 'I\'m not paid enough for this!', 'Ow ow ow — I\'m done!']), 4);
        g.ui.toast('🐾 You bit and scratched the Twoleg until they gave up! They limp back to their monster.', 'good');
        g.clan.player.reputation = clamp(g.clan.player.reputation + 1, -100, 100);
      } else {
        this.say(k, simRng.pick([ouch, 'You little — get OFF!', 'Right, that\'s it!']), 2);
        k.stun = Math.min(k.stun!, 0.6);
        fightBack(heavy ? 0.65 : 0.45, heavy ? 14 : 9, simRng.pick(['💢 The Twoleg kicks out and sends you tumbling!', '💢 A big Twoleg paw swats you across the road!', '💢 The Twoleg shoves you away with their boot!']));
      }
      return true;
    }
    if (h.kind === 'worker') {
      const w = h.ref;
      w.stun = heavy ? 3.5 : 2;
      w.state = 'chase'; w.timer = 9;
      this.say(w, simRng.pick(['ARGH! My hand!', 'You little monster!', 'OW! That\'s it, you\'re going back in!']), 3);
      if (simRng.chance(0.45)) { w.stun = 0.4; fightBack(1, heavy ? 12 : 8, '💢 The worker swings the broom and knocks you sideways!'); }
      else g.ui.toast('The worker clutches their hand — run while you can!', 'good');
      return true;
    }
    if (h.kind === 'walker') {
      const w = h.ref as Walker;
      if (!w.kid && simRng.chance(0.35)) { this.say(w, simRng.pick(['Hey! Bad cat!', 'Get away! *kicks*', 'Shoo! SHOO!']), 3); fightBack(1, heavy ? 9 : 6, '💢 The Twoleg kicks at you and catches your side!'); return true; }
      w.mode = 'run'; w.timer = 2.5; w.target = undefined;
      this.say(w, simRng.pick([ouch, 'Get away from me!', 'That cat is wild! Someone call animal control!']), 3);
      // the walker runs off, and might report a wild cat
      w.dirSign = -w.dirSign;
      if (simRng.chance(0.3) && !this.cars.some((c) => c.van)) setTimeout(() => { if (g.state === 'playing' && this.nearTown(g.player.pos.x, g.player.pos.z, 60)) this.callVan(); }, 15000);
      return true;
    }
    // your own family
    const o = h.ref as Owner;
    o.petT = 0;
    this.say(o, this.isKittypet ? simRng.pick([`Ow! ${this.pc.given}, what's gotten into you?`, 'Hey! No biting!', '*sniffles* That hurt…']) : ouch, 3);
    if (this.isKittypet && o.kid) g.ui.toast('The little Twoleg starts to cry. You feel a bit bad.', 'info');
    else if (!this.isKittypet) fightBack(0.6, heavy ? 8 : 5, '💢 The Twoleg shoves you away with their foot!');
    else g.ui.toast('Your Twoleg pushes you away. "No biting!"', 'info');
    return true;
  }

  /** Interaction prompt for anything Twoleg-related near the player. */
  prompt(): Prompt | null {
    const g = this.game;
    if (!this.L) return null;
    const pp = g.player.pos;
    const pc = this.pc;
    const near = (p: P2, r: number) => Math.hypot(pp.x - p.x, pp.z - p.z) < r * Math.max(0.8, g.player.scale);
    const ac = this.ac;
    if (ac && this.inFacility(pp.x, pp.z)) {
      const watching = this.workerWatching();
      if (ac.cage !== null && !this.fac.cages[ac.cage].open) {
        const cg = this.fac.cages[ac.cage];
        if (near(cg.bowl, 0.9) && g.time.totalHours - ((ac as any).ateAt ?? -99) > 6) return { text: 'Eat the dry Twoleg food in the bowl', action: () => { (ac as any).ateAt = g.time.totalHours; pc.hunger = 100; g.interactions.drink(100); g.audio.eat(); g.ui.toast('The food is dry and tastes of nothing, but it fills your belly. You lap the stale water too.', 'info'); } };
        return { text: `Wiggle the latch with your paw (${ac.latch}/${ac.need})${watching ? ' — the Twoleg is WATCHING!' : ''}`, action: () => this.wiggle() };
      }
      for (let i = 0; i < this.fac.cages.length; i++) {
        const cg = this.fac.cages[i];
        const occ = this.occupants.find((o) => o.cage === i && !o.player && !o.freed);
        if (!occ || !near(cg.front, 1.1)) continue;
        return { text: `Open ${occ.cat.given}'s cage${watching ? ' (the Twoleg is watching!)' : ''}`, action: () => this.freeCat(occ) };
      }
      if (near(this.fac.vent.inside, 1.2)) {
        if (!ac.ventOpen) return { text: `Pry at the loose, rusty vent cover (${ac.vent}/4)`, action: () => this.pryVent() };
        return { text: 'Squeeze through the vent and escape!', action: () => this.escape('vent') };
      }
      if (near(this.fac.door, 1.5)) return { text: 'Scratch at the door (it\'s locked)', action: () => { g.audio.swipe(); g.ui.toast('The metal door is locked tight. The Twoleg has the key. There must be another way out…', 'info'); } };
      return null;
    }
    // bait set out by the van: a trick!
    for (const c of this.cars) {
      if (!c.bait || !near(c.bait, 1.0)) continue;
      const bait = c.bait;
      return { text: '🐟 Eat the delicious-smelling tuna', action: () => {
        const k = c.catcher;
        const watching = k && k.state !== 'return' && Math.hypot(k.pos.x - bait.x, k.pos.z - bait.z) < 10 && (k.stun ?? 0) <= 0;
        bait.mesh.parent?.remove(bait.mesh);
        c.bait = undefined;
        g.audio.eat();
        if (watching) {
          this.say(k!, 'Gotcha! Works every time.', 3);
          g.ui.toast('🐟 It was a TRAP! While you gulp the tuna, the Twoleg grabs you from behind!', 'danger');
          this.vanLeave(c);
          this.captured([], false);
        } else {
          pc.hunger = Math.min(100, pc.hunger + 50);
          g.ui.toast('You gobble the tuna while the Twoleg isn\'t looking. Delicious — and risky!', 'good');
        }
      } };
    }
    // a wire box trap with food inside
    if (this.trap && !this.trap.sprung) {
      const t = this.trap;
      const mouth = { x: t.x + t.dirX * 0.7, z: t.z + t.dirZ * 0.7 };
      if (near(mouth, 0.9) || near(t, 0.7)) return { text: '🐟 Creep inside the wire box to get the food', action: () => this.springTrap() };
    }
    // the parked animal-control van: sneak in the back
    for (const c of this.cars) {
      if (!c.van || c.state !== 'stop' || c.doors < 0.7) continue;
      if (near(this.vanBack(c), 2.4) && c.catcher?.state !== 'chase') return { text: '🚐 Sneak into the back of the monster', action: () => { this.vanLeave(c); c.state = 'leave'; this.captured([], true); } };
    }
    // town cats
    for (const t of this.townCats) {
      if (t.gone || !near(t.pos, 1.6)) continue;
      return { text: `Talk to ${t.cat.given}${t.cat.lifestyle === 'kittypet' ? ' (kittypet)' : ' (loner)'}`, action: () => this.talkTownCat(t) };
    }
    // nests
    if (pc.lifestyle === 'loner' && near(this.L.nest.loner, 1.2)) return { text: 'Curl up in your mossy nest', action: () => g.sleep() };
    if (pc.lifestyle === 'rogue' && near(this.L.nest.rogue, 1.2)) return { text: 'Curl up in your bramble den', action: () => g.sleep() };
    // the kittypet home
    if (!this.home || Math.hypot(pp.x - this.L.home.x, pp.z - this.L.home.z) > 14) return null;
    const s = this.home.spots;
    const kp = this.isKittypet;
    for (const o of this.owners) {
      if (o.away || o.task === 'sleep' || !near(o.pos, 1.5)) continue;
      return { text: kp ? `Rub against ${this.ownerLabel(o)}'s legs` : this.twoleg('Sniff the Tallfolk'), action: () => this.petOwner(o) };
    }
    if (near(s.food, 0.75)) {
      if (this.bowlFull) return { text: kp ? 'Eat from your bowl' : 'Eat the kittypet food (yuck… or yum?)', action: () => this.eatBowl() };
      return { text: kp ? 'Meow for food (your bowl is empty)' : 'The bowl is empty', action: () => this.meowForFood() };
    }
    if (near(s.water, 0.7)) return { text: kp ? 'Drink from your water bowl' : 'Drink from the kittypet bowl', action: () => g.interactions.drink(100) };
    if (near(s.bed, 0.8)) return { text: kp ? 'Curl up in your cosy bed' : 'Curl up in the soft kittypet bed', action: () => g.sleep() };
    if (near(s.tree, 1.0)) return { text: 'Scratch the cat tree', action: () => { g.audio.swipe(); g.player.stamina = 100; pc.strength = Math.min(100, pc.strength + 0.3); g.ui.toast(simRng.pick(['*scritch scratch* Your claws feel sharp and ready.', 'You stretch up the post and sink your claws in. Bliss.', 'You scratch until the sisal frays.']), 'good'); } };
    if (near(s.window, 1.0)) return { text: 'Watch the birds through the window', action: () => { g.ui.toast(simRng.pick(['A sparrow hops on the sill. Your tail twitches. *ek-ek-ek*', 'You chatter at a pigeon on the fence. It ignores you.', 'You watch the forest beyond the fences. It smells wild and exciting…']), 'info'); g.audio.meow(1.4, 0.2, 0.02); } };
    const yarnW = toWorld(this.home.frame, this.yarnPos.x, this.yarnPos.y);
    if (near(yarnW, 0.8)) return { text: 'Bat the yarn ball', action: () => { const f = g.player.forward(); const l = toLocal({ x: 0, z: 0, rot: this.home.frame.rot }, f.x, f.z); this.yarnVel.set(l.x * 3, l.z * 3); g.audio.swipe(); } };
    if (near(s.tv, 1.0) && this.owners.some((o) => o.task === 'tv' && o.still === 'sit')) return { text: 'Stare at the flickering box', action: () => g.ui.toast(simRng.pick(['Tiny Twolegs are running around inside the glowing box. How did they get in there?', 'A bird flies across the box! You pounce at it — *bonk*. It\'s flat.', 'The box is showing… cats! You tilt your head.']), 'info') };
    return null;
  }

  private wiggle() {
    const g = this.game;
    const ac = this.ac!;
    g.audio.rattle();
    if (this.workerWatching()) {
      ac.latch = Math.max(0, ac.latch - 2);
      this.say(this.worker!, 'Stop that rattling, you!', 2);
      g.ui.toast('The Twoleg is looking right at you! Wait until they turn away or get busy with their phone.', 'danger');
      return;
    }
    ac.latch++;
    g.player.shake = 0.15;
    if (ac.latch >= ac.need) {
      const cg = this.fac.cages[ac.cage!];
      cg.open = true;
      g.audio.success();
      g.ui.toast('*clink!* The rusty latch gives way and your cage door creaks open. Now free the others!', 'good');
    } else if (ac.latch === Math.floor(ac.need / 2)) g.ui.toast('The latch is starting to wobble…', 'info');
  }

  private freeCat(o: Occupant) {
    const g = this.game;
    const cg = this.fac.cages[o.cage];
    if (this.workerWatching()) { this.say(this.worker!, 'Hey! Leave that alone!', 2); this.worker!.state = 'chase'; this.worker!.timer = 9; return; }
    cg.open = true;
    o.freed = true;
    g.audio.rattle();
    g.audio.purr();
    const pc = this.pc;
    if (o.cat.clan === 'home') g.clan.adjust(o.cat, pc, 15, { text: `${pc.given} opened my cage at the Twoleg pound.`, weight: 8 });
    g.ui.toast(`You hook your claws under the latch — it pops open! ${o.cat.given} leaps out: "${simRng.pick(['Thank you! Let\'s get out of here!', 'I thought I\'d never get out!', 'You\'re a hero! Where do we go?'])}"`, 'good');
  }

  private pryVent() {
    const g = this.game;
    const ac = this.ac!;
    if (this.workerWatching()) { g.ui.toast('Not while the Twoleg is watching!', 'danger'); return; }
    ac.vent++;
    g.audio.rattle();
    if (ac.vent >= 4) {
      ac.ventOpen = true;
      const cv = this.fac.vent.cover;
      cv.rotation.z = -1.3;
      cv.position.x += 0.35;
      g.audio.crash();
      g.ui.toast('The rusty vent cover clangs to the floor! A dark tunnel leads outside.', 'good');
    }
  }

  /** Leave the pound: through the vent, home with your Tallfolk, or adopted by a new family. */
  private escape(how: 'vent' | 'owner' | 'adopted') {
    const g = this.game;
    const pc = this.pc;
    const freed = this.occupants.filter((o) => o.freed && !o.player);
    const left = this.occupants.filter((o) => !o.freed && !o.player);
    g.ui.fade(true, how === 'vent' ? 'You squeeze into the dark, rusty tunnel… and burst out into the cold night air. FREE!' : how === 'owner' ? 'Your Tallfolk carries you out to their monster. You\'re going home.' : 'The family carries you out in a soft basket…');
    g.player.frozen = true;
    setTimeout(() => {
      for (const o of this.occupants) o.model?.dispose();
      this.occupants = [];
      this.ac = null;
      g.objectives.list = g.objectives.list.filter((o) => o.id !== 'tw-escape');
      // where you come out
      let p: P2;
      if (how === 'owner' || how === 'adopted') p = this.home.spots.bed;
      else p = this.st(this.L.len / 2 + 6, 10);
      g.chunks.primeAround(p.x, p.z);
      g.player.placeAt(p.x, p.z);
      g.time.totalHours += how === 'vent' ? 5 : 2;
      g.player.frozen = false;
      g.ui.fade(false);
      if (how === 'adopted') this.becomeKittypet();
      // the cats you freed
      const clanFreed: Cat[] = [];
      const strayFreed: Cat[] = [];
      for (const o of freed) {
        o.cat.caged = false;
        if (o.cat.clan === 'home') clanFreed.push(o.cat);
        else strayFreed.push(o.cat);
        g.objectives.list = g.objectives.list.filter((x) => x.id !== `tw-rescue-${o.cat.id}`);
        const tc = this.townCats.find((t) => t.cat.id === o.cat.id);
        if (tc) { tc.gone = false; tc.pos.set(tc.home.x, 0, tc.home.z); }
      }
      for (const o of left) if (o.stray) { const tc = this.townCats.find((t) => t.cat.id === o.cat.id); if (tc) tc.cat.caged = true; }
      if (clanFreed.length) {
        pc.reputation = clamp(pc.reputation + 6 * clanFreed.length, -100, 100);
        pc.coins = (pc.coins ?? 0) + 15 * clanFreed.length;
        for (const c of clanFreed) g.clan.remember(c, `${pc.given} rescued me from the Twoleg pound.`, 10, pc.id);
        g.clan.log(`${displayName(pc)} rescued ${clanFreed.map((c) => displayName(c)).join(', ')} from the Twoleg pound.`, 'event');
        g.npcs.syncRoster();
        g.ui.toast(`🎉 ${clanFreed.map((c) => displayName(c)).join(' and ')} ${clanFreed.length > 1 ? 'are' : 'is'} free and heading home! (+🪙${15 * clanFreed.length})`, 'good');
      }
      g.clan.remember(pc, how === 'vent' ? `I escaped from the Twoleg pound${freed.length ? ` and freed ${freed.length} other cat${freed.length > 1 ? 's' : ''}` : ''}.` : 'I left the Twoleg pound.', 8);
      if (left.length && how === 'vent') g.ui.toast(`${left.length} cat${left.length > 1 ? 's are' : ' is'} still locked in the pound…`, 'info');
      // grateful strays may ask to join the clan
      this.askStrays(strayFreed);
      g.save();
    }, 2200);
  }

  private askStrays(list: Cat[]) {
    const g = this.game;
    const pc = this.pc;
    const s = list.shift();
    if (!s) return;
    const inClan = pc.lifestyle === 'clan' && !pc.exiled;
    const text = inClan
      ? `"${simRng.pick(['You saved me!', 'I owe you my life.', 'I\'ve never met a cat so brave.'])} I'm ${s.given}. I have nowhere to go… could I come and live with your clan?"`
      : `"Thank you! I'm ${s.given}. I'll never forget this. If you ever need a friend, find me by the Twoleg dens."`;
    const opts = inClan
      ? [{ label: `Bring ${s.given} to the clan`, action: () => { this.joinClan(s); g.ui.toast(`${s.given} follows you home and joins the clan! They will be known as ${displayName(s)}.`, 'good'); this.askStrays(list); } },
        { label: 'Good luck out there', action: () => { s.clan = 'loner'; g.clan.addLoner(s, false); this.askStrays(list); } }]
      : [{ label: 'Goodbye, friend', action: () => { s.clan = 'loner'; g.clan.addLoner(s, false); this.askStrays(list); } }];
    g.ui.dialog({ speaker: s, sub: lifestyleLabel(s.lifestyle ?? 'loner'), text, options: opts, onClose: () => {} });
  }

  /** A rescued stray (or a kittypet player) becomes a member of the clan. */
  joinClan(c: Cat) {
    const g = this.game;
    c.lifestyle = 'clan';
    c.clan = 'home';
    c.exiled = false;
    c.app = { ...c.app, accessories: (c.app.accessories ?? []).filter((a) => a !== 'collar' && a !== 'bellCollar') };
    if (c.age < 6) c.stage = 'kit';
    else if (c.age < 12) c.stage = 'apprentice';
    else { c.stage = 'warrior'; if (!c.epithet) c.epithet = makeEpithet(simRng, c); }
    if (!g.clan.cats[c.id]) g.clan.addLoner(c, true);
    else { c.joinedDay = g.time.day; g.npcs.syncRoster(); }
    if (c.stage === 'apprentice' && !c.isPlayer) { const m = g.clan.pickMentor(c); if (m) { c.mentor = m.id; m.apprentice = c.id; } }
  }

  /** Adopted from the pound: you're a kittypet now. */
  becomeKittypet() {
    const g = this.game;
    const pc = this.pc;
    pc.lifestyle = 'kittypet';
    pc.exiled = true;
    if (pc.stage === 'kit' || pc.stage === 'apprentice') { pc.stage = 'warrior'; pc.age = Math.max(pc.age, 12); }
    pc.role = 'none';
    pc.app = { ...pc.app, accessories: [...(pc.app.accessories ?? []).filter((a) => a !== 'bellCollar'), 'bellCollar'], accessoryColor: pc.app.accessoryColor ?? '#c8302a' };
    g.player.attach();
    this.home.setName(pc.given);
    pc.homeSeen = g.time.totalHours;
    g.objectives.list = g.objectives.list.filter((o) => !o.id.startsWith('tw-'));
    g.objectives.add({ id: 'exile', kind: 'free', title: `Life as a ${lifestyleLabel('kittypet').toLowerCase()}`, desc: this.twoleg('Your new Tallfolk feed you and keep you warm. But the forest is just over the fence… you could always ask a clan cat if you may join.'), need: 1 });
    g.ui.showBanner(this.twoleg(`You have a new home and a jingly collar. You are ${pc.given} the ${lifestyleLabel('kittypet').toLowerCase()} now.`), 10);
  }

  private eatBowl() {
    const g = this.game;
    const pc = this.pc;
    this.bowlFull = false;
    pc.hunger = 100;
    g.audio.eat();
    g.player.model.pose = 'eat';
    if (this.isKittypet) g.ui.toast(simRng.pick(['Crunchy, salty kibble. Your belly is full.', 'You gobble your dinner and lick the bowl clean.', 'Mmm, the fishy kind today!']), 'good');
    else {
      g.ui.toast('You crunch the strange dry pellets. Kittypet food! If the clan finds out…', 'info');
      if (pc.lifestyle === 'clan' && !pc.exiled) g.clan.infraction('dangerZones', g.npcs.witnesses(g.player.pos.x, g.player.pos.z, 20), 'ate kittypet food');
    }
  }

  private meowForFood() {
    const g = this.game;
    g.audio.meow(1.1, 0.6, 0.05);
    const o = this.owners.find((x) => !x.kid && !x.away && x.task !== 'sleep' && x.task !== 'leash');
    if (!o || !this.isKittypet) { g.ui.toast(o ? 'Nobody fills the bowl for a stranger.' : 'Nobody is home to hear you.', 'info'); return; }
    this.say(o, simRng.pick(['Alright, alright, I\'m coming!', `Are you hungry, ${this.pc.given}?`, 'You just ate! …oh, fine.']), 3);
    this.send(o, toWorld(this.home.frame, -4.55, -2.3), 'feed', 'crouch');
  }

  private petOwner(o: Owner) {
    const g = this.game;
    const pc = this.pc;
    o.petT = 3.5;
    o.path = [];
    o.still = 'crouch';
    o.heading = Math.atan2(g.player.pos.x - o.pos.x, g.player.pos.z - o.pos.z);
    g.audio.purr();
    if (!this.isKittypet) {
      this.say(o, simRng.pick(['Oh! A little stray! Are you hungry?', 'Aww, you\'re so fluffy! Where did you come from?', 'Shoo! …okay, one pat.']), 4);
      return;
    }
    pc.health = Math.min(pc.maxHealth, pc.health + 5);
    g.player.calmUntil = g.clock + 60;
    if (this.lastPetDay !== g.time.day) { this.lastPetDay = g.time.day; pc.reputation = pc.reputation; }
    this.say(o, simRng.pick([`Who's a good kitty? You are, ${pc.given}!`, `Aww, ${pc.given}, I love you too.`, '*scratches under your chin*', `Did you have an adventure today, ${pc.given}?`, '*gives you a tummy rub — you allow it, this once*']), 4);
    g.ui.toast(this.twoleg(`${o.kid ? 'The little Tallfolk' : 'Your Tallfolk'} strokes your back. You purr so loudly your whiskers buzz.`), 'good');
  }

  private talkTownCat(t: TownCat) {
    const g = this.game;
    const pc = this.pc;
    const c = t.cat;
    const kp = c.lifestyle === 'kittypet';
    const clanCat = pc.lifestyle === 'clan';
    const lines = kp
      ? (clanCat ? [`You smell like the forest! Is it true you wild cats eat bones? And fight every day?`, `I could never live out there. My Tallfolk give me cream every morning!`, `If you're ever hungry, my bowl is by the back door. Don't tell anyone.`]
        : [`Hello neighbour! Did your Tallfolk give you the fishy kind today too?`, `I saw the wild cats by the fence again last night. Their eyes glow!`, `Watch out for the white monster with the flashing lights. It takes cats away.`])
      : [`Shh. I'm watching the bins. The Tallfolk throw away whole fish sometimes.`, `The white monster took my brother. I've been hiding ever since.`, `Clan cats think they're better than everyone. Are you one of them?`];
    const opts = [
      { label: 'Chat', action: () => g.ui.dialog({ speaker: c, sub: lifestyleLabel(c.lifestyle ?? 'loner'), text: simRng.pick(lines), options: [{ label: 'Goodbye', action: () => {} }] }) },
    ];
    if (!kp && clanCat && !pc.exiled && g.clan.leader && !g.clan.leader.isPlayer) opts.push({ label: 'Invite them to join the clan', action: () => {
      if (simRng.chance(0.5 + pc.reputation / 200)) {
        t.gone = true; t.model.root.visible = false;
        this.joinClan(c);
        g.ui.dialog({ speaker: c, text: `A real clan? Warm dens and friends? …Yes. I'll come. Thank you!`, options: [{ label: 'Welcome!', action: () => {} }] });
        g.ui.toast(`${c.given} joins your clan as ${displayName(c)}!`, 'good');
        pc.reputation = clamp(pc.reputation + 2, -100, 100);
      } else g.ui.dialog({ speaker: c, text: `Live by somebody else's rules? No thanks. But… thanks for asking.`, options: [{ label: 'Goodbye', action: () => {} }] });
    } });
    opts.push({ label: 'Leave', action: () => {} });
    g.audio.meow(1.1, 0.4, 0.03);
    g.ui.dialog({ speaker: c, sub: lifestyleLabel(c.lifestyle ?? 'loner'), text: kp ? `*${c.given} blinks lazily from the fence.* Oh, hello!` : `*${c.given} flattens their ears.* What do you want?`, options: opts });
  }

  // ------------------------------------------------------------------ UI hooks
  speech(): { x: number; y: number; z: number; name: string; text: string }[] {
    const out: { x: number; y: number; z: number; name: string; text: string }[] = [];
    const add = (o: { pos: THREE.Vector3; bubble: Bubble | null; model: TwolegModel }, name: string) => {
      if (o.bubble && o.model.root.visible) out.push({ x: o.pos.x, y: o.pos.y + 1.85 * o.model.look.height, z: o.pos.z, name: this.twoleg(name), text: o.bubble.text });
    };
    for (const w of this.walkers) add(w, w.kid ? 'Tallfolk kit' : 'Tallfolk');
    for (const o of this.owners) add(o, this.isKittypet ? (o.kid ? 'Your little Tallfolk' : 'Your Tallfolk') : (o.kid ? 'Tallfolk kit' : 'Tallfolk'));
    for (const c of this.cars) if (c.catcher) add(c.catcher, 'Animal control Tallfolk');
    if (this.worker) add(this.worker, 'Pound worker');
    return out;
  }

  places(): { label: string; icon: string; x: number; z: number; y: number }[] {
    if (!this.home || !this.isKittypet) return [];
    const s = this.home.spots, y = this.L.home.y;
    return [
      { label: this.bowlFull ? 'Food bowl' : 'Food bowl (empty)', icon: '🍽️', x: s.food.x, z: s.food.z, y: y + 0.5 },
      { label: 'Water bowl', icon: '💧', x: s.water.x, z: s.water.z, y: y + 0.5 },
      { label: 'Your bed', icon: '🛏️', x: s.bed.x, z: s.bed.z, y: y + 0.5 },
      { label: 'Cat flap', icon: '🚪', x: s.flap.x, z: s.flap.z, y: y + 0.8 },
      { label: 'Cat tree', icon: '🌳', x: s.tree.x, z: s.tree.z, y: y + 1.9 },
    ];
  }

  /** Where a new kittypet / loner / rogue begins. */
  startPoint(l: Lifestyle): { x: number; z: number; yaw: number } {
    if (l === 'kittypet') { const b = this.home.spots.bed; return { x: b.x + 0.5, z: b.z, yaw: this.home.frame.rot }; }
    const n = l === 'rogue' ? this.L.nest.rogue : this.L.nest.loner;
    return { x: n.x + 0.8, z: n.z + 0.8, yaw: Math.atan2(n.x, n.z) };
  }
}
