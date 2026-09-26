// Leadership decisions. When the player is Warden (or Second, for patrols)
// these appear as choices; otherwise the NPC leader decides according to
// personality. Clan cats react to every decision.
import type { Game } from '../game';
import type { PendingDecision, DecisionOption } from './clan';
import { Cat, Trait, displayName } from '../cats/types';
import { simRng } from '../core/rng';
import { clamp } from '../core/math';

type Tag = 'brave' | 'cautious' | 'kind' | 'strict' | 'lenient' | 'selfish' | 'bold';

const TAG_LIKES: Record<Tag, [Trait[], Trait[]]> = {
  brave: [['brave', 'aggressive', 'ambitious'], ['shy', 'calm', 'kind']],
  bold: [['brave', 'curious', 'ambitious'], ['serious', 'shy']],
  cautious: [['calm', 'serious', 'shy', 'kind'], ['aggressive', 'brave']],
  kind: [['kind', 'friendly', 'loyal'], ['suspicious', 'aggressive']],
  strict: [['loyal', 'serious'], ['mischievous', 'playful', 'lazy']],
  lenient: [['kind', 'mischievous', 'playful'], ['serious', 'loyal']],
  selfish: [['lazy'], ['kind', 'loyal']],
};

export class DecisionSystem {
  handlers = new Map<string, (opt: string) => void>();
  queue: string[] = [];
  constructor(private game: Game) {}

  private get playerLeads() { const l = this.game.clan.leader; return !!l && l.isPlayer; }

  /** Clan reacts to a leadership choice. */
  react(tags: Tag[], magnitude = 4) {
    const clan = this.game.clan;
    const leader = clan.leader;
    if (!leader) return;
    for (const c of clan.home()) {
      if (c === leader) continue;
      let d = 0;
      for (const t of tags) {
        const [likes, dislikes] = TAG_LIKES[t];
        if (c.traits.some((x) => likes.includes(x))) d += magnitude;
        if (c.traits.some((x) => dislikes.includes(x))) d -= magnitude;
      }
      if (d) clan.adjust(c, leader, d);
    }
  }

  private leaderPick(options: { id: string; weight: (l: Cat) => number }[]): string {
    const l = this.game.clan.leader;
    if (!l) return options[0].id;
    return simRng.weighted(options.map((o) => [o.id, Math.max(0.05, o.weight(l))] as [string, number]));
  }

  push(d: Omit<PendingDecision, 'expiresDay'> & { expiresDay?: number }, handler: (opt: string) => void) {
    const pd: PendingDecision = { expiresDay: this.game.time.day + 1, ...d };
    this.game.clan.pending.push(pd);
    this.handlers.set(pd.id, handler);
    this.game.ui.toast(`Decision needed: ${pd.title}`, 'objective');
    this.game.audio.chime();
    this.showNext(pd.id);
  }

  showNext(id?: string) {
    const clan = this.game.clan;
    const pd = id ? clan.pending.find((p) => p.id === id) : clan.pending[0];
    if (!pd) return;
    if (this.game.ui.isBusy()) { if (!this.queue.includes(pd.id)) this.queue.push(pd.id); return; }
    this.game.ui.choice(pd.title, pd.text, pd.options.map((o) => ({ label: o.label, hint: o.hint, action: () => this.resolve(pd.id, o.id) })), () => { /* deferred */ });
  }

  flushQueue() {
    while (this.queue.length && !this.game.ui.isBusy()) {
      const id = this.queue.shift()!;
      if (this.game.clan.pending.some((p) => p.id === id)) { this.showNext(id); return; }
    }
  }

  resolve(id: string, opt: string) {
    const clan = this.game.clan;
    const h = this.handlers.get(id);
    clan.pending = clan.pending.filter((p) => p.id !== id);
    this.handlers.delete(id);
    h?.(opt);
  }

  autoResolve(p: PendingDecision) {
    const h = this.handlers.get(p.id);
    this.handlers.delete(p.id);
    if (h) h(p.options[0].id);
    else if (p.kind === 'patrols') this.game.clan.autoPatrols(Math.floor(this.game.time.hour));
    this.game.clan.log(`With no word from you, "${p.title}" was settled by default.`, 'politics');
  }

