// Everything the player can *do* with the world: talk, groom, share prey,
// court a mate, deliver herbs and moss, sleep, escort cats, give orders.
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

export interface Prompt { text: string; action: () => void }

export class Interactions {
  current: Prompt | null = null;
  private lastSpoke = new Map<string, number>();
  constructor(private game: Game) {}

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
    // fresh-kill pile
    const pile = g.camp.pile;
    if (dist2(p.x, p.z, pile.x, pile.z) < 2 && !pc.exiled) {
      if (pl.prey.length) { this.current = { text: `Drop your catch on the fresh-kill pile`, action: () => this.depositPrey() }; return; }
      if (g.clan.food >= 1) { this.current = { text: `Eat from the fresh-kill pile (${Math.floor(g.clan.food)} left)`, action: () => this.eatFromPile() }; return; }
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
    const text = greetPlayer(c, pc, op, { night: g.time.isNight, food: clan.food, clanSize: clan.home().length, weather: g.weatherLabel(), recent: clan.lastRecent });
    const opts = this.talkOptions(a, done);
    g.ui.dialog({ speaker: c, text, options: opts, onClose: done });
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
    const young = (st: string) => st === 'kit' || st === 'apprentice';
    if (c.stage === 'kit' || (young(pc.stage) && young(c.stage))) {
      opts.push({ label: 'Play-fight', action: () => { done(); this.playFight(a); } });
    }
    opts.push({ label: 'Tease', hint: 'playful cats like it, others don\'t', action: () => {
      const likes = c.traits.includes('playful') || c.traits.includes('mischievous');
      clan.adjust(c, pc, likes ? 4 : -5);
      g.ui.dialog({ speaker: c, text: likes ? 'Ha! You\'ll pay for that one!' : simRng.pick(['Mouse-brain.', 'Is that supposed to be funny?', 'Grow up.']), options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
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

  private talkMenu(a: NpcAgent, done: () => void) {
    const g = this.game;
    g.ui.dialog({ speaker: a.cat, text: simRng.pick(['Mm?', 'Yes?', 'What else?', '...']), options: this.talkOptions(a, done), onClose: done });
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
    g.ui.dialog({ speaker: c, text, sub: isRival ? `${clanTitle(clanName)}` : 'Loner', options: opts, onClose: done });
  }

  private askReturn(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const ok = g.decisions.requestReturn();
    if (ok) {
      pc.exiled = false;
      pc.clan = 'home';
      pc.reputation = -10;
      pc.infractions = 0;
      clan.log(`${displayName(pc)} was allowed to return to the clan.`, 'politics');
      clan.remember(pc, 'The clan took me back. I must earn their trust again.', 8);
      g.ui.dialog({ speaker: a.cat, text: 'The Warden has agreed. Come home — but tread carefully.', options: [{ label: 'Thank you', action: done }], onClose: done });
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
      this.eat(info.value, true);
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
    const pr = pl.prey.shift()!;
    pl.updateCarryVisual();
    this.eat(pr.value, true);
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
    pc.reputation = clamp(pc.reputation + n * 1.5, -100, 100);
    g.ui.toast(`You add your catch to the pile. (+${total} food)`, 'good');
    g.audio.drop();
    for (const w of g.npcs.witnesses(pl.pos.x, pl.pos.z, 15)) { const c = g.clan.get(w); if (c) g.clan.adjust(c, pc, 1.5); }
    g.objectives.onDeliverPrey(n);
    pc.deeds += n >= 2 ? 1 : 0;
  }

  eatFromPile() {
    const g = this.game;
    const pc = g.clan.player;
    const clan = g.clan;
    if (pc.hunger > 80) { g.ui.toast('You\'re not hungry.', 'info'); return; }
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
