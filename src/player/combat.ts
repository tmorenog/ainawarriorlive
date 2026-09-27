// Stylised, non-graphic combat shared by the player, NPC cats and creatures.
// Hits produce puffs of fur and a flash; defeated creatures flee, defeated
// cats are knocked down and wounded (and occasionally die).
import * as THREE from 'three';
import type { Game } from '../game';
import { simRng } from '../core/rng';
import { clamp, dist2 } from '../core/math';

export interface Fighter {
  id: string;
  kind: 'player' | 'cat' | 'creature';
  faction: 'home' | 'rival' | 'loner' | 'wild';
  pos: THREE.Vector3;
  heading: number;
  radius: number;
  hp: number;
  maxHp: number;
  power: number;
  defense: number;
  alive: boolean;
  name: string;
  fightTarget?: Fighter | null;
  /** Ids of the player's friends who have sworn to finish this attacker. */
  doomedBy?: Set<string>;
}

interface Puff { pos: THREE.Vector3; vel: THREE.Vector3; life: number; size: number }

export class CombatSystem {
  active = new Set<Fighter>();
  private puffs: Puff[] = [];
  private points: THREE.Points;
  private posAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  telegraphs = new Map<Fighter, number>();
  lastPlayerHit = -99;
  yieldUntil = -99;

