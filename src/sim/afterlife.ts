// StarClan and the Dark Forest: after you die you can walk among the spirits as a ghost.
// The living can't see you — except in their dreams, where you can warn, heal and guide them
// (or, in the Dark Forest, tempt and train them). You also judge the cats who die after you.
// While you're alive, the spirits of the dead glimmer in the night sky.
import * as THREE from 'three';
import type { Game } from '../game';
import type { NpcAgent } from '../ai/npc';
import type { Prompt } from './interactions';
import { CatModel, Pose } from '../cats/model';
import { Cat, displayName } from '../cats/types';
import { createCat } from '../cats/generate';
import { simRng } from '../core/rng';
import { clamp } from '../core/math';

export type Realm = 'starclan' | 'dark';

interface Ghost {
  cat: Cat;
  model: CatModel;
  pos: THREE.Vector3;
  heading: number;
  target: THREE.Vector3 | null;
  wait: number;
  kit: boolean;
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

export class Afterlife {
  /** StarClan is a land of clouds high in a dreamy blue sky. */
  static readonly SKY_Y = 600;
  realm: Realm | null = null;
  get inSky() { return this.realm === 'starclan'; }
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
    this.applyLook();
    this.spawnGhosts();
  }

  leave() {
    const g = this.game;
    this.realm = null;
    for (const gh of this.ghosts.values()) { g.scene.remove(gh.model.root); gh.model.dispose(); }
    this.ghosts.clear();
    for (const c of this.clouds) { this.cloudGroup.remove(c); }
    this.clouds = [];
    for (const c of this.floor) this.cloudGroup.remove(c);
    this.floor = [];
    if (this.pool) { this.cloudGroup.remove(this.pool); this.pool = null; }
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
      const pose: Pose = speed > 0 ? 'walk' : gh.kit ? (Math.sin(g.clock * 2 + gh.heading) > 0.3 ? 'pounce' : 'sit') : 'sit';
      gh.model.pose = pose;
      gh.model.update(dt);
      if (gh.kit && this.kitPlayT <= 0 && simRng.chance(dt * 0.15)) {
        this.kitPlayT = 12;
        g.ui.showBanner(`${gh.cat.given}kit: ${simRng.pick(['Mama! Play with us!', 'Catch me, Mama! *giggles*', 'Look, the stars are so pretty here!', 'We\'re never going to leave you, Mama.'])}`, 4);
      }
    }
    // a newly dead clanmate is waiting to be judged
    if (this.judging.length && !g.ui.isBusy() && !g.player.busy) this.judge(this.judging.shift()!);
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
    // StarClan: the Star Pool shows you the living, and lets you walk into their dreams
    if (this.inSky && this.pool && Math.hypot(this.pool.position.x - p.x, this.pool.position.z - p.z) < 2.6) {
      return { text: '🌙 Gaze into the Star Pool — visit a dream', at: { x: this.pool.position.x, y: Afterlife.SKY_Y + 0.6, z: this.pool.position.z }, action: () => this.starPool() };
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
    if (this.inSky) return null;
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

  /** Look down through the Star Pool and choose a sleeping cat to visit. */
  private starPool() {
    const g = this.game;
    const sleepers = [...g.npcs.agents.values()].filter((a) => a.cat.clan === 'home' && a.cat.alive && (a.activity === 'sleep' || a.model.pose === 'sleep'));
    if (!sleepers.length) {
      g.ui.dialog({ text: 'The Star Pool shimmers. Far below, your clan is busy and awake… Come back when they sleep — at night, or when a cat naps in the day.', options: [{ label: 'Step back from the pool', action: () => {} }] });
      return;
    }
    g.ui.choice('🌙 The Star Pool', 'Ripples of starlight show your clan asleep far below. Whose dream will you visit?', [
      ...sleepers.slice(0, 8).map((a) => ({ label: `💭 ${a.name}${a.cat.sick > 20 || a.cat.injury > 20 ? ' (hurt or sick)' : ''}`, action: () => this.dream(a) })),
      { label: 'Not now', action: () => {} },
    ]);
  }

  /** Draw the world while you're up in StarClan: only the sky, the clouds and the spirits. */
  renderSky(render: () => void) {
    const g = this.game;
    const keep = new Set<THREE.Object3D>([this.cloudGroup, g.player.model.root]);
    for (const gh of this.ghosts.values()) keep.add(gh.model.root);
    const hidden: THREE.Object3D[] = [];
    for (const o of g.scene.children) {
      const sky = o instanceof THREE.AmbientLight || o instanceof THREE.HemisphereLight || o instanceof THREE.DirectionalLight;
      if (keep.has(o) || sky || !o.visible) continue;
      o.visible = false; hidden.push(o);
    }
    const bg = g.scene.background;
    g.scene.background = this.skyColor;
    render();
    g.scene.background = bg;
    for (const o of hidden) o.visible = true;
  }
  private skyColor = new THREE.Color(0x1f3a86);

  private talkGhost(gh: Ghost) {
    const g = this.game;
    const c = gh.cat;
    const pc = g.clan.player;
    const good = c.memories.filter((m) => m.weight > 0).slice(-2).map((m) => m.text);
    const lines = this.realm === 'dark'
      ? [`*eyes glinting red* So you've come to the Dark Forest too, ${pc.given}.`, 'The living are weak. Visit their dreams… make them strong. Make them ours.', 'StarClan won\'t have us. So we make our own path.']
      : [`*purrs, fur shimmering with stars* Welcome, ${pc.given}. You're home now.`, `I watch over ${g.territories.homeName} every night. ${good[0] ? `I still remember: ${good[0]}` : ''}`, 'When the living sleep, go to them. Warn them. They need us.'];
    const opts: { label: string; action: () => void }[] = [
      { label: 'Tell me about your life', action: () => g.ui.dialog({ speaker: c, text: `I lived ${Math.floor(c.age)} moons as ${c.stage === 'kit' ? 'a kit' : c.role === 'leader' ? 'leader' : c.role === 'medicine' ? 'a medicine cat' : c.stage === 'elder' ? 'an elder' : 'a warrior'} of ${g.territories.homeName}. I died of ${c.deathCause ?? 'something I don\'t like to remember'}.${good[0] ? ` I still think about it: ${good[0]}` : ''}${c.kits.length ? ` I had ${c.kits.length} kit${c.kits.length > 1 ? 's' : ''} — I watch them from here.` : ''}`, options: [{ label: '*purrs*', action: () => {} }] }) },
      { label: 'Will you watch over the clan with me?', action: () => g.ui.dialog({ speaker: c, text: this.realm === 'dark' ? '*laughs coldly* Watch over them? I watch them… and I wait.' : 'Always. Every star you see from the camp is one of us, keeping watch.', options: [{ label: '*touches noses*', action: () => {} }] }) },
      { label: 'Goodbye', action: () => {} },
    ];
    g.ui.dialog({ speaker: c, text: simRng.pick(lines), options: opts });
  }

  private playWithKit(gh: Ghost) {
    const g = this.game;
    g.player.startPounce(0.3, false);
    gh.target = null;
    g.ui.showBanner(`${gh.cat.given}kit: ${simRng.pick(['*squeals* You got me, Mama!', 'Again! Again!', '*tumbles over your paws, giggling*'])}`, 3.5);
    g.audio.purr();
  }

  // ------------------------------------------------------------ dreams
  private dream(a: NpcAgent) {
    const g = this.game;
    const c = a.cat;
    const clan = g.clan;
    const dangers = g.events.active.filter((e) => ['fire', 'flood', 'storm', 'coldSnap', 'badger', 'fox', 'dog', 'illness', 'rivalSkirmish', 'rockslide', 'fallenTree', 'deathberries'].includes(e.type));
    const pending = g.pendingProphecy;
    const opts: { label: string; hint?: string; action: () => void }[] = [];
    const done = (text: string) => { g.ui.closeDialog(false); g.ui.toast(text, 'good'); };
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
    opts.push({ label: 'Leave the dream', action: () => g.ui.closeDialog(false) });
    g.ui.dialog({ speaker: c, text: this.realm === 'starclan'
      ? `*${c.given} stirs in their sleep* You step into their dream like starlight. "Who… who's there? Are you from StarClan?"`
      : `*${c.given} twitches in their sleep* You slip into their dream like a shadow. "Where… where am I? Why is it so dark?"`, options: opts });
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
