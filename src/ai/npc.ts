// NPC embodiment & autonomous behaviour. Every living clan cat gets an agent
// that walks the world, follows a daily rhythm shaped by its role, stage and
// personality, talks to other cats, hunts, patrols, trains and sleeps.
import * as THREE from 'three';
import type { Game } from '../game';
import { Cat, displayName } from '../cats/types';
import { CatModel, Mood, Pose } from '../cats/model';
import { simRng } from '../core/rng';
import { angleDiff, clamp, dist2 } from '../core/math';
import { DenName } from '../world/camp';
import { chooseTopic, conversation, Topic } from '../sim/social';
import type { Patrol } from '../sim/clan';
import type { Fighter } from '../player/combat';

export type Activity =
  | 'idle' | 'wander' | 'sit' | 'sleep' | 'eat' | 'talk' | 'groom' | 'patrol' | 'hunt' | 'train' | 'play'
  | 'herbs' | 'ceremony' | 'flee' | 'fight' | 'follow' | 'shelter' | 'stranded' | 'gathering' | 'approach' | 'talkPlayer'
  | 'guard' | 'rivalPatrol' | 'moss' | 'nurse' | 'watch' | 'leaving' | 'shield' | 'lead';

export interface ApproachIntent {
  kind: 'training' | 'play' | 'order' | 'greet' | 'apprentice' | 'rescueThanks' | 'warning' | 'loner' | 'scoldKit' | 'punishKit';
  text: string;
  data?: any;
}

const CAMP_IN = { x: 0, z: 12 };
const CAMP_OUT = { x: 0, z: 21.5 };
const tmpV = new THREE.Vector3();

export class NpcAgent implements Fighter {
  kind: 'cat' = 'cat';
  pos = new THREE.Vector3();
  heading = simRng.range(0, Math.PI * 2);
  speed = 0;
  model: CatModel;
  activity: Activity = 'idle';
  actTimer = 0;
  route: { x: number; z: number }[] = [];
  target: { x: number; z: number } | null = null;
  moveSpeed = 1.3;
  bubble: { text: string; until: number } | null = null;
  partner: NpcAgent | null = null;
  convoLines: [Cat, string][] = [];
  convoIdx = 0;
  convoDelta = 0;
  convoRomance = 0;
  convoTopic: Topic = 'weather';
  lineTimer = 0;
  carrying: number | null = null;
  patrol: Patrol | null = null;
  wp: { x: number; z: number }[] = [];
  wpIdx = 0;
  followTarget: 'player' | NpcAgent | null = null;
  fightTarget: Fighter | null = null;
  attackCd = 0;
  windup = 0;
  approach: ApproachIntent | null = null;
  approachCooldown = simRng.range(20, 60);
  lastPlayerInteract = -999;
  stuckT = 0;
  hostile = false;
  warned = 0;
  mood: Mood = 'neutral';
  forcedPose: Pose | null = null;
  bedSpot: { x: number; z: number } | null = null;
  visible = true;
  stalkT = 0;
  successHunt = false;
  lastPos = new THREE.Vector3();
  radius = 0.25;
  talkCooldown = simRng.range(5, 30);
  // behaviour scratch state
  userEat?: boolean;
  userHuntPhase?: string;
  userTrainPartner?: NpcAgent;
  userHome?: { x: number; z: number };
  userAggressive?: boolean;
  userWarnT?: number;
  userSpar?: boolean;
  userGossip?: string | null;
  userWalkHome?: boolean;
  userLessonWatch?: boolean;
  userLead?: { route: { x: number; z: number }[]; idx: number; onArrive: () => void; onWaypoint?: (i: number) => void; paused: boolean; nagT: number; best: number; stuckT: number };

  constructor(public cat: Cat, private game: Game) {
    this.model = new CatModel(cat.app, cat.stage);
    game.scene.add(this.model.root);
    this.moveSpeed = cat.stage === 'kit' ? 0.9 : cat.stage === 'elder' ? 1.0 : 1.35;
  }

  get id() { return this.cat.id; }
  get name() { return displayName(this.cat); }
  get faction(): 'home' | 'rival' | 'loner' { return this.cat.clan === 'home' ? 'home' : this.cat.clan === 'loner' ? 'loner' : 'rival'; }
  get hp() { return this.cat.health; }
  set hp(v: number) { this.cat.health = v; }
  get maxHp() { return this.cat.maxHealth; }
  get alive() { return this.cat.alive && this.cat.health > 0; }
  get power() { return 6 + this.cat.strength * 0.08 + this.cat.skills.fighting * 0.1; }
  get defense() { return 0.1 + this.cat.skills.fighting / 400; }
  get scale() { return this.model.scale; }

  say(text: string, seconds = 4) {
    this.bubble = { text, until: this.game.clock + seconds };
  }

  setTarget(x: number, z: number) {
    const inA = Math.hypot(this.pos.x, this.pos.z) < 16.5;
    const inB = Math.hypot(x, z) < 16.5;
    this.route = [];
    if (!inA && !inB) {
      // don't cut through the bramble wall: skirt around the camp
      const ax = this.pos.x, az = this.pos.z, dx = x - ax, dz = z - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, -(ax * dx + az * dz) / L2));
      const px = ax + dx * t, pz = az + dz * t;
      if (Math.hypot(px, pz) < 19) {
        let l = Math.hypot(px, pz);
        let nx = px, nz = pz;
        if (l < 1) { nx = -dz; nz = dx; l = Math.hypot(nx, nz) || 1; }
        this.route.push({ x: (nx / l) * 25, z: (nz / l) * 25 });
      }
    }
    if (inA && !inB) this.route.push(CAMP_IN, CAMP_OUT);
    else if (!inA && inB) {
      if (Math.hypot(this.pos.x - CAMP_OUT.x, this.pos.z - CAMP_OUT.z) > 2) this.route.push(CAMP_OUT);
      this.route.push(CAMP_IN);
    }
    this.route.push({ x, z });
    this.target = this.route.shift()!;
  }

  dispose() {
    this.model.dispose();
  }
}

export class NpcManager {
  agents = new Map<string, NpcAgent>();
  private tmpCols: { x: number; z: number; r: number }[] = [];
  ceremonyUntil = 0;
  ceremonyText = '';
  ceremonyIds: string[] = [];
  evacuate: { x: number; z: number } | null = null;
  gatheringActive = false;
  private convoCheck = 0;

  constructor(private game: Game) {}

  get list() { return [...this.agents.values()]; }

  /** Ensure every living home cat (except the player) has an agent. */
  syncRoster() {
    const clan = this.game.clan;
    const want = new Set(clan.home(false).map((c) => c.id));
    for (const [id, a] of this.agents) {
      if (a.cat.clan !== 'home') continue;
      if (!want.has(id)) {
        a.dispose();
        this.agents.delete(id);
      }
    }
    for (const c of clan.home(false)) {
      if (!this.agents.has(c.id)) {
        const a = new NpcAgent(c, this.game);
        const p = this.initialPos(c);
        a.pos.set(p.x, this.game.groundAt(p.x, p.z), p.z);
        this.agents.set(c.id, a);
      }
    }
  }

  private initialPos(c: Cat) {
    const camp = this.game.camp;
    if (this.game.time.isNight) {
      const d = camp.dens[this.denFor(c)];
      const b = simRng.pick(d.beds);
      return { x: b.x + simRng.range(-0.3, 0.3), z: b.z + simRng.range(-0.3, 0.3) };
    }
    return camp.randomCampPoint(() => simRng.next());
  }

