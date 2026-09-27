// Game orchestrator: owns every system, runs the main loop, handles new game,
// loading, sleeping, time skips, death and succession.
import * as THREE from 'three';
import { clanTitle, lore } from './lore';
import { Bus } from './core/bus';
import { GameTime } from './core/time';
import { RNG, simRng } from './core/rng';
import { clamp } from './core/math';
import { Terrain } from './world/terrain';
import { Territories } from './world/territory';
import { ChunkManager, Collider } from './world/chunks';
import { Camp } from './world/camp';
import { Sky } from './world/sky';
import { Weather, WEATHER_LABEL } from './world/weather';
import { Ambient } from './world/ambient';
import { FireSystem } from './world/fire';
import { emptyMods, WorldMods } from './world/worldState';
import { sharedUniforms } from './world/assets';
import { ClanSim, RuleId } from './sim/clan';
import { EventSystem } from './sim/events';
import { Objectives } from './sim/objectives';
import { TrainingSystem } from './sim/training';
import { DecisionSystem } from './sim/decisions';
import { Interactions } from './sim/interactions';
import { Discoveries } from './sim/discoveries';
import { NpcManager } from './ai/npc';
import { Player } from './player/player';
import { Input } from './player/input';
import { CombatSystem, Fighter } from './player/combat';
import { ScentSystem } from './player/scent';
import { PreyManager } from './wildlife/prey';
import { CreatureManager } from './wildlife/creatures';
import { AudioEngine, SoundEnv } from './audio/audio';
import { UI } from './ui/ui';
import { Menus, NewGameSpec, Settings, loadSettings } from './ui/menus';
import { TouchControls, isTouchDevice } from './ui/touch';
import { hasSave, readSave, writeSave } from './save/save';
import { Appearance, Cat, LifeStage, displayName, LESSONS } from './cats/types';
import { createCat } from './cats/generate';
import { CatModel } from './cats/model';