  // ------------------------------------------------------------ decisions
  chooseMentor(kit: Cat) {
    const clan = this.game.clan;
    const cands = clan.home().filter((w) => w.stage === 'warrior' && !w.apprentice && w.role !== 'medicine' && !kit.parents.includes(w.id) && !w.isPlayer)
      .sort((a, b) => (b.skills.hunting + b.skills.fighting + b.reputation) - (a.skills.hunting + a.skills.fighting + a.reputation)).slice(0, 3);
    const opts: DecisionOption[] = cands.map((c) => ({ id: c.id, label: displayName(c), hint: `hunting ${Math.round(c.skills.hunting)}, fighting ${Math.round(c.skills.fighting)}, ${c.traits.join(' & ')}` }));
    const leader = clan.leader!;
    if (!leader.apprentice) opts.push({ id: leader.id, label: 'Mentor them yourself', hint: 'a great honour for the kit' });
    if (!opts.length) { clan.apprenticeCeremony(kit, undefined); return; }
    this.push({ id: `mentor-${kit.id}`, kind: 'mentor', title: `${kit.given} is ready to be an apprentice`, text: `${kit.given} (${kit.traits.join(', ')}) has reached six moons. Who will be their mentor?`, options: opts }, (opt) => {
      const m = clan.get(opt);
      clan.apprenticeCeremony(kit, m);
      if (m) { clan.adjust(m, leader, 6); if (m.isPlayer) this.game.ui.toast(`You are now ${kit.given}'s mentor.`, 'good'); }
    });
  }

  chooseDeputy() {
    const clan = this.game.clan;
    const cands = clan.home().filter((c) => c.stage === 'warrior' && c.role === 'none' && !c.isPlayer).sort((a, b) => clan.leadershipScore(b) - clan.leadershipScore(a)).slice(0, 4);
    if (!cands.length) return;
    this.push({ id: `deputy-${this.game.time.day}`, kind: 'deputy', title: 'Name a Second', text: 'The clan needs a Second (deputy) to organise patrols and lead if you fall. Choose wisely — the ambitious remember being passed over.',
      options: cands.map((c) => ({ id: c.id, label: displayName(c), hint: `rep ${Math.round(c.reputation)}, mentored ${c.mentored}, ${c.traits.join(' & ')}` })) }, (opt) => {
      const c = clan.get(opt);
      if (c) clan.appointDeputy(c, true);
    });
  }

  organizePatrols() {
    const game = this.game;
    const clan = game.clan;
    const hour = Math.floor(game.time.hour);
    const who = clan.deputy?.isPlayer ? 'Second' : 'Warden';
    this.push({ id: `patrols-${game.time.day}-${hour}`, kind: 'patrols', title: `Organise the ${hour < 12 ? 'dawn' : 'afternoon'} patrols`, text: `As ${who}, you choose how the warriors spend this part of the day. The fresh-kill pile holds ${Math.floor(clan.food)} pieces for ${clan.home().length} cats; border scent is ${clan.borderSafety > 60 ? 'strong' : clan.borderSafety > 30 ? 'fading' : 'stale'}.`,
      options: [
        { id: 'balanced', label: 'Two hunting patrols and a border patrol', hint: 'steady' },
        { id: 'hunt', label: 'Everyone hunts', hint: 'more food, weaker borders' },
        { id: 'border', label: 'Strengthen the borders', hint: 'safer borders, less food' },
        { id: 'rest', label: 'Let the clan rest', hint: 'popular with some — the pile will shrink' },
        { id: 'self', label: 'I will lead a hunting patrol myself', hint: 'you join a patrol' },
      ], expiresDay: game.time.day }, (opt) => {
      const pool = simRng.shuffle(clan.home(false).filter((c) => (c.stage === 'warrior' || c.stage === 'apprentice') && c.role !== 'medicine' && c.role !== 'medicineApprentice' && c.injury < 40 && c.sick < 40 && !c.expectingUntil));
      const take = (n: number) => pool.splice(0, n).map((c) => c.id);
      let plans: { kind: 'hunt' | 'border'; members: string[] }[] = [];
      switch (opt) {
        case 'balanced': plans = [{ kind: 'hunt', members: take(2) }, { kind: 'hunt', members: take(2) }, { kind: 'border', members: take(3) }]; this.react(['cautious'], 1); break;
        case 'hunt': plans = [{ kind: 'hunt', members: take(3) }, { kind: 'hunt', members: take(3) }, { kind: 'hunt', members: take(2) }]; clan.borderSafety -= 10; this.react(['bold'], 2); break;
        case 'border': plans = [{ kind: 'border', members: take(3) }, { kind: 'border', members: take(3) }, { kind: 'hunt', members: take(2) }]; this.react(['strict'], 2); break;
        case 'rest': plans = []; this.react(['lenient'], 3); for (const c of clan.home()) if (c.traits.includes('lazy')) clan.adjust(c, clan.leader!, 3); break;
        case 'self': plans = [{ kind: 'hunt', members: [...take(2), clan.playerId] }, { kind: 'border', members: take(3) }]; this.react(['brave'], 2); break;
      }
      clan.autoPatrols(hour, plans);
    });
  }