  spawnOutsider(c: Cat, x: number, z: number, hostile: boolean, activity: Activity = 'rivalPatrol'): NpcAgent {
    const a = new NpcAgent(c, this.game);
    a.pos.set(x, this.game.groundAt(x, z), z);
    a.hostile = hostile;
    a.activity = activity;
    a.actTimer = 120;
    a.moveSpeed = 1.6;
    this.agents.set(c.id, a);
    return a;
  }

  removeAgent(id: string) {
    const a = this.agents.get(id);
    if (!a) return;
    if (a.partner) this.endConvo(a);
    a.dispose();
    this.agents.delete(id);
  }

  onCatDied(c: Cat) {
    if (this.agents.has(c.id)) this.removeAgent(c.id);
  }
  onCatLeft(c: Cat) {
    const a = this.agents.get(c.id);
    if (!a) return;
    a.activity = 'leaving';
    a.say('I can\'t stay here any longer.', 5);
    const ang = simRng.range(0, Math.PI * 2);
    a.setTarget(Math.cos(ang) * 260, Math.sin(ang) * 260);
    a.actTimer = 90;
  }
  onPatrolsChanged() {
    for (const p of this.game.clan.patrols) {
      for (const id of p.members) {
        const a = this.agents.get(id);
        if (a && !this.busyWithPlayer(a) && a.activity !== 'fight' && a.activity !== 'flee' && a.patrol?.id !== p.id) {
          this.endConvo(a);
          a.patrol = p;
          a.activity = 'patrol';
          a.wp = [];
          a.wpIdx = 0;
        }
      }
    }
  }

  startCeremony(text: string, ids: string[]) {
    this.ceremonyUntil = this.game.clock + 22;
    this.ceremonyText = text;
    this.ceremonyIds = ids;
    for (const a of this.agents.values()) {
      if (a.cat.clan !== 'home') continue;
      if (a.activity === 'fight' || a.activity === 'stranded' || a.activity === 'leaving' || this.busyWithPlayer(a)) continue;
      const d = Math.hypot(a.pos.x, a.pos.z);
      if (d > 60) continue;
      this.endConvo(a);
      a.activity = 'ceremony';
      a.actTimer = 22;
      if (a.cat.role === 'leader') a.setTarget(this.game.camp.highRock.x, this.game.camp.highRock.z + 0.2);
      else {
        const ang = simRng.range(-Math.PI * 0.8, -Math.PI * 0.2) + Math.PI;
        const r = ids.includes(a.id) ? 3.5 : simRng.range(5, 9);
        a.setTarget(Math.cos(ang) * r * 0.9, this.game.camp.highRock.z + 1 + Math.sin(ang) * r);
      }
    }
    const leader = this.game.clan.leader;
    const la = leader ? this.agents.get(leader.id) : null;
    if (la) setTimeout(() => la.say(text, 12), 2500);
  }

  /** Leading, watching, following or shielding the player — don't pull them away. */
  busyWithPlayer(a: NpcAgent) {
    return a.activity === 'lead' || a.activity === 'follow' || a.activity === 'shield' || a.activity === 'talkPlayer' || !!a.userLessonWatch;
  }

  denFor(c: Cat): DenName {
    if (c.role === 'leader') return 'leader';
    if (c.role === 'medicine' || c.role === 'medicineApprentice') return 'medicine';
    if (c.stage === 'kit') return 'nursery';
    if (c.expectingUntil !== null || c.kits.some((k) => (this.game.clan.get(k)?.age ?? 99) < 6 && this.game.clan.get(k)?.alive)) {
      if (c.sex === 'she') return 'nursery';
    }
    if (c.stage === 'apprentice') return 'apprentices';
    if (c.stage === 'elder') return 'elders';
    return 'warriors';
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const game = this.game;
    const player = game.player;
    const cam = game.camera.position;
    this.convoCheck -= dt;
    const doConvo = this.convoCheck <= 0;
    if (doConvo) this.convoCheck = 1.2;
    for (const a of [...this.agents.values()]) {
      const d = a.pos.distanceTo(player.pos);
      const far = d > 110;
      if (far && a.cat.clan !== 'home' && a.activity !== 'gathering') {
        // outsiders despawn when far away
        this.removeAgent(a.id);
        continue;
      }
      this.think(a, dt, d);
      this.move(a, dt, d < 50);
      // visuals
      const vis = d < 95;
      a.model.root.visible = vis;
      if (vis) {
        a.model.root.position.copy(a.pos);
        a.model.root.rotation.y = -a.heading;
        a.model.speed = a.speed;
        a.model.mood = a.mood;
        a.model.pose = this.poseFor(a);
        a.model.setShadows(d < 28);
        // look at player when close
        if (d < 4 && a.activity !== 'sleep') {
          const want = Math.atan2(player.pos.z - a.pos.z, player.pos.x - a.pos.x);
          a.model.lookYaw = clamp(-angleDiff(a.heading, want), -1, 1);
        } else if (a.partner) {
          const want = Math.atan2(a.partner.pos.z - a.pos.z, a.partner.pos.x - a.pos.x);
          a.model.lookYaw = clamp(-angleDiff(a.heading, want), -1, 1);
        } else a.model.lookYaw = 0;
        if (d < 60) a.model.update(dt);
      }
      if (a.bubble && a.bubble.until < game.clock) a.bubble = null;
      void cam;
    }
    if (doConvo) this.tryConversations();
  }

  private poseFor(a: NpcAgent): Pose {
    if (a.forcedPose) return a.forcedPose;
    const swim = this.game.chunks.waterDepthAt(a.pos.x, a.pos.z) > 0.18 * a.model.scale + 0.1;
    if (swim) return 'swim';
    if (a.speed > 0.1) return a.activity === 'hunt' && a.stalkT > 0 ? 'crouch' : a.activity === 'fight' ? 'fight' : 'walk';
    switch (a.activity) {
      case 'sleep': return 'sleep';
      case 'sit': case 'ceremony': case 'watch': case 'guard': return 'sit';
      case 'groom': return 'groom';
      case 'eat': return 'eat';
      case 'talk': case 'talkPlayer': return a.cat.stage === 'elder' ? 'lie' : 'sit';
      case 'nurse': case 'shelter': return 'lie';
      case 'fight': return 'fight';
      case 'train': return a.actTimer % 3 < 1.5 ? 'fight' : 'crouch';
      case 'hunt': return 'crouch';
      case 'stranded': return 'sit';
      case 'gathering': return 'sit';
      default: return 'stand';
    }
  }

