// Everything the player can *do* with the world: talk, groom, share prey,
// court a mate, deliver herbs and moss, sleep, escort cats, give orders.
import * as THREE from 'three';
import type { Game } from '../game';
import { clanTitle } from '../lore';
import type { NpcAgent, ApproachIntent } from '../ai/npc';
import type { PreyKind } from '../wildlife/models';
import { PREY } from '../wildlife/prey';
import { Cat, displayName, pronoun, roleLabel } from '../cats/types';
import { adviceLine, greetPlayer, isFamily, relLabel } from './social';
import { HERB_INFO, HerbKind, Interactable } from '../world/chunks';
import { simRng } from '../core/rng';
import { clamp, dist2 } from '../core/math';
import { bearing } from '../player/scent';
import { localReply, sentiment } from './chatbot';
import { aiReply, chatHistory } from './aiChat';

export interface Prompt { text: string; action: () => void }

export class Interactions {
  current: Prompt | null = null;
  private lastSpoke = new Map<string, number>();
  private reminisced = new Set<string>();
  private remindedOf = new Set<string>();
  /** Prey the player has dropped on the ground; it can be picked up again. */
  dropped: { kind: PreyKind; mesh: THREE.Mesh; x: number; z: number }[] = [];
  constructor(private game: Game) {}