  fireResponse(x: number, z: number) {
    const game = this.game;
    const clan = game.clan;
    const d = Math.hypot(x, z);
    // safe point: away from fire, toward the home river side
    const ax = -x / d, az = -z / d;
    const safe = { x: ax * 55, z: az * 55 };
    const apply = (opt: string) => {
      if (opt === 'evacuate') {
        game.npcs.evacuate = safe;
        clan.log(`${clan.leader ? displayName(clan.leader) : 'The Warden'} ordered the clan to flee the fire.`, 'politics');
        this.react(['cautious', 'kind'], 3);
        const p = clan.player;
        if (p && !p.exiled && p.stage !== 'kit') {
          game.objectives.add({ id: 'escort', kind: 'escort', title: 'Lead kits and elders to safety', desc: 'Find kits and elders in camp, tell them to follow you (E), and lead them to the safe meeting place.', target: safe, need: 2, reward: { rep: 10 } });
        } else if (p?.stage === 'kit') {
          game.objectives.add({ id: 'flee', kind: 'visit', title: 'Flee the fire!', desc: 'Follow your clanmates to the safe place.', target: safe, need: 1, radius: 10 });
        }
      } else {
        clan.log(`${clan.leader ? displayName(clan.leader) : 'The Warden'} decided the clan would hold the camp against the fire.`, 'politics');
        this.react(['brave'], 3);
        // if the fire gets too close, the clan flees anyway
        const check = setInterval(() => {
          if (!game.fire.active) { clearInterval(check); return; }
          if (game.fire.distanceTo(0, 0) < 25 && !game.npcs.evacuate) {
            game.npcs.evacuate = safe;
            game.ui.toast('The flames reach the camp! Everyone flees!', 'danger');
            this.react(['cautious'], 5);
            if (clan.leader) for (const c of clan.home()) if (c !== clan.leader) clan.adjust(c, clan.leader, -4);
            clearInterval(check);
          }
        }, 3000);
      }
    };
    if (this.playerLeads) {
      this.push({ id: `fire-${game.time.day}`, kind: 'fire', title: 'Fire near the camp!', text: 'Smoke is pouring through the trees. Do we abandon camp until the fire passes, or stay and hope the hollow protects us?',
        options: [{ id: 'evacuate', label: 'Evacuate — everyone to safety', hint: 'the cautious approve' }, { id: 'hold', label: 'Hold the camp', hint: 'risky' }] }, apply);
    } else {
      apply(this.leaderPick([{ id: 'evacuate', weight: (l) => 1 + l.pers.kindness }, { id: 'hold', weight: (l) => l.pers.bravery * 0.6 }]));
    }
  }