  // ------------------------------------------------------------------ brains
  private think(a: NpcAgent, dt: number, dPlayer: number) {
    const game = this.game;
    const c = a.cat;
    a.actTimer -= dt;
    a.approachCooldown -= dt;
    a.talkCooldown -= dt;
    a.attackCd -= dt;

    // emergencies override everything
    if (a.activity === 'fight') { this.fightThink(a, dt); return; }
    if (a.activity === 'stranded') { a.mood = 'afraid'; if (simRng.chance(dt * 0.25)) a.say(simRng.pick(['Help! Help me!', 'The water is rising!', 'Someone, please!']), 3); return; }
    if (a.activity === 'follow') { this.followThink(a); return; }
    if (a.activity === 'shield') { this.shieldThink(a); return; }
    if (a.activity === 'lead') { this.leadThink(a, dt); return; }
    if (a.activity === 'talkPlayer') { if (a.actTimer <= 0) a.activity = 'idle'; return; }
    if (a.activity === 'leaving') { if (a.actTimer <= 0 || !a.target) this.removeAgent(a.id); return; }
    if (c.clan !== 'home') { this.outsiderThink(a, dt, dPlayer); return; }
    if (this.evacuate && a.activity !== 'flee' && Math.hypot(a.pos.x - this.evacuate.x, a.pos.z - this.evacuate.z) > 10) {
      this.endConvo(a);
      a.activity = 'flee';
      a.mood = 'afraid';
      a.setTarget(this.evacuate.x + simRng.range(-5, 5), this.evacuate.z + simRng.range(-5, 5));
    }
    if (a.activity === 'flee') {
      a.moveSpeed = c.stage === 'kit' ? 2.2 : 3.5;
      if (!this.evacuate) { a.activity = 'idle'; a.mood = 'neutral'; }
      else if (!a.target) a.forcedPose = 'sit';
      return;
    }
    a.forcedPose = null;
    if (this.ceremonyUntil > game.clock && a.activity === 'ceremony') {
      if (!a.target) {
        const hr = game.camp.highRock;
        if (c.role === 'leader') a.heading = Math.PI / 2;
        else a.heading = Math.atan2(hr.z - a.pos.z, hr.x - a.pos.x);
      }
      return;
    }
    if (a.activity === 'ceremony') a.activity = 'idle';
    if (a.activity === 'approach') { this.approachThink(a); return; }
    if (a.activity === 'talk') { this.convoThink(a, dt); return; }
    if (a.activity === 'patrol' && a.patrol) { this.patrolThink(a, dt); return; }
    if (a.activity === 'gathering') { this.gatheringThink(a); return; }
    if (a.activity === 'train') { this.trainThink(a); return; }
    if (a.activity === 'hunt') { this.huntThink(a, dt); return; }
    if (a.activity === 'herbs' || a.activity === 'moss') { this.errandThink(a); return; }

    if (a.activity === 'eat' && a.userEat && !a.target) {
      a.userEat = false;
      if (game.clan.food >= 1) {
        game.clan.addFood(-1);
        c.hunger = clamp(c.hunger + 50, 0, 100);
      }
    }
    // continuing simple activities
    if (a.actTimer > 0 && a.activity !== 'idle' && a.activity !== 'wander') {
      if (a.activity === 'sleep' && !game.time.isNight && game.time.hour > 6.5 && a.cat.injury < 50 && simRng.chance(dt * 0.3)) a.actTimer = 0;
      return;
    }
    if (a.activity === 'wander' && a.target) return;
    this.decide(a, dPlayer);
  }

  private decide(a: NpcAgent, dPlayer: number) {
    const game = this.game;
    const c = a.cat;
    const t = game.time;
    const h = t.hour;
    const w = game.weather;
    const camp = game.camp;
    a.mood = c.sick > 40 || c.injury > 40 ? 'sad' : 'neutral';

    // player-directed intents
    if (a.approachCooldown <= 0 && dPlayer < 45 && !game.player.busy) {
      const intent = this.wantsToApproach(a);
      if (intent) {
        a.approach = intent;
        a.activity = 'approach';
        a.approachCooldown = 90;
        return;
      }
      a.approachCooldown = simRng.range(15, 40);
    }

    // sleep
    const night = h >= 21.5 || h < 5.5;
    if (night || c.injury > 60 || c.sick > 60) {
      if (!(c.stage === 'warrior' && h >= 21.5 && h < 23 && simRng.chance(0.2))) {
        this.goToBed(a);
        return;
      }
    }
    // shelter from bad weather
    if ((w.p.rain > 0.6 || w.p.snow > 0.6 || w.p.storm > 0.5) && simRng.chance(0.7)) {
      const d = camp.dens[this.denFor(c)];
      const b = simRng.pick(d.beds);
      a.activity = 'shelter';
      a.actTimer = simRng.range(30, 70);
      a.setTarget(b.x, b.z);
      return;
    }
    // hunger
    if (c.hunger < 40 && game.clan.food >= 1) {
      a.activity = 'eat';
      a.actTimer = 12;
      a.setTarget(camp.pile.x + simRng.range(-0.6, 0.6), camp.pile.z + simRng.range(-0.6, 0.6));
      a.userEat = true;
      return;
    }
    // role specific
    const r = simRng.next();
    if (c.stage === 'kit') {
      if (r < 0.4) return this.kitPlay(a);
      if (r < 0.55) { const e = camp.dens.elders; a.activity = 'sit'; a.actTimer = simRng.range(15, 30); a.setTarget(e.x + simRng.range(-1.5, 1.5), e.z + simRng.range(-1.5, 1.5)); return; }
      return this.wanderCamp(a, 6);
    }
    if (c.stage === 'elder') {
      const e = camp.dens.elders;
      if (r < 0.6) { a.activity = r < 0.3 ? 'sit' : 'groom'; a.actTimer = simRng.range(20, 50); a.setTarget(e.x + simRng.range(-2, 2), e.z + simRng.range(-2, 2)); return; }
      return this.wanderCamp(a, 8);
    }
    if (c.role === 'medicine' || c.role === 'medicineApprentice') {
      if (r < 0.3 && !t.isNight) return this.startErrand(a, 'herbs');
      const d = camp.dens.medicine;
      a.activity = r < 0.7 ? 'groom' : 'sit';
      a.actTimer = simRng.range(15, 35);
      a.setTarget(d.x + simRng.range(-1, 1), d.z + simRng.range(-1, 1));
      return;
    }
    if (this.denFor(c) === 'nursery' && c.stage === 'warrior') {
      const d = camp.dens.nursery;
      a.activity = r < 0.5 ? 'nurse' : 'groom';
      a.actTimer = simRng.range(20, 40);
      a.setTarget(d.x + simRng.range(-1.5, 1.5), d.z + simRng.range(-1.5, 1.5));
      return;
    }
    if (c.stage === 'apprentice') {
      const mentor = game.clan.get(c.mentor);
      const ma = mentor ? this.agents.get(mentor.id) : undefined;
      if (ma && r < 0.35 && !t.isNight && this.free(ma)) return this.startTraining(ma, a);
      if (r < 0.5 && !t.isNight) return this.startErrand(a, 'moss');
      if (r < 0.65 && !t.isNight) return this.startHunt(a);
    }
    if (c.role === 'leader') {
      if (r < 0.35) { const hr = camp.highRock; a.activity = 'watch'; a.actTimer = simRng.range(20, 45); a.setTarget(hr.x + 2.5, hr.z + 2.5); return; }
      if (r < 0.55) { const d = camp.dens.leader; a.activity = 'sit'; a.actTimer = simRng.range(20, 40); a.setTarget(d.x, d.z + 1); return; }
      return this.wanderCamp(a, 10);
    }
    if (c.stage === 'warrior') {
      const hungry = game.clan.food < game.clan.home().length * 0.7;
      if (!t.isNight && r < (hungry ? 0.4 : 0.18)) return this.startHunt(a);
      if (r < 0.28) { a.activity = 'guard'; a.actTimer = simRng.range(25, 50); a.setTarget(CAMP_IN.x + simRng.range(-2, 2), CAMP_IN.z + simRng.range(-1, 1)); return; }
      if (c.apprentice && r < 0.4 && !t.isNight) {
        const ap = this.agents.get(c.apprentice);
        if (ap && this.free(ap)) return this.startTraining(a, ap);
      }
      if (r < 0.55) { a.activity = simRng.chance(0.5) ? 'groom' : 'sit'; a.actTimer = simRng.range(15, 35); const p = camp.randomCampPoint(() => simRng.next()); a.setTarget(p.x, p.z); return; }
    }
    this.wanderCamp(a, 10);
  }

  private free(a: NpcAgent) {
    return ['idle', 'wander', 'sit', 'groom', 'guard', 'watch'].includes(a.activity) && !a.patrol;
  }

  private goToBed(a: NpcAgent) {
    const d = this.game.camp.dens[this.denFor(a.cat)];
    if (!a.bedSpot || Math.hypot(a.bedSpot.x - d.x, a.bedSpot.z - d.z) > d.radius + 1) a.bedSpot = simRng.pick(d.beds);
    a.activity = 'sleep';
    const h = this.game.time.hour;
    a.actTimer = h >= 21 || h < 5 ? 60 : simRng.range(30, 60);
    a.setTarget(a.bedSpot.x + simRng.range(-0.25, 0.25), a.bedSpot.z + simRng.range(-0.25, 0.25));
  }