export type GameState = 'loading' | 'title' | 'create' | 'playing' | 'paused' | 'dead';

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  bus = new Bus();
  time = new GameTime();
  clock = 0;
  uTime = { value: 0 };
  state: GameState = 'loading';
  settings: Settings;
  input: Input;
  audio = new AudioEngine();
  seed = 1;
  terrain!: Terrain;
  territories!: Territories;
  mods: WorldMods = emptyMods();
  chunks!: ChunkManager;
  camp!: Camp;
  sky: Sky;
  weather: Weather;
  ambient: Ambient;
  fire: FireSystem;
  clan: ClanSim;
  npcs: NpcManager;
  player: Player;
  prey: PreyManager;
  creatures: CreatureManager;
  combat: CombatSystem;
  events: EventSystem;
  objectives: Objectives;
  training: TrainingSystem;
  decisions: DecisionSystem;
  interactions: Interactions;
  discoveries: Discoveries;
  scent: ScentSystem;
  ui: UI;
  menus: Menus;
  touch: TouchControls | null = null;
  windDir = new THREE.Vector2(1, 0);
  private windAngle = Math.random() * Math.PI * 2;
  private lastHour = 0;
  private last = performance.now();
  private autosaveT = 15;
  private previewModel: CatModel | null = null;
  private sleepUntil: number | null = null;
  private audioT = 0;
  private waterProx = 0;
  private campColliders: Collider[] = [];
  private seasonKey = '';

  constructor(private canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.02, 1400);
    this.scene.add(this.camera);
    this.input = new Input(canvas);
    this.sky = new Sky(this.scene);
    this.weather = new Weather(this.scene);
    this.ambient = new Ambient(this.scene);
    this.clan = new ClanSim(this);
    this.npcs = new NpcManager(this);
    this.player = new Player(this);
    this.prey = new PreyManager(this);
    this.creatures = new CreatureManager(this);
    this.combat = new CombatSystem(this);
    this.events = new EventSystem(this);
    this.objectives = new Objectives(this);
    this.training = new TrainingSystem(this);
    this.decisions = new DecisionSystem(this);
    this.interactions = new Interactions(this);
    this.discoveries = new Discoveries(this);
    this.fire = new FireSystem(this);
    this.scent = new ScentSystem(this);
    this.ui = new UI(this);
    this.menus = new Menus(this);
    if (isTouchDevice()) this.touch = new TouchControls(this);
    this.weather.onLightning = (d) => {
      this.sky.lightning = 1 - d * 0.6;
      this.audio.thunder(d);
    };
    window.addEventListener('resize', () => this.resize());
    this.resize();
    canvas.addEventListener('click', () => {
      this.audio.start();
      if (this.state === 'playing' && !this.ui.isBusy() && !this.player.busy) this.input.lock();
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.ui.isBusy() && !this.player.busy && !this.touch) this.pause();
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'paused') { this.resume(); e.preventDefault(); }
        else if (this.state === 'playing' && this.ui.panels.isOpen) { this.ui.panels.close(); e.preventDefault(); }
        else if (this.state === 'playing' && !this.ui.isBusy() && !this.player.busy) { this.pause(); e.preventDefault(); }
      }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.save(); });
    window.addEventListener('beforeunload', () => { if (this.state === 'playing' || this.state === 'paused') this.save(); });
    this.applySettings();
  }

  // ------------------------------------------------------------ boot
  async boot() {
    this.menus.loading('Growing the forest…');
    await new Promise((r) => setTimeout(r, 30));
    const save = readSave();
    lore.mode = save?.lore ?? 'classic';
    this.setupWorld(save?.seed ?? 4242, save?.homeName);
    this.time.totalHours = 17.8;
    this.chunks.primeAround(0, 0);
    this.state = 'title';
    this.menus.title(hasSave());
    this.loop();
  }

  private setupWorld(seed: number, homeName?: string) {
    if (this.chunks) {
      this.chunks.invalidateAll();
      this.scene.remove(this.chunks.root);
    }
    if (this.camp) this.scene.remove(this.camp.group);
    this.seed = seed;
    this.terrain = new Terrain(seed);
    this.territories = new Territories(seed, homeName);
    for (const l of this.territories.landmarks) {
      if (l.kind === 'pond') this.terrain.addMod(l.x, l.z, l.radius, 'pond');
      else if (l.kind === 'trainingHollow') this.terrain.addMod(l.x, l.z, 9, 'flat');
      else if (l.kind === 'councilRocks') this.terrain.addMod(l.x, l.z, 16, 'flat');
    }
    this.mods = emptyMods();
    this.chunks = new ChunkManager({ terrain: this.terrain, territories: this.territories, mods: this.mods, season: this.time.season, day: this.time.day, seed }, this.scene);
    this.camp = new Camp(this.terrain, this.scene);
    this.campColliders = this.camp.colliders;
    this.applySettings();
  }

  // ------------------------------------------------------------ helpers used by systems
  groundAt(x: number, z: number) { return this.chunks.groundHeight(x, z); }
  collidersNear(x: number, z: number, out: Collider[] = []): Collider[] {
    this.chunks.collidersNear(x, z, out);
    if (x * x + z * z < 30 * 30) for (const c of this.campColliders) if (Math.abs(c.x - x) < c.r + 3 && Math.abs(c.z - z) < c.r + 3) out.push(c);
    return out;
  }
  weatherLabel() { return WEATHER_LABEL[this.weather.kind]; }
  notify(text: string, kind = 'info') { this.ui.toast(text, kind); }

  ceremony(text: string, ids: string[]) {
    this.ui.showBanner(text, 11);
    this.npcs.startCeremony(text, ids);
    this.audio.chime();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applySettings() {
    const s = this.settings;
    const dpr = window.devicePixelRatio || 1;
    const q = s.quality;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) * 0.8 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    if (this.chunks) {
      const r = q === 'low' ? 2 : q === 'medium' ? 3 : 4;
      const dr = q === 'high' ? 2 : 1;
      const gd = q === 'low' ? 0.45 : q === 'medium' ? 0.8 : 1.15;
      if (r !== this.chunks.radius || dr !== this.chunks.detailRadius || gd !== this.chunks.grassDensity) {
        this.chunks.radius = r;
        this.chunks.detailRadius = dr;
        this.chunks.grassDensity = gd;
        this.chunks.invalidateAll();
      }
    }
    this.prey.max = q === 'low' ? 14 : 22;
    this.renderer.shadowMap.enabled = s.shadows;
    this.sky.setShadowQuality(q === 'low' ? 1024 : 2048, s.shadows);
    this.audio.setVolume(s.volume);
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.time.daySeconds = s.dayMinutes * 60;
    this.ui.showFps = s.showFps;
    this.resize();
  }

  // ------------------------------------------------------------ game setup
  newGame(spec: NewGameSpec) {
    this.state = 'loading';
    this.menus.loading('You open your eyes for the first time…');
    this.clearPreview();
    setTimeout(() => {
      this.resetSystems();
      this.time.totalHours = 7;
      this.lastHour = Math.floor(this.time.totalHours);
      lore.mode = spec.lore;
      this.setupWorld(spec.seed, spec.clanName);
      const rng = new RNG(spec.seed * 7 + 3);
      const me = createCat({ age: 3, sex: spec.sex, given: spec.name, app: { ...spec.app }, day: 0, rng: new RNG((Math.random() * 1e9) | 0) });
      this.clan.newClan(me, rng);
      this.weather.kind = 'sunny';
      const nursery = this.camp.dens.nursery;
      this.chunks.primeAround(0, 0);
      this.npcs.syncRoster();
      this.player.attach();
      this.player.placeAt(nursery.x + 1.2, nursery.z - 1.2, Math.atan2(nursery.x, nursery.z) + Math.PI);
      this.objectives.add({ id: 'kit-elders', kind: 'visit', title: 'Visit the elders\' den', desc: 'The elders tell the best stories. Their den is under the old log on the far side of camp.', target: { x: this.camp.dens.elders.x, z: this.camp.dens.elders.z }, radius: 3.5, need: 1, reward: { rep: 1 } });
      this.objectives.add({ id: 'kit-rock', kind: 'visit', title: 'See the High Rock', desc: 'The Warden speaks to the clan from the High Rock.', target: { x: this.camp.highRock.x, z: this.camp.highRock.z + 3 }, radius: 4, need: 1 });
      this.startPlaying();
      const mother = this.clan.get(me.parents[0]);
      this.ui.showBanner(`You are ${displayName(me)}, a kit of ${clanTitle(this.territories.homeName)}. ${mother ? `Your mother ${displayName(mother)} watches over you in the nursery.` : ''} Stay inside the camp until you are old enough to train.`, 12);
      this.save();
    }, 60);
  }

  continueGame() {
    const d = readSave();
    if (!d) { this.menus.create(); return; }
    this.state = 'loading';
    this.menus.loading('Returning to the forest…');
    setTimeout(() => {
      this.resetSystems();
      this.time.totalHours = d.totalHours;
      this.lastHour = Math.floor(d.totalHours);
      lore.mode = d.lore ?? 'original';
      this.setupWorld(d.seed, d.homeName);
      Object.assign(this.mods, d.mods);
      const c = this.clan;
      c.cats = d.clan.cats;
      c.leaderId = d.clan.leaderId;
      c.deputyId = d.clan.deputyId;
      c.medicineId = d.clan.medicineId;
      c.food = d.clan.food;
      c.journal = d.clan.journal;
      c.rivals = d.clan.rivals;
      c.playerId = d.clan.playerId;
      c.generation = d.clan.generation;
      c.lineage = d.clan.lineage;
      c.borderSafety = d.clan.borderSafety;
      c.usedNames = new Set(d.clan.usedNames);
      this.weather.kind = (d.weather.kind as any) ?? 'sunny';
      this.weather.snowCover = d.weather.snowCover ?? 0;
      this.events.load(d.events);
      this.chunks.setWaterLevel(this.events.waterTarget);
      this.objectives.load(d.objectives);
      this.training.lastLessonHour = d.player.lastLesson ?? -99;
      this.chunks.setContext(this.time.season, this.time.day);
      this.chunks.primeAround(d.player.x, d.player.z);
      this.camp.setPileCount(c.food);
      this.npcs.syncRoster();
      this.player.thirdPerson = d.player.thirdPerson;
      this.player.attach();
      this.player.placeAt(d.player.x, d.player.z, d.player.yaw);
      this.player.prey = d.player.prey ?? [];
      this.player.herbs = d.player.herbs ?? { silverleaf: 0, sunpetal: 0, bitterroot: 0 };
      this.player.moss = d.player.moss ?? 0;
      this.player.updateCarryVisual();
      this.startPlaying();
      this.ui.toast(`Welcome back, ${displayName(c.player)}.`, 'good');
    }, 60);
  }

  private resetSystems() {
    this.npcs.list.forEach((a) => this.npcs.removeAgent(a.id));
    this.prey.clear();
    this.creatures.clear();
    this.combat.active.clear();
    this.objectives.list = [];
    this.clan.pending = [];
    this.clan.patrols = [];
    this.clan.journal = [];
    this.clan.cats = {};
    this.clan.usedNames = new Set();
    this.clan.generation = 1;
    this.clan.lineage = [];
    this.clan.lastRecent = '';
    this.events.active = [];
    this.events.cooldown = {};
    this.events.waterTarget = 0;
    this.fire.fires = [];
    this.npcs.evacuate = null;
    this.npcs.gatheringActive = false;
    this.player.prey = [];
    this.player.moss = 0;
    this.player.herbs = { silverleaf: 0, sunpetal: 0, bitterroot: 0 };
    this.player.sleeping = false;
    this.player.busy = false;
    this.sleepUntil = null;
    this.time.speed = 1;
    this.training.lastLessonHour = -99;
    this.weather.forced = null;
    this.weather.snowCover = 0;
    this.chunks?.setWaterLevel(0);
  }

  private startPlaying() {
    this.menus.clear();
    this.state = 'playing';
    this.ui.showHud(true);
    this.touch?.show(true);
    this.input.clear();
    this.input.lock();
    this.seasonKey = this.time.season;
    this.player.lastTerritory = '';
    this.ui.fade(false);
  }

  toTitle() {
    this.state = 'title';
    this.ui.showHud(false);
    this.touch?.show(false);
    this.ui.panels.close();
    this.ui.closeDialog(false);
    this.ui.closeModal();
    this.input.unlock();
    this.clearPreview();
    this.npcs.list.forEach((a) => this.npcs.removeAgent(a.id));
    this.prey.clear();
    this.creatures.clear();
    if (this.player.model) this.player.model.root.visible = false;
    this.time.totalHours = 17.8;
    this.menus.title(hasSave());
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.unlock();
    this.ui.closeDialog(false);
    this.menus.pause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menus.clear();
    this.state = 'playing';
    this.player.busy = false;
    this.input.clear();
    this.input.lock();
  }

  save() {
    if (!this.clan.playerId || !this.clan.player) return;
    if (this.state !== 'playing' && this.state !== 'paused') return;
    writeSave(this);
  }

  // ------------------------------------------------------------ creation preview
  showPreview(app: Appearance, stage: LifeStage) {
    this.state = 'create';
    if (!this.previewModel) {
      this.previewModel = new CatModel(app, stage);
      this.scene.add(this.previewModel.root);
    } else {
      this.previewModel.setAppearance({ ...app });
      this.previewModel.setStage(stage);
    }
    this.previewModel.pose = 'stand';
  }
  private clearPreview() {
    if (this.previewModel) { this.previewModel.dispose(); this.previewModel = null; }
  }

  // ------------------------------------------------------------ life events
  onPlayerStageChange() {
    this.player.refreshStage();
    const c = this.clan.player;
    if (c.stage === 'apprentice') {
      this.ui.toast('You are an apprentice! You may now leave camp with your mentor. Your mentor will find you for lessons.', 'good');
      this.objectives.fail('kit-elders', true);
      this.objectives.fail('kit-rock', true);
    } else if (c.stage === 'warrior') {
      this.ui.toast('You are a warrior! Hunt, patrol, and serve your clan. One day you may mentor an apprentice.', 'good');
    } else if (c.stage === 'elder') {
      this.ui.toast('You have retired to the elders\' den. Rest, and pass on your wisdom.', 'good');
    }
    this.save();
  }

  onPlayerRoleChange() {
    const c = this.clan.player;
    if (c.role === 'leader') this.ui.toast('You are the Warden of the clan! Press L to hold council, make decisions and give orders.', 'objective');
    else if (c.role === 'deputy') this.ui.toast('You are the Second! You will organise the daily patrols (L).', 'objective');
  }

  onPlayerWonFight(f: Fighter) {
    const c = this.clan.player;
    c.reputation = clamp(c.reputation + 2, -100, 100);
    this.clan.remember(c, `I drove off ${f.name} in a fight.`, 2);
  }

  knockedOut(by: Fighter) {
    const c = this.clan.player;
    this.combat.disengage(this.player);
    this.ui.fade(true, 'Everything goes dark…');
    this.player.frozen = true;
    const cr = this.creatures.get(by.id);
    if (cr) this.creatures.driveOff(cr.id, this.player);
    const ag = this.npcs.agents.get(by.id);
    if (ag && ag.cat.clan !== 'home') { ag.hostile = false; ag.activity = 'leaving'; ag.setTarget(ag.pos.x * 2, ag.pos.z * 2); ag.actTimer = 20; }
    setTimeout(() => {
      c.health = Math.max(c.health, 35);
      c.injury = clamp(c.injury + 30, 0, 100);
      if (!c.exiled) {
        const d = this.camp.dens.medicine;
        this.player.placeAt(d.x + 0.8, d.z + 0.8);
        this.clan.remember(c, `I was beaten by ${by.name.toLowerCase()} and woke in the medicine den.`, -3);
        this.ui.toast(`You wake in the medicine den, sore and bruised. ${this.clan.medicine ? displayName(this.clan.medicine) + ' tends your wounds.' : ''}`, 'info');
      } else {
        this.ui.toast('You wake alone, aching. The forest is quiet.', 'info');
      }
      this.time.totalHours += 2;
      this.player.frozen = false;
      this.ui.fade(false);
    }, 2500);
  }

  onPlayerDeath(cause: string) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    const c = this.clan.player;
    this.combat.active.clear();
    this.input.unlock();
    this.ui.panels.close();
    this.ui.closeDialog(false);
    this.ui.closeModal();
    this.objectives.list = [];
    this.audio.toll();
    this.ui.fade(true, `${displayName(c)} has died.`);
    this.ui.showHud(false);
    this.touch?.show(false);
    setTimeout(() => {
      this.ui.fade(false);
      this.menus.memorial(c, cause);
    }, 3000);
  }

  continueAs(cat: Cat) {
    const old = this.clan.player;
    if (old) {
      old.isPlayer = false;
      this.clan.lineage.push(old.id);
    }
    const agent = this.npcs.agents.get(cat.id);
    const pos = agent ? agent.pos.clone() : new THREE.Vector3(0, 0, 3);
    this.npcs.removeAgent(cat.id);
    cat.isPlayer = true;
    this.clan.playerId = cat.id;
    this.clan.generation++;
    this.clan.log(`The story continues through ${displayName(cat)}.`, 'clan');
    this.clan.remember(cat, `${old ? displayName(old) + ' is gone. ' : ''}Now my own path begins.`, 5);
    this.player.prey = [];
    this.player.moss = 0;
    this.player.herbs = { silverleaf: 0, sunpetal: 0, bitterroot: 0 };
    this.player.attach();
    this.player.placeAt(pos.x, pos.z);
    this.objectives.list = [];
    this.training.lastLessonHour = -99;
    this.player.sleeping = false;
    this.sleepUntil = null;
    this.time.speed = 1;
    this.startPlaying();
    this.ui.showBanner(`You are now ${displayName(cat)}, ${cat.stage === 'kit' ? 'a kit' : cat.stage === 'apprentice' ? 'an apprentice' : cat.stage === 'elder' ? 'an elder' : 'a warrior'} of ${clanTitle(this.territories.homeName)}. Generation ${this.clan.generation}.`, 10);
    this.save();
  }

  /** Consequence ladder for the player's code violations. */
  consequence(rule: RuleId) {
    const clan = this.clan;
    const p = clan.player;
    const n = p.infractions;
    const enforcer = clan.deputy && !clan.deputy.isPlayer ? clan.deputy : clan.leader && !clan.leader.isPlayer ? clan.leader : null;
    const eName = enforcer ? displayName(enforcer) : 'The clan';
    if (p.role === 'leader') {
      for (const c of clan.home()) if (c.traits.includes('loyal') || c.traits.includes('serious')) clan.adjust(c, p, -3);
      this.ui.toast('As Warden you answer to no one — but the clan is watching.', 'info');
      return;
    }
    if (rule === 'kitLeaveCamp') return; // the leader comes to deal with kits in person
    if (n <= 2) {
      this.ui.toast(`${eName}: "${p.given}, I know what you did. Don't let it happen again."`, 'danger');
    } else if (n === 3) {
      this.ui.toast(`${eName} scolds you in front of the clan and gives you extra duties.`, 'danger');
      this.objectives.add({ id: 'punish-moss', kind: 'moss', title: 'Punishment: clean the elders\' bedding', desc: 'Bring three clumps of fresh moss to the elders\' den.', need: 3, giver: enforcer?.id, order: true, deadline: this.time.totalHours + 24, reward: { rep: 3 } });
    } else if (n === 4) {
      p.confinedUntil = this.time.day + 2;
      this.ui.toast(`${eName}: "You are confined to camp for two moons." Leaving will make things worse.`, 'danger');
      clan.log(`${p.given} was confined to camp.`, 'rule');
    } else if (n === 5) {
      if (p.stage === 'apprentice') {
        const l = LESSONS.find((x) => p.training[x] > 0);
        if (l) p.training[l]--;
        this.ui.toast('Your training has been set back as punishment.', 'danger');
      } else if (p.apprentice) {
        const ap = clan.get(p.apprentice)!;
        p.apprentice = null;
        ap.mentor = null;
        const m = clan.pickMentor(ap);
        if (m) { ap.mentor = m.id; m.apprentice = ap.id; }
        this.ui.toast(`Your apprentice ${ap.given} has been given to another mentor.`, 'danger');
        clan.log(`${p.given}'s apprentice was reassigned.`, 'rule');
      } else {
        p.reputation -= 10;
        this.ui.toast('The Warden has lost patience with you. One more offence could mean exile.', 'danger');
      }
    } else {
      const leader = clan.leader;
      const op = leader ? clan.opinion(leader, p) : 0;
      if (p.reputation < -30 && (op < -10 || p.reputation < -55)) this.exilePlayer();
      else this.ui.toast(`${leader ? displayName(leader) : 'The Warden'}: "This is your last warning. Break the code again and you will be driven out."`, 'danger');
    }
  }

  exilePlayer() {
    const clan = this.clan;
    const p = clan.player;
    p.exiled = true;
    if (p.role === 'deputy') { clan.deputyId = null; p.role = 'none'; }
    if (p.apprentice) { const ap = clan.get(p.apprentice); if (ap) { ap.mentor = null; const m = clan.pickMentor(ap); if (m) { ap.mentor = m.id; m.apprentice = ap.id; } } p.apprentice = null; }
    if (p.mentor) { const m = clan.get(p.mentor); if (m) m.apprentice = null; p.mentor = null; }
    this.objectives.list = [];
    clan.log(`${displayName(p)} was exiled from the clan.`, 'politics');
    clan.remember(p, 'I was exiled from my clan. I must survive alone — or find a way back.', -12);
    this.ceremony(`${clan.leader ? displayName(clan.leader) : 'The Warden'}: "${p.given}, you have broken the code too many times. You are no longer one of us. Leave, and do not return."`, [p.id]);
    // friends grieve
    const friends = clan.home().filter((c) => !c.isPlayer && (c.relations[p.id]?.opinion ?? 0) >= 40);
    for (const f of friends) {
      clan.remember(f, `${p.given} was exiled. It broke my heart.`, -6, p.id);
      clan.adjust(f, p, 5);
      const ag = this.npcs.agents.get(f.id);
      if (ag) { ag.mood = 'sad'; ag.say(simRng.pick(['No... not ' + p.given + '!', 'This isn\'t fair!', '*wails softly*', 'I\'ll find you. I promise.']), 5); }
    }
    if (friends.length) setTimeout(() => this.ui.toast(`${friends.slice(0, 3).map((f) => f.given).join(', ')}${friends.length > 3 ? ' and others' : ''} watch you go with sorrow in their eyes. Friends may still help you in secret — and speak for your return.`, 'info'), 4000);
    this.ui.toast('You have been exiled. Leave the territory. After some time, a clanmate may speak for your return.', 'danger');
    this.objectives.add({ id: 'exile', kind: 'free', title: 'Exiled', desc: 'Leave the territory and survive. Hunt, and sleep in caves or hollows. After a few moons, ask a clanmate outside camp to speak for your return.', need: 1 });
    p.confinedUntil = this.time.day;
  }

  // ------------------------------------------------------------ sleep & time
  sleep() {
    if (this.combat.playerInCombat) { this.ui.toast('You can\'t sleep while in danger!', 'danger'); return; }
    const h = this.time.hour;
    const night = h >= 19 || h < 5;
    const target = night ? (h >= 19 ? Math.floor(this.time.totalHours / 24) * 24 + 24 + 6.5 : Math.floor(this.time.totalHours / 24) * 24 + 6.5) : this.time.totalHours + 3;
    this.sleepUntil = target;
    this.player.sleeping = true;
    this.ui.fade(true, night ? 'You curl up in the moss and drift to sleep…' : 'You doze in the warm den…');
    setTimeout(() => { if (this.player.sleeping) this.time.speed = 60; }, 900);
  }

  private wake() {
    this.sleepUntil = null;
    this.time.speed = 1;
    this.player.sleeping = false;
    const c = this.clan.player;
    c.health = Math.min(c.maxHealth, c.health + 20);
    this.player.stamina = 100;
    this.ui.fade(false);
    this.ui.toast(this.time.hour < 8 ? 'Dawn light filters into the den. A new moon begins.' : 'You wake, refreshed.', 'info');
    this.save();
  }

  passTime(hours: number) {
    this.ui.fade(true, 'A moon passes…');
    this.player.frozen = true;
    setTimeout(() => {
      for (let i = 0; i < hours && this.state === 'playing'; i++) {
        this.time.totalHours += 1;
        this.hourTick();
      }
      this.lastHour = Math.floor(this.time.totalHours);
      this.npcs.resetPositions();
      this.prey.clear();
      this.player.frozen = false;
      if (this.state === 'playing') this.ui.fade(false);
      this.save();
    }, 900);
  }

  private hourTick() {
    const t = this.time;
    const hour = Math.floor(t.hour);
    this.clan.tickHour();
    this.weather.tickHour(t.season, this.events.isActive('drought'), this.events.isActive('coldSnap'));
    this.fire.tickHour();
    this.events.tickHour();
    const c = this.clan.player;
    if (c && c.alive) {
      if (c.exiled) {
        c.hunger = clamp(c.hunger - 1.35, 0, 100);
        if (c.hunger < 8) c.health -= 1.2;
      }
      if (this.player.poison > 0) {
        c.health -= 7 * this.player.poison;
        this.player.poison = Math.max(0, this.player.poison - 0.07);
        if (c.health <= 0) { this.clan.kill(c, 'deathberries'); return; }
      } else if (c.hunger > 25 && !this.combat.playerInCombat) c.health = Math.min(c.maxHealth, c.health + (this.player.sleeping ? 8 : 3));
      if (c.health <= 0) this.clan.kill(c, 'hunger');
    }
    if (hour === 6) {
      this.clan.tickDay();
      this.npcs.syncRoster();
      this.npcs.refreshModels();
      if (this.clan.player?.alive) this.player.refreshStage();
      this.chunks.setContext(t.season, t.day);
      if (this.clan.player?.exiled) this.objectives.list = this.objectives.list.filter((o) => o.id === 'exile');
    }
    if (t.season !== this.seasonKey) {
      this.seasonKey = t.season;
      this.chunks.setContext(t.season, t.day);
      this.ui.toast(`The season turns: ${t.season === 'spring' ? 'Budding season — new life stirs.' : t.season === 'summer' ? 'High-sun season — long warm days.' : t.season === 'autumn' ? 'Leaf-drop season — the forest turns to gold.' : 'Frost season — the forest sleeps under frost.'}`, 'event');
      this.clan.log(`A new season began: ${t.season}.`, 'event');
    }
  }

  // ------------------------------------------------------------ main loop
  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.uTime.value = this.clock;
    sharedUniforms.uTime.value = this.clock;
    if (this.state === 'playing') this.update(dt);
    else this.idleUpdate(dt);
    this.ui.update(dt);
    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  };

  private idleUpdate(dt: number) {
    if (!this.chunks) return;
    const t = this.clock * 0.05;
    const w = this.weather;
    w.update(dt, this.clock, this.camera.position, 0);
    sharedUniforms.uWind.value = 0.3 + w.p.wind * 0.8;
    if (this.state === 'create' && this.previewModel) {
      const m = this.previewModel;
      const x = 0, z = 4;
      m.root.position.set(x, this.groundAt(x, z), z);
      m.root.rotation.y = this.clock * 0.4;
      m.update(dt);
      const s = Math.max(0.5, m.scale);
      const narrow = window.innerWidth < 700;
      this.camera.position.set(x + (narrow ? 0 : -0.35 * s), m.root.position.y + 0.35 * s + 0.1, z + 1.3 * s + 0.3);
      this.camera.lookAt(x + (narrow ? 0 : -0.35 * s), m.root.position.y + 0.18 * s + (narrow ? -0.12 : 0), z);
      this.time.totalHours = 16.5;
    } else if (this.state === 'title' || this.state === 'loading') {
      const y = this.terrain.campHeight;
      this.camera.position.set(Math.cos(t) * 34, y + 9 + Math.sin(t * 0.7) * 2, Math.sin(t) * 34);
      this.camera.lookAt(0, y + 1, 0);
    }
    if (this.state !== 'paused' && this.state !== 'dead') {
      this.chunks.update(this.camera.position.x, this.camera.position.z, 2);
    }
    this.sky.update(this.time.hour, this.clock, this.camera.position, { ...w.p }, 0);
    this.ambient.update(this.clock, this.camera.position, this.terrain.campHeight, { night: this.time.darkness, season: this.time.season, rain: w.p.rain, wind: w.p.wind, day: this.time.day, inForest: true });
    this.chunks.setNightLights(this.time.darkness * 1.5);
    if (this.state === 'paused' || this.state === 'dead') this.audio.update(dt, this.soundEnv(), this.clock);
  }

  private update(dt: number) {
    const input = this.input;
    const busy = this.ui.isBusy();
    // global keys
    if (!this.player.busy && !this.player.sleeping) {
      if (input.pressed('KeyE')) this.interactions.interact();
    }
    if (input.pressed('KeyX') && this.combat.playerInCombat) this.combat.playerYield();
    if (input.pressed('KeyJ')) this.ui.panels.toggle('journal');
    if (input.pressed('KeyM')) this.ui.panels.toggle('map');
    if (input.pressed('KeyL')) this.ui.panels.toggle('leader');
    // player
    if (!this.player.frozen) this.player.update(dt);
    else this.player.updateCamera(dt);
    // time
    const speed = this.player.sleeping ? this.time.speed : 1;
    this.time.speed = speed;
    this.time.advance(dt);
    while (Math.floor(this.time.totalHours) > this.lastHour) {
      this.lastHour++;
      this.hourTick();
      if (this.state !== 'playing') return;
    }
    if (this.sleepUntil !== null && (this.time.totalHours >= this.sleepUntil || this.combat.playerInCombat)) this.wake();
    // world
    const w = this.weather;
    w.update(dt, this.clock, this.camera.position, (dt / this.time.daySeconds) * 24 * speed);
    this.windAngle += dt * 0.01 * Math.sin(this.clock * 0.03);
    this.windDir.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    sharedUniforms.uWind.value = 0.25 + w.p.wind * 0.9;
    sharedUniforms.uSnow.value = w.snowCover;
    sharedUniforms.uWet.value = w.wetness;
    sharedUniforms.uPlayer.value.copy(this.player.pos);
    this.sky.update(this.time.hour, this.clock, this.camera.position, { ...w.p }, this.player.inCave);
    const biome = this.chunks.biomeAt(this.player.pos.x, this.player.pos.z);
    this.ambient.update(this.clock, this.camera.position, this.player.pos.y, { night: this.time.darkness, season: this.time.season, rain: w.p.rain, wind: w.p.wind, day: this.time.day, inForest: biome === 'forest' || biome === 'pine' });
    this.chunks.setNightLights(this.time.darkness * 1.5);
    this.chunks.update(this.player.pos.x, this.player.pos.z, 1);
    // simulation
    this.npcs.update(dt);
    this.prey.update(dt);
    this.creatures.update(dt);
    this.combat.update(dt);
    this.fire.update(dt);
    this.events.update(dt);
    this.objectives.update();
    this.scent.update(dt);
    this.interactions.update();
    this.touch?.update();
    // exiled player: clan cats chase them off home land
    this.exileCheck(dt);
    // audio
    this.audio.listener.copy(this.player.pos);
    this.audio.listenerYaw = this.player.yaw;
    this.audio.update(dt, this.soundEnv(), this.clock);
    // autosave
    this.autosaveT -= dt;
    if (this.autosaveT <= 0) { this.autosaveT = 15; this.save(); }
    void busy;
  }

  private exileT = 0;
  private exileCheck(dt: number) {
    const p = this.clan.player;
    if (!p?.exiled) return;
    this.exileT -= dt;
    if (this.exileT > 0) return;
    this.exileT = 1;
    if (this.territories.ownerAt(this.player.pos.x, this.player.pos.z) !== 'home') return;
    const a = this.npcs.nearestTo(this.player.pos.x, this.player.pos.z, 14, (x) => x.cat.clan === 'home' && x.cat.stage === 'warrior' && x.activity !== 'fight' && x.activity !== 'sleep' && !this.npcs.isPlayerFriend(x));
    if (!a) return;
    if (!a.warned) {
      a.warned = 1;
      a.say(`${p.given}! You were exiled. Leave our land!`, 4);
      this.audio.hiss();
      setTimeout(() => { a.warned = 2; }, 9000);
    } else if (a.warned === 2 && this.territories.ownerAt(this.player.pos.x, this.player.pos.z) === 'home') {
      this.combat.engage(a, this.player);
      a.warned = 3;
    }
  }

  private soundEnv(): SoundEnv {
    const p = this.player.pos;
    this.audioT -= 1 / 60;
    if (this.audioT <= 0 && this.chunks) {
      this.audioT = 0.5;
      let best = 0;
      for (const r of [2, 6, 12, 22, 34]) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (this.chunks.waterDepthAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r) > 0.1) { best = Math.max(best, 1 - r / 40); break; }
        }
        if (best > 0) break;
      }
      this.waterProx = best;
    }
    const biome = this.chunks ? this.chunks.biomeAt(p.x, p.z) : 'forest';
    const forest = biome === 'forest' ? 1 : biome === 'pine' ? 0.7 : biome === 'marsh' ? 0.4 : 0.25;
    const camY = this.camera.position;
    const under = this.chunks ? this.chunks.waterSurfaceAt(camY.x, camY.z) > camY.y : false;
    return {
      wind: this.weather.p.wind,
      rain: this.weather.p.rain,
      night: this.time.darkness,
      forest,
      water: this.waterProx,
      fire: clamp(1 - this.fire.nearestDist / 70, 0, 1),
      flood: this.events.isActive('flood') ? this.waterProx : 0,
      cave: this.state === 'playing' ? this.player.inCave : 0,
      season: this.time.season,
      snow: this.weather.p.snow,
      storm: this.weather.p.storm,
      inCamp: Math.hypot(p.x, p.z) < 17,
      underwater: under,
    };
  }
}

void simRng;
