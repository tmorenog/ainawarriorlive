// StarClan and the Dark Forest: after you die you can walk among the spirits as a ghost.
// The living can't see you — except in their dreams, where you can warn, heal and guide them
// (or, in the Dark Forest, tempt and train them). You also judge the cats who die after you.
// While you're alive, the spirits of the dead glimmer in the night sky.
import * as THREE from 'three';
import type { Game } from '../game';
import type { NpcAgent } from '../ai/npc';
import type { Prompt } from './interactions';
import { CatModel, Pose } from '../cats/model';
import { Cat, displayName, isExpecting } from '../cats/types';
import { createCat, GIVEN_NAMES } from '../cats/generate';
import { simRng } from '../core/rng';
import { clamp } from '../core/math';
import { smartReply } from './chatbrain';

export type Realm = 'starclan' | 'dark';

interface Ghost {
  cat: Cat;
  model: CatModel;
  pos: THREE.Vector3;
  heading: number;
  target: THREE.Vector3 | null;
  wait: number;
  kit: boolean;
  hold?: { pose: Pose; until: number };
}

/** Make a cat model look like a spirit: see-through and softly glowing. */
export function ghostify(model: CatModel, tint: number, opacity: number, noFog = false) {
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.ghost) return;
    const src = m.material as THREE.Material;
    const mat = src.clone() as THREE.MeshLambertMaterial;
    mat.transparent = true;
    mat.opacity = opacity * (src.transparent ? (src as THREE.MeshBasicMaterial).opacity ?? 1 : 1);
    mat.depthWrite = false;
    if (noFog) mat.fog = false;
    if ('emissive' in mat && mat.emissive) mat.emissive = new THREE.Color(tint).multiplyScalar(0.55);
    m.material = mat;
    m.castShadow = false;
    m.userData.ghost = true;
  });
}

/** The ancient spirits who always walk in StarClan (the founders and old heroes). */
const ANCIENTS: [string, string, string][] = [
  ['Thunder', 'star', 'I founded ThunderClan in the oak forest, long before your grandmothers\' grandmothers. Be brave, little one.'],
  ['Wind', 'star', 'I ran the moors faster than any rabbit. WindClan still runs with my heart.'],
  ['River', 'star', 'I taught my cats to swim and fish. The river remembers every paw.'],
  ['Shadow', 'star', 'They called me harsh. But I kept my clan alive through the coldest leaf-bare.'],
  ['Sky', 'star', 'I walked away from my clan once. Never again. Hold on to the cats you love.'],
  ['Moth', 'flight', 'I was the first medicine cat to walk in dreams. Now you can too.'],
  ['Lion', 'heart', 'I fought a whole patrol of rogues alone. Courage isn\'t never being afraid.'],
  ['Spotted', 'leaf', 'Every herb has a story. Every cat has a destiny.'],
  ['Feather', 'tail', 'I gave my life for my friends. I would do it again.'],
  ['Silver', 'stream', 'Love doesn\'t care about clan borders. Don\'t let anyone tell you otherwise.'],
];

export class Afterlife {
  /** StarClan is a land of clouds high in a dreamy blue sky. */
  static readonly SKY_Y = 600;
  realm: Realm | null = null;
  get inSky() { return this.realm === 'starclan' || !!this.dreaming; }
  /** Walking inside a sleeping cat's dream. */
  dreaming: { a: NpcAgent; model: CatModel; pos: THREE.Vector3; heading: number; home: THREE.Vector3; back: THREE.Vector3; group: THREE.Group; exit: THREE.Vector3; t: number } | null = null;
  static readonly DREAM_X = 4000;
  private pool: THREE.Group | null = null;
  private floor: THREE.Mesh[] = [];
  private ghosts = new Map<string, Ghost>();
  private clouds: THREE.Mesh[] = [];
  private cloudGroup = new THREE.Group();
  private tint: HTMLElement | null = null;
  private refreshT = 0;
  private skyCats: { cat: Cat; model: CatModel }[] = [];
  private skyT = 0;
  private judging: Cat[] = [];
  private kitPlayT = 0;
  // StarClan fun and decisions
  private starPrey: { mesh: THREE.Mesh; pos: THREE.Vector3; heading: number; hop: number }[] = [];
  starCatches = 0;
  private councilT = 45;
  private ancientLines = new Map<string, string>();

  constructor(private game: Game) {
    game.scene.add(this.cloudGroup);
  }

  /** Which afterlife a dead cat goes to (unless you judge them yourself). */
  static fateOf(c: Cat): Realm {
    if (c.afterlife) return c.afterlife;
    const dark = c.reputation < -10 || c.griefDark || (c.traits.includes('aggressive') && c.traits.includes('ambitious')) || c.bookId === 'Tigerclaw';
    return dark ? 'dark' : 'starclan';
  }

  /** Can this player choose StarClan? (Ordinary reputation or better.) */
  static realmFor(c: Cat): Realm { return c.reputation > -10 ? 'starclan' : 'dark'; }

  get tintColor() { return this.realm === 'dark' ? 0xc0201a : 0xa8d0ff; }

  // ------------------------------------------------------------ entering / leaving
  enter(realm: Realm, fromLoad = false) {
    const g = this.game;
    const pc = g.clan.player;
    this.realm = realm;
    pc.ghost = realm;
    pc.alive = true;
    pc.health = pc.maxHealth;
    pc.hunger = 100;
    pc.thirst = 100;
    pc.sick = 0; pc.injury = 0;
    pc.expectingUntil = null; pc.labour = false; pc.fatalBirth = false;
    if (!fromLoad) {
      g.player.placeAt(0, realm === 'starclan' ? 3 : 4);
      g.player.attach();
      g.objectives.list = [];
      g.startPlaying();
      g.ui.toast(realm === 'starclan'
        ? '🌟 You walk among StarClan. The living can\'t see you — but you can visit their dreams while they sleep, warn them of danger and guide their fate.'
        : '🔥 You wander the Dark Forest. The living can\'t see you — but you can creep into their dreams to tempt and train them.', 'objective');
    }
    // a save made inside a dream: wake back up in your own realm
    if (fromLoad && Math.abs(g.player.pos.x) > 3000) g.player.placeAt(0, 3);
    this.applyLook();
    this.spawnGhosts();
  }

  leave() {
    const g = this.game;
    if (this.dreaming) this.leaveDream();
    this.realm = null;
    for (const gh of this.ghosts.values()) { g.scene.remove(gh.model.root); gh.model.dispose(); }
    this.ghosts.clear();
    for (const c of this.clouds) { this.cloudGroup.remove(c); }
    this.clouds = [];
    for (const c of this.floor) this.cloudGroup.remove(c);
    this.floor = [];
    if (this.pool) { this.cloudGroup.remove(this.pool); this.pool = null; }
    for (const sp of this.starPrey) this.cloudGroup.remove(sp.mesh);
    this.starPrey = [];
    this.tint?.remove(); this.tint = null;
    g.player.placeAt(g.player.pos.x, g.player.pos.z); // back down to the forest floor
    document.body.classList.remove('realm-starclan', 'realm-dark');
  }