  private wanderCamp(a: NpcAgent, r: number) {
    const ang = simRng.range(0, Math.PI * 2);
    const rr = simRng.range(2, r);
    a.activity = 'wander';
    a.actTimer = simRng.range(4, 10);
    a.setTarget(Math.cos(ang) * rr, Math.sin(ang) * rr * 0.9 + 1);
  }

  private kitPlay(a: NpcAgent) {
    const kits = this.list.filter((k) => k !== a && k.cat.stage === 'kit' && k.cat.clan === 'home' && this.free(k));
    const other = kits.length ? simRng.pick(kits) : null;
    const n = this.game.camp.dens.nursery;
    a.activity = 'play';
    a.actTimer = simRng.range(10, 20);
    a.moveSpeed = 2.2;
    const ang = simRng.range(0, Math.PI * 2);
    a.setTarget(n.x + 3 + Math.cos(ang) * 3, n.z - 1 + Math.sin(ang) * 3);
    if (other && simRng.chance(0.6)) {
      other.activity = 'play';
      other.actTimer = a.actTimer;
      other.moveSpeed = 2.2;
      other.followTarget = a;
      other.setTarget(a.target!.x + 0.6, a.target!.z + 0.4);
      if (simRng.chance(0.5)) a.say(simRng.pick(['Can\'t catch me!', 'I\'m a fearsome warrior!', 'Rawr!', 'Pounce!']), 3);
    }
  }

  // ------------------------------------------------------------------ jobs
  private startHunt(a: NpcAgent) {
    const game = this.game;
    const ang = simRng.range(0, Math.PI * 2);
    const r = simRng.range(35, 130);
    a.activity = 'hunt';
    a.actTimer = simRng.range(60, 110);
    a.stalkT = 0;
    a.successHunt = false;
    a.carrying = null;
    a.userHuntPhase = 'going';
    a.moveSpeed = 2.4;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    a.setTarget(x, z);
    void game;
  }

  private huntThink(a: NpcAgent, dt: number) {
    const game = this.game;
    const phase = a.userHuntPhase as string;
    if (phase === 'going' && !a.target) {
      a.userHuntPhase = 'stalk';
      a.stalkT = simRng.range(12, 25);
      a.moveSpeed = 0.5;
    }
    if (phase === 'stalk') {
      a.stalkT -= dt;
      if (!a.target) {
        const ang = simRng.range(0, Math.PI * 2);
        a.setTarget(a.pos.x + Math.cos(ang) * 3, a.pos.z + Math.sin(ang) * 3);
      }
      if (a.stalkT <= 0) {
        const c = a.cat;
        const abundance = game.events.preyAbundance();
        const chance = (0.35 + c.skills.hunting / 180) * abundance * (game.time.isNight ? 0.7 : 1);
        a.successHunt = simRng.chance(chance);
        if (a.successHunt) {
          a.carrying = simRng.pick([0x8a7560, 0x6d5d50, 0x9a8a78, 0x5c4a3a]);
          a.model.setCarry(a.carrying);
          c.skills.hunting = Math.min(95, c.skills.hunting + 0.3);
        }
        a.userHuntPhase = 'return';
        a.moveSpeed = 2.4;
        const pile = game.camp.pile;
        a.setTarget(pile.x + simRng.range(-0.5, 0.5), pile.z + simRng.range(-0.5, 0.5));
      }
    }
    if (phase === 'return' && !a.target) {
      if (a.carrying !== null) {
        game.clan.addFood(1);
        a.carrying = null;
        a.model.setCarry(null);
        a.cat.reputation = Math.min(100, a.cat.reputation + 0.5);
      }
      a.activity = 'idle';
      a.moveSpeed = 1.35;
      a.actTimer = 0;
    }
    if (a.actTimer < -60) { a.activity = 'idle'; a.model.setCarry(null); a.carrying = null; }
  }

  private startErrand(a: NpcAgent, kind: 'herbs' | 'moss') {
    const ang = simRng.range(0, Math.PI * 2);
    const r = simRng.range(30, 80);
    a.activity = kind;
    a.userHuntPhase = 'going';
    a.actTimer = 100;
    a.moveSpeed = 1.9;
    a.setTarget(Math.cos(ang) * r, Math.sin(ang) * r);
  }

  private errandThink(a: NpcAgent) {
    const camp = this.game.camp;
    if (a.userHuntPhase === 'going' && !a.target) {
      a.userHuntPhase = 'gather';
      a.forcedPose = 'eat';
      a.actTimer = 5;
    } else if (a.userHuntPhase === 'gather' && a.actTimer <= 0) {
      a.forcedPose = null;
      a.userHuntPhase = 'return';
      a.model.setCarry(a.activity === 'herbs' ? 0x6fa050 : 0x5f8a3a);
      const d = a.activity === 'herbs' ? camp.dens.medicine : camp.dens.elders;
      a.setTarget(d.x + simRng.range(-0.8, 0.8), d.z + simRng.range(-0.8, 0.8));
    } else if (a.userHuntPhase === 'return' && !a.target) {
      a.model.setCarry(null);
      if (a.activity === 'herbs') {
        for (const c of this.game.clan.home()) if (c.sick > 0 && simRng.chance(0.5)) c.sick = Math.max(0, c.sick - 12);
      } else {
        for (const c of this.game.clan.home()) if (c.stage === 'elder') this.game.clan.adjust(c, a.cat, 1.5);
      }
      a.activity = 'idle';
      a.moveSpeed = 1.35;
    }
    if (a.actTimer < -80) { a.activity = 'idle'; a.forcedPose = null; a.model.setCarry(null); }
  }

  private startTraining(mentor: NpcAgent, ap: NpcAgent) {
    const th = this.game.territories.landmarks.find((l) => l.kind === 'trainingHollow')!;
    for (const [x, off] of [[mentor, -1.2], [ap, 1.2]] as [NpcAgent, number][]) {
      this.endConvo(x);
      x.activity = 'train';
      x.actTimer = simRng.range(50, 80);
      x.moveSpeed = 2;
      x.setTarget(th.x + off, th.z);
      x.userTrainPartner = x === mentor ? ap : mentor;
    }
    if (simRng.chance(0.6)) mentor.say(simRng.pick(['Come on, training hollow. Now.', 'Let\'s see that battle crouch.', 'Today we work on your leap.']), 3);
  }

  private trainThink(a: NpcAgent) {
    const p = a.userTrainPartner as NpcAgent | undefined;
    if (!p || !this.agents.has(p.id) || p.activity !== 'train') { a.activity = 'idle'; a.moveSpeed = 1.35; return; }
    if (!a.target && p && !p.target) {
      a.heading = Math.atan2(p.pos.z - a.pos.z, p.pos.x - a.pos.x);
      if (simRng.chance(0.01)) {
        const ang = a.heading + (simRng.chance(0.5) ? 1.2 : -1.2);
        a.setTarget(a.pos.x + Math.cos(ang) * 0.8, a.pos.z + Math.sin(ang) * 0.8);
      }
    }
    if (a.actTimer <= 0) {
      a.activity = 'idle';
      a.moveSpeed = 1.35;
      if (a.cat.stage === 'apprentice') a.cat.skills.fighting = Math.min(90, a.cat.skills.fighting + 0.5);
    }
  }