  /** Put down what you're carrying (onto the pile if you're next to it). */
  drop() {
    const g = this.game;
    const pl = g.player;
    const pile = g.camp.pile;
    if (pl.prey.length && dist2(pl.pos.x, pl.pos.z, pile.x, pile.z) < 2.5 && !g.clan.player.exiled) { this.depositPrey(); return; }
    if (pl.prey.length) {
      const pr = pl.prey.pop()!;
      pl.updateCarryVisual();
      const f = pl.forward();
      const x = pl.pos.x + f.x * 0.5, z = pl.pos.z + f.z * 0.5;
      const geo = new THREE.SphereGeometry(0.07 * (pr.slots > 1 ? 1.6 : 1), 10, 8);
      geo.scale(1.8, 0.8, 0.9);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: pr.color }));
      mesh.position.set(x, g.groundAt(x, z) + 0.05, z);
      mesh.rotation.y = Math.random() * Math.PI;
      g.scene.add(mesh);
      this.dropped.push({ kind: pr.kind as PreyKind, mesh, x, z });
      g.audio.drop();
      g.ui.toast(`You put down the ${pr.kind}.`, 'info');
      return;
    }
    if (pl.moss > 0 || pl.herbs.silverleaf + pl.herbs.sunpetal + pl.herbs.bitterroot > 0) {
      pl.moss = 0;
      pl.herbs = { silverleaf: 0, sunpetal: 0, bitterroot: 0 };
      pl.updateCarryVisual();
      g.ui.toast('You drop what you were carrying.', 'info');
      return;
    }
    g.ui.toast('You aren\'t carrying anything.', 'info');
  }

  drink() {
    const g = this.game;
    const pl = g.player;
    const pc = g.clan.player;
    g.audio.eat();
    pl.stamina = 100;
    pc.health = Math.min(pc.maxHealth, pc.health + 5);
    const drought = g.events.active.some((e) => e.type === 'drought');
    if (drought) pc.health = Math.min(pc.maxHealth, pc.health + 10);
    g.ui.toast(drought ? 'You lap up the precious water. In this drought, every drop helps.' : simRng.pick(['You lap up cool, fresh water. Refreshing!', 'The water is cold and clear. You feel ready for anything.', 'You drink until your whiskers drip.']), 'good');
    // nearby friends come to drink beside you
    for (const a of g.npcs.agents.values()) {
      if (a.activity === 'follow' && dist2(a.pos.x, a.pos.z, pl.pos.x, pl.pos.z) < 6 && a.cat.clan === 'home') { a.say('*laps water beside you*', 2); g.clan.adjust(a.cat, pc, 1); }
    }
  }

  /** Share a piece of fresh-kill with a clanmate: from your mouth, or from the pile when in camp. */
  private shareFreshKill(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    const again = () => this.talkMenu(a, done);
    let what = 'a piece of fresh-kill';
    if (g.player.prey.length) { const pr = g.player.prey.shift()!; g.player.updateCarryVisual(); what = `your ${pr.kind}`; }
    else if (clan.food >= 1) clan.addFood(-1);
    else { g.ui.dialog({ speaker: c, text: 'The pile is empty. Maybe we should hunt together first?', options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done }); return; }
    pc.hunger = clamp(pc.hunger + 30, 0, 100);
    c.hunger = clamp(c.hunger + 30, 0, 100);
    g.audio.eat();
    g.audio.purr();
    a.forcedPose = 'groom';
    setTimeout(() => (a.forcedPose = null), 3000);
    const close = clan.opinion(c, pc) > 50;
    clan.adjust(c, pc, 8, { text: `${pc.given} and I shared fresh-kill.`, weight: 3 });
    clan.adjust(pc, c, 5);
    if (c.stage === 'warrior' && pc.stage === 'warrior' && !isFamily(c, pc) && close) clan.rel(c, pc).romance = clamp(clan.rel(c, pc).romance + 5, 0, 100);
    g.ui.toast(`You share ${what} with ${a.name}.`, 'good');
    g.ui.dialog({ speaker: c, text: simRng.pick(['Mmm, this is good. Thanks for sharing.', 'Sharing tongues and fresh-kill — this is the best part of the day.', '*purrs, chewing happily*', 'You can have the last bite. No, really!']), options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
  }

  private pickUp(i: number) {
    const g = this.game;
    const d = this.dropped[i];
    if (!g.player.addPrey(d.kind)) { g.ui.toast('Your mouth is full.', 'info'); return; }
    g.scene.remove(d.mesh);
    d.mesh.geometry.dispose();
    (d.mesh.material as THREE.Material).dispose();
    this.dropped.splice(i, 1);
  }

  /** Compute the best contextual action near the player. */
  update() {
    const g = this.game;
    const pl = g.player;
    if (pl.busy || pl.sleeping || !pl.alive) { this.current = null; return; }
    const p = pl.pos;
    const f = pl.forward();
    const pc = g.clan.player;
    this.current = null;
    // NPC in front
    let best: NpcAgent | null = null, bs = 2.6 * Math.max(0.6, pl.scale);
    for (const a of g.npcs.agents.values()) {
      const d = dist2(a.pos.x, a.pos.z, p.x, p.z);
      if (d > 3) continue;
      const dot = ((a.pos.x - p.x) * f.x + (a.pos.z - p.z) * f.z) / Math.max(d, 0.01);
      const score = d - dot * 0.8;
      if (dot > 0.2 && score < bs) { bs = score; best = a; }
    }
    if (best && best.activity !== 'fight') {
      const a = best;
      if (a.activity === 'stranded') { this.current = { text: `Help ${a.name} — "Follow me!"`, action: () => this.rescue(a) }; return; }
      if (g.npcs.evacuate && (a.cat.stage === 'kit' || a.cat.stage === 'elder') && a.activity !== 'follow') {
        this.current = { text: `Tell ${a.name} to follow you`, action: () => this.escort(a) }; return;
      }
      this.current = { text: `Talk to ${a.name}${a.activity === 'sleep' ? ' (sleeping)' : ''}`, action: () => this.talk(a) };
      return;
    }
    // prey you put down
    const di = this.dropped.findIndex((d) => dist2(d.x, d.z, p.x, p.z) < 1.4 * Math.max(0.7, pl.scale));
    if (di >= 0) { this.current = { text: `Pick up the ${this.dropped[di].kind}`, action: () => this.pickUp(di) }; return; }
    // fresh-kill pile
    const pile = g.camp.pile;
    if (dist2(p.x, p.z, pile.x, pile.z) < 2 && !pc.exiled) {
      if (pl.prey.length) { this.current = { text: `Drop your catch on the fresh-kill pile`, action: () => this.depositPrey() }; return; }
      if (g.clan.food >= 1) { this.current = { text: `Eat from the fresh-kill pile (${Math.floor(g.clan.food)} left)`, action: () => this.eatFromPile() }; return; }
    }
    // water: lap from the edge of a stream, pond or lake
    {
      const ax = p.x + f.x * 1.1, az = p.z + f.z * 1.1;
      if (g.chunks.waterDepthAt(ax, az) > 0.02 || g.chunks.waterDepthAt(p.x, p.z) > 0.02) {
        this.current = { text: 'Drink water', action: () => this.drink() };
        return;
      }
    }
    // herbs & moss
    const its = g.chunks.interactablesNear(p.x, p.z, 1.3 * Math.max(0.7, pl.scale));
    if (its.length) {
      const it = its[0];
      if (it.type === 'berries') {
        const kit = pc.stage === 'kit';
        this.current = { text: kit ? 'Taste the shiny red berries' : 'Deathberries! Eat them anyway? (deadly poison)', action: () => this.eatDeathberries(it) };
        return;
      }
      if (it.type === 'herb') { const info = HERB_INFO[it.kind as HerbKind]; this.current = { text: `Pick ${info.name} (${info.use})`, action: () => this.collect(it) }; }
      else this.current = { text: 'Gather soft moss', action: () => this.collect(it) };
      return;
    }
    // dens
    const den = g.camp.denAt(p.x, p.z);
    if (den && !pc.exiled) {
      const med = g.clan.medicine;
      if (den.name === 'medicine' && med && !med.isPlayer && (pl.poison > 0 || pc.sick > 10 || pc.injury > 10 || pc.health < pc.maxHealth - 10)) {
        this.current = { text: `Ask ${displayName(med)} for help`, action: () => this.seekHealing(med) };
        return;
      }
      if (den.name === 'medicine' && (pl.herbs.silverleaf + pl.herbs.sunpetal + pl.herbs.bitterroot) > 0) { this.current = { text: 'Leave your herbs with the healer', action: () => this.deliverHerbs() }; return; }
      if ((den.name === 'elders' || den.name === 'nursery') && pl.moss > 0) { this.current = { text: `Line the ${den.label.toLowerCase()} with fresh moss`, action: () => this.deliverMoss(den.name) }; return; }
      if (den.name === g.npcs.denFor(pc) || (den.name === 'warriors' && pc.stage === 'warrior')) {
        this.current = { text: g.time.isNight || g.time.hour > 19 ? 'Sleep until dawn' : 'Take a nap', action: () => g.sleep() };
        return;
      }
    }
    // High Rock
    const hr = g.camp.highRock;
    if (dist2(p.x, p.z, hr.x, hr.z) < 4 && g.clan.leader?.isPlayer) { this.current = { text: 'Call the clan beneath the High Rock', action: () => g.ui.openLeader() }; return; }
    // exiled: ask to return near clan cats is handled via talk
  }

  interact() {
    this.current?.action();
  }

  // ---------------------------------------------------------------- talking
  talk(a: NpcAgent) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    if (a.activity === 'sleep') {
      g.ui.dialog({ speaker: c, text: `${a.name} is curled up fast asleep, snoring softly.`, options: [
        { label: `Nudge ${pronoun(c, 'obj')} awake`, action: () => this.wakeCat(a) },
        { label: 'Let them sleep', action: () => {} },
      ] });
      return;
    }
    g.npcs.endConvo(a);
    const prev = a.activity;
    a.activity = 'talkPlayer';
    a.actTimer = 999;
    a.target = null;
    a.heading = Math.atan2(g.player.pos.z - a.pos.z, g.player.pos.x - a.pos.x);
    const done = () => { if (a.activity === 'talkPlayer') { a.activity = prev === 'follow' || prev === 'shield' ? prev : 'idle'; a.actTimer = 0; } };
    if (c.clan !== 'home') return this.talkOutsider(a, done);
    if (pc.stage === 'kit' && Math.hypot(g.player.pos.x, g.player.pos.z) > 17.5 && c.stage !== 'kit' && !pc.exiled) {
      if (prev === 'shield' || g.npcs.isPlayerFriend(a)) {
        g.ui.dialog({ speaker: c, text: 'Shh! Get behind me — if anyone sees you out here you\'ll be in big trouble!', options: [
          { label: 'Hide behind them', action: () => { g.npcs.startShield(a); } },
          { label: 'Ask them to walk you home', action: () => { a.activity = 'follow'; a.followTarget = 'player'; a.userWalkHome = true; a.say('Alright, but quietly!', 2); g.ui.toast('Lead the way back to camp.', 'info'); } },
          { label: 'Thanks! I\'ll go back now', action: () => { done(); } },
        ], onClose: done });
      } else {
        this.scoldKit(a, done);
      }
      return;
    }
    const op = clan.opinion(c, pc);
    const r = clan.rel(c, pc);
    r.familiarity = clamp(r.familiarity + 2, 0, 100);
    let text = greetPlayer(c, pc, op, { night: g.time.isNight, food: clan.food, clanSize: clan.home().length, weather: g.weatherLabel(), recent: clan.lastRecent });
    if (pc.exiled && g.npcs.isPlayerFriend(a)) text = simRng.pick([
      `${pc.given}! *presses close* It hasn't been the same without you. I hate this.`,
      `Oh, ${pc.given}... are you eating? Are you safe? I think about you every night.`,
      `I told them it was wrong to drive you out. I'll keep telling them.`,
    ]);
    const past = this.pastLifeFriend(c);
    const pkey = c.id + ':' + g.time.day;
    if (past && !this.reminisced.has(pkey) && simRng.chance(0.35)) {
      this.reminisced.add(pkey);
      text = this.reminiscence(c, past);
      clan.adjust(c, pc, 3, this.remindedOf.has(c.id + ':' + past.id) ? undefined : { text: `${pc.given} reminded me of ${past.given}.`, weight: 2 });
      this.remindedOf.add(c.id + ':' + past.id);
    }
    const opts = this.talkOptions(a, done);
    g.ui.dialog({ speaker: c, text, options: opts, onClose: done, input: (t) => this.freeTalk(a, t, done) });
  }

  /** The most recent of the player's past lives this cat was friends with. */
  pastLifeFriend(c: Cat): Cat | null {
    const clan = this.game.clan;
    for (let i = clan.lineage.length - 1; i >= 0; i--) {
      const old = clan.get(clan.lineage[i]);
      if (!old || old.alive || old.id === clan.player.id || old.id === c.id) continue;
      if ((c.relations[old.id]?.opinion ?? 0) >= 40) return old;
    }
    return null;
  }

  private reminiscence(c: Cat, old: Cat): string {
    const n = displayName(old);
    const mate = c.mate === old.id;
    const kin = isFamily(c, old);
    const mem = c.memories.filter((m) => m.about === old.id && m.weight > 0).pop();
    const lines = mate ? [
      `*looks at you for a long moment* You have ${n}'s way of tilting your head... I still dream of ${pronoun(old, 'obj')} some nights.`,
      `For a heartbeat I thought you were ${n}. ${pronoun(old, 'subj')[0].toUpperCase() + pronoun(old, 'subj').slice(1)} used to sit just like that beside me.`,
    ] : kin ? [
      `You remind me of ${n}. Family always carries a little of each other, I suppose.`,
      `${n} would have been proud of you. I see ${pronoun(old, 'obj')} in you, you know.`,
    ] : [
      `Sometimes you remind me so much of ${n}... the way you hold your tail. I miss ${pronoun(old, 'obj')}.`,
      `Huh. You sounded just like ${n} then. We were close, ${pronoun(old, 'subj')} and I.`,
      `*purrs softly* ${n} used to say the exact same thing. It's like a piece of ${pronoun(old, 'obj')} is still here.`,
      `Do you ever feel like you've walked these paths before? ${n} used to love this part of the forest.`,
      `I was just thinking about ${n}. ${pronoun(old, 'subj')[0].toUpperCase() + pronoun(old, 'subj').slice(1)} hunts with StarClan now, but when I look at you... I don't know. It's strange.`,
    ];
    let line = simRng.pick(lines);
    if (mem && simRng.chance(0.5)) line += ` I'll never forget — ${mem.text.replace(/^./, (ch) => ch.toLowerCase())}`;
    return line;
  }

  private talkOptions(a: NpcAgent, done: () => void): { label: string; action: () => void; hint?: string }[] {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    const op = clan.opinion(c, pc);
    const opts: { label: string; action: () => void; hint?: string }[] = [];
    const again = () => this.talkMenu(a, done);
    const key = c.id + ':' + g.time.day;
    const talkedToday = (this.lastSpoke.get(key) ?? 0) >= 3;

    if (pc.exiled) {
      opts.push({ label: 'Ask to return to the clan', action: () => this.askReturn(a, done) });
      if (g.npcs.isPlayerFriend(a) && c.stage !== 'kit') opts.push({ label: 'Ask for shelter', hint: 'in secret', action: () => this.secretShelter(a, done) });
      opts.push({ label: 'Leave', action: done });
      return opts;
    }
    opts.push({ label: 'Chat', action: () => {
      this.lastSpoke.set(key, (this.lastSpoke.get(key) ?? 0) + 1);
      const gain = talkedToday ? 0.3 : 2 + c.pers.sociability * 2;
      clan.adjust(c, pc, gain, undefined, 4);
      g.ui.dialog({ speaker: c, text: this.chatLine(c), options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
    if (c.stage !== 'kit') opts.push({ label: 'Share tongues (groom)', action: () => {
      if (op < -15) { g.ui.dialog({ speaker: c, text: 'Don\'t touch me.', options: [{ label: 'Leave', action: done }], onClose: done }); clan.adjust(c, pc, -1); return; }
      this.lastSpoke.set(key, (this.lastSpoke.get(key) ?? 0) + 1);
      clan.adjust(c, pc, talkedToday ? 0.5 : 4, undefined, 5);
      clan.adjust(pc, c, 2);
      if (c.stage === 'warrior' && pc.stage === 'warrior' && !isFamily(c, pc) && op > 35) clan.rel(c, pc).romance = clamp(clan.rel(c, pc).romance + 4, 0, 100);
      a.forcedPose = 'groom';
      setTimeout(() => (a.forcedPose = null), 3000);
      g.audio.purr();
      g.ui.dialog({ speaker: c, text: simRng.pick(['*purrs* That\'s nice.', 'Mm, right behind the ears.', 'You\'re a good friend.', '*rumbles contentedly*']), options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
    opts.push({ label: 'Ask for advice or news', action: () => {
      const pr = g.prey.nearestOfKind(g.player.pos.x, g.player.pos.z, 60);
      const ev = g.events.active.find((e) => e.type !== 'gathering');
      const bd = g.territories.homeBorderDist(g.player.pos.x, g.player.pos.z);
      const line = adviceLine(c, {
        preyNear: pr && simRng.chance(0.5) ? `${pr.info.name} to the ${bearing(pr.pos.x - g.player.pos.x, pr.pos.z - g.player.pos.z)}` : undefined,
        eventHint: ev ? { fire: 'Stay away from the smoke!', flood: 'Keep off the low ground until the water drops.', drought: 'Drink where you can — the small streams are gone.', illness: 'The healer needs sunpetal and bitterroot.', shortage: 'Prey is thin. Try the meadows at dawn.', coldSnap: 'Keep the elders warm tonight.' }[ev.type as string] : undefined,
        borderHint: bd > -25 ? 'We\'re close to the border here. Mind your paws.' : undefined,
      });
      g.ui.dialog({ speaker: c, text: line, options: [{ label: 'Thanks', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
    if (g.player.prey.length) opts.push({ label: `Give ${pronoun(c, 'obj')} your ${g.player.prey[0].kind}`, action: () => {
      const pr = g.player.prey.shift()!;
      g.player.updateCarryVisual();
      c.hunger = clamp(c.hunger + 45 * pr.value, 0, 100);
      const needy = c.stage === 'elder' || c.stage === 'kit' || c.expectingUntil !== null || c.hunger < 40;
      clan.adjust(c, pc, needy ? 10 : 6, { text: `${pc.given} brought me fresh-kill.`, weight: 2 });
      pc.reputation = clamp(pc.reputation + (needy ? 2 : 1), -100, 100);
      g.ui.dialog({ speaker: c, text: needy ? 'Oh, thank you! I was so hungry.' : 'For me? You\'re too kind.', options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
    const inCamp = Math.hypot(g.player.pos.x, g.player.pos.z) < 17.5;
    if (!pc.exiled && (g.player.prey.length || (inCamp && clan.food >= 1))) opts.push({ label: 'Share fresh-kill together', hint: g.player.prey.length ? 'what you carry' : 'from the pile', action: () => this.shareFreshKill(a, done) });
    const young = (st: string) => st === 'kit' || st === 'apprentice';
    if (c.stage === 'kit' || (young(pc.stage) && young(c.stage))) {
      opts.push({ label: 'Play-fight', action: () => { done(); this.playFight(a); } });
    }
    opts.push({ label: 'Tease', hint: 'playful cats like it, others don\'t', action: () => {
      const likes = c.traits.includes('playful') || c.traits.includes('mischievous');
      clan.adjust(c, pc, likes ? 4 : -5);
      g.ui.dialog({ speaker: c, text: likes ? 'Ha! You\'ll pay for that one!' : simRng.pick(['Mouse-brain.', 'Is that supposed to be funny?', 'Grow up.']), options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
    const past = this.pastLifeFriend(c);
    if (past && this.remindedOf.has(c.id + ':' + past.id)) opts.push({ label: `Ask about ${past.given}`, hint: 'a past life', action: () => {
      const r = c.relations[past.id];
      const bits = [`${displayName(past)} was a ${roleLabel({ ...past, alive: true }).toLowerCase()} who lived ${Math.floor(past.age)} moons.`];
      bits.push(r.opinion > 70 ? `There was no cat I trusted more.` : `We were good friends.`);
      if (past.traits.length) bits.push(`${pronoun(past, 'subj')[0].toUpperCase() + pronoun(past, 'subj').slice(1)} was ${past.traits.join(' and ')}.`);
      bits.push(`${pronoun(past, 'subj')[0].toUpperCase() + pronoun(past, 'subj').slice(1)} died of ${past.deathCause ?? 'something none of us saw coming'}. ...Thank you for asking. It's nice to say ${pronoun(past, 'poss')} name out loud.`);
      clan.adjust(c, pc, 2);
      g.ui.dialog({ speaker: c, text: bits.join(' '), options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
    // ask the medicine cat to take you as their apprentice
    if (c.role === 'medicine' && !c.isPlayer && (pc.stage === 'kit' || pc.stage === 'apprentice') && pc.role !== 'medicineApprentice' && !(pc.stage === 'kit' && pc.medicinePath)) {
      opts.push({ label: 'Ask to become their apprentice', hint: 'the medicine cat\'s path', action: () => this.askMedicineApprentice(a, done) });
    }
    // medicine: be treated, or treat others
    const hurt = (x: Cat) => x.sick > 10 || x.injury > 10 || x.health < x.maxHealth - 10;
    if (c.role === 'medicine' && (g.player.poison > 0 || hurt(pc))) {
      opts.push({ label: 'Ask to be treated', action: () => this.seekHealing(c) });
    }
    if ((pc.role === 'medicine' || pc.role === 'medicineApprentice') && hurt(c) && c.id !== pc.id) {
      opts.push({ label: `Treat ${pronoun(c, 'poss')} ${c.sick > c.injury ? 'sickness' : 'wounds'}`, action: () => this.treatCat(a, done) });
    }
    // mates
    const pr = clan.rel(c, pc);
    if (pc.stage === 'warrior' && c.stage === 'warrior' && !pc.mate && !c.mate && !isFamily(c, pc) && op > 45) {
      opts.push({ label: 'Ask to become mates', hint: `they ${pr.romance > 40 ? 'seem fond of you' : 'may not feel the same'}`, action: () => this.proposeMate(a, done) });
    }
    // apprentice / mentor
    if (pc.stage === 'apprentice' && pc.mentor === c.id && g.training.canOfferLesson()) opts.push({ label: 'Ask for a training lesson', action: () => { done(); g.training.offerLesson(a); } });
    if (pc.apprentice === c.id) {
      const lessons = g.training.mentorOptions(a);
      if (lessons.length) opts.push({ label: `Train ${c.given}`, action: () => g.ui.dialog({ speaker: c, text: 'What are we learning today?', options: [...lessons.map((l) => ({ ...l, action: () => { done(); l.action(); } })), { label: 'Not today', action: done }], onClose: done }) });
    }
    // report to leader
    if (c.role === 'leader') {
      const ap = clan.get(pc.apprentice);
      if (ap && ap.stage === 'apprentice' && g.training.readyForWarrior(ap) && ap.age >= 12) {
        opts.push({ label: `Report that ${ap.given} is ready to be a warrior`, action: () => {
          done();
          clan.warriorCeremony(ap);
        } });
      }
      if (!g.objectives.busy() && (pc.stage === 'warrior' || pc.stage === 'apprentice')) opts.push({ label: 'Ask for a duty', action: () => { done(); this.npcInitiated(a, { kind: 'order', text: 'Hmm. Let me think.' }); } });
    }
    // player is leader: orders
    if (clan.leader?.isPlayer && c.stage !== 'kit') {
      opts.push({ label: 'Give an order', action: () => this.orderMenu(a, done) });
      if (c.stage === 'warrior' && c.role === 'none') opts.push({ label: `Name ${pronoun(c, 'obj')} Second`, action: () => { done(); clan.appointDeputy(c, true); } });
      opts.push({ label: `Exile ${pronoun(c, 'obj')}`, hint: 'permanent', action: () => g.ui.choice(`Exile ${displayName(c)}?`, 'They will be driven from the clan. Their friends will not forget.', [
        { label: 'Yes — exile them', action: () => { done(); g.decisions.exile(c); } }, { label: 'No', action: done }]) });
    }
    if (pc.stage === 'warrior' && c.role === 'none' && clan.deputy?.isPlayer && c.stage !== 'kit' && c.stage !== 'elder') {
      opts.push({ label: 'Send them hunting', action: () => { done(); this.orderHunt(a); } });
    }
    opts.push({ label: 'Goodbye', action: done });
    return opts;
  }

  /** The player typed their own words; the cat answers in character. */
  async freeTalk(a: NpcAgent, text: string, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    a.activity = 'talkPlayer';
    a.actTimer = 999;
    g.ui.dialog({ speaker: c, said: text, text: '…', options: [{ label: 'Wait for a reply', action: () => {}, disabled: true }] });
    const local = localReply(g, c, text);
    let reply = await aiReply(g, c, text);
    const usedAI = !!reply;
    if (!reply) {
      await new Promise((r) => setTimeout(r, 350 + Math.random() * 350));
      reply = local.reply;
    }
    // relationship effects come from the player's words either way
    const delta = usedAI ? sentiment(text) : local.opinion;
    clan.adjust(c, pc, delta, undefined, 3);
    if (local.romance) clan.rel(c, pc).romance = clamp(clan.rel(c, pc).romance + local.romance, 0, 100);
    if (delta <= -8) clan.remember(c, `${pc.given} said something hurtful to me.`, -2, pc.id);
    a.mood = delta < -5 ? 'angry' : delta > 3 ? 'happy' : 'neutral';
    if (delta < -5) g.audio.hiss();
    const h = chatHistory(c.id);
    h.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    if (h.length > 12) h.splice(0, h.length - 12);
    a.say(reply.length > 90 ? reply.slice(0, 88) + '…' : reply, 4);
    if (!g.ui.isBusy() || document.querySelector('.dialog')) {
      const opts = c.clan === 'home' ? this.talkOptions(a, done) : [{ label: 'Farewell', action: done }];
      g.ui.dialog({ speaker: c, said: text, text: reply, options: opts, onClose: done, input: (t) => this.freeTalk(a, t, done) });
    }
  }

  private talkMenu(a: NpcAgent, done: () => void) {
    const g = this.game;
    g.ui.dialog({ speaker: a.cat, text: simRng.pick(['Mm?', 'Yes?', 'What else?', '...']), options: this.talkOptions(a, done), onClose: done, input: (t) => this.freeTalk(a, t, done) });
  }

  private chatLine(c: Cat): string {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const lines: string[] = [];
    const mem = c.memories.filter((m) => m.about === pc.id).slice(-1)[0];
    if (mem && simRng.chance(0.5)) lines.push(mem.weight > 0 ? `I haven't forgotten: ${mem.text.replace(pc.given, 'you')}` : `I remember what happened. ${mem.text.replace(pc.given, 'You')}`);
    if (c.mate) { const m = clan.get(c.mate); if (m) lines.push(`${displayName(m)} and I watched the stars last night.`); }
    if (c.apprentice) { const ap = clan.get(c.apprentice); if (ap) lines.push(`${ap.given} is learning quickly. ${pronoun(ap, 'subj').replace(/^./, (s) => s.toUpperCase())} might make a fine warrior.`); }
    if (c.sick > 30) lines.push('*cough* This sickness has me weak as a newborn kit.');
    if (c.injury > 30) lines.push('My leg still aches from that fight.');
    if (c.stage === 'elder') lines.push(simRng.pick(['In my day, we hunted in the snow without complaint.', 'The Long Meadow calls to me some nights. Not yet, though.', `I remember when ${clan.leader ? displayName(clan.leader) : 'our Warden'} was a scrawny kit.`]));
    if (c.stage === 'kit') lines.push(simRng.pick(['When I grow up I\'m going to fight a badger!', 'Do you know any stories?', 'I found a feather! It\'s mine.']));
    const fav = Object.entries(c.relations).sort((x, y) => y[1].opinion - x[1].opinion)[0];
    if (fav) { const f = clan.get(fav[0]); if (f && f.alive && f !== pc) lines.push(`${displayName(f)} is my closest friend, you know.`); }
    const foe = Object.entries(c.relations).sort((x, y) => x[1].opinion - y[1].opinion)[0];
    if (foe && foe[1].opinion < -25) { const f = clan.get(foe[0]); if (f && f.alive && f !== pc) lines.push(`Don't talk to me about ${displayName(f)}.`); }
    if (clan.lastRecent) lines.push(`Have you heard? ${clan.lastRecent}`);
    lines.push(`It's a ${g.weatherLabel().toLowerCase()} kind of day.`);
    return simRng.pick(lines);
  }

  /** Waking a sleeping cat: grumpy serious cats may lash out. */
  wakeCat(a: NpcAgent) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    const grumpy = c.traits.includes('serious') || c.traits.includes('aggressive') || c.traits.includes('suspicious');
    const lashChance = c.traits.includes('aggressive') ? 0.65 : c.traits.includes('serious') ? 0.5 : grumpy ? 0.3 : 0;
    a.activity = 'idle';
    a.actTimer = 0;
    a.forcedPose = null;
    a.heading = Math.atan2(g.player.pos.z - a.pos.z, g.player.pos.x - a.pos.x);
    if (simRng.chance(lashChance)) {
      // a sleepy swipe: stings, but never serious
      a.mood = 'angry';
      a.model.pose = 'fight';
      g.audio.hiss();
      const dmg = pc.stage === 'kit' ? 6 : 9;
      pc.health = Math.max(1, pc.health - dmg);
      g.player.onHit(dmg, a);
      g.combat.puff(g.player.pos, 6, 0.12);
      clan.adjust(c, pc, -8, { text: `${pc.given} woke me from a good sleep.`, weight: -2 });
      a.say(simRng.pick(['HOW DARE YOU wake me?!', '*HISS* Get away from me!', 'Mouse-brained furball! I was SLEEPING!']), 3.5);
      g.ui.toast(`${a.name} lashes out with a sleepy swipe of claws!`, 'danger');
      setTimeout(() => { a.mood = 'neutral'; a.activity = 'sleep'; a.actTimer = 40; }, 3500);
    } else {
      a.mood = 'neutral';
      clan.adjust(c, pc, grumpy ? -3 : -1);
      a.say(simRng.pick(['What……?', 'Mmf… what? Is it dawn already?', '…huh? Whassat? Oh. It\'s you.', 'Wha—? Is there a badger?!', 'Five more heartbeats… zzz…']), 3.5);
      g.ui.toast(`${a.name} blinks at you sleepily.`, 'info');
      setTimeout(() => { if (a.activity === 'idle' && g.time.isNight) { a.activity = 'sleep'; a.actTimer = 40; } }, 8000);
    }
  }

  /** The leader deals with a kit who snuck out of camp. */
  punishKit(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    clan.kitPunishPending = false;
    if (pc.stage !== 'kit') { done(); return; }
    pc.kitOffenses = (pc.kitOffenses ?? 0) + 1;
    const repeat = pc.kitOffenses > 1;
    const name = displayName(pc);
    const leaderName = displayName(a.cat);
    const text = repeat
      ? `${name}. Again? You were told to stay in camp. The forest is full of foxes, hawks and Twolegs — you could have been killed! This time your apprentice ceremony will wait an extra moon. And you will pick the ticks off the elders.`
      : `${name}, I hear you were found outside the camp. The forest is no place for a kit. As punishment you will pick ticks off the elders, and you will stay in camp until tomorrow.`;
    const punish = (sassy: boolean) => {
      pc.confinedUntil = g.time.day + 1;
      if (repeat || sassy) pc.ceremonyDelay = (pc.ceremonyDelay ?? 0) + 1;
      g.objectives.add({ id: 'punish-ticks', kind: 'visit', title: 'Punishment: pick ticks off the elders', desc: `${leaderName} ordered you to clean the elders' ticks with mouse bile. Go to the elders' den.`, target: { x: g.camp.dens.elders.x, z: g.camp.dens.elders.z }, radius: 3, need: 1, giver: a.id, order: true, deadline: g.time.totalHours + 16, reward: { rep: 2 } });
      clan.log(`${leaderName} punished ${name} for leaving camp${repeat || sassy ? ' — the apprentice ceremony will be delayed a moon' : ''}.`, 'rule');
      clan.remember(pc, `${leaderName} punished me for sneaking out of camp.`, -3, a.id);
      if (repeat || sassy) g.ui.toast('Your apprentice ceremony has been delayed by one moon.', 'danger');
      g.ui.toast('You are confined to camp until tomorrow.', 'danger');
      done();
    };
    g.ui.dialog({ speaker: a.cat, text, options: [
      { label: `"I'm sorry, ${leaderName}."`, action: () => { clan.adjust(a.cat, pc, 1); punish(false); } },
      { label: '"It\'s not fair! I just wanted to explore!"', hint: 'talking back makes it worse', action: () => { clan.adjust(a.cat, pc, -5); a.say('Then you can wait an extra moon to be an apprentice, too.', 4); punish(true); } },
    ], onClose: () => punish(false) });
  }

  /** A clanmate who isn't your friend finds you outside camp as a kit. */
  scoldKit(a: NpcAgent, done: () => void, text?: string) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    if (!g.player.kitOutFlag) {
      g.player.kitOutFlag = true;
      clan.infraction('kitLeaveCamp', [a.id]);
      clan.kitPunishPending = true; // word reaches the leader
    }
    g.ui.dialog({ speaker: a.cat, text: text ?? simRng.pick([`What are you doing out here, ${pc.given}kit? Go back to camp — now!`, 'Kits don\'t leave camp! A fox could snap you up in one bite. Back you go!', 'Does your mother know you\'re out here? Get back to the nursery!']), options: [
      { label: 'Okay… I\'m going', action: () => {
        done();
        g.objectives.add({ id: 'kit-home', kind: 'visit', title: 'Go back to camp', desc: `${a.name} caught you outside camp. Hurry back before you get in more trouble.`, target: { x: 0, z: 2 }, radius: 12, need: 1 });
      } },
      { label: '"I\'m not a baby! Just a little longer…"', action: () => {
        done();
        clan.adjust(a.cat, pc, -6, { text: `${pc.given}kit talked back to me outside camp.`, weight: -2 });
        a.say('Mouse-brain! I\'m telling the leader.', 3);
      } },
    ], onClose: done });
  }

  private proposeMate(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    const r = clan.rel(c, pc);
    const chance = clamp((r.romance - 20) / 60 + (r.opinion - 40) / 100, 0.02, 0.95);
    if (simRng.chance(chance)) {
      pc.mate = c.id;
      c.mate = pc.id;
      r.romance = 90;
      clan.rel(pc, c).romance = 90;
      clan.log(`${displayName(pc)} and ${displayName(c)} became mates.`, 'clan');
      clan.remember(pc, `${displayName(c)} became my mate.`, 10, c.id);
      clan.remember(c, `${displayName(pc)} and I became mates.`, 10, pc.id);
      clan.setRecent(`${pc.given} and ${c.given} are mates!`);
      g.audio.purr();
      g.ui.dialog({ speaker: c, text: 'Yes. Yes, of course! I\'ve hoped you would ask.', options: [{ label: '*purr*', action: done }], onClose: done });
    } else {
      clan.adjust(c, pc, -3);
      r.romance = Math.max(0, r.romance - 10);
      g.ui.dialog({ speaker: c, text: simRng.pick(['I... think of you as a friend. I\'m sorry.', 'I\'m not ready for that.', 'Maybe one day. Not now.']), options: [{ label: 'I understand', action: done }], onClose: done });
    }
  }

  private orderMenu(a: NpcAgent, done: () => void) {
    const g = this.game;
    const c = a.cat;
    g.ui.dialog({
      speaker: c, text: 'What do you need, Warden?',
      options: [
        { label: 'Go hunting', action: () => { done(); this.orderHunt(a); } },
        { label: 'Guard the camp entrance', action: () => { done(); a.activity = 'guard'; a.actTimer = 90; a.setTarget(0, 12); a.say('Yes, Warden.', 2); } },
        { label: 'Rest in your den', action: () => { done(); a.activity = 'sleep'; a.actTimer = 60; const d = g.camp.dens[g.npcs.denFor(c)]; a.setTarget(d.x, d.z); a.say('Thank you, Warden.', 2); g.clan.adjust(c, g.clan.player, c.traits.includes('lazy') ? 3 : 1); } },
        { label: 'Never mind', action: done },
      ],
      onClose: done,
    });
  }

  private orderHunt(a: NpcAgent) {
    const g = this.game;
    a.activity = 'idle';
    a.actTimer = 0;
    a.say(simRng.pick(['Right away.', 'I\'ll bring back something plump.', 'On my way.']), 2);
    const ang = simRng.range(0, Math.PI * 2);
    a.activity = 'hunt';
    a.userHuntPhase = 'going';
    a.actTimer = 90;
    a.moveSpeed = 2.4;
    a.setTarget(Math.cos(ang) * 80, Math.sin(ang) * 80);
    if (a.cat.traits.includes('lazy')) g.clan.adjust(a.cat, g.clan.player, -1);
  }

  private talkOutsider(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    const isRival = typeof c.clan === 'number';
    const clanName = isRival ? g.territories.rivals[c.clan as number].name : 'no clan';
    const truce = g.events.gatheringTruce(a.pos.x, a.pos.z);
    const op = clan.opinion(c, pc);
    let text: string;
    if (a.hostile && !truce) text = simRng.pick(['You have no business here.', 'Turn around. Now.', `This is ${clanName} land.`]);
    else if (truce) text = simRng.pick([`Greetings, ${g.territories.homeName} cat. The truce holds tonight.`, 'Good hunting to your clan this moon.', `I'm ${c.given} of ${clanName}. Have we met?`]);
    else if (c.clan === 'loner') text = simRng.pick(['A clan cat... what\'s it like, living with so many?', 'I\'m just passing through. Mostly.', 'Could you spare some food?']);
    else text = `Hm. A ${g.territories.homeName} cat.`;
    const opts: { label: string; action: () => void; hint?: string }[] = [];
    opts.push({ label: 'Chat', action: () => {
      clan.adjust(c, pc, truce ? 4 : 1, undefined, 5);
      clan.adjust(pc, c, 1);
      const r = isRival ? clan.rivals[c.clan as number] : null;
      const line = r ? (r.attitude < -30 ? 'Our Warden says your clan can\'t be trusted.' : r.attitude > 20 ? 'Our clans have been good neighbours lately.' : simRng.pick(['Prey is running well on our side.', 'Our healer found a new patch of herbs by the rocks.', 'The border feels tense these days.'])) : simRng.pick(['The Tallfolk dens have warm spots under the porches.', 'Dogs roam near the roads. Be careful.', 'I\'ve seen a cave up in the rocks — dry and quiet.']);
      g.ui.dialog({ speaker: c, text: line, options: [{ label: 'Farewell', action: done }], onClose: done });
      if (op > 40 && simRng.chance(0.3)) clan.remember(pc, `I befriended ${c.given} of ${clanName}.`, 3, c.id);
    } });
    if (g.player.prey.length) opts.push({ label: 'Share your catch', hint: 'breaks the code', action: () => {
      g.player.prey.shift();
      g.player.updateCarryVisual();
      clan.adjust(c, pc, 12, { text: `${pc.given} shared prey with me.`, weight: 4 });
      clan.infraction('helpOutsiders', g.npcs.witnesses(g.player.pos.x, g.player.pos.z, 25));
      g.ui.dialog({ speaker: c, text: 'You... you\'d do that? Thank you.', options: [{ label: 'Farewell', action: done }], onClose: done });
    } });
    if (!truce && isRival) opts.push({ label: 'Challenge them', hint: 'fight', action: () => { done(); a.hostile = true; a.userAggressive = true; g.combat.engage(a, g.player); } });
    if (c.clan === 'loner' && !pc.exiled && clan.leader && !clan.leader.isPlayer) opts.push({ label: 'Suggest they ask to join the clan', action: () => {
      clan.adjust(c, pc, 5);
      g.ui.dialog({ speaker: c, text: 'Maybe I will. Thank you for the kindness.', options: [{ label: 'Farewell', action: done }], onClose: done });
    } });
    opts.push({ label: 'Leave', action: done });
    g.ui.dialog({ speaker: c, text, sub: isRival ? `${clanTitle(clanName)}` : 'Loner', options: opts, onClose: done, input: (t) => this.freeTalk(a, t, done) });
  }

  /** A friend secretly feeds and hides the exiled player for the night. */
  private secretShelter(a: NpcAgent, done: () => void) {
    const g = this.game;
    const pc = g.clan.player;
    g.ui.dialog({ speaker: a.cat, text: simRng.pick([
      `Shh — follow me. There's a hollow under the old roots nobody uses. I'll bring you something to eat.`,
      `Of course. Nobody has to know. Rest here, I'll keep watch.`,
      `I'd never leave you out in the cold. Come, quickly, before anyone sees.`,
    ]), options: [{ label: 'Rest in secret', action: () => {
      done();
      pc.hunger = 100;
      pc.health = Math.min(pc.maxHealth, pc.health + 40);
      pc.injury = Math.max(0, pc.injury - 30);
      g.clan.adjust(pc, a.cat, 6, { text: `${a.cat.given} secretly sheltered me while I was exiled.`, weight: 6 });
      g.clan.adjust(a.cat, pc, 3);
      g.passTime(8);
      g.ui.toast(`${a.name} hid you, shared fresh-kill and kept watch while you slept. Nobody found out.`, 'good');
    } }, { label: 'I don\'t want to get you in trouble', action: done }], onClose: done });
  }

  private askReturn(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const friend = clan.opinion(a.cat, pc) >= 40;
    const ok = friend || g.decisions.requestReturn();
    if (ok) {
      pc.exiled = false;
      pc.clan = 'home';
      pc.reputation = -10;
      pc.infractions = 0;
      clan.log(`${displayName(pc)} was allowed to return to the clan.`, 'politics');
      clan.remember(pc, 'The clan took me back. I must earn their trust again.', 8);
      clan.adjust(pc, a.cat, 10, { text: `${a.cat.given} spoke for me and brought me home.`, weight: 8 });
      g.ui.dialog({ speaker: a.cat, text: friend
        ? `I went to the leader and I didn't stop asking until they agreed. You're coming home, ${pc.given}. I missed you so much.`
        : 'The Warden has agreed. Come home — but tread carefully.', options: [{ label: 'Thank you', action: done }], onClose: done });
      g.onPlayerRoleChange();
    } else {
      clan.adjust(a.cat, pc, -2);
      g.ui.dialog({ speaker: a.cat, text: 'Not yet. The clan hasn\'t forgotten. Prove yourself first.', options: [{ label: 'I will', action: done }], onClose: done });
    }
  }

  // ---------------------------------------------------------------- NPC initiated
  npcInitiated(a: NpcAgent, intent: ApproachIntent) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const done = () => { if (a.activity === 'talkPlayer') a.activity = 'idle'; };
    if (g.player.busy || g.ui.isBusy()) { done(); return; }
    switch (intent.kind) {
      case 'training':
        g.training.offerLesson(a);
        return;
      case 'apprentice': {
        const lessons = g.training.mentorOptions(a);
        g.ui.dialog({ speaker: a.cat, text: intent.text, options: [...lessons.map((l) => ({ ...l, action: () => { done(); l.action(); } })), { label: 'Not today', action: () => { clan.adjust(a.cat, pc, -3); done(); } }], onClose: done });
        return;
      }
      case 'punishKit':
        this.punishKit(a, done);
        return;
      case 'scoldKit':
        this.scoldKit(a, done, intent.text);
        return;
      case 'play':
        g.ui.dialog({ speaker: a.cat, text: intent.text, options: [
          { label: 'Play-fight!', action: () => { done(); this.playFight(a); } },
          { label: 'Not now', action: () => { clan.adjust(a.cat, pc, -1); done(); } },
        ], onClose: done });
        return;
      case 'order': {
        const task = this.makeOrder(a.cat);
        g.ui.dialog({ speaker: a.cat, text: `${intent.text} ${task.speech}`, options: [
          { label: 'At once', action: () => { g.objectives.add(task.obj); done(); } },
          { label: 'Refuse', hint: 'breaks the code', action: () => { clan.infraction('obeyOrders', [a.id]); clan.adjust(a.cat, pc, -8); done(); } },
        ], onClose: done });
        return;
      }
      case 'greet':
      default:
        a.say(intent.text, 3);
        clan.adjust(a.cat, pc, 1);
        done();
        return;
    }
  }

  makeOrder(giver: Cat) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const r = simRng.next();
    const now = g.time.totalHours;
    if (clan.food < clan.home().length * 0.9 && r < 0.5 || pc.stage === 'warrior' && r < 0.35) {
      const n = pc.stage === 'apprentice' ? 1 : 2;
      return { speech: `The pile is low. Bring back ${n} piece${n > 1 ? 's' : ''} of prey.`, obj: { id: 'order-hunt', kind: 'hunt' as const, title: `Hunt for the clan (${n})`, desc: `${displayName(giver)} ordered you to bring ${n} prey to the fresh-kill pile.`, need: n, giver: giver.id, order: true, deadline: now + 14, reward: { rep: 4 } } };
    }
    if (r < 0.7) {
      return { speech: 'The elders\' bedding is getting old. Fetch fresh moss for them — three clumps.', obj: { id: 'order-moss', kind: 'moss' as const, title: 'Fresh moss for the elders (3)', desc: 'Gather moss in the forest (look for soft green clumps) and bring it to the elders\' den.', need: 3, giver: giver.id, order: true, deadline: now + 14, reward: { rep: 3 } } };
    }
    if (pc.stage === 'warrior') {
      const stones = g.territories.landmarks.filter((l) => l.kind === 'borderStone');
      const s = simRng.shuffle(stones.slice()).slice(0, 2);
      return { speech: 'Renew the scent markers on the border. Two markers should do.', obj: { id: 'order-border', kind: 'markBorder' as const, title: 'Renew two border markers', desc: 'Walk up to two border markers to renew our scent.', need: 2, giver: giver.id, order: true, deadline: now + 14, targets: s.map((x) => ({ x: x.x, z: x.z })), target: { x: s[0].x, z: s[0].z }, reward: { rep: 4 } } };
    }
    return { speech: 'The healer needs herbs. Bring two of any kind to the medicine den.', obj: { id: 'order-herbs', kind: 'herbs' as const, title: 'Herbs for the healer (2)', desc: 'Find herbs in the territory and bring them to the medicine den.', need: 2, giver: giver.id, order: true, deadline: now + 14, reward: { rep: 3 } } };
  }

  private playFight(a: NpcAgent) {
    const g = this.game;
    a.say('Rawr! I\'m a fearsome badger!', 2);
    g.combat.engage(a, g.player, true);
    g.clan.adjust(a.cat, g.clan.player, 3);
    g.ui.toast('Play-fight! Swipe with left click or F. It ends when someone gets tired.', 'info');
  }

  private rescue(a: NpcAgent) {
    const g = this.game;
    a.activity = 'follow';
    a.followTarget = 'player';
    a.mood = 'afraid';
    a.say('Thank you! I\'ll follow you — don\'t let go!', 3);
    g.ui.toast(`Lead ${a.name} back to camp.`, 'objective');
  }

  private escort(a: NpcAgent) {
    const g = this.game;
    a.activity = 'follow';
    a.followTarget = 'player';
    a.say(a.cat.stage === 'kit' ? 'I\'m scared! I\'ll stay close!' : 'Lead the way, young one.', 3);
  }

  // ---------------------------------------------------------------- prey & items
  caughtPrey(kind: PreyKind) {
    const g = this.game;
    const pl = g.player;
    const info = PREY[kind];
    g.audio.catchPrey();
    const pc = g.clan.player;
    pc.skills.hunting = Math.min(99, pc.skills.hunting + 1.2);
    if (!pl.addPrey(kind)) {
      g.ui.toast(`You caught a ${info.name}, but your mouth is full. You gulp it down.`, 'info');
      this.eat(info.value, false);
    } else {
      g.ui.toast(`You caught a ${info.name}!${pc.stage !== 'kit' && !pc.exiled ? ' Bring it to the fresh-kill pile.' : ''}`, 'good');
    }
    g.objectives.onCatch(kind);
    if (simRng.chance(0.15)) g.clan.log(`Caught a ${info.name}.`, 'memory');
  }

  eatCarried() {
    const g = this.game;
    const pl = g.player;
    if (!pl.prey.length) { g.ui.toast('You have nothing to eat.', 'info'); return; }
    // warn first if eating now would break the code; pressing again within a few seconds eats anyway
    const now = performance.now();
    if (this.wouldBreakFeedRule(true) && now - this.eatWarnAt > 4000) {
      this.eatWarnAt = now;
      g.ui.toast('⚠ The code says to feed the clan first — take your catch to the fresh-kill pile. (Press again to eat anyway.)', 'danger');
      return;
    }
    const pr = pl.prey.shift()!;
    pl.updateCarryVisual();
    this.eat(pr.value, true);
  }

  private eatWarnAt = -1e9;

  /** Would eating right now break the "feed the clan first" rule? */
  wouldBreakFeedRule(outside: boolean): boolean {
    const g = this.game;
    const pc = g.clan.player;
    if (pc.exiled || pc.stage === 'kit') return false;
    if (outside) {
      const clanHungry = g.clan.home().some((c) => (c.stage === 'kit' || c.stage === 'elder') && c.hunger < 45) && g.clan.food < g.clan.home().length * 0.5;
      return pc.hunger >= 15 && (clanHungry || pc.hunger > 50);
    }
    const needy = g.clan.home().some((c) => !c.isPlayer && (c.stage === 'kit' || c.stage === 'elder' || c.expectingUntil !== null) && c.hunger < 40);
    return needy && g.clan.food < 3 && pc.hunger > 25 && pc.stage !== 'elder';
  }

  private eat(value: number, outside: boolean) {
    const g = this.game;
    const pc = g.clan.player;
    const before = pc.hunger;
    pc.hunger = clamp(pc.hunger + 45 * value, 0, 100);
    g.audio.eat();
    g.ui.toast(before > 85 ? 'You eat, though you weren\'t really hungry.' : 'You eat. Your belly feels warm and full.', 'info');
    if (pc.exiled) return;
    const clanHungry = g.clan.home().some((c) => (c.stage === 'kit' || c.stage === 'elder') && c.hunger < 45) && g.clan.food < g.clan.home().length * 0.5;
    const starving = before < 15;
    if (outside && !starving && pc.stage !== 'kit' && (clanHungry || before > 50)) {
      g.clan.infraction('feedClanFirst', g.npcs.witnesses(g.player.pos.x, g.player.pos.z, 18), 'ate prey on the hunt');
    }
  }

  depositPrey() {
    const g = this.game;
    const pl = g.player;
    const pc = g.clan.player;
    let total = 0;
    for (const p of pl.prey) total += p.value;
    const n = pl.prey.length;
    g.clan.addFood(total);
    pl.prey = [];
    pl.updateCarryVisual();
    pc.reputation = clamp(pc.reputation + n * 3, -100, 100);
    g.ui.toast(`You add your catch to the pile. (+${total} food, +reputation)`, 'good');
    g.audio.drop();
    for (const w of g.npcs.witnesses(pl.pos.x, pl.pos.z, 15)) { const c = g.clan.get(w); if (c) g.clan.adjust(c, pc, 3); }
    g.objectives.onDeliverPrey(n);
    pc.deeds += n >= 1 ? 1 : 0;
  }

  eatFromPile() {
    const g = this.game;
    const pc = g.clan.player;
    const clan = g.clan;
    if (pc.hunger > 80) { g.ui.toast('You\'re not hungry.', 'info'); return; }
    const now = performance.now();
    if (this.wouldBreakFeedRule(false) && now - this.eatWarnAt > 4000) {
      this.eatWarnAt = now;
      g.ui.toast('⚠ Kits and elders are hungry and the pile is low — the code says they eat first. (Press again to eat anyway.)', 'danger');
      return;
    }
    const before = pc.hunger;
    clan.addFood(-1);
    pc.hunger = clamp(pc.hunger + 50, 0, 100);
    g.audio.eat();
    g.ui.toast('You eat from the fresh-kill pile.', 'info');
    const needy = clan.home().some((c) => !c.isPlayer && (c.stage === 'kit' || c.stage === 'elder' || c.expectingUntil !== null) && c.hunger < 40);
    if (needy && clan.food < 3 && before > 25 && pc.stage !== 'kit' && pc.stage !== 'elder') {
      clan.infraction('feedClanFirst', g.npcs.witnesses(g.player.pos.x, g.player.pos.z, 20), 'ate while kits and elders went hungry');
    }
  }

  collect(it: Interactable) {
    const g = this.game;
    const pl = g.player;
    if (it.type === 'moss') {
      if (pl.moss >= 3) { g.ui.toast('You can\'t carry any more moss.', 'info'); return; }
      pl.moss++;
      g.ui.toast(`You gather a clump of moss (${pl.moss}/3).`, 'good');
    } else {
      const k = it.kind as HerbKind;
      const total = pl.herbs.silverleaf + pl.herbs.sunpetal + pl.herbs.bitterroot;
      if (total >= 4) { g.ui.toast('Your jaws are full of herbs.', 'info'); return; }
      pl.herbs[k]++;
      g.ui.toast(`You pick ${HERB_INFO[k].name} — it ${HERB_INFO[k].use}.`, 'good');
      g.clan.player.skills.healing = Math.min(99, g.clan.player.skills.healing + 1);
    }
    g.chunks.takeInteractable(it);
    g.audio.pick();
    pl.updateCarryVisual();
  }

  eatDeathberries(it: Interactable) {
    const g = this.game;
    const pc = g.clan.player;
    g.chunks.takeInteractable(it);
    g.audio.eat();
    const kit = pc.stage === 'kit';
    g.player.poison = 1;
    pc.sick = clamp(pc.sick + 70, 0, 100);
    pc.health -= kit ? 45 : 30;
    g.ui.hurtFlash();
    g.ui.toast('The berries taste bitter... your belly cramps and the world spins. Deathberries! Get to the medicine cat — fast!', 'danger');
    g.clan.remember(pc, 'I ate deathberries. I will never forget that bitter taste.', -6);
    g.clan.log(`${displayName(pc)} ate deathberries.`, 'event');
    if (!pc.exiled) g.objectives.add({ id: 'poison', kind: 'visit', title: 'Get to the medicine den!', desc: 'Deathberry poison is spreading. The medicine cat can make you retch it up with yarrow.', target: { x: g.camp.dens.medicine.x, z: g.camp.dens.medicine.z }, radius: 2.5, need: 1 });
    if (pc.health <= 0) g.clan.kill(pc, 'deathberries');
  }

  /** The medicine cat happily agrees to teach the player. */
  askMedicineApprentice(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const med = a.cat;
    clan.adjust(med, pc, 10, { text: `${pc.given} asked to learn the ways of a medicine cat from me.`, weight: 5 });
    if (pc.stage === 'kit') {
      pc.medicinePath = true;
      clan.remember(pc, `${displayName(med)} promised to make me a medicine cat apprentice.`, 6, med.id);
      g.ui.dialog({ speaker: med, text: `*purrs* Yes! I'd be honoured, ${displayName(pc)}. When you reach six moons, you'll come to my den as my apprentice. Until then — watch, listen, and learn your herbs.`, options: [{ label: 'Thank you!', action: done }], onClose: done });
      return;
    }
    // an apprentice switches paths now
    const old = clan.get(pc.mentor);
    if (old && old.apprentice === pc.id) old.apprentice = null;
    if (old && old.id !== med.id) clan.adjust(old, pc, -2);
    g.objectives.fail('lesson', true);
    g.objectives.fail('assessment', true);
    pc.role = 'medicineApprentice';
    pc.mentor = med.id;
    med.apprentice = pc.id;
    g.training.lastLessonHour = -99;
    clan.log(`${displayName(pc)} became ${displayName(med)}'s medicine cat apprentice.`, 'ceremony');
    clan.remember(pc, `I asked ${displayName(med)} to teach me, and they said yes. I will be a medicine cat.`, 7, med.id);
    g.ui.dialog({ speaker: med, text: `Yes! StarClan must have sent you, ${displayName(pc)}. ${old && old.id !== med.id ? `I'll speak to ${displayName(old)} and the leader. ` : ''}From today you are my apprentice. Come — there are herbs to sort.`, options: [{ label: 'I\'m ready!', action: done }], onClose: done });
    g.ui.toast(`You are now a medicine cat apprentice. ${displayName(med)} will teach you.`, 'good');
    if (old && old.id !== med.id) g.ceremony(`${displayName(med)}: "${displayName(pc)} will walk the path of a medicine cat, as my apprentice."`, [pc.id, med.id]);
  }

  /** A player medicine cat (or apprentice) treats a clanmate. */
  treatCat(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    const pl = g.player;
    const herb = (['sunpetal', 'bitterroot', 'silverleaf'] as HerbKind[]).find((k) => pl.herbs[k] > 0);
    if (herb) { pl.herbs[herb]--; pl.updateCarryVisual(); }
    const skill = 0.6 + pc.skills.healing / 150 + (herb ? 0.4 : 0);
    c.injury = Math.max(0, c.injury - 30 * skill);
    c.sick = Math.max(0, c.sick - 25 * skill);
    c.health = Math.min(c.maxHealth, c.health + 20 * skill);
    pc.skills.healing = Math.min(99, pc.skills.healing + 2);
    pc.reputation = clamp(pc.reputation + 1.5, -100, 100);
    clan.adjust(c, pc, 6, { text: `${pc.given} treated me.`, weight: 2 });
    g.audio.pick();
    g.ui.dialog({ speaker: c, text: herb ? `You chew the ${herb} into a poultice and press it on. ${a.name} sighs with relief. "That feels much better. Thank you."` : `You press cobweb and moss where it hurts. "Thank you… that helps a little."`, options: [{ label: 'Rest now', action: done }], onClose: done });
    const o = g.objectives.get('lesson');
    if (o?.data?.medLesson === 'treat') g.objectives.complete('lesson');
  }

  seekHealing(medCat?: Cat) {
    const g = this.game;
    const pc = g.clan.player;
    const med = medCat ?? g.clan.medicine!;
    const poisoned = g.player.poison > 0;
    g.player.poison = 0;
    pc.sick = Math.max(0, pc.sick - (poisoned ? 70 : 40));
    pc.injury = Math.max(0, pc.injury - 30);
    pc.health = Math.min(pc.maxHealth, pc.health + 40);
    g.objectives.complete('poison');
    g.clan.adjust(pc, med, 5);
    g.ui.dialog({ speaker: med, text: poisoned
      ? 'Deathberries?! Mouse-brain! Here — chew this yarrow, quickly. ... There. Get it all out. You were lucky.'
      : simRng.pick(['Hold still. A poultice of marigold and cobweb will do.', 'Eat these herbs and rest. You\'ll be right in a day or two.', 'Let me see... yes, I can help with that.']),
      options: [{ label: 'Thank you', action: () => {} }] });
  }

  deliverHerbs() {
    const g = this.game;
    const pl = g.player;
    const clan = g.clan;
    const n = pl.herbs.silverleaf + pl.herbs.sunpetal + pl.herbs.bitterroot;
    const sick = clan.home().filter((c) => c.sick > 0 || c.injury > 0).sort((a, b) => b.sick + b.injury - a.sick - a.injury);
    let healed = 0;
    for (let i = 0; i < pl.herbs.sunpetal + pl.herbs.bitterroot; i++) { const c = sick.find((x) => x.sick > 0); if (c) { c.sick = Math.max(0, c.sick - 35); healed++; clan.adjust(c, clan.player, 5, { text: `${clan.player.given}'s herbs helped me recover.`, weight: 3 }); } }
    for (let i = 0; i < pl.herbs.silverleaf; i++) { const c = sick.find((x) => x.injury > 0); if (c) { c.injury = Math.max(0, c.injury - 35); healed++; } }
    const berryEv = g.events.get('deathberries');
    const kit = berryEv ? clan.get(berryEv.data.id) : undefined;
    if (kit && kit.alive && n > 0) {
      kit.sick = 0;
      clan.adjust(kit, clan.player, 30, { text: `${clan.player.given} brought the herbs that saved me from the deathberries.`, weight: 8 });
      clan.remember(clan.player, `I helped save ${displayName(kit)} from deathberry poison.`, 6, kit.id);
      clan.player.deeds++;
      g.ui.toast(`${displayName(kit)} retches up the berries. They will live!`, 'good');
    }
    pl.herbs = { silverleaf: 0, sunpetal: 0, bitterroot: 0 };
    pl.updateCarryVisual();
    const med = clan.medicine;
    if (med) clan.adjust(med, clan.player, 3 + n);
    clan.player.reputation = clamp(clan.player.reputation + n, -100, 100);
    g.ui.toast(`The healer takes your herbs.${healed ? ` ${healed} cat${healed > 1 ? 's' : ''} feel better.` : ' They\'ll be stored for later.'}`, 'good');
    g.objectives.onHerbs(n);
  }

  deliverMoss(den: string) {
    const g = this.game;
    const pl = g.player;
    const n = pl.moss;
    pl.moss = 0;
    pl.updateCarryVisual();
    const who = g.clan.home().filter((c) => (den === 'elders' ? c.stage === 'elder' : c.stage === 'kit' || c.expectingUntil !== null));
    for (const c of who) g.clan.adjust(c, g.clan.player, 3, undefined, 3);
    g.clan.player.reputation = clamp(g.clan.player.reputation + n * 0.8, -100, 100);
    g.ui.toast(`You spread fresh moss in the ${den === 'elders' ? 'elders\' den' : 'nursery'}.`, 'good');
    g.objectives.onMoss(n);
  }
}

export function relSummary(g: Game, c: Cat): string {
  const pc = g.clan.player;
  const r = c.relations[pc.id];
  return relLabel(r, isFamily(c, pc), c.mate === pc.id) + ' · ' + roleLabel(c);
}
