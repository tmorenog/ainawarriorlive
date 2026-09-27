// First-person cat controller: movement, stealth, pounce hunting, swimming,
// combat moves, camera and the player's own visible body.
import * as THREE from 'three';
import type { Game } from '../game';
import { CatModel } from '../cats/model';
import { Cat, LifeStage } from '../cats/types';
import type { Fighter } from './combat';
import { angleDiff, clamp, damp, dist2 } from '../core/math';
import { simRng } from '../core/rng';
import { PREY } from '../wildlife/prey';
import type { PreyKind } from '../wildlife/models';
import { HerbKind } from '../world/chunks';

export interface CarriedPrey { kind: PreyKind; value: number; slots: number; color: number }

const STAGE_SPEED: Record<LifeStage, number> = { kit: 0.62, apprentice: 0.88, warrior: 1, elder: 0.78 };

export class Player implements Fighter {
  kind: 'player' = 'player';
  faction: 'home' = 'home';
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  heading = 0;
  radius = 0.2;
  speed = 0;
  onGround = true;
  crouching = false;
  crouchToggle = false;
  sprinting = false;
  stamina = 100;
  pounceCharge = 0;
  charging = false;
  pounce: { t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; h: number; charge: number; attack: boolean } | null = null;
  dodgeT = 0;
  attackCd = 0;
  model!: CatModel;
  thirdPerson = false;
  prey: CarriedPrey[] = [];
  herbs: Record<HerbKind, number> = { silverleaf: 0, sunpetal: 0, bitterroot: 0 };
  moss = 0;
  busy = false;
  frozen = false;
  noise = 0;
  private stepDist = 0;
  inCave = 0;
  swimming = false;
  inCombatT = 0;
  fightTarget: Fighter | null = null;
  shake = 0;
  private bob = 0;
  private carryView: THREE.Mesh | null = null;
  private cols: { x: number; z: number; r: number }[] = [];
  lastTerritory: string = '';
  trespassFlag = false;
  kitOutFlag = false;
  dangerFlag = false;
  confineFlag = false;
  private checkT = 0;
  sniffCd = 0;
  sleeping = false;
  poison = 0; // deathberry poisoning, 0..1

  constructor(private game: Game) {}

  get cat(): Cat { return this.game.clan.player; }
  get id() { return this.cat.id; }
  get name() { return this.cat.given; }
  get hp() { return this.cat.health; }
  set hp(v: number) { this.cat.health = v; }
  get maxHp() { return this.cat.maxHealth; }
  get alive() { return !!this.cat && this.cat.alive; }
  get stageK() { return this.cat.stage === 'kit' ? 0.35 : this.cat.stage === 'apprentice' ? 0.7 : this.cat.stage === 'elder' ? 0.8 : 1; }
  get power() { return (7 + this.cat.strength * 0.13 + this.cat.skills.fighting * 0.15) * Math.max(0.55, this.stageK); }
  get defense() { return 0.2 + this.cat.skills.fighting / 400; }
  get isDodging() { return this.dodgeT > 0; }
  get scale() { return this.model.scale; }
  get carrySlots() { return this.prey.reduce((s, p) => s + p.slots, 0); }
  get maxSlots() { return this.cat.stage === 'kit' ? 1 : 2; }

  attach() {
    if (this.model) this.model.dispose();
    this.model = new CatModel(this.cat.app, this.cat.stage);
    this.game.scene.add(this.model.root);
    this.model.setVisibleHead(this.thirdPerson);
    this.radius = 0.12 + 0.12 * this.model.scale;
    this.updateCarryVisual();
  }

  refreshStage() {
    this.model.setStage(this.cat.stage);
    this.model.setVisibleHead(this.thirdPerson);
    this.radius = 0.12 + 0.12 * this.model.scale;
  }

  placeAt(x: number, z: number, yaw?: number) {
    this.pos.set(x, this.game.groundAt(x, z), z);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.pounce = null;
  }

  enterCombat() { this.inCombatT = 6; }