  floodResponse() {
    const game = this.game;
    const clan = game.clan;
    const apply = (opt: string) => {
      if (opt === 'search') {
        clan.log('Warriors were sent to search the floodwaters for trapped cats.', 'politics');
        this.react(['kind', 'brave'], 3);
        game.events.searchParties = true;
      } else {
        clan.log('The Warden kept every cat inside the camp until the flood passed.', 'politics');
        this.react(['cautious'], 3);
        game.events.searchParties = false;
      }
    };
    if (this.playerLeads) {
      this.push({ id: `flood-${game.time.day}`, kind: 'flood', title: 'The river floods', text: 'The floodwater is rising fast. Some cats may be caught out on the banks.',
        options: [{ id: 'search', label: 'Send warriors to search the banks', hint: 'rescues are likelier; risky' }, { id: 'stay', label: 'Everyone stays in camp', hint: 'safe, but anyone trapped is on their own' }] }, apply);
    } else apply(this.leaderPick([{ id: 'search', weight: (l) => l.pers.kindness + l.pers.bravery }, { id: 'stay', weight: (l) => 1 - l.pers.bravery }]));
  }

  clearFlood() { this.game.events.searchParties = false; }

  droughtResponse() {
    const game = this.game;
    const clan = game.clan;
    const apply = (opt: string) => {
      if (opt === 'ration') {
        clan.log('The Warden ordered strict rationing: kits and elders first.', 'politics');
        game.events.rationing = true;
        this.react(['strict', 'kind'], 2);
      } else {
        clan.log('The Warden allowed hunting beyond the borders during the drought.', 'politics');
        game.events.rationing = false;
        clan.addFood(3);
        for (const r of clan.rivals) r.attitude = clamp(r.attitude - 12, -100, 100);
        this.react(['bold'], 3);
      }
    };
    if (this.playerLeads) {
      this.push({ id: `drought-${game.time.day}`, kind: 'drought', title: 'Drought', text: 'The streams are shrinking and prey is scarce. How do we survive?',
        options: [{ id: 'ration', label: 'Ration food strictly', hint: 'fair, but everyone goes hungry' }, { id: 'far', label: 'Hunt beyond our borders', hint: 'more food; angers the other clans' }] }, apply);
    } else apply(this.leaderPick([{ id: 'ration', weight: (l) => l.pers.loyalty + l.pers.kindness }, { id: 'far', weight: (l) => l.pers.ambition + l.pers.aggression }]));
  }

  illnessResponse() {
    const game = this.game;
    const clan = game.clan;
    const apply = (opt: string) => {
      if (opt === 'quarantine') {
        clan.log('The sick were kept apart in the medicine den.', 'politics');
        for (const c of clan.home()) if (c.sick > 20) c.sick = Math.max(0, c.sick - 5);
        this.react(['cautious'], 2);
      } else {
        clan.log('Warriors were sent to gather herbs for the sick.', 'politics');
        for (const c of clan.home()) if (c.sick > 0) c.sick = Math.max(0, c.sick - 15);
        clan.addFood(-2);
        this.react(['kind'], 3);
      }
    };
    if (this.playerLeads) {
      this.push({ id: `ill-${game.time.day}`, kind: 'illness', title: 'Sickness in camp', text: 'A cough is spreading through the dens.',
        options: [{ id: 'quarantine', label: 'Isolate the sick', hint: 'slows the spread' }, { id: 'herbs', label: 'Send warriors for herbs', hint: 'heals faster; less hunting' }] }, apply);
    } else apply(this.leaderPick([{ id: 'quarantine', weight: (l) => 1 - l.pers.kindness }, { id: 'herbs', weight: (l) => l.pers.kindness + 0.3 }]));
  }