  constructor(private game: Game) {
    const N = 120;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(N), 1);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(N), 1);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * 300.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(0.95, 0.93, 0.88, vA * (1.0 - d * 2.0)); }`,
    }));
    this.points.frustumCulled = false;
    game.scene.add(this.points);
  }

  get playerInCombat(): boolean {
    for (const f of this.active) if (f.fightTarget && f.fightTarget.kind === 'player' && f.alive) return true;
    return false;
  }

  hostilesNearPlayer(r = 14): Fighter[] {
    const p = this.game.player;
    const out: Fighter[] = [];
    for (const f of this.active) if (f.alive && f.fightTarget?.kind === 'player' && dist2(f.pos.x, f.pos.z, p.pos.x, p.pos.z) < r) out.push(f);
    return out;
  }

  /** The player submits: every fight aimed at them ends, and enemies leave them be for a while. */
  playerYield() {
    const g = this.game;
    const foes = [...this.active].filter((f) => f.fightTarget?.kind === 'player');
    if (!foes.length) return;
    let real = false;
    for (const f of foes) {
      this.disengage(f);
      const ag = g.npcs.agents.get(f.id);
      if (ag) {
        if (ag.userSpar) { g.training.sparLost(ag); ag.activity = 'idle'; continue; }
        real = true;
        ag.hostile = false;
        ag.userAggressive = false;
        ag.warned = 3;
        ag.mood = 'neutral';
        ag.activity = ag.cat.clan === 'home' ? 'idle' : 'rivalPatrol';
        ag.say(ag.cat.clan === 'home' ? 'Then stay out of our way!' : simRng.pick(['Go back where you belong.', 'Smart choice. Now leave.', 'Run home, then!']), 3);
        continue;
      }
      const cr = g.creatures.get(f.id);
      if (cr) {
        real = true;
        cr.state = 'wander';
        cr.fightTarget = null;
        cr.windup = 0;
        const ax = cr.pos.x - g.player.pos.x, az = cr.pos.z - g.player.pos.z;
        const l = Math.hypot(ax, az) || 1;
        cr.target = { x: cr.pos.x + (ax / l) * 25, z: cr.pos.z + (az / l) * 25 };
        cr.timer = 12;
      }
    }
    g.player.inCombatT = 0;
    this.yieldUntil = g.clock + 20;
    if (real) {
      const c = g.clan.player;
      c.reputation = clamp(c.reputation - 1, -100, 100);
      g.ui.toast('You flatten your ears, crouch low and back away. The fight is over.', 'info');
    }
  }

  /** a starts fighting b. Nearby clanmates rally if a home cat or the player is attacked. */
  engage(a: Fighter, b: Fighter, spar = false) {
    if (!a.alive || !b.alive) return;
    if (b.kind === 'player' && !spar && this.yieldUntil > this.game.clock) return;
    a.fightTarget = b;
    this.active.add(a);
    const agent = this.game.npcs.agents.get(a.id);
    if (agent) {
      this.game.npcs.endConvo(agent);
      agent.activity = 'fight';
      agent.fightTarget = b;
      agent.userSpar = spar;
      agent.patrol = null;
    }
    if (b.kind === 'player' && !spar) {
      this.game.player.enterCombat();
      this.rally(a, b);
      this.sendFriends(a);
    }
    if (b.kind === 'cat' && b.faction === 'home' && !spar) this.rally(a, b);
    if (a.kind === 'creature' || a.faction === 'rival') this.game.audio.growl(a.kind === 'creature');
  }

  /** Clan warriors nearby join the fight against `enemy`. */
  rally(enemy: Fighter, victim: Fighter) {
    for (const ag of this.game.npcs.agents.values()) {
      if (ag.cat.clan !== 'home' || ag.cat.stage === 'kit' || ag.cat.stage === 'elder' || ag.activity === 'fight') continue;
      if (ag.id === victim.id) continue;
      if (ag.cat.role === 'medicine' && simRng.chance(0.7)) continue;
      const d = dist2(ag.pos.x, ag.pos.z, enemy.pos.x, enemy.pos.z);
      if (d > 26) continue;
      if (ag.cat.pers.bravery < 0.25 && simRng.chance(0.5)) { ag.say('I... I can\'t!', 2); continue; }
      ag.say(simRng.pick(['For the clan!', 'I\'m with you!', 'Get away from them!', 'Attack!']), 2.5);
      this.engage(ag, enemy);
      if (victim.kind === 'player') {
        this.game.clan.adjust(this.game.clan.player, ag.cat, 4, { text: `${ag.name} fought at my side.`, weight: 3 });
      }
    }
  }

  /** Anyone who tries to kill the player answers to the player's friends — no matter what. */
  sendFriends(enemy: Fighter) {
    const g = this.game;
    const pc = g.clan.player;
    if (!pc || enemy.kind === 'player') return;
    const friends = [...g.npcs.agents.values()]
      .filter((ag) => ag.cat.clan === 'home' && ag.cat.alive && ag.cat.stage !== 'kit' && ag.id !== enemy.id && !ag.userSpar
        && (g.clan.opinion(ag.cat, pc) >= 40 || ag.cat.mate === pc.id))
      .sort((x, y) => dist2(x.pos.x, x.pos.z, g.player.pos.x, g.player.pos.z) - dist2(y.pos.x, y.pos.z, g.player.pos.x, g.player.pos.z));
    if (!friends.length) return;
    let chosen = friends.filter((ag) => dist2(ag.pos.x, ag.pos.z, g.player.pos.x, g.player.pos.z) < 80).slice(0, 2);
    if (!chosen.length) {
      // the closest friend was already on your trail and bursts out of the undergrowth
      const f = friends[0];
      const ang = Math.atan2(g.player.pos.z - enemy.pos.z, g.player.pos.x - enemy.pos.x) + simRng.range(-0.8, 0.8);
      const x = g.player.pos.x + Math.cos(ang) * 7, z = g.player.pos.z + Math.sin(ang) * 7;
      f.pos.set(x, g.groundAt(x, z), z);
      chosen = [f];
    }
    enemy.doomedBy = enemy.doomedBy ?? new Set();
    for (const f of chosen) {
      if (enemy.doomedBy.has(f.id)) continue;
      enemy.doomedBy.add(f.id);
      if (f.activity === 'sleep') { f.activity = 'idle'; f.forcedPose = null; }
      if (f.fightTarget && f.fightTarget !== enemy) this.disengage(f);
      f.say(simRng.pick([`Get AWAY from ${pc.given}!`, `Nobody hurts ${pc.given}!`, `You'll never touch ${pc.given} again!`, `${pc.given}, I'm here!`]), 3);
      f.moveSpeed = Math.max(f.moveSpeed, 6);
      this.active.delete(f); // make sure the new target sticks
      this.engage(f, enemy);
      g.clan.adjust(pc, f.cat, 6, { text: `${f.name} came to save me when ${enemy.name.toLowerCase()} attacked.`, weight: 5 });
    }
    g.ui.toast(`${chosen.map((f) => f.name).join(' and ')} ${chosen.length > 1 ? 'charge' : 'charges'} in to protect you!`, 'good');
  }

  disengage(a: Fighter) {
    this.active.delete(a);
    a.fightTarget = null;
    for (const f of this.active) if (f.fightTarget === a) f.fightTarget = null;
    this.telegraphs.delete(a);
  }

  telegraph(a: Fighter) {
    this.telegraphs.set(a, this.game.clock + 0.5);
    if (a.kind === 'creature') this.game.audio.growl(true);
  }

  /** Resolve an attack from `att` on `def`. inRange=0 means a miss due to distance. */
  resolveAttack(att: Fighter, def: Fighter, inRange: number, heavy = false): boolean {
    this.telegraphs.delete(att);
    if (!inRange || !def.alive || !att.alive) {
      this.game.audio.swipe();
      return false;
    }
    if (def.kind === 'player' && this.game.player.isDodging) {
      this.game.audio.swipe();
      this.game.ui.floatText('Dodged!', '#bfe8ff');
      return false;
    }
    // hit chance and position bonus
    const toAtt = Math.atan2(att.pos.z - def.pos.z, att.pos.x - def.pos.x);
    let rel = Math.abs(((toAtt - def.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    // rel ~ 0 => attacker in front; PI => behind
    const posBonus = rel > 2.3 ? 1.5 : rel > 1.2 ? 1.2 : 1;
    const avenging = !!def.doomedBy?.has(att.id);
    let hitChance = clamp(0.72 + (att.power - def.power) * 0.01 + (posBonus - 1) * 0.3 - def.defense * 0.5, 0.35, 0.95);
    if (def.kind === 'player') hitChance *= 0.75; // fights are forgiving for the player
    if (att.kind === 'player') hitChance = Math.min(0.97, hitChance + 0.15);
    if (avenging) hitChance = 1;
    if (!simRng.chance(hitChance)) {
      this.game.audio.swipe();
      if (att.kind === 'player') this.game.ui.floatText('Miss', '#ddd');
      return false;
    }
    let dmg = att.power * simRng.range(0.8, 1.25) * (heavy ? 1.8 : 1) * posBonus * (1 - def.defense);
    if (avenging) dmg = Math.max(dmg, def.maxHp * 0.4);
    def.hp = Math.max(0, def.hp - dmg);
    this.puff(def.pos, 6 + Math.floor(dmg / 3), def.kind === 'creature' ? 0.25 : 0.12);
    this.game.audio.hit(heavy);
    if (def.kind === 'player') {
      this.lastPlayerHit = this.game.clock;
      this.game.player.onHit(dmg, att);
    }
    if (att.kind === 'player') {
      this.game.ui.floatText(heavy ? 'Pin!' : 'Hit!', posBonus > 1 ? '#ffd27a' : '#fff');
      const pc = this.game.clan.player;
      pc.skills.fighting = Math.min(99, pc.skills.fighting + 0.25);
    }
    // knockback
    const kx = def.pos.x - att.pos.x, kz = def.pos.z - att.pos.z;
    const kl = Math.hypot(kx, kz) || 1;
    const kb = heavy ? 0.6 : 0.25;
    def.pos.x += (kx / kl) * kb;
    def.pos.z += (kz / kl) * kb;
    // defeated?
    if (def.hp <= 0.5) this.defeat(def, att);
    else if (def.kind === 'creature' && !def.fightTarget) this.engage(def, att);
    else if (def.kind === 'cat' && def.faction !== 'home' && !def.fightTarget) this.engage(def, att);
    return true;
  }

  defeat(f: Fighter, by: Fighter) {
    this.disengage(f);
    if (f.doomedBy?.size && f.kind !== 'player') { this.finish(f, by); return; }
    if (f.kind === 'creature') {
      this.game.creatures.driveOff(f.id, by);
      return;
    }
    if (f.kind === 'player') {
      this.game.player.onDefeated(by);
      return;
    }
    const ag = this.game.npcs.agents.get(f.id);
    if (!ag) return;
    const cat = ag.cat;
    if (ag.userSpar) {
      cat.health = Math.max(20, cat.health);
      ag.activity = 'idle';
      return;
    }
    if (cat.clan !== 'home') {
      cat.health = 15;
      ag.activity = 'leaving';
      ag.hostile = false;
      ag.say(simRng.pick(['I yield!', 'Enough! Enough!', 'We\'re going!']), 3);
      const ax = ag.pos.x - by.pos.x, az = ag.pos.z - by.pos.z;
      ag.setTarget(ag.pos.x + ax * 25, ag.pos.z + az * 25);
      ag.moveSpeed = 4;
      ag.actTimer = 20;
      if (by.kind === 'player') this.game.onPlayerWonFight(f);
      return;
    }
    // home cat knocked down
    cat.injury = clamp(cat.injury + simRng.range(40, 70), 0, 100);
    const deathChance = by.kind === 'creature' ? (by.name.includes('badger') || by.name.includes('Badger') ? 0.25 : 0.1) : 0.04;
    if (simRng.chance(deathChance * (cat.stage === 'elder' ? 2 : 1))) {
      this.game.clan.kill(cat, `a ${by.name.toLowerCase()} attack`);
    } else {
      cat.health = 12;
      ag.activity = 'sleep';
      ag.actTimer = 30;
      ag.say('Ugh...', 2);
      const d = this.game.camp.dens.medicine;
      ag.bedSpot = d.beds[0];
      ag.setTarget(d.x, d.z);
    }
  }

  /** An attacker brought down by the player's friend does not get up again. */
  private finish(f: Fighter, by: Fighter) {
    const g = this.game;
    const saviourId = f.doomedBy!.has(by.id) ? by.id : [...f.doomedBy!][0];
    const saviour = g.npcs.agents.get(saviourId);
    const sName = saviour ? saviour.name : by.name;
    this.puff(f.pos, 18, 0.3);
    g.audio.hit(true);
    if (f.kind === 'creature') {
      const c = g.creatures.get(f.id);
      if (!c) return;
      g.events.creatureDrivenOff(c, by);
      g.creatures.remove(c);
      g.ui.toast(`The ${c.name.toLowerCase()} falls and does not rise again. ${sName} stands over you, fur bristling.`, 'good');
      g.clan.log(`${sName} killed a ${c.name.toLowerCase()} that attacked ${g.clan.player.given}.`, 'event');
    } else {
      const ag = g.npcs.agents.get(f.id);
      const cat = ag?.cat ?? g.clan.get(f.id);
      if (!cat) return;
      g.ui.toast(`${f.name} falls and does not rise again. ${sName} protected you.`, 'good');
      g.clan.kill(cat, `a fight with ${sName}, who was protecting ${g.clan.player.given}`);
    }
    if (saviour) {
      saviour.say(simRng.pick(['Are you alright? I\'d never let anything happen to you.', 'It\'s over. You\'re safe now.', 'Nobody hurts my friend.']), 4);
      saviour.activity = 'idle';
      saviour.fightTarget = null;
      const pc = g.clan.player;
      g.clan.adjust(saviour.cat, pc, 5);
      g.clan.remember(pc, `${sName} saved my life.`, 8, saviour.id);
      saviour.cat.deeds++;
    }
  }

  puff(at: THREE.Vector3, n: number, spread: number) {
    for (let i = 0; i < n; i++) {
      if (this.puffs.length > 110) this.puffs.shift();
      this.puffs.push({
        pos: new THREE.Vector3(at.x + simRng.range(-spread, spread), at.y + 0.2 + simRng.range(0, spread), at.z + simRng.range(-spread, spread)),
        vel: new THREE.Vector3(simRng.range(-0.8, 0.8), simRng.range(0.3, 1.2), simRng.range(-0.8, 0.8)),
        life: simRng.range(0.5, 1.0),
        size: simRng.range(0.02, 0.05),
      });
    }
  }

  update(dt: number) {
    // cleanup
    for (const f of [...this.active]) {
      if (!f.alive || (f.fightTarget && !f.fightTarget.alive)) this.disengage(f);
    }
    // puffs
    const P = this.posAttr.array as Float32Array, S = this.sizeAttr.array as Float32Array, A = this.alphaAttr.array as Float32Array;
    this.puffs = this.puffs.filter((p) => (p.life -= dt) > 0);
    for (let i = 0; i < 120; i++) {
      const p = this.puffs[i];
      if (!p) { S[i] = 0; A[i] = 0; continue; }
      p.vel.y -= dt * 1.5;
      p.vel.multiplyScalar(1 - dt * 2);
      p.pos.addScaledVector(p.vel, dt);
      P[i * 3] = p.pos.x; P[i * 3 + 1] = p.pos.y; P[i * 3 + 2] = p.pos.z;
      S[i] = p.size;
      A[i] = Math.min(1, p.life * 1.5);
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }
}