  private applyLook() {
    const g = this.game;
    ghostify(g.player.model, this.tintColor, 0.5);
    this.tint?.remove();
    this.tint = document.createElement('div');
    this.tint.className = `realm-tint ${this.realm}`;
    g.ui.root.appendChild(this.tint);
    document.body.classList.remove('realm-starclan', 'realm-dark');
    document.body.classList.add(`realm-${this.realm}`);
    // drifting clouds and mist all around
    for (const c of this.clouds) this.cloudGroup.remove(c);
    this.clouds = [];
    for (const c of this.floor) this.cloudGroup.remove(c);
    this.floor = [];
    if (this.pool) { this.cloudGroup.remove(this.pool); this.pool = null; }
    if (this.inSky) {
      // a soft floor of clouds to walk on, and the Star Pool that looks down on the living
      const fm = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xc8dcff, emissiveIntensity: 0.35 });
      const fg = new THREE.SphereGeometry(1, 14, 10);
      for (let i = 0; i < 70; i++) {
        const m = new THREE.Mesh(fg, fm);
        const s = simRng.range(3, 6);
        m.scale.set(s, s * 0.32, s);
        this.placeFloor(m, true);
        this.floor.push(m); this.cloudGroup.add(m);
      }
      const pool = new THREE.Group();
      const water = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.85 }));
      water.rotation.x = -Math.PI / 2; water.position.y = 0.03; pool.add(water);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 8, 32), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9fc8ff, emissiveIntensity: 0.5 }));
      rim.rotation.x = -Math.PI / 2; rim.position.y = 0.05; pool.add(rim);
      const glow = new THREE.PointLight(0x9fd8ff, 1.2, 8); glow.position.y = 1; pool.add(glow);
      pool.position.set(0, Afterlife.SKY_Y, 0);
      this.pool = pool; this.cloudGroup.add(pool);
    }
    const mat = new THREE.MeshBasicMaterial({ color: this.realm === 'dark' ? 0x3a0a0a : 0xf4f7ff, transparent: true, opacity: this.realm === 'dark' ? 0.45 : 0.32, depthWrite: false });
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 46; i++) {
      const m = new THREE.Mesh(geo, mat);
      const s = simRng.range(1.5, 4.5);
      m.scale.set(s * 1.6, s * 0.35, s);
      this.placeCloud(m, true);
      this.clouds.push(m);
      this.cloudGroup.add(m);
    }
  }

  private placeFloor(m: THREE.Mesh, anywhere: boolean) {
    const p = this.game.player.pos;
    const a = simRng.range(0, Math.PI * 2), r = anywhere ? Math.sqrt(Math.random()) * 34 : simRng.range(28, 34);
    m.position.set(p.x + Math.cos(a) * r, Afterlife.SKY_Y - 0.55 - Math.random() * 0.3, p.z + Math.sin(a) * r);
  }

  private placeCloud(m: THREE.Mesh, anywhere: boolean) {
    const p = this.game.player.pos;
    const a = simRng.range(0, Math.PI * 2);
    const r = anywhere ? simRng.range(4, 34) : simRng.range(24, 34);
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    const high = simRng.chance(0.35);
    const base = this.inSky ? Afterlife.SKY_Y + (high ? 0 : -18) : this.game.groundAt(x, z);
    m.position.set(x, base + (high ? simRng.range(5, 14) : simRng.range(0.2, 1.4)), z);
    m.userData.drift = simRng.range(0.2, 0.6);
  }

  /** Spirits of the dead who share your realm (and the kits who came with you). */
  private spawnGhosts() {
    const g = this.game;
    const pc = g.clan.player;
    for (const gh of this.ghosts.values()) { g.scene.remove(gh.model.root); gh.model.dispose(); }
    this.ghosts.clear();
    const dead = g.clan.dead().filter((d) => d.clan === 'home' && d.id !== pc.id && Afterlife.fateOf(d) === this.realm)
      .sort((a, b) => (pc.relations[b.id]?.opinion ?? 0) - (pc.relations[a.id]?.opinion ?? 0)).slice(0, this.inSky ? 30 : 10);
    for (const d of dead) this.addGhost(d, false);
    // StarClan is never empty: the founders and old heroes are always here
    if (this.realm === 'starclan') {
      for (const [given, suffix, line] of ANCIENTS) {
        if (this.ghosts.size >= 18) break;
        const a = createCat({ age: simRng.range(30, 90), given, day: g.time.day, usedNames: new Set() });
        a.epithet = suffix; a.stage = 'warrior'; a.alive = false; a.id = `ancient-${given}`;
        if (suffix === 'star') a.role = 'leader';
        if (given === 'Moth' || given === 'Spotted') a.role = 'medicine';
        a.deathCause = 'old age, many seasons ago';
        this.ancientLines.set(a.id, line);
        this.addGhost(a, false);
      }
    }
    // the kits who died with you play at your paws
    if (this.realm === 'starclan') for (const name of pc.starKits ?? []) {
      const k = createCat({ age: 0.2, parents: [pc, pc], day: g.time.day, usedNames: new Set() });
      k.given = name; k.alive = false; k.id = `star-${name}-${pc.id}`;
      this.addGhost(k, true);
    }
  }

  private addGhost(c: Cat, kit: boolean) {
    const g = this.game;
    const model = new CatModel(c.app, kit ? 'kit' : c.stage === 'kit' ? 'kit' : c.stage);
    ghostify(model, this.tintColor, 0.5);
    const p = g.player.pos;
    const a = simRng.range(0, Math.PI * 2), r = kit ? simRng.range(1, 2) : simRng.range(4, 14);
    const pos = new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
    pos.y = g.groundAt(pos.x, pos.z);
    g.scene.add(model.root);
    this.ghosts.set(c.id, { cat: c, model, pos, heading: simRng.range(0, 6), target: null, wait: simRng.range(1, 5), kit });
  }

  // ------------------------------------------------------------ every frame
  update(dt: number) {
    this.updateSkyCats(dt);
    if (!this.realm) return;
    const g = this.game;
    const p = g.player.pos;
    if (this.dreaming) { this.updateDream(dt); return; }
    for (const f of this.floor) if (Math.hypot(f.position.x - p.x, f.position.z - p.z) > 34) this.placeFloor(f, false);
    // keep the clouds around you
    for (const c of this.clouds) {
      c.position.x += c.userData.drift * dt;
      if (Math.hypot(c.position.x - p.x, c.position.z - p.z) > 36) this.placeCloud(c, false);
    }
    this.refreshT -= dt;
    if (this.refreshT <= 0) { this.refreshT = 1; ghostify(g.player.model, this.tintColor, 0.5); }
    // spirits wander; your kits scamper around you
    this.kitPlayT -= dt;
    for (const gh of this.ghosts.values()) {
      if (gh.kit) {
        const d = Math.hypot(gh.pos.x - p.x, gh.pos.z - p.z);
        if (!gh.target || d > 3 || simRng.chance(dt * 0.5)) {
          const a = simRng.range(0, Math.PI * 2);
          gh.target = new THREE.Vector3(p.x + Math.cos(a) * 1.1, 0, p.z + Math.sin(a) * 1.1);
        }
      } else if (!gh.target) {
        gh.wait -= dt;
        if (gh.wait <= 0) {
          const a = simRng.range(0, Math.PI * 2), r = simRng.range(3, 12);
          gh.target = new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
        }
      }
      let speed = 0;
      if (gh.target) {
        const dx = gh.target.x - gh.pos.x, dz = gh.target.z - gh.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.2) { gh.target = null; gh.wait = simRng.range(3, 9); }
        else {
          speed = gh.kit ? 1.8 : 0.9;
          gh.heading = Math.atan2(dz, dx);
          const step = Math.min(d, speed * dt);
          gh.pos.x += (dx / d) * step; gh.pos.z += (dz / d) * step;
        }
      }
      gh.pos.y = g.groundAt(gh.pos.x, gh.pos.z) + 0.05 + Math.sin(g.clock * 1.5 + gh.heading) * 0.04;
      gh.model.root.position.copy(gh.pos);
      gh.model.root.rotation.y = -gh.heading;
      gh.model.speed = speed;
      const held = gh.hold && gh.hold.until > g.clock ? gh.hold.pose : null;
      const pose: Pose = held ?? (speed > 0 ? 'walk' : gh.kit ? (Math.sin(g.clock * 2 + gh.heading) > 0.3 ? 'pounce' : 'sit') : 'sit');
      gh.model.pose = pose;
      gh.model.update(dt);
      if (gh.kit && this.kitPlayT <= 0 && simRng.chance(dt * 0.15)) {
        this.kitPlayT = 12;
        g.ui.showBanner(`${gh.cat.given}kit: ${simRng.pick(['Mama! Play with us!', 'Catch me, Mama! *giggles*', 'Look, the stars are so pretty here!', 'We\'re never going to leave you, Mama.'])}`, 4);
      }
    }
    // a newly dead clanmate is waiting to be judged
    if (this.judging.length && !g.ui.isBusy() && !g.player.busy) this.judge(this.judging.shift()!);
    if (this.realm === 'starclan') {
      this.updateStarPrey(dt);
      // the spirits bring you decisions about the living
      this.councilT -= dt;
      if (this.councilT <= 0 && !g.ui.isBusy() && !g.player.busy) { this.councilT = simRng.range(90, 150); this.council(); }
    }
  }

  /** The sky looks different in the afterlife. */
  applyAtmosphere() {
    if (!this.realm) return;
    const g = this.game;
    const fog = g.scene.fog as THREE.Fog | null;
    if (fog) fog.color.set(this.realm === 'dark' ? 0x1a0505 : 0x2c4a9a);
    if (g.scene.background instanceof THREE.Color) g.scene.background.set(this.realm === 'dark' ? 0x120303 : 0x1f3a86);
  }

  // ------------------------------------------------------------ the living see the dead in the stars
  private updateSkyCats(dt: number) {
    const g = this.game;
    const night = g.time.isNight && !this.realm && g.state === 'playing';
    this.skyT -= dt;
    if (night && this.skyT <= 0 && !this.skyCats.length) {
      this.skyT = 30;
      const dead = g.clan.dead().filter((d) => d.clan === 'home' && Afterlife.fateOf(d) === 'starclan' && !d.isPlayer)
        .sort((a, b) => (b.deathDay ?? 0) - (a.deathDay ?? 0)).slice(0, 5);
      for (const d of dead) {
        const model = new CatModel(d.app, d.stage === 'kit' ? 'kit' : 'warrior');
        ghostify(model, 0xbfe0ff, 0.22, true);
        model.root.scale.multiplyScalar(14);
        model.pose = simRng.pick(['sit', 'lie', 'loaf'] as Pose[]);
        g.scene.add(model.root);
        this.skyCats.push({ cat: d, model });
      }
    }
    if (!night && this.skyCats.length) {
      for (const s of this.skyCats) { g.scene.remove(s.model.root); s.model.dispose(); }
      this.skyCats = [];
    }
    const cam = g.camera.position;
    this.skyCats.forEach((s, i) => {
      const a = i * 1.25 + g.clock * 0.004;
      s.model.root.position.set(cam.x + Math.cos(a) * 130, cam.y + 38 + i * 7, cam.z + Math.sin(a) * 130);
      s.model.root.rotation.y = -a + Math.PI / 2;
      s.model.update(dt);
    });
  }

  // ------------------------------------------------------------ prompts (what E does in the afterlife)
  prompt(): Prompt | null {
    if (!this.realm) return null;
    const g = this.game;
    const p = g.player.pos;
    const dr = this.dreaming;
    if (dr) {
      if (Math.hypot(dr.pos.x - p.x, dr.pos.z - p.z) < 2.4) return { text: `💬 Talk to ${dr.a.name}`, at: { x: dr.pos.x, y: dr.pos.y + dr.model.shoulderY * dr.model.scale, z: dr.pos.z }, action: () => this.dreamTalk(dr.a) };
      if (Math.hypot(dr.exit.x - p.x, dr.exit.z - p.z) < 2.2) return { text: '🌙 Leave the dream', at: { x: dr.exit.x, y: dr.exit.y + 0.8, z: dr.exit.z }, action: () => this.leaveDream() };
      return null;
    }
    // StarClan: the Star Pool shows you the living, and lets you walk into their dreams
    if (this.realm === 'starclan' && this.pool && Math.hypot(this.pool.position.x - p.x, this.pool.position.z - p.z) < 2.6) {
      return { text: '🌙 Gaze into the Star Pool — visit a dream', at: { x: this.pool.position.x, y: Afterlife.SKY_Y + 0.6, z: this.pool.position.z }, action: () => this.starPool() };
    }
    // glowing star-mice to chase across the clouds
    if (this.realm === 'starclan') {
      const f = g.player.forward();
      for (const sp of this.starPrey) {
        const dx = sp.pos.x - p.x, dz = sp.pos.z - p.z, d = Math.hypot(dx, dz);
        if (d < 2.6 && (d < 1.4 || (dx * f.x + dz * f.z) / Math.max(d, 0.01) > -0.2)) return { text: '✨ Pounce on the star-mouse!', at: { x: sp.pos.x, y: sp.pos.y + 0.25, z: sp.pos.z }, action: () => this.pounceStar(sp) };
      }
    }
    // spirits and your kits
    let best: Ghost | null = null, bd = 2.2;
    for (const gh of this.ghosts.values()) { const d = Math.hypot(gh.pos.x - p.x, gh.pos.z - p.z); if (d < bd) { bd = d; best = gh; } }
    if (best) {
      const gh = best;
      const at = { x: gh.pos.x, y: gh.pos.y + 0.25 * gh.model.scale, z: gh.pos.z };
      return gh.kit
        ? { text: `🐾 Play with ${gh.cat.given}kit`, at, action: () => this.playWithKit(gh) }
        : { text: `✨ Talk to ${displayName(gh.cat)}'s spirit`, at, action: () => this.talkGhost(gh) };
    }
    if (this.realm === 'starclan') return null;
    // the living, but only in their dreams
    let sleeper: NpcAgent | null = null, sd = 2.4;
    for (const a of g.npcs.agents.values()) {
      if (a.cat.clan !== 'home' || !a.cat.alive) continue;
      const asleep = a.activity === 'sleep' || a.model.pose === 'sleep';
      if (!asleep) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d < sd) { sd = d; sleeper = a; }
    }
    if (sleeper) {
      const a = sleeper;
      return { text: `💭 Enter ${a.name}'s dream`, at: { x: a.pos.x, y: a.pos.y + 0.3, z: a.pos.z }, action: () => this.dream(a) };
    }
    return null;
  }

  // ------------------------------------------------------------ StarClan fun: star-mice
  private updateStarPrey(dt: number) {
    const g = this.game;
    const p = g.player.pos;
    while (this.starPrey.length < 5) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff6c0 }));
      mesh.scale.set(1.6, 0.9, 1);
      const a = simRng.range(0, Math.PI * 2), r = simRng.range(4, 14);
      const pos = new THREE.Vector3(p.x + Math.cos(a) * r, Afterlife.SKY_Y, p.z + Math.sin(a) * r);
      this.cloudGroup.add(mesh);
      this.starPrey.push({ mesh, pos, heading: simRng.range(0, 6), hop: Math.random() * 6 });
    }
    for (const sp of this.starPrey) {
      sp.hop += dt * 6;
      const d = Math.hypot(sp.pos.x - p.x, sp.pos.z - p.z);
      if (d < 3) sp.heading = Math.atan2(sp.pos.z - p.z, sp.pos.x - p.x) + Math.sin(sp.hop) * 0.6; // scampers away from you
      else sp.heading += Math.sin(sp.hop * 0.3) * dt;
      const speed = d < 3 ? 0.9 : 0.5;
      sp.pos.x += Math.cos(sp.heading) * speed * dt;
      sp.pos.z += Math.sin(sp.heading) * speed * dt;
      if (d > 30) { const a = simRng.range(0, Math.PI * 2); sp.pos.set(p.x + Math.cos(a) * 10, Afterlife.SKY_Y, p.z + Math.sin(a) * 10); }
      sp.mesh.position.set(sp.pos.x, Afterlife.SKY_Y + 0.07 + Math.abs(Math.sin(sp.hop)) * 0.12, sp.pos.z);
      sp.mesh.rotation.y = -sp.heading;
    }
  }

  private pounceStar(sp: { mesh: THREE.Mesh; pos: THREE.Vector3 }) {
    const g = this.game;
    const dx = sp.pos.x - g.player.pos.x, dz = sp.pos.z - g.player.pos.z;
    g.player.yaw = Math.atan2(-dx, -dz); g.player.heading = -g.player.yaw - Math.PI / 2;
    g.player.startPounce(Math.min(1, Math.max(0, (Math.hypot(dx, dz) - 0.9) / 2.4)), false);
    if (simRng.chance(0.7)) {
      this.cloudGroup.remove(sp.mesh);
      this.starPrey.splice(this.starPrey.indexOf(sp as typeof this.starPrey[number]), 1);
      this.starCatches++;
      g.audio.purr();
      g.ui.toast(`✨ You caught a star-mouse! It bursts into sparkles. (${this.starCatches} caught)`, 'good');
      if (this.starCatches % 5 === 0) g.ui.showBanner(`A StarClan spirit: *purrs* ${this.starCatches} star-mice! You hunt as well here as you did in the forest.`, 4);
    } else g.ui.toast('✨ The star-mouse slips between your paws in a puff of sparkles!', 'info');
  }

  // ------------------------------------------------------------ StarClan decisions about the living
  private council() {
    const g = this.game;
    const clan = g.clan;
    const living = clan.home(false);
    const spirit = [...this.ghosts.values()].filter((x) => !x.kit)[0]?.cat;
    const say = (text: string, options: { label: string; hint?: string; action: () => void }[]) => g.ui.dialog({ speaker: spirit, text: `${spirit ? '' : 'A voice like starlight: '}${text}`, options });
    const ok = (t: string) => g.ui.toast(t, 'good');
    const choices: (() => boolean)[] = [
      // a sick or hurt cat: heal them, or call them home
      () => {
        const c = living.filter((x) => x.sick > 25 || x.injury > 25 || x.poisoned !== undefined || x.stage === 'elder').sort((a, b) => (b.sick + b.injury) - (a.sick + a.injury))[0];
        if (!c) return false;
        say(`${displayName(c)} is ${c.sick > 25 || c.poisoned !== undefined ? 'very sick' : c.injury > 25 ? 'badly hurt' : 'growing very old'}. Shall we send them strength — or is it their time to join us?`, [
          { label: `💫 Send ${c.given} strength`, action: () => { c.sick = 0; c.injury = 0; c.poisoned = undefined; c.health = c.maxHealth; ok(`💫 ${displayName(c)} wakes up feeling strong again.`); } },
          { label: `🌟 Call ${c.given} to StarClan`, hint: 'they pass peacefully', action: () => { clan.kill(c, 'StarClan called them home'); ok(`🌟 ${displayName(c)} passes peacefully in their sleep and walks up into the stars.`); } },
          { label: 'Let fate decide', action: () => {} },
        ]);
        return true;
      },
      // an omen for the clan
      () => {
        say('The clan below needs a sign from us. What omen shall we send tonight?', [
          { label: '🌠 A shower of falling stars', hint: 'great hunting', action: () => { clan.addFood(8); ok('🌠 Stars streak over the camp. The next morning the hunting patrols come back heavy with prey!'); } },
          { label: '☁ A dark cloud over the moon', hint: 'the clan grows careful', action: () => { clan.borderSafety = Math.min(100, (clan.borderSafety ?? 50) + 20); ok('☁ The clan sees the dark cloud and doubles its border patrols.'); } },
          { label: '🍃 A leaf falling on the medicine den', hint: 'more herbs', action: () => { clan.herbStore.silverleaf += 2; clan.herbStore.sunpetal += 2; ok('🍃 The medicine cat takes the sign and gathers extra herbs.'); } },
        ]);
        return true;
      },
      // an apprentice's warrior name
      () => {
        const ap = living.find((x) => x.stage === 'apprentice' && !x.starName && x.role !== 'medicineApprentice');
        if (!ap) return false;
        const opts = ['heart', 'claw', 'storm', 'whisker', 'fur', 'pelt', 'song', 'flight', 'leap', 'fang', 'tail', 'frost'].sort(() => Math.random() - 0.5).slice(0, 3);
        say(`${displayName(ap)} will be a warrior soon. StarClan will whisper their name to the leader. What shall it be?`, [
          ...opts.map((s) => ({ label: `${ap.given}${s}`, action: () => { ap.starName = s; ok(`✨ When ${ap.given}paw becomes a warrior, they will be named ${ap.given}${s}.`); } })),
        ]);
        return true;
      },
      // two cats who love each other
      () => {
        const pairs: [Cat, Cat][] = [];
        for (const a of living) for (const b of living) if (a.id < b.id && !a.mate && !b.mate && a.sex !== b.sex && clan.grownUp(a) && clan.grownUp(b) && clan.rel(a, b).romance > 20) pairs.push([a, b]);
        const pr = pairs[0];
        if (!pr) return false;
        const [a, b] = pr;
        say(`${displayName(a)} and ${displayName(b)} are always looking at each other… Shall we bring them together?`, [
          { label: '💕 Bring them together', action: () => { clan.makeMates(a, b); ok(`💕 ${displayName(a)} and ${displayName(b)} become mates.`); } },
          { label: 'Let them find their own way', action: () => {} },
        ]);
        return true;
      },
      // bless a kit
      () => {
        const k = living.find((x) => x.stage === 'kit');
        if (!k) return false;
        say(`Little ${displayName(k)} is still so small. Which gift will you give them?`, [
          { label: '⚔ Courage', action: () => { k.skills.fighting = Math.min(99, k.skills.fighting + 10); ok(`⚔ ${displayName(k)} will grow up brave.`); } },
          { label: '🐭 Sharp senses', action: () => { k.skills.hunting = Math.min(99, k.skills.hunting + 10); k.skills.tracking = Math.min(99, k.skills.tracking + 10); ok(`🐭 ${displayName(k)} will be a great hunter.`); } },
          { label: '🌿 Wisdom', action: () => { k.skills.knowledge = Math.min(99, k.skills.knowledge + 12); ok(`🌿 ${displayName(k)} will understand the herbs and the stars.`); } },
        ]);
        return true;
      },
      // a rival patrol
      () => {
        say('A rival patrol is creeping toward your clan\'s border. Shall we warn them?', [
          { label: '⚠ Warn them in a dream', action: () => { clan.borderSafety = Math.min(100, (clan.borderSafety ?? 50) + 25); ok('⚠ The deputy wakes from a dream and sends an extra border patrol. The rivals turn back.'); } },
          { label: 'Let them learn on their own', action: () => {} },
        ]);
        return true;
      },
    ];
    const order = choices.map((f, i) => ({ f, r: Math.random() + (i === 0 ? 0.3 : 0) })).sort((a, b) => b.r - a.r);
    for (const o of order) if (o.f()) return;
  }

  /** Look down through the Star Pool and choose a sleeping cat to visit. */
  private starPool() {
    const g = this.game;
    const pc = g.clan.player;
    const mine = (a: NpcAgent) => a.cat.widowOf === pc.id || pc.mate === a.cat.id;
    const sleepers = [...g.npcs.agents.values()].filter((a) => a.cat.clan === 'home' && a.cat.alive && (a.activity === 'sleep' || a.model.pose === 'sleep'))
      .sort((x, y) => Number(mine(y)) - Number(mine(x)));
    if (!sleepers.length) {
      g.ui.dialog({ text: 'The Star Pool shimmers. Far below, your clan is busy and awake… Come back when they sleep — at night, or when a cat naps in the day.', options: [{ label: 'Step back from the pool', action: () => {} }] });
      return;
    }
    g.ui.choice('🌙 The Star Pool', 'Ripples of starlight show your clan asleep far below. Whose dream will you visit?', [
      ...sleepers.slice(0, 8).map((a) => ({ label: `💭 ${a.name}${mine(a) ? ' — your mate 💕' : ''}${a.cat.sick > 20 || a.cat.injury > 20 ? ' (hurt or sick)' : ''}`, action: () => this.dream(a) })),
      { label: 'Not now', action: () => {} },
    ]);
  }

  /** Draw the world while you're up in StarClan: only the sky, the clouds and the spirits. */
  renderSky(render: () => void) {
    const g = this.game;
    const keep = new Set<THREE.Object3D>([g.player.model.root]);
    if (this.dreaming) { keep.add(this.dreaming.group); keep.add(this.dreaming.model.root); }
    else { keep.add(this.cloudGroup); for (const gh of this.ghosts.values()) keep.add(gh.model.root); }
    const hidden: THREE.Object3D[] = [];
    for (const o of g.scene.children) {
      const sky = o instanceof THREE.AmbientLight || o instanceof THREE.HemisphereLight || o instanceof THREE.DirectionalLight;
      if (keep.has(o) || sky || !o.visible) continue;
      o.visible = false; hidden.push(o);
    }
    const bg = g.scene.background;
    g.scene.background = this.dreaming ? (this.realm === 'dark' ? this.nightmareColor : this.dreamColor) : this.skyColor;
    render();
    g.scene.background = bg;
    for (const o of hidden) o.visible = true;
  }
  private skyColor = new THREE.Color(0x1f3a86);
  private dreamColor = new THREE.Color(0x231a5c);
  private nightmareColor = new THREE.Color(0x1c0306);

  /** Talk with a spirit the way you'd talk with any clanmate — chat, share tongues, play, love. */
  private talkGhost(gh: Ghost, opening?: string) {
    const g = this.game;
    const clan = g.clan;
    const c = gh.cat;
    const pc = clan.player;
    const dark = this.realm === 'dark';
    const again = (text: string) => this.talkGhost(gh, text);
    const op = clan.opinion(c, pc);
    const good = c.memories.filter((m) => m.weight > 0).slice(-2).map((m) => m.text);
    const own = this.ancientLines.get(c.id);
    const greeting = opening ?? (own ? `*fur glittering with countless stars* ${own}`
      : dark ? simRng.pick([`*eyes glinting red* So you've come to the Dark Forest too, ${pc.given}.`, 'The living are weak. Visit their dreams… make them strong. Make them ours.'])
      : simRng.pick([`*purrs, fur shimmering with stars* Welcome, ${pc.given}. You're home now.`, `I watch over ${g.territories.homeName} every night.`, g.interactions.chatLine(c)]));
    const pose = (p: Pose, secs: number) => { gh.hold = { pose: p, until: g.clock + secs }; gh.target = null; gh.wait = secs; gh.heading = Math.atan2(g.player.pos.z - gh.pos.z, g.player.pos.x - gh.pos.x); };
    const opts: { label: string; hint?: string; action: () => void }[] = [];
    opts.push({ label: 'Chat', action: () => { clan.adjust(c, pc, 2); again(g.interactions.chatLine(c)); } });
    opts.push({ label: 'Share tongues', hint: 'groom each other', action: () => {
      clan.adjust(c, pc, 4); clan.adjust(pc, c, 2); pose('groomOther', 6); g.player.posePick = 'groomOther'; g.audio.purr();
      again(simRng.pick(['*purrs* Even up here, a good grooming feels wonderful.', '*rumbles* You missed a spot behind my ear.', '*leans into you* Thank you, friend.']));
    } });
    opts.push({ label: 'Play-fight', hint: 'pounce and tumble on the clouds', action: () => {
      g.player.startPounce(0.4, false); pose('pounce', 3); clan.adjust(c, pc, 3);
      again(simRng.pick(['*rolls over on the clouds, laughing* You got me!', 'Ha! I haven\'t played like this in moons!', '*bats your ear with a velvet paw* Gotcha!']));
    } });
    opts.push({ label: 'Tell me about your life', action: () => again(own
      ? simRng.pick(['When I was young the forest had no borders — just cats, and the stars above them.', 'We met at Fourtrees under the full moon, even then. Some things never change.', 'The first warrior code was only a few words. Protect the kits. Feed the elders. Never forget StarClan.'])
      : `I lived ${Math.floor(c.age)} moons as ${c.stage === 'kit' ? 'a kit' : c.role === 'leader' ? 'leader' : c.role === 'medicine' ? 'a medicine cat' : c.stage === 'elder' ? 'an elder' : 'a warrior'} of ${g.territories.homeName}. I died of ${c.deathCause ?? 'something I don\'t like to remember'}.${good[0] ? ` I still think about it: ${good[0]}` : ''}${c.kits.length ? ` I had ${c.kits.length} kit${c.kits.length > 1 ? 's' : ''} — I watch them from here.` : ''}`) });
    opts.push({ label: 'Ask for a story', action: () => again(simRng.pick([
      'Long ago a kit climbed the tallest pine to touch the moon. She didn\'t reach it — but she saw the whole forest, and became the wisest leader we ever had.',
      'Once, a fox chased three apprentices into the river. They held on to a floating branch and sang the whole way down. That\'s why we sing when we\'re afraid.',
      'Every star up here was once a cat who loved their clan. When a new star appears, the elders say a hero has come home.',
    ])) });
    opts.push({ label: dark ? 'Will you haunt the living with me?' : 'Will you watch over the clan with me?', action: () => again(dark ? '*laughs coldly* I watch them… and I wait.' : 'Always. Every star you see from the camp is one of us, keeping watch.') });
    // love, even among the stars
    const grown = (x: Cat) => x.stage !== 'kit' && x.stage !== 'apprentice';
    if (pc.mate === c.id) {
      if (g.time.day !== pc.starLitterDay && (c.sex !== pc.sex || pc.sex === 'she')) opts.push({ label: '🍼 Have kits together', hint: 'star-kits to raise among the clouds', action: () => {
        pc.starLitterDay = g.time.day;
        const n = simRng.int(1, 4);
        const names = Array.from({ length: n }, () => simRng.pick(GIVEN_NAMES));
        pc.starKits = [...(pc.starKits ?? []), ...names];
        for (const name of names) {
          const k = createCat({ age: 0.2, parents: [pc, c], day: g.time.day, usedNames: new Set() });
          k.given = name; k.alive = false; k.id = `star-${name}-${pc.id}-${pc.starKits.length}-${Math.random().toString(36).slice(2, 6)}`;
          this.addGhost(k, true);
        }
        g.audio.purr();
        g.ui.toast(`🍼✨ ${n === 1 ? 'A tiny star-kit appears' : `${n} tiny star-kits appear`} between you and ${displayName(c)}, glowing like new stars: ${names.map((x) => x + 'kit').join(', ')}!`, 'good');
        again('*purrs, nuzzling the tiny glowing kits* Look at them… our very own little stars.');
      } });
      opts.push({ label: '💕 Curl up together', action: () => { pose('sleep', 8); g.player.posePick = 'lie'; g.audio.purr(); again('*presses close* We\'ll never be apart again. Not even the stars could separate us.'); } });
      opts.push({ label: '💔 Unmate', hint: 'just removes the mate label', action: () => { pc.mate = null; if (c.mate === pc.id) c.mate = null; again('*blinks* Alright. I\'ll always care for you, though.'); } });
    } else if (grown(pc) && grown(c) && c.sex !== undefined) {
      opts.push({ label: 'Ask to become mates', action: () => {
        const livingMate = clan.get(pc.mate);
        if (livingMate && livingMate.alive && !livingMate.ghost) { again(`You still have a mate below — ${displayName(livingMate)}. Your heart belongs to them.`); return; }
        if (c.mate && c.mate !== pc.id) { const m = clan.get(c.mate); again(`I'm sorry… my heart still belongs to ${m ? displayName(m) : 'another'}.`); return; }
        const yes = simRng.chance(clamp((clan.rel(c, pc).romance + op) / 120 + 0.3, 0.15, 0.95));
        if (yes) {
          pc.mate = c.id; c.mate = pc.id;
          clan.rel(c, pc).romance = 90; clan.rel(pc, c).romance = 90;
          clan.remember(pc, `${displayName(c)} and I became mates among the stars.`, 10, c.id);
          g.audio.purr();
          g.ui.toast(`💕 You and ${displayName(c)} are mates in ${dark ? 'the Dark Forest' : 'StarClan'}.`, 'good');
          again('*purrs so loudly the stars tremble* Yes! A thousand times yes!');
        } else { clan.adjust(c, pc, -2); again(simRng.pick(['I… think of you as a friend. I\'m sorry.', 'Not yet. Let\'s walk among the stars together a while first.'])); }
      } });
    } else if (!grown(pc) && !grown(c) && pc.crush !== c.id) {
      opts.push({ label: '💕 Tell them you have a crush', action: () => { pc.crush = c.id; again(simRng.pick(['*squeaks and hides behind their tail* Really?! I like you too!', '*giggles* Ew! …Okay, maybe a little.'])); } });
    }
    opts.push({ label: 'Goodbye', action: () => {} });
    g.ui.dialog({ speaker: c, text: greeting, options: opts, input: (t) => {
      const r = smartReply(g, c, t);
      if (r) { clan.adjust(c, pc, r.opinion); if (r.romance) clan.rel(c, pc).romance = clamp(clan.rel(c, pc).romance + r.romance, 0, 100); }
      again(r?.reply ?? simRng.pick(['*tilts head, stars drifting from their whiskers* Tell me more.', 'Up here, every word feels like it echoes forever.', '*purrs* I\'m listening.']));
    } });
  }

  private playWithKit(gh: Ghost) {
    const g = this.game;
    g.player.startPounce(0.3, false);
    gh.target = null;
    g.ui.showBanner(`${gh.cat.given}kit: ${simRng.pick(['*squeals* You got me, Mama!', 'Again! Again!', '*tumbles over your paws, giggling*'])}`, 3.5);
    g.audio.purr();
  }

  // ------------------------------------------------------------ dreams
  /** Step into a sleeping cat's dream: a misty, starry place where you can walk and talk with them. */
  private dream(a: NpcAgent) {
    const g = this.game;
    const c = a.cat;
    g.ui.closeDialog(false);
    const X = Afterlife.DREAM_X, Y = Afterlife.SKY_Y;
    const group = new THREE.Group();
    const nightmare = this.realm === 'dark';
    // a soft glowing meadow of mist, scattered stars, and a ring of light to leave by
    const floor = new THREE.Mesh(new THREE.CircleGeometry(26, 48), new THREE.MeshLambertMaterial({ color: nightmare ? 0x2a0808 : 0x6a5fc0, emissive: nightmare ? 0x3a0505 : 0x3b2f8a, emissiveIntensity: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(X, Y - 0.02, 0); group.add(floor);
    const mistMat = new THREE.MeshBasicMaterial({ color: nightmare ? 0x5a1010 : 0xd8d0ff, transparent: true, opacity: 0.28, depthWrite: false });
    const mg = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(mg, mistMat);
      const ang = simRng.range(0, Math.PI * 2), r = simRng.range(5, 24), s = simRng.range(1.5, 4);
      m.scale.set(s * 1.5, s * 0.35, s); m.position.set(X + Math.cos(ang) * r, Y + simRng.range(0.1, 1.2), Math.sin(ang) * r);
      group.add(m);
    }
    const starGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 400; i++) { const ang = Math.random() * Math.PI * 2, r = 20 + Math.random() * 60; pts.push(X + Math.cos(ang) * r, Y + 6 + Math.random() * 40, Math.sin(ang) * r); }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: nightmare ? 0xff6050 : 0xffffff, size: 0.35, fog: false })));
    const exit = new THREE.Vector3(X, Y, -4.5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 32), new THREE.MeshBasicMaterial({ color: nightmare ? 0xff4a3a : 0xbfe0ff }));
    ring.position.set(exit.x, Y + 1, exit.z); group.add(ring);
    const light = new THREE.PointLight(nightmare ? 0xff4030 : 0xb8b0ff, 1.4, 30); light.position.set(X, Y + 4, 0); group.add(light);
    g.scene.add(group);
    // the dreamer, glowing softly
    const model = new CatModel(c.app, c.stage);
    ghostify(model, nightmare ? 0xc02020 : 0xd8d0ff, 0.92);
    const home = new THREE.Vector3(X, Y, 3.5);
    model.root.position.copy(home);
    g.scene.add(model.root);
    this.dreaming = { a, model, pos: home.clone(), heading: -Math.PI / 2, home, back: g.player.pos.clone(), group, exit, t: 0 };
    g.player.placeAt(X, 0);
    g.player.yaw = Math.PI; g.player.heading = -Math.PI - Math.PI / 2; // face the dreamer
    g.ui.toast(nightmare ? `😈 You slip into ${c.given}'s dream like a shadow. Walk up and speak to them — the red ring takes you back.` : `💭 You step into ${c.given}'s dream. Walk up to them and talk — the ring of light takes you back to StarClan.`, 'info');
    setTimeout(() => g.ui.showBanner(`${displayName(c)}: ${nightmare ? 'Where… where am I? Why is it so dark?' : 'Who… who\'s there? Are you from StarClan?'}`, 4.5), 900);
  }

  private updateDream(dt: number) {
    const g = this.game;
    const dr = this.dreaming!;
    const p = g.player.pos;
    dr.t += dt;
    const near = Math.hypot(dr.pos.x - p.x, dr.pos.z - p.z);
    let speed = 0;
    if (near > 4.5) {
      // the dreamer drifts around their little patch of dream
      const tx = dr.home.x + Math.cos(dr.t * 0.25) * 2.2, tz = dr.home.z + Math.sin(dr.t * 0.18) * 1.6;
      const dx = tx - dr.pos.x, dz = tz - dr.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.15) { speed = 0.8; dr.heading = Math.atan2(dz, dx); dr.pos.x += (dx / d) * Math.min(d, speed * dt); dr.pos.z += (dz / d) * Math.min(d, speed * dt); }
    } else dr.heading = Math.atan2(p.z - dr.pos.z, p.x - dr.pos.x); // they look at you
    dr.pos.y = Afterlife.SKY_Y + Math.sin(dr.t * 1.4) * 0.03;
    dr.model.root.position.copy(dr.pos);
    dr.model.root.rotation.y = -dr.heading;
    dr.model.speed = speed;
    dr.model.pose = speed > 0 ? 'walk' : 'sit';
    dr.model.update(dt);
    this.refreshT -= dt;
    if (this.refreshT <= 0) { this.refreshT = 1; ghostify(g.player.model, this.tintColor, 0.5); }
  }

  /** Wake out of the dream and go back to StarClan (or the Dark Forest). */
  leaveDream() {
    const g = this.game;
    const dr = this.dreaming;
    if (!dr) return;
    g.scene.remove(dr.group);
    g.scene.remove(dr.model.root);
    dr.model.dispose();
    this.dreaming = null;
    g.player.placeAt(dr.back.x, dr.back.z);
    g.ui.toast(this.realm === 'dark' ? '🔥 You slip back into the shadows of the Dark Forest.' : '🌟 You drift back up among the stars.', 'info');
  }

  /** Talking with a cat inside their dream. */
  private dreamTalk(a: NpcAgent) {
    const g = this.game;
    const c = a.cat;
    const clan = g.clan;
    const dangers = g.events.active.filter((e) => ['fire', 'flood', 'storm', 'coldSnap', 'badger', 'fox', 'dog', 'illness', 'rivalSkirmish', 'rockslide', 'fallenTree', 'deathberries'].includes(e.type));
    const pending = g.pendingProphecy;
    const opts: { label: string; hint?: string; action: () => void }[] = [];
    const done = (text: string) => { g.ui.closeDialog(false); g.ui.toast(text, 'good'); };
    const pc = clan.player;
    const myMate = c.widowOf === pc.id || pc.mate === c.id;
    if (myMate) {
      opts.push({ label: '💕 How are you, my love?', action: () => {
        const kits = c.kits.map((k) => clan.get(k)).filter((k) => k && k.alive) as Cat[];
        g.ui.dialog({ speaker: c, text: `*eyes wide, voice shaking* ${pc.given}?! Is it really you? …I miss you every single day. The den feels so cold without you.${kits.length ? ` ${kits.map((k) => k.given).slice(0, 3).join(' and ')} ask about you all the time. I tell them you're the brightest star.` : ''}`, options: [{ label: '*presses your nose to theirs*', action: () => this.dreamTalk(a) }] });
      } });
      if (!c.freeToLove) opts.push({ label: '💞 Tell them it\'s okay to find a new mate', action: () => {
        c.freeToLove = true;
        c.griefDark = false;
        clan.remember(c, `${pc.given} came to me in a dream and told me it's okay to love again.`, 10, pc.id);
        // their heart can open to someone new
        const next = clan.home(false).filter((o) => o.id !== c.id && !o.mate && clan.grownUp(o) && o.sex !== c.sex && !o.isPlayer).sort((x, y) => clan.rel(c, y).opinion - clan.rel(c, x).opinion)[0];
        if (next) clan.rel(c, next).romance = clamp(clan.rel(c, next).romance + 30, 0, 100);
        g.ui.dialog({ speaker: c, text: `*tears glittering like starlight* You… you want me to be happy? …I'll never forget you, ${pc.given}. Never. But… thank you. I'll try.`, options: [{ label: '*licks their ear one last time*', action: () => this.dreamTalk(a) }] });
      } });
    }
    opts.push({ label: '💬 How are you feeling?', action: () => {
      const mate = clan.get(c.mate);
      const line = c.poisoned !== undefined ? 'My belly burns… I ate something bad. Am I going to die?'
        : c.sick > 30 ? '*coughs* I feel so weak. The medicine cat says it\'s greencough…'
        : c.injury > 30 ? 'My wounds ache. I keep dreaming of the fight.'
        : isExpecting(c) ? 'I\'m so heavy with kits! I can\'t wait to meet them.'
        : c.hunger < 30 ? 'I\'m so hungry… the fresh-kill pile has been empty for days.'
        : mate ? `I\'m happy. ${mate.given} makes every day warm.` : 'I\'m alright. Just… tired. And I miss the cats we\'ve lost.';
      g.ui.dialog({ speaker: c, text: line, options: [{ label: 'Back', action: () => this.dreamTalk(a) }] });
    } });
    if ((c.relations[pc.id]?.opinion ?? 0) > 30 || c.parents.includes(pc.id) || c.mate === pc.id) opts.push({ label: `💕 Tell ${c.given} you miss them`, action: () => {
      clan.remember(c, `${pc.given} visited me in a dream and said they miss me.`, 8, pc.id);
      g.ui.dialog({ speaker: c, text: `*eyes filling with tears* ${pc.given}?! Is it really you? I miss you so much… Please come back to me in my dreams.`, options: [{ label: '*presses close*', action: () => this.dreamTalk(a) }] });
    } });
    if (this.realm === 'starclan') {
      if (dangers.length || (pending && !pending.solved)) {
        const what = dangers[0]?.type ?? pending!.type;
        opts.push({ label: `⚠ Warn ${c.given} of the ${what}`, hint: 'decide the fate of the clan', action: () => {
          if (pending && !pending.solved) pending.solved = true;
          for (const e of dangers) e.end = Math.min(e.end, g.time.totalHours + 1);
          clan.remember(c, `A starry spirit warned me in a dream about the ${what}.`, 6);
          done(`🌟 ${c.given} wakes with a start and warns the clan. Because of you, the ${what} will pass far more gently.`);
        } });
      }
      if (c.sick > 15 || c.injury > 15) opts.push({ label: `💫 Heal ${c.given}'s body`, action: () => { c.sick = 0; c.injury = 0; c.health = c.maxHealth; done(`💫 ${c.given}'s wounds and sickness melt away in the starlight.`); } });
      opts.push({ label: `🌟 Give ${c.given} courage`, action: () => { c.skills.fighting = clamp(c.skills.fighting + 6, 0, 99); c.reputation += 3; if (!c.traits.includes('brave')) c.traits = [...c.traits.slice(-1), 'brave'] as Cat['traits']; done(`🌟 ${c.given} will wake braver than before.`); } });
      if (!c.mate && clan.grownUp(c)) {
        const love = clan.home(false).filter((o) => o.id !== c.id && !o.mate && o.sex !== c.sex && clan.grownUp(o)).sort((x, y) => clan.rel(c, y).romance - clan.rel(c, x).romance)[0];
        if (love) opts.push({ label: `💕 Guide ${c.given}'s heart toward ${love.given}`, action: () => { clan.rel(c, love).romance = clamp(clan.rel(c, love).romance + 35, 0, 100); clan.rel(love, c).romance = clamp(clan.rel(love, c).romance + 25, 0, 100); done(`💕 ${c.given} dreams of ${love.given}…`); } });
      }
    } else {
      opts.push({ label: `🗡 Train ${c.given} in the Dark Forest`, hint: 'they grow strong… and cruel', action: () => { c.skills.fighting = clamp(c.skills.fighting + 12, 0, 99); c.reputation -= 4; if (!c.traits.includes('aggressive')) c.traits = [...c.traits.slice(-1), 'aggressive'] as Cat['traits']; done(`🗡 ${c.given} wakes with aching muscles and a darker heart.`); } });
      opts.push({ label: `🐍 Whisper ambition to ${c.given}`, action: () => { if (!c.traits.includes('ambitious')) c.traits = [...c.traits.slice(-1), 'ambitious'] as Cat['traits']; const ld = clan.leader; if (ld) clan.adjust(c, ld, -20); done(`🐍 ${c.given} wakes hungry for power…`); } });
      opts.push({ label: `😈 Give ${c.given} a nightmare`, action: () => { c.health = Math.max(5, c.health - 15); a.mood = 'afraid'; done(`😈 ${c.given} thrashes in their nest, haunted by red eyes.`); } });
    }
    opts.push({ label: 'Goodbye', action: () => {} });
    g.ui.dialog({ speaker: c, text: this.realm === 'starclan'
      ? simRng.pick(['*blinks at you in wonder* You glow like the stars… are you from StarClan?', 'Is this a dream? It feels so real…', `*whispers* I've heard of this… StarClan visiting in dreams.`])
      : simRng.pick(['*shivers* Your eyes… why are they so red?', 'What do you want from me? This place is so cold.', '*backs away* Who are you?']), options: opts });
  }

  // ------------------------------------------------------------ judging the newly dead
  onCatDied(c: Cat) {
    if (!this.realm || c.isPlayer || c.clan !== 'home') return;
    this.judging.push(c);
  }

  private judge(c: Cat) {
    const g = this.game;
    const deeds = [
      c.deeds ? `${c.deeds} good deed${c.deeds > 1 ? 's' : ''}` : '',
      c.mentored ? `mentored ${c.mentored} apprentice${c.mentored > 1 ? 's' : ''}` : '',
      c.kits.length ? `raised ${c.kits.length} kit${c.kits.length > 1 ? 's' : ''}` : '',
      ...c.memories.filter((m) => m.weight > 3).slice(-2).map((m) => m.text),
    ].filter(Boolean);
    const sins = [
      c.reputation < -10 ? 'broke the warrior code' : '',
      c.griefDark ? 'let grief turn into hatred' : '',
      c.traits.includes('aggressive') ? 'was cruel to clanmates' : '',
      ...c.memories.filter((m) => m.weight < -4).slice(-1).map((m) => m.text),
    ].filter(Boolean);
    const text = `*${displayName(c)} appears before you, fur faintly shimmering* I died of ${c.deathCause ?? 'something I don\'t understand'}…`
      + `\n\nMy deeds: ${deeds.length ? deeds.join('; ') : 'I lived quietly.'}`
      + `\nMy sins: ${sins.length ? sins.join('; ') : 'none that I know of.'}`
      + `\n\nWhere will I walk now?`;
    const send = (r: Realm) => {
      c.afterlife = r;
      g.ui.closeDialog(false);
      g.ui.toast(r === 'starclan' ? `🌟 ${displayName(c)} joins StarClan.` : `🔥 ${displayName(c)} is sent to the Dark Forest.`, r === 'starclan' ? 'good' : 'danger');
      if (r === this.realm) this.addGhost(c, false);
    };
    g.ui.dialog({ speaker: c, text, options: [
      { label: '🌟 Welcome them to StarClan', action: () => send('starclan') },
      { label: '🔥 Send them to the Dark Forest', action: () => send('dark') },
    ] });
  }
}