  rivalResponse(index: number) {
    const game = this.game;
    const clan = game.clan;
    const r = clan.rivals[index];
    const name = game.territories.rivals[index].name;
    const apply = (opt: string) => {
      if (opt === 'attack') {
        const strength = clan.home().filter((c) => c.stage === 'warrior').length * 5;
        const win = simRng.chance(clamp(strength / (strength + r.strength), 0.2, 0.85));
        r.attitude = clamp(r.attitude - 25, -100, 100);
        const hurt = simRng.pick(clan.home().filter((c) => c.stage === 'warrior' && !c.isPlayer));
        if (hurt) { hurt.injury = clamp(hurt.injury + 40, 0, 100); if (simRng.chance(0.1)) clan.kill(hurt, 'battle wounds'); }
        if (win) { r.strength -= 10; clan.addFood(2); clan.borderSafety = 100; }
        clan.log(win ? `Our warriors raided ${name} and won. They will think twice.` : `Our raid on ${name} failed. We limped home.`, 'politics');
        this.react(['brave'], 4);
      } else if (opt === 'talk') {
        r.attitude = clamp(r.attitude + 15, -100, 100);
        clan.log(`The Warden spoke with ${name} at the border, and tempers cooled.`, 'politics');
        this.react(['kind', 'cautious'], 3);
      } else {
        clan.borderSafety = clamp(clan.borderSafety + 30, 0, 100);
        clan.log(`The Warden ordered extra border patrols against ${name}.`, 'politics');
        this.react(['strict'], 2);
      }
    };
    if (this.playerLeads) {
      this.push({ id: `rival-${index}-${game.time.day}`, kind: 'rival', title: `${name} crossed our border`, text: `${name} warriors were caught on our land. How do we answer?`,
        options: [{ id: 'patrols', label: 'Double the border patrols', hint: 'measured' }, { id: 'talk', label: 'Seek peace at the border', hint: 'improves relations' }, { id: 'attack', label: 'Raid their territory', hint: 'dangerous; the bold approve' }] }, apply);
    } else apply(this.leaderPick([{ id: 'patrols', weight: (l) => l.pers.loyalty }, { id: 'talk', weight: (l) => l.pers.kindness }, { id: 'attack', weight: (l) => l.pers.aggression * 0.8 }]));
  }

  lonerArrives(loner: Cat) {
    const game = this.game;
    const clan = game.clan;
    const apply = (opt: string) => {
      const a = game.npcs.agents.get(loner.id);
      if (opt === 'accept') {
        game.npcs.removeAgent(loner.id);
        clan.addLoner(loner, true);
        if (loner.stage === 'warrior') loner.epithet = loner.epithet ?? null;
        this.react(['kind'], 3);
        game.ui.toast(`${loner.given} joined the clan.`, 'good');
        const e = game.events.get('loner');
        if (e) e.end = game.time.totalHours;
      } else {
        clan.log(`${loner.given} was turned away from the camp.`, 'politics');
        this.react(['strict'], 2);
        if (a) { a.activity = 'leaving'; a.say('Fine. I\'ll find my own way.', 3); a.setTarget(a.pos.x, a.pos.z + 150); a.actTimer = 40; }
      }
    };
    if (this.playerLeads) {
      this.push({ id: `loner-${loner.id}`, kind: 'loner', title: `A loner asks to join`, text: `${loner.given}, a ${loner.traits.join(' and ')} ${loner.sex === 'tom' ? 'tom' : 'she-cat'} of about ${Math.round(loner.age)} moons, waits at the entrance asking for shelter.`,
        options: [{ id: 'accept', label: 'Welcome them', hint: 'the kind approve' }, { id: 'refuse', label: 'Send them away', hint: 'the suspicious approve' }] }, apply);
    } else {
      const big = clan.home().length > 26;
      setTimeout(() => apply(this.leaderPick([{ id: 'accept', weight: (l) => (big ? 0.1 : 1) * (l.pers.kindness + 0.2) }, { id: 'refuse', weight: (l) => (l.traits.includes('suspicious') ? 1 : 0.4) }])), 40000);
    }
  }