  private patrolThink(a: NpcAgent, dt: number) {
    const p = a.patrol!;
    const game = this.game;
    if (p.state === 'done' || !game.clan.patrols.includes(p)) { a.patrol = null; a.activity = 'idle'; a.moveSpeed = 1.35; return; }
    const isLeader = p.leaderId === a.id;
    if (p.state === 'forming') {
      if (!a.target) a.setTarget(CAMP_OUT.x + simRng.range(-1.5, 1.5), CAMP_OUT.z + simRng.range(0, 2));
      if (isLeader && game.time.totalHours - p.startHour > 0.6) {
        // wait for the player if they're part of it
        if (p.members.includes(game.clan.playerId) && game.player.pos.distanceTo(new THREE.Vector3(CAMP_OUT.x, game.player.pos.y, CAMP_OUT.z)) > 6 && game.time.totalHours - p.startHour < 1.6) return;
        p.state = 'out';
        a.say(p.kind === 'hunt' ? 'Let\'s go. Keep low and quiet.' : 'Border patrol, move out!', 3);
        this.planPatrolRoute(p);
      }
      return;
    }
    // out
    const route: { x: number; z: number }[] = (p as any).route ?? [];
    const leader = this.agents.get(p.leaderId);
    if (isLeader || !leader) {
      if (!a.target) {
        if (a.wpIdx < route.length) {
          const w = route[a.wpIdx++];
          a.moveSpeed = p.kind === 'hunt' ? 1.8 : 2.0;
          a.setTarget(w.x, w.z);
          if (p.kind === 'border' && a.wpIdx > 1) {
            game.clan.borderSafety = clamp(game.clan.borderSafety + 12, 0, 100);
            game.events.onBorderMarked(w.x, w.z, p);
          }
        } else {
          // finished: return
          if (Math.hypot(a.pos.x, a.pos.z) > 18) a.setTarget(0, 5);
          else {
            p.state = 'done';
            if (p.kind === 'hunt') {
              const n = p.members.filter((m) => !game.clan.get(m)?.isPlayer).length;
              const abundance = game.events.preyAbundance();
              let caught = 0;
              for (let i = 0; i < n; i++) if (simRng.chance(0.55 * abundance)) caught++;
              game.clan.addFood(caught);
              if (caught) game.clan.log(`A hunting patrol returned with ${caught} piece${caught > 1 ? 's' : ''} of prey.`, 'clan');
            }
            for (const m of p.members) {
              const ma = this.agents.get(m);
              if (ma) { ma.patrol = null; ma.activity = 'idle'; ma.moveSpeed = 1.35; ma.model.setCarry(null); }
            }
            game.objectives.patrolFinished(p);
          }
        }
      }
    } else {
      // follow leader loosely
      const off = (p.members.indexOf(a.id) + 1) * 1.1;
      const tx = leader.pos.x - Math.cos(leader.heading) * off + Math.sin(leader.heading) * 0.6 * (p.members.indexOf(a.id) % 2 ? 1 : -1);
      const tz = leader.pos.z - Math.sin(leader.heading) * off;
      if (dist2(a.pos.x, a.pos.z, tx, tz) > 1.2) {
        a.target = { x: tx, z: tz };
        a.route = [];
        a.moveSpeed = Math.max(leader.moveSpeed * 1.25, 1.6);
      } else a.target = null;
      if (p.kind === 'hunt' && leader.target === null && simRng.chance(dt * 0.05)) {
        a.carrying = 0x8a7560;
        a.model.setCarry(a.carrying);
      }
    }
  }