  forward(): { x: number; z: number } { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  update(dt: number) {
    const game = this.game;
    const input = game.input;
    const cat = this.cat;
    if (!cat || !cat.alive) return;
    this.attackCd -= dt;
    this.dodgeT -= dt;
    this.inCombatT -= dt;
    this.sniffCd -= dt;
    this.shake = Math.max(0, this.shake - dt * 3);
    const controllable = !this.busy && !this.frozen && !this.sleeping;

    // look
    const look = input.consumeLook();
    if (controllable) {
      this.yaw -= look.dx * 0.0022;
      this.pitch = clamp(this.pitch - look.dy * 0.0022, -1.45, 1.2);
    }
    if (controllable && input.pressed('KeyV')) {
      this.thirdPerson = !this.thirdPerson;
      this.model.setVisibleHead(this.thirdPerson);
    }

    const scale = this.model.scale;
    const stageSpeed = STAGE_SPEED[cat.stage] * (cat.injury > 40 ? 0.7 : 1) * (cat.hunger < 10 ? 0.8 : 1);
    const ground = game.groundAt(this.pos.x, this.pos.z);
    const depth = game.chunks.waterDepthAt(this.pos.x, this.pos.z);
    this.swimming = depth > 0.28 * Math.max(0.5, scale) + 0.05;

    // --- pounce in progress
    if (this.pounce) {
      const p = this.pounce;
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      this.pos.lerpVectors(p.from, p.to, k);
      const gy = game.groundAt(this.pos.x, this.pos.z);
      this.pos.y = gy + Math.sin(k * Math.PI) * p.h;
      this.speed = p.from.distanceTo(p.to) / p.dur;
      this.model.pose = 'pounce';
      if (k >= 1) this.landPounce();
      this.syncModel(dt);
      this.updateCamera(dt);
      return;
    }

    // --- movement input
    const ax = controllable ? input.moveAxis() : { x: 0, y: 0 };
    if (controllable && input.pressed('KeyC')) this.crouchToggle = !this.crouchToggle;
    this.crouching = controllable && (this.crouchToggle || input.isDown('ControlLeft') || input.isDown('ControlRight')) && !this.swimming;
    const wantsSprint = controllable && input.isDown('ShiftLeft') && (ax.x !== 0 || ax.y !== 0) && !this.crouching;
    this.sprinting = wantsSprint && this.stamina > 2;
    let target = 2.0;
    if (this.crouching) target = 0.75;
    else if (this.sprinting) target = 7.2;
    else if (controllable && input.isDown('AltLeft')) target = 1.1;
    else target = 4.2;
    target *= stageSpeed;
    if (this.swimming) target = 1.4 * Math.max(0.6, stageSpeed);
    if (ax.y < 0 && !this.sprinting) target *= 0.7;
    const f = this.forward();
    const rx = -f.z, rz = f.x; // right vector
    let mx = f.x * ax.y + rx * ax.x;
    let mz = f.z * ax.y + rz * ax.x;
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; }
    const moving = ml > 0.01;
    const desiredVX = moving ? mx * target * Math.min(1, ml) : 0;
    const desiredVZ = moving ? mz * target * Math.min(1, ml) : 0;
    const accel = this.onGround || this.swimming ? 10 : 2;
    this.vel.x = damp(this.vel.x, desiredVX, accel, dt);
    this.vel.z = damp(this.vel.z, desiredVZ, accel, dt);

    // slope resistance
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const nh = game.groundAt(nx, nz);
    const rise = (nh - ground) / Math.max(1e-4, Math.hypot(this.vel.x * dt, this.vel.z * dt));
    if (rise > 1.6 && this.onGround) { this.vel.x *= 0.2; this.vel.z *= 0.2; }

    // stamina
    if (this.sprinting) this.stamina -= dt * 17;
    else if (this.swimming) this.stamina -= dt * (moving ? 5 : 2.5);
    else this.stamina += dt * (cat.hunger < 15 ? 5 : 12);
    this.stamina = clamp(this.stamina, 0, 100);
    if (this.swimming && this.stamina <= 0) {
      cat.health -= dt * 6;
      if (simRng.chance(dt)) game.ui.toast('You are exhausted and slipping under! Get out of the water!', 'danger');
      if (cat.health <= 0) { game.clan.kill(cat, 'drowning'); return; }
    }

    // jump / pounce / dodge
    const hostileNear = game.combat.hostilesNearPlayer(8).length > 0;
    if (controllable && this.crouching && input.isDown('Space') && this.onGround) {
      this.charging = true;
      this.pounceCharge = Math.min(1, this.pounceCharge + dt * 1.1);
    } else if (this.charging) {
      this.charging = false;
      if (controllable) this.startPounce(this.pounceCharge, false);
      this.pounceCharge = 0;
    } else if (controllable && input.pressed('Space') && this.onGround) {
      if (hostileNear) this.dodge(mx, mz);
      else if (!this.swimming) { this.vel.y = 3.4 * Math.sqrt(Math.max(0.45, scale)); this.onGround = false; game.audio.jump(); }
    }

    // gravity & position
    this.vel.y -= 12 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    this.collide();
    const g2 = game.groundAt(this.pos.x, this.pos.z);
    const waterY = game.chunks.waterSurfaceAt(this.pos.x, this.pos.z) - this.model.shoulderY * scale * 0.85;
    const floor = this.swimming ? Math.max(g2, waterY) : g2;
    if (this.pos.y <= floor) {
      if (!this.onGround && this.vel.y < -2) game.audio.land();
      this.pos.y = floor;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > floor + 0.05) this.onGround = false;

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // heading follows camera yaw
    const camHeading = -this.yaw - Math.PI / 2;
    this.heading += angleDiff(this.heading, camHeading) * Math.min(1, dt * 12);

    // noise
    const sp = this.speed / Math.max(0.5, scale);
    let n = sp < 0.1 ? 0.03 : this.crouching ? 0.1 + sp * 0.06 : this.sprinting ? 1 : 0.35 + sp * 0.08;
    const biome = game.chunks.biomeAt(this.pos.x, this.pos.z);
    if (biome === 'meadow' || biome === 'farmland') n *= 1.1;
    if (biome === 'forest' && game.time.season === 'autumn') n *= 1.25;
    if (this.swimming) n *= 1.3;
    this.noise = clamp(n, 0, 1.2);

    // footsteps
    if (this.onGround && this.speed > 0.2) {
      this.stepDist += this.speed * dt;
      const stride = 0.28 * Math.max(0.5, scale) * (this.sprinting ? 1.8 : 1);
      if (this.stepDist > stride) {
        this.stepDist = 0;
        game.audio.footstep(this.surface(biome, depth), this.crouching ? 0.25 : this.sprinting ? 1 : 0.55);
      }
    }

    // actions
    if (controllable) {
      if (input.anyPressed('Mouse0', 'KeyF')) this.attack(false);
      if (input.anyPressed('Mouse2', 'KeyR')) this.attack(true);
      if (input.pressed('KeyQ')) this.sniff();
      if (input.pressed('KeyG')) game.interactions.eatCarried();
    }

    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.5;
      this.periodicChecks();
    }
    this.syncModel(dt);
    this.updateCamera(dt);
  }

  surface(biome: string, depth: number): string {
    if (depth > 0.02) return 'water';
    if (this.game.weather.snowCover > 0.35) return 'snow';
    if (Math.hypot(this.pos.x, this.pos.z) < 17) return 'dirt';
    const c = this.game.chunks.getChunkAt(this.pos.x, this.pos.z);
    if (c && c.flagAt(this.pos.x, this.pos.z) & 2) return 'road';
    switch (biome) {
      case 'forest': return 'leaves';
      case 'pine': return 'needles';
      case 'rocky': case 'mountain': return 'rock';
      case 'marsh': return 'mud';
      default: return 'grass';
    }
  }

  private collide() {
    this.cols.length = 0;
    this.game.collidersNear(this.pos.x, this.pos.z, this.cols);
    const r = this.radius;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.cols) {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + r;
        if (d < min && d > 1e-5) {
          this.pos.x = c.x + (dx / d) * min;
          this.pos.z = c.z + (dz / d) * min;
        }
      }
    }
  }

  private dodge(mx: number, mz: number) {
    if (this.stamina < 10) return;
    this.stamina -= 10;
    this.dodgeT = 0.38;
    let dx = mx, dz = mz;
    if (!dx && !dz) { const f = this.forward(); dx = -f.x; dz = -f.z; }
    this.vel.x = dx * 6;
    this.vel.z = dz * 6;
    this.vel.y = 1.8;
    this.onGround = false;
    this.game.audio.swipe();
  }

  startPounce(charge: number, attack: boolean) {
    const scale = Math.max(0.45, this.model.scale);
    const f = this.forward();
    const dist = (0.9 + charge * 2.4) * scale * (this.cat.stage === 'kit' ? 1.3 : 1);
    const to = new THREE.Vector3(this.pos.x + f.x * dist, 0, this.pos.z + f.z * dist);
    // stop at obstacles
    for (const c of this.game.collidersNear(to.x, to.z)) {
      if (dist2(c.x, c.z, to.x, to.z) < c.r + this.radius) { to.x -= f.x * (c.r + this.radius); to.z -= f.z * (c.r + this.radius); }
    }
    to.y = this.game.groundAt(to.x, to.z);
    this.pounce = { t: 0, dur: 0.32 + charge * 0.22, from: this.pos.clone(), to, h: (0.18 + charge * 0.3) * scale, charge, attack };
    this.stamina = Math.max(0, this.stamina - 6);
    this.game.audio.pounce();
    this.noise = 0.6;
  }

  private landPounce() {
    const p = this.pounce!;
    this.pounce = null;
    this.vel.set(0, 0, 0);
    this.onGround = true;
    this.game.audio.land();
    const scale = Math.max(0.45, this.model.scale);
    // attack pounce on a hostile
    const hostile = this.findTarget(0.9 * scale + 0.4, 1.4);
    if (hostile) {
      this.game.combat.resolveAttack(this, hostile, 1, true);
      return;
    }
    const precision = 1 - Math.abs(p.charge - 0.75) * 1.3;
    const caught = this.game.prey.tryCatch(this.pos.x, this.pos.z, 0.45 * scale + 0.25, precision);
    if (caught) this.game.interactions.caughtPrey(caught.kind);
    else {
      const near = this.game.prey.nearestOfKind(this.pos.x, this.pos.z, 3);
      if (near) this.game.ui.floatText('Missed!', '#ddd');
    }
  }

  findTarget(reach: number, arc = 1.2): Fighter | null {
    const game = this.game;
    let best: Fighter | null = null, bd = reach;
    const consider = (f: Fighter) => {
      if (!f.alive) return;
      const d = dist2(f.pos.x, f.pos.z, this.pos.x, this.pos.z) - (f.radius ?? 0.25);
      if (d > bd) return;
      const a = Math.atan2(f.pos.z - this.pos.z, f.pos.x - this.pos.x);
      if (Math.abs(angleDiff(this.heading, a)) > arc) return;
      bd = d;
      best = f;
    };
    for (const c of game.creatures.list) consider(c);
    for (const a of game.npcs.agents.values()) {
      if (a.fightTarget?.kind === 'player' || (a.hostile && a.cat.clan !== 'home') || (a.userSpar && a.activity === 'fight')) consider(a);
    }
    return best;
  }

  private attack(heavy: boolean) {
    if (this.attackCd > 0) return;
    const game = this.game;
    const scale = Math.max(0.45, this.model.scale);
    const cost = heavy ? 18 : 6;
    if (this.stamina < cost) { game.ui.floatText('Too tired!', '#faa'); return; }
    this.stamina -= cost;
    this.attackCd = heavy ? 1.2 : 0.45;
    this.model.pose = 'fight';
    const target = this.findTarget((heavy ? 1.6 : 0.8) * scale + 0.3);
    if (heavy) {
      const f = this.forward();
      this.vel.x += f.x * 3;
      this.vel.z += f.z * 3;
    }
    if (target) {
      // attacking a clanmate that isn't sparring is not allowed
      game.combat.resolveAttack(this, target, 1, heavy);
      if (target.kind === 'cat' && target.faction === 'rival' && !target.fightTarget) game.combat.engage(target, this);
      return;
    }
    // swipe at fish / prey in reach
    const pr = game.prey.nearestOfKind(this.pos.x, this.pos.z, 0.7 * scale + 0.35);
    if (pr) {
      const caught = game.prey.tryCatch(pr.pos.x, pr.pos.z, 0.5, pr.kind === 'fish' ? 0.5 : 0);
      if (caught) game.interactions.caughtPrey(caught.kind);
      return;
    }
    game.audio.swipe();
  }

  sniff() {
    if (this.sniffCd > 0) return;
    this.sniffCd = 3;
    this.game.scent.sniff();
  }

  onHit(dmg: number, by: Fighter) {
    this.shake = Math.min(1, this.shake + dmg / 20);
    this.cat.injury = clamp(this.cat.injury + dmg * 0.25, 0, 100);
    this.game.ui.hurtFlash();
    this.game.audio.hurt();
    this.inCombatT = 6;
    void by;
  }

  onDefeated(by: Fighter) {
    const game = this.game;
    const cat = this.cat;
    game.combat.disengage(this);
    for (const f of [...game.combat.active]) if (f.fightTarget === this) game.combat.disengage(f);
    const spar = !!game.npcs.agents.get(by.id)?.userSpar;
    if (spar) {
      cat.health = Math.max(cat.health, 25);
      game.training.sparLost(by);
      return;
    }
    let death = by.kind === 'creature' ? (by.name === 'Badger' ? 0.12 : by.name === 'Dog' ? 0.08 : 0.05) : 0.02;
    if (cat.stage === 'kit' || cat.stage === 'apprentice') death *= 0.3;
    if (cat.stage === 'elder') death *= 1.8;
    if (simRng.chance(death)) {
      game.clan.kill(cat, `a ${by.name.toLowerCase()} attack`);
      return;
    }
    game.knockedOut(by);
  }

  private periodicChecks() {
    const game = this.game;
    const cat = this.cat;
    const x = this.pos.x, z = this.pos.z;
    const inCamp = Math.hypot(x, z) < 17.5;
    const owner = game.territories.ownerAt(x, z);
    const label = game.territories.ownerName(owner);
    if (label !== this.lastTerritory) {
      if (this.lastTerritory) game.ui.areaLabel(label);
      this.lastTerritory = label;
    }
    if (cat.exiled) return;
    // kit outside camp
    if (cat.stage === 'kit' && !inCamp) {
      // clanmates who spot a wandering kit either scold them or (if friends) hide them
      if (!this.kitOutFlag) game.npcs.kitSpotted();
    } else if (inCamp) this.kitOutFlag = false;
    if (game.clan.kitPunishPending && cat.stage === 'kit' && !this.busy) game.npcs.summonForKitPunishment();
    // confinement
    if (cat.confinedUntil !== null && cat.confinedUntil > game.time.day && !inCamp) {
      if (!this.confineFlag) { this.confineFlag = true; game.clan.infraction('confinement', game.npcs.witnesses(x, z, 30)); }
    } else if (inCamp) this.confineFlag = false;
    // trespass
    if (typeof owner === 'number' && !game.events.gatheringTruce(x, z)) {
      if (!this.trespassFlag) {
        this.trespassFlag = true;
        const w = game.npcs.witnesses(x, z, 20);
        game.clan.infraction('crossBorder', w, game.territories.rivals[owner].name);
        game.events.onTrespass(owner);
      }
    } else if (owner === 'home') this.trespassFlag = false;
    // danger zones
    const nearHouse = game.chunks.structuresNear(x, z, 12).some((s) => s.type === 'house');
    const chunk = game.chunks.getChunkAt(x, z);
    const onRoad = chunk ? (chunk.flagAt(x, z) & 2) !== 0 : false;
    if (nearHouse || onRoad) {
      if (!this.dangerFlag) {
        this.dangerFlag = true;
        if (cat.stage !== 'warrior' || nearHouse) game.clan.infraction('dangerZones', game.npcs.witnesses(x, z, 20));
        if (onRoad) game.ui.toast('The road is hard and smells of fumes. Something roars in the distance...', 'danger');
      }
    } else this.dangerFlag = false;
    // caves
    const cave = game.chunks.structuresNear(x, z, 0).find((s) => s.type === 'cave');
    this.inCave = cave ? 1 - clamp(dist2(x, z, cave.x, cave.z) / cave.r, 0, 1) * 0.5 : 0;
    game.discoveries.check(x, z);
  }

  syncModel(dt: number) {
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = -this.heading;
    m.speed = this.speed;
    if (!this.pounce) {
      if (this.sleeping) m.pose = 'sleep';
      else if (this.swimming) m.pose = 'swim';
      else if (this.crouching || this.charging) m.pose = 'crouch';
      else if (this.inCombatT > 0) m.pose = 'fight';
      else if (this.speed > 0.1) m.pose = 'walk';
      else m.pose = 'stand';
    }
    m.lookPitch = this.thirdPerson ? -this.pitch * 0.5 : 0;
    m.update(dt);
  }

  updateCamera(dt: number) {
    const cam = this.game.camera;
    const m = this.model;
    const scale = m.scale;
    const f = this.forward();
    if (this.speed > 0.2 && this.onGround) this.bob += dt * this.speed * 3.2 / Math.max(0.5, scale);
    const bobY = Math.sin(this.bob * 2) * 0.012 * scale * Math.min(1, this.speed / 3);
    const crouchDrop = this.crouching || this.charging ? m.legLen * 0.35 * scale : 0;
    const eye = m.eyeHeight + 0.025 * scale;
    if (this.thirdPerson) {
      const dist = 0.9 + 1.6 * scale;
      const cx = this.pos.x - f.x * dist * Math.cos(this.pitch * 0.6);
      const cz = this.pos.z - f.z * dist * Math.cos(this.pitch * 0.6);
      let cy = this.pos.y + eye + 0.25 + Math.sin(-this.pitch) * dist * 0.6;
      cy = Math.max(cy, this.game.groundAt(cx, cz) + 0.15);
      cam.position.set(cx, cy, cz);
      cam.lookAt(this.pos.x + f.x * 0.5, this.pos.y + eye, this.pos.z + f.z * 0.5);
    } else {
      const fo = 0.15 * scale;
      cam.position.set(this.pos.x + f.x * fo, this.pos.y + eye - crouchDrop + bobY, this.pos.z + f.z * fo);
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * 0.03 * this.shake;
      cam.position.y += (Math.random() - 0.5) * 0.03 * this.shake;
    }
    // prey held in mouth, visible in first person
    if (this.carryView) this.carryView.visible = !this.thirdPerson;
  }

  updateCarryVisual() {
    const first = this.prey[0];
    const color = first ? first.color : this.moss > 0 ? 0x6a9a48 : (this.herbs.silverleaf + this.herbs.sunpetal + this.herbs.bitterroot) > 0 ? 0x8ab870 : null;
    this.model.setCarry(color);
    const cam = this.game.camera;
    if (this.carryView) { cam.remove(this.carryView); this.carryView.geometry.dispose(); (this.carryView.material as THREE.Material).dispose(); this.carryView = null; }
    if (color !== null) {
      const g = new THREE.SphereGeometry(0.03, 10, 8);
      g.scale(first && first.slots > 1 ? 2.6 : 1.8, 0.8, 0.9);
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
      mesh.position.set(0.0, -0.075, -0.13);
      mesh.rotation.y = 0.4;
      cam.add(mesh);
      this.carryView = mesh;
    }
  }

  addPrey(kind: PreyKind): boolean {
    const info = PREY[kind];
    if (this.carrySlots + info.slots > this.maxSlots) return false;
    this.prey.push({ kind, value: info.value, slots: info.slots, color: info.color });
    this.updateCarryVisual();
    return true;
  }
}