  punishNpc(cat: Cat, crime: string) {
    const game = this.game;
    const clan = game.clan;
    const apply = (opt: string) => {
      const leader = clan.leader;
      switch (opt) {
        case 'warn':
          clan.log(`${displayName(cat)} was given a warning.`, 'politics');
          this.react(['lenient'], 2);
          break;
        case 'duties':
          clan.log(`${displayName(cat)} was given extra duties for ${crime}.`, 'politics');
          if (leader) clan.adjust(cat, leader, -5);
          this.react(['strict'], 1);
          break;
        case 'confine':
          cat.confinedUntil = game.time.day + 3;
          clan.log(`${displayName(cat)} was confined to camp for three moons.`, 'politics');
          if (leader) clan.adjust(cat, leader, -12, { text: `I was confined to camp by ${displayName(leader)}.`, weight: -3 });
          this.react(['strict'], 3);
          break;
        case 'exile':
          this.exile(cat);
          break;
      }
    };
    if (this.playerLeads) {
      this.push({ id: `punish-${cat.id}-${game.time.day}`, kind: 'punish', title: `${displayName(cat)} broke the code`, text: `${displayName(cat)} ${crime}. What is your judgement?`,
        options: [{ id: 'warn', label: 'A stern warning', hint: 'lenient' }, { id: 'duties', label: 'Extra duties', hint: 'fair' }, { id: 'confine', label: 'Confine them to camp', hint: 'strict' }, { id: 'exile', label: 'Exile them from the clan', hint: 'harsh — friends will not forget' }] }, apply);
    } else apply(this.leaderPick([{ id: 'warn', weight: (l) => l.pers.kindness }, { id: 'duties', weight: () => 1 }, { id: 'confine', weight: (l) => l.pers.loyalty * 0.6 }]));
  }

  exile(cat: Cat) {
    const game = this.game;
    const clan = game.clan;
    const leader = clan.leader;
    clan.log(`${displayName(cat)} was exiled from the clan.`, 'politics');
    for (const o of clan.home()) {
      if (o === cat) continue;
      const op = clan.opinion(o, cat);
      if (leader && o !== leader) clan.adjust(o, leader, op > 30 ? -15 : op < -20 ? 5 : -2, op > 30 ? { text: `${displayName(leader)} exiled my friend ${displayName(cat)}.`, weight: -4 } : undefined);
    }
    if (cat.isPlayer) return;
    cat.exiled = true;
    cat.clan = 'loner';
    if (cat.role === 'deputy') { clan.deputyId = null; cat.role = 'none'; }
    if (cat.mentor) { const m = clan.get(cat.mentor); if (m) m.apprentice = null; }
    if (cat.apprentice) { const ap = clan.get(cat.apprentice); if (ap) { ap.mentor = null; const nm = clan.pickMentor(ap); if (nm) { ap.mentor = nm.id; nm.apprentice = ap.id; } } cat.apprentice = null; }
    game.npcs.onCatLeft(cat);
  }

  fosterKit(kit: Cat) {
    const game = this.game;
    const clan = game.clan;
    const p = clan.player;
    const canFoster = p && p.stage === 'warrior' && !p.exiled;
    if (!canFoster) return;
    this.push({ id: `foster-${kit.id}`, kind: 'foster', title: 'A kit with no mother', text: `${kit.given} has no one to care for them. Will you raise them as your own${p.mate ? ` with ${displayName(clan.get(p.mate)!)}` : ''}?`,
      options: [{ id: 'no', label: 'Let the nursery queens care for them' }, { id: 'yes', label: 'Raise them yourself' }] }, (opt) => {
      if (opt === 'yes') {
        kit.parents = p.mate ? [p.id, p.mate] : [p.id];
        p.kits.push(kit.id);
        const m = clan.get(p.mate);
        if (m) m.kits.push(kit.id);
        clan.rel(kit, p).opinion = 70;
        clan.remember(p, `I took in ${kit.given}, a lost kit, as my own.`, 8, kit.id);
        this.react(['kind'], 2);
      }
    });
  }

  requestReturn(): boolean {
    const game = this.game;
    const clan = game.clan;
    const p = clan.player;
    const leader = clan.leader;
    if (!leader) return false;
    const op = clan.opinion(leader, p);
    const chance = clamp(0.25 + op / 150 + p.deeds * 0.05 + (game.time.day - (p.confinedUntil ?? 0)) * 0.02, 0.05, 0.9);
    return simRng.chance(chance);
  }
}