  planPatrolRoute(p: Patrol) {
    const game = this.game;
    const route: { x: number; z: number }[] = [{ x: CAMP_OUT.x, z: CAMP_OUT.z + 3 }];
    if (p.kind === 'border') {
      const stones = game.territories.landmarks.filter((l) => l.kind === 'borderStone');
      const start = simRng.int(0, stones.length - 1);
      for (let i = 0; i < 3; i++) {
        const s = stones[(start + i) % stones.length];
        route.push({ x: s.x * 0.97, z: s.z * 0.97 });
      }
    } else {
      const ang = simRng.range(0, Math.PI * 2);
      const r = simRng.range(50, 120);
      route.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r });
      route.push({ x: Math.cos(ang + 0.4) * (r + 15), z: Math.sin(ang + 0.4) * (r + 15) });
    }
    route.push({ x: CAMP_OUT.x, z: CAMP_OUT.z + 1 });
    (p as any).route = route;
  }

  private gatheringThink(a: NpcAgent) {
    const c = this.game.territories.council;
    if (!a.target && Math.hypot(a.pos.x - c.x, a.pos.z - c.z) > 14) {
      const ang = simRng.range(0, Math.PI * 2);
      a.setTarget(c.x + Math.cos(ang) * simRng.range(4, 9), c.z + Math.sin(ang) * simRng.range(4, 9));
      a.moveSpeed = 2.6;
    }
    if (!a.target) a.heading = Math.atan2(c.z - a.pos.z, c.x - a.pos.x);
    if (!this.gatheringActive) {
      a.activity = 'idle';
      a.moveSpeed = 1.35;
      if (a.cat.clan !== 'home') this.removeAgent(a.id);
      else a.setTarget(0, 5);
    }
  }

  // ------------------------------------------------------------------ kit sneaking out
  /** Is this cat a friend of the player (would cover for them)? */
  isPlayerFriend(a: NpcAgent) {
    const p = this.game.clan.player;
    return !!p && this.game.clan.opinion(a.cat, p) >= 28;
  }

  /** The kit-player is outside camp: nearby clanmates react. */
  kitSpotted(): void {
    const g = this.game;
    const pl = g.player;
    if (this.shielder()) return;
    for (const a of this.agents.values()) if (a.activity === 'approach' && a.approach?.kind === 'scoldKit') return;
    for (const a of this.agents.values()) {
      if (a.cat.clan !== 'home' || a.cat.stage === 'kit' || a.activity === 'sleep' || a.activity === 'fight' || a.activity === 'shield' || a.activity === 'approach' || a.activity === 'talkPlayer') continue;
      const d = dist2(a.pos.x, a.pos.z, pl.pos.x, pl.pos.z);
      if (d > 16 * g.weather.visibility + 2) continue;
      this.endConvo(a);
      a.patrol = null;
      if (this.isPlayerFriend(a)) {
        this.startShield(a);
        return;
      }
      a.activity = 'approach';
      a.approach = { kind: 'scoldKit', text: `${pl.cat.given}kit? What are you doing out here? Get back to camp this instant!` };
      a.say('Hey! You there!', 2);
      return;
    }
  }

  /** The leader (or deputy) comes to deal with a kit who was caught outside camp. */
  summonForKitPunishment() {
    for (const a of this.agents.values()) if (a.approach?.kind === 'punishKit' && a.activity === 'approach') return;
    const clan = this.game.clan;
    const judge = [clan.leader, clan.deputy].find((c) => c && c.alive && !c.isPlayer);
    const a = judge ? this.agents.get(judge.id) : undefined;
    if (!a || a.activity === 'fight') return;
    if (a.pos.distanceTo(this.game.player.pos) > 55) return;
    this.endConvo(a);
    a.patrol = null;
    a.activity = 'approach';
    a.approach = { kind: 'punishKit', text: '' };
    a.say(`${clan.player.given}kit! Come here. Now.`, 3);
  }

  shielder(): NpcAgent | null {
    for (const a of this.agents.values()) if (a.activity === 'shield') return a;
    return null;
  }

  startShield(a: NpcAgent) {
    this.endConvo(a);
    a.patrol = null;
    a.activity = 'shield';
    a.actTimer = 999;
    a.mood = 'alert';
    a.say(simRng.pick(['Shh! Quick — get behind me!', 'Stay behind me, little one. Nobody will see you.', 'Psst! Hide behind me before someone spots you!']), 3.5);
    this.game.ui.toast(`${a.name} steps in front of you to hide you from the others.`, 'good');
    this.game.clan.remember(this.game.clan.player, `${a.name} hid me when I snuck out of camp.`, 3, a.id);
  }

  private shieldThink(a: NpcAgent) {
    const g = this.game;
    const pl = g.player;
    const d = dist2(a.pos.x, a.pos.z, pl.pos.x, pl.pos.z);
    const pc = g.clan.player;
    if (!pc || pc.stage !== 'kit' || Math.hypot(pl.pos.x, pl.pos.z) < 16 || d > 18) {
      a.activity = 'idle';
      a.mood = 'neutral';
      if (d < 18) a.say(simRng.pick(['Phew. That was close!', 'Our secret, okay?', 'Now scamper home before your mother notices.']), 3);
      return;
    }
    // stand between the kit and whoever could see them (or toward camp)
    let threat: { x: number; z: number } | null = null, bd = 30;
    for (const o of this.agents.values()) {
      if (o === a || o.cat.clan !== 'home' || o.cat.stage === 'kit' || o.activity === 'sleep') continue;
      const od = dist2(o.pos.x, o.pos.z, pl.pos.x, pl.pos.z);
      if (od < bd) { bd = od; threat = o.pos; }
    }
    const t = threat ?? { x: 0, z: 0 };
    let dx = t.x - pl.pos.x, dz = t.z - pl.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const off = 0.55 + a.model.scale * 0.35;
    const tx = pl.pos.x + dx * off, tz = pl.pos.z + dz * off;
    if (dist2(a.pos.x, a.pos.z, tx, tz) > 0.25) {
      a.target = { x: tx, z: tz };
      a.route = [];
      a.moveSpeed = dist2(a.pos.x, a.pos.z, tx, tz) > 3 ? 3.2 : 1.4;
    } else {
      a.target = null;
      a.heading = Math.atan2(dz, dx); // face the watcher, body blocking their view
      a.forcedPose = 'sit';
    }
    if (a.target) a.forcedPose = null;
    if (simRng.chance(0.004)) a.say(simRng.pick(['Shh… keep your tail down.', 'Nothing to see here!', 'Don\'t move a whisker.']), 2.5);
  }

  /** Cats the kit is hidden from don't count as witnesses. */
  isHiddenFrom(o: NpcAgent) {
    const s = this.shielder();
    if (!s || o === s) return false;
    return dist2(s.pos.x, s.pos.z, this.game.player.pos.x, this.game.player.pos.z) < 2.2;
  }

  // ------------------------------------------------------------------ leading the player
  /** This cat walks a route and the player follows; it waits if they fall behind. */
  startLead(a: NpcAgent, route: { x: number; z: number }[], onArrive: () => void, onWaypoint?: (i: number) => void) {
    this.endConvo(a);
    a.patrol = null;
    a.followTarget = null;
    a.activity = 'lead';
    a.actTimer = 999;
    a.userLead = { route, idx: 0, onArrive, onWaypoint, paused: false, nagT: 4, best: Infinity, stuckT: 0 };
    a.setTarget(route[0].x, route[0].z);
  }

  private leadThink(a: NpcAgent, dt: number) {
    const L = a.userLead;
    const pl = this.game.player;
    if (!L) { a.activity = 'idle'; return; }
    const dP = dist2(a.pos.x, a.pos.z, pl.pos.x, pl.pos.z);
    const w = L.route[L.idx];
    const dW = dist2(a.pos.x, a.pos.z, w.x, w.z);
    const face = () => { a.heading = Math.atan2(pl.pos.z - a.pos.z, pl.pos.x - a.pos.x); };
    // blocked just short of the spot (tree, water)? close enough counts
    if (!L.paused) {
      if (dW < L.best - 0.3) { L.best = dW; L.stuckT = 0; } else L.stuckT += dt;
    }
    const arrived = dW < 2.2 || (dW < 7 && L.stuckT > 6);
    if (arrived) {
      a.target = null;
      a.route = [];
      if (dP < 7) {
        L.onWaypoint?.(L.idx);
        L.idx++;
        if (L.idx >= L.route.length) {
          a.userLead = undefined;
          a.activity = 'idle';
          a.actTimer = 0;
          L.onArrive();
          return;
        }
        const n = L.route[L.idx];
        L.best = Infinity;
        L.stuckT = 0;
        a.setTarget(n.x, n.z);
      } else face();
      return;
    }
    if (dP > 10) {
      // wait for the apprentice
      if (!L.paused) { L.paused = true; a.target = null; a.route = []; }
      face();
      L.nagT -= dt;
      if (L.nagT <= 0) {
        L.nagT = 7;
        a.say(simRng.pick([`Keep up, ${this.game.clan.player.given}!`, 'Over here! Don\'t dawdle.', 'Stay close to me.', 'This way!']), 2.5);
      }
      return;
    }
    if (L.paused || !a.target) {
      L.paused = false;
      a.setTarget(w.x, w.z);
    }
    a.moveSpeed = dP > 6 ? 1.4 : Math.max(2.2, pl.speed * 0.95);
  }

  private followThink(a: NpcAgent) {
    const player = this.game.player;
    const tgt = a.followTarget === 'player' ? player.pos : a.followTarget instanceof NpcAgent ? a.followTarget.pos : null;
    if (!tgt) { a.activity = 'idle'; return; }
    if (a.userWalkHome && Math.hypot(player.pos.x, player.pos.z) < 15) {
      a.userWalkHome = false;
      a.activity = 'idle';
      a.followTarget = null;
      a.say('Home safe. Off to the nursery with you!', 3);
      return;
    }
    const d = dist2(a.pos.x, a.pos.z, tgt.x, tgt.z);
    if (d > 2.2) {
      a.target = { x: tgt.x, z: tgt.z };
      a.route = [];
      a.moveSpeed = d > 6 ? Math.max(3.5, player.speed * 1.1) : Math.max(1.5, player.speed);
    } else {
      a.target = null;
    }
  }

  private approachThink(a: NpcAgent) {
    const player = this.game.player;
    const d = dist2(a.pos.x, a.pos.z, player.pos.x, player.pos.z);
    if (!a.approach) { a.activity = 'idle'; return; }
    if (d > 60 || this.game.player.busy && d > 3) { a.activity = 'idle'; a.approach = null; return; }
    if (d > 1.6) {
      a.target = { x: player.pos.x, z: player.pos.z };
      a.route = [];
      a.moveSpeed = d > 8 ? 3 : 1.6;
    } else {
      a.target = null;
      a.heading = Math.atan2(player.pos.z - a.pos.z, player.pos.x - a.pos.x);
      const intent = a.approach;
      a.approach = null;
      a.activity = 'talkPlayer';
      a.actTimer = 10;
      this.game.interactions.npcInitiated(a, intent);
    }
  }

  private wantsToApproach(a: NpcAgent): ApproachIntent | null {
    const game = this.game;
    const c = a.cat;
    const p = game.clan.player;
    if (!p || !p.alive) return null;
    if (p.exiled) return null;
    const op = game.clan.opinion(c, p);
    const t = game.time;
    if (t.isNight) return null;
    // mentor fetches apprentice for training
    if (p.stage === 'apprentice' && p.mentor === c.id && !game.objectives.busy() && game.training.canOfferLesson()) {
      return { kind: 'training', text: `Come, ${p.given}. Time for training.` };
    }
    // player's apprentice wants a lesson
    if (c.mentor === p.id && simRng.chance(0.4) && !game.objectives.busy()) return { kind: 'apprentice', text: `Can we train today? Please?` };
    // kits want to play
    if (c.stage === 'kit' && (p.stage === 'kit' || p.stage === 'apprentice') && simRng.chance(0.25)) return { kind: 'play', text: `${p.given}! Let's play-fight!` };
    // orders from leader/deputy
    if ((c.role === 'leader' || c.role === 'deputy') && (p.stage === 'warrior' || p.stage === 'apprentice') && !game.objectives.busy() && simRng.chance(0.35)) {
      return { kind: 'order', text: `${p.given}, I have a task for you.` };
    }
    if (op > 45 && simRng.chance(0.12)) return { kind: 'greet', text: `${p.given}! There you are.` };
    return null;
  }

  // ------------------------------------------------------------------ outsiders
  private outsiderThink(a: NpcAgent, dt: number, dPlayer: number) {
    const game = this.game;
    const player = game.player;
    if (a.activity === 'gathering') { this.gatheringThink(a); return; }
    if (a.activity === 'rivalPatrol' || a.activity === 'wander' || a.activity === 'idle') {
      if (!a.target) {
        const home = a.userHome as { x: number; z: number } | undefined;
        const ang = simRng.range(0, Math.PI * 2);
        const base = home ?? { x: a.pos.x, z: a.pos.z };
        a.setTarget(base.x + Math.cos(ang) * 12, base.z + Math.sin(ang) * 12);
        a.moveSpeed = 1.4;
      }
      // hostile rivals confront trespassers
      if (a.hostile && dPlayer < 18 && !player.cat.exiled && player.alive) {
        const owner = game.territories.ownerAt(player.pos.x, player.pos.z);
        const trespass = typeof owner === 'number' && owner === a.cat.clan;
        if (trespass || a.userAggressive) {
          if (a.warned === 0) {
            a.warned = 1;
            a.userWarnT = 8;
            a.target = null;
            a.heading = Math.atan2(player.pos.z - a.pos.z, player.pos.x - a.pos.x);
            a.mood = 'angry';
            a.say(simRng.pick(['You\'re on our land! Get out!', 'Leave now, or feel our claws!', 'Trespasser! Go back to your own territory!']), 4);
            game.audio.hiss();
          } else {
            a.userWarnT = (a.userWarnT ?? 0) - dt;
            if (a.userWarnT <= 0 || a.userAggressive) {
              game.combat.engage(a, player);
            }
          }
        }
      }
    }
    if (a.activity === 'approach') this.approachThink(a);
  }

  // ------------------------------------------------------------------ combat
  private fightThink(a: NpcAgent, dt: number) {
    const game = this.game;
    const t = a.fightTarget;
    a.mood = 'angry';
    if (!t || !t.alive) {
      a.fightTarget = null;
      a.activity = 'idle';
      a.mood = 'neutral';
      a.windup = 0;
      if (a.cat.clan !== 'home') { a.hostile = false; a.activity = 'leaving'; a.setTarget(a.pos.x + (a.pos.x - game.player.pos.x) * 10, a.pos.z + (a.pos.z - game.player.pos.z) * 10); a.actTimer = 20; }
      return;
    }
    // flee when badly hurt
    if (a.hp < a.maxHp * 0.25 && a.cat.clan !== 'home') {
      a.say(simRng.pick(['This isn\'t over!', 'Retreat!', 'You win... this time.']), 3);
      game.combat.disengage(a);
      a.activity = 'leaving';
      a.hostile = false;
      a.mood = 'afraid';
      const ax = a.pos.x - t.pos.x, az = a.pos.z - t.pos.z;
      a.setTarget(a.pos.x + ax * 20, a.pos.z + az * 20);
      a.moveSpeed = 4;
      a.actTimer = 20;
      return;
    }
    if (a.hp < a.maxHp * 0.2 && a.cat.clan === 'home' && a.userSpar) {
      game.combat.disengage(a);
      a.activity = 'idle';
      return;
    }
    const d = dist2(a.pos.x, a.pos.z, t.pos.x, t.pos.z);
    const reach = 0.55 * Math.max(0.5, a.scale) + (t.radius ?? 0.3);
    a.heading = Math.atan2(t.pos.z - a.pos.z, t.pos.x - a.pos.x);
    if (a.windup > 0) {
      a.windup -= dt;
      a.target = null;
      if (a.windup <= 0) {
        game.combat.resolveAttack(a, t, d < reach + 0.35 ? 1 : 0);
        a.attackCd = simRng.range(1.1, 2.0) * (a.userSpar ? 1.4 : 1);
      }
      return;
    }
    if (d > reach) {
      a.target = { x: t.pos.x, z: t.pos.z };
      a.route = [];
      a.moveSpeed = 3.2;
    } else {
      // circle a little
      a.target = null;
      if (a.attackCd <= 0) {
        a.windup = t.kind === 'player' ? 0.75 : 0.45;
        game.combat.telegraph(a);
      } else if (simRng.chance(dt * 0.8)) {
        const ang = a.heading + Math.PI / 2 * (simRng.chance(0.5) ? 1 : -1);
        a.target = { x: a.pos.x + Math.cos(ang) * 0.7, z: a.pos.z + Math.sin(ang) * 0.7 };
        a.moveSpeed = 1.8;
      }
    }
  }

  // ------------------------------------------------------------------ conversation
  private tryConversations() {
    const game = this.game;
    const agents = this.list.filter((a) => a.cat.clan === 'home' && (a.activity === 'idle' || a.activity === 'wander' || a.activity === 'sit' || a.activity === 'groom' || a.activity === 'guard' || a.activity === 'watch' || a.activity === 'shelter' || a.activity === 'nurse' || a.activity === 'gathering') && a.talkCooldown <= 0 && !a.partner);
    for (const a of agents) {
      if (a.partner) continue;
      if (!simRng.chance(0.15 + a.cat.pers.sociability * 0.35)) { a.talkCooldown = simRng.range(4, 12); continue; }
      let best: NpcAgent | null = null, bestS = -1e9;
      for (const b of agents) {
        if (b === a || b.partner) continue;
        const d = a.pos.distanceTo(b.pos);
        if (d > 7) continue;
        const op = game.clan.opinion(a.cat, b.cat);
        const s = op * 0.05 + (op < -30 ? 2 * a.cat.pers.aggression : 0) - d * 0.3 + simRng.range(0, 1);
        if (s > bestS) { bestS = s; best = b; }
      }
      if (best) this.startConvo(a, best);
      else a.talkCooldown = simRng.range(5, 15);
    }
  }

  private startConvo(a: NpcAgent, b: NpcAgent) {
    const game = this.game;
    const clan = game.clan;
    const op = clan.opinion(a.cat, b.cat);
    const others = clan.home().filter((c) => c !== a.cat && c !== b.cat);
    let gossip: Cat | undefined = undefined;
    if (others.length) {
      // gossip often about the player if they're notable
      const p = clan.player;
      gossip = p && p.alive && simRng.chance(0.4) && p !== a.cat ? p : simRng.pick(others);
    }
    const ctx = {
      a: a.cat, b: b.cat, weather: game.weatherLabel(), food: clan.food, clanSize: clan.home().length, season: game.time.season,
      night: game.time.isNight, recent: clan.lastRecent || undefined, gossip, gossipOpinion: gossip ? clan.opinion(a.cat, gossip) : 0, leader: clan.leader,
    };
    const topic = chooseTopic(ctx, op);
    const conv = conversation(ctx, topic);
    a.partner = b;
    b.partner = a;
    a.convoLines = conv.lines;
    a.convoIdx = 0;
    a.lineTimer = 0.2;
    a.convoDelta = conv.delta;
    a.convoRomance = conv.romance;
    a.convoTopic = topic;
    if (topic === 'gossip' && gossip) a.userGossip = gossip.id;
    for (const x of [a, b]) {
      x.activity = 'talk';
      x.actTimer = 4 + conv.lines.length * 3.2;
      x.target = null;
      x.route = [];
    }
    // face each other; move closer if needed
    const d = a.pos.distanceTo(b.pos);
    if (d > 1.6) {
      const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2;
      const ang = Math.atan2(b.pos.z - a.pos.z, b.pos.x - a.pos.x);
      a.target = { x: mx - Math.cos(ang) * 0.6, z: mz - Math.sin(ang) * 0.6 };
      b.target = { x: mx + Math.cos(ang) * 0.6, z: mz + Math.sin(ang) * 0.6 };
      a.moveSpeed = b.moveSpeed = 1.2;
    }
  }

  private convoThink(a: NpcAgent, dt: number) {
    const b = a.partner;
    if (!b || !this.agents.has(b.id)) { this.endConvo(a); return; }
    if (!a.target) a.heading = Math.atan2(b.pos.z - a.pos.z, b.pos.x - a.pos.x);
    if (a.convoLines.length) {
      a.lineTimer -= dt;
      if (a.lineTimer <= 0 && !a.target) {
        if (a.convoIdx < a.convoLines.length) {
          const [speaker, line] = a.convoLines[a.convoIdx++];
          const sa = speaker.id === a.id ? a : b;
          sa.say(line, 3.4);
          sa.mood = a.convoTopic === 'argue' ? 'angry' : a.convoTopic === 'friendly' || a.convoTopic === 'romance' || a.convoTopic === 'tease' ? 'happy' : 'neutral';
          a.lineTimer = 3.2;
          // overheard gossip about the player
          const pid = this.game.clan.playerId;
          if (a.userGossip === pid && this.game.player.pos.distanceTo(sa.pos) < 12) {
            this.game.notify(`You overhear ${sa.name} talking about you.`);
            a.userGossip = null;
          }
        } else {
          this.finishConvo(a);
        }
      }
    }
    if (a.actTimer < -5) this.endConvo(a);
  }

  private finishConvo(a: NpcAgent) {
    const b = a.partner;
    const clan = this.game.clan;
    if (b) {
      const comp = 1 + (simRng.next() - 0.5) * 0.6;
      clan.adjust(a.cat, b.cat, a.convoDelta * comp, undefined, 3);
      clan.adjust(b.cat, a.cat, a.convoDelta * comp, undefined, 3);
      if (a.convoRomance) {
        clan.rel(a.cat, b.cat).romance = clamp(clan.rel(a.cat, b.cat).romance + a.convoRomance, 0, 100);
        clan.rel(b.cat, a.cat).romance = clamp(clan.rel(b.cat, a.cat).romance + a.convoRomance, 0, 100);
      } else if (a.cat.stage === 'warrior' && b.cat.stage === 'warrior' && clan.opinion(a.cat, b.cat) > 40 && !a.cat.mate && !b.cat.mate) {
        clan.rel(a.cat, b.cat).romance = clamp(clan.rel(a.cat, b.cat).romance + simRng.range(0, 3), 0, 100);
      }
      if (a.convoTopic === 'argue' && clan.opinion(a.cat, b.cat) < -50) clan.remember(a.cat, `I argued bitterly with ${b.name}.`, -3, b.id);
    }
    this.endConvo(a);
  }

  endConvo(a: NpcAgent) {
    const b = a.partner;
    a.partner = null;
    a.convoLines = [];
    if (a.activity === 'talk') { a.activity = 'idle'; a.actTimer = 0; }
    a.talkCooldown = simRng.range(15, 45);
    a.mood = 'neutral';
    if (b && b.partner === a) this.endConvo(b);
  }

  // ------------------------------------------------------------------ movement
  private move(a: NpcAgent, dt: number, precise: boolean) {
    const game = this.game;
    if (!a.target) {
      a.speed = Math.max(0, a.speed - dt * 6);
      a.pos.y = this.surfaceY(a);
      return;
    }
    const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      if (a.route.length) a.target = a.route.shift()!;
      else a.target = null;
      return;
    }
    const want = Math.atan2(dz, dx);
    const turn = angleDiff(a.heading, want);
    a.heading += clamp(turn, -dt * 6, dt * 6);
    let sp = a.moveSpeed * (a.cat.injury > 40 ? 0.6 : 1) * (a.cat.stage === 'elder' ? 0.8 : 1);
    const depth = game.chunks.waterDepthAt(a.pos.x, a.pos.z);
    if (depth > 0.2) sp *= 0.45;
    if (Math.abs(turn) > 1.2) sp *= 0.3;
    const step = Math.min(sp * dt, d);
    a.lastPos.copy(a.pos);
    a.pos.x += Math.cos(a.heading) * step;
    a.pos.z += Math.sin(a.heading) * step;
    if (precise) {
      // push out of colliders (trees, dens, walls)
      this.tmpCols.length = 0;
      game.collidersNear(a.pos.x, a.pos.z, this.tmpCols);
      for (const c of this.tmpCols) {
        const ox = a.pos.x - c.x, oz = a.pos.z - c.z;
        const od = Math.hypot(ox, oz);
        const min = c.r + 0.15;
        if (od < min && od > 1e-4) {
          a.pos.x = c.x + (ox / od) * min;
          a.pos.z = c.z + (oz / od) * min;
          // slide: nudge heading sideways
          a.heading += 0.08;
        }
      }
    }
    a.speed = step / Math.max(dt, 1e-4);
    // stuck detection
    if (a.lastPos.distanceTo(a.pos) < step * 0.2) {
      a.stuckT += dt;
      if (a.stuckT > 2.5) {
        a.stuckT = 0;
        a.pos.x += Math.cos(a.heading + 1.57) * 0.8;
        a.pos.z += Math.sin(a.heading + 1.57) * 0.8;
      }
    } else a.stuckT = 0;
    a.pos.y = this.surfaceY(a);
  }

  private surfaceY(a: NpcAgent) {
    const g = this.game.groundAt(a.pos.x, a.pos.z);
    const w = this.game.chunks.waterSurfaceAt(a.pos.x, a.pos.z);
    const swimY = w - a.model.shoulderY * a.model.scale * 0.8;
    return Math.max(g, swimY);
  }

  // ------------------------------------------------------------------ queries
  nearestTo(x: number, z: number, maxD: number, filter?: (a: NpcAgent) => boolean): NpcAgent | null {
    let best: NpcAgent | null = null, bd = maxD;
    for (const a of this.agents.values()) {
      if (filter && !filter(a)) continue;
      const d = dist2(a.pos.x, a.pos.z, x, z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  witnesses(x: number, z: number, r = 22): string[] {
    const vis = this.game.weather.visibility;
    const out: string[] = [];
    for (const a of this.agents.values()) {
      if (a.cat.clan !== 'home' || a.activity === 'sleep' || a.activity === 'shield') continue;
      if (this.isHiddenFrom(a) && dist2(x, z, this.game.player.pos.x, this.game.player.pos.z) < 3) continue;
      if (dist2(a.pos.x, a.pos.z, x, z) < r * vis) out.push(a.id);
    }
    return out;
  }

  /** Called when time is fast-forwarded: reset everyone to sensible spots. */
  resetPositions() {
    for (const a of this.agents.values()) {
      if (a.cat.clan !== 'home') { this.removeAgent(a.id); continue; }
      this.endConvo(a);
      a.patrol = null;
      a.activity = 'idle';
      a.target = null;
      a.route = [];
      a.model.setCarry(null);
      const p = this.initialPos(a.cat);
      a.pos.set(p.x, this.game.groundAt(p.x, p.z), p.z);
      if (this.game.time.isNight) this.goToBed(a);
    }
  }

  refreshModels() {
    for (const a of this.agents.values()) a.model.setStage(a.cat.stage);
  }
}

void tmpV;
