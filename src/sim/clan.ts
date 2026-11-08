// Clan simulation: population, aging, ceremonies, births, deaths, food,
// politics (leader/deputy), reputation and the clan code.
import type { Game } from '../game';
import { clanTitle } from '../lore';
import { Cat, LESSONS, Lesson, Relation, displayName, isQueen, pronoun } from '../cats/types';
import { EYE_COLORS, GIVEN_NAMES, PATTERN_LABEL, createCat, randomAppearance, epithetOptions, makeEpithet, personalityFrom, stageForAge } from '../cats/generate';
import { BOOK_CATS, BookCat, CLASSIC_PREFIXES, isClassic } from '../lore';
import { RNG, simRng } from '../core/rng';
import { clamp } from '../core/math';
import { compatibility, isFamily } from './social';

export type JournalKind = 'event' | 'clan' | 'memory' | 'discovery' | 'ceremony' | 'death' | 'birth' | 'rule' | 'politics';
export interface JournalEntry { day: number; hour: number; text: string; kind: JournalKind }

export interface RivalState { index: number; strength: number; attitude: number }

export interface Patrol {
  id: string;
  kind: 'hunt' | 'border';
  members: string[];
  leaderId: string;
  startHour: number;
  day: number;
  state: 'forming' | 'out' | 'done';
}

export interface DecisionOption { id: string; label: string; hint?: string }
export interface PendingDecision {
  id: string;
  kind: string;
  title: string;
  text: string;
  options: DecisionOption[];
  data?: any;
  expiresDay: number;
}

export type RuleId = 'kitLeaveCamp' | 'crossBorder' | 'feedClanFirst' | 'obeyOrders' | 'helpOutsiders' | 'dangerZones' | 'confinement' | 'medicineMate';
export function isMedCat(c: Cat) { return c.role === 'medicine' || c.role === 'medicineApprentice'; }

export const RULES: Record<RuleId, { text: string; severity: number }> = {
  kitLeaveCamp: { text: 'Kits must not leave the camp.', severity: 4 },
  medicineMate: { text: 'Medicine cats must not take mates or have kits.', severity: 8 },
  crossBorder: { text: "Do not hunt or trespass on another clan's land.", severity: 7 },
  feedClanFirst: { text: 'Feed the kits, elders and queens before yourself.', severity: 5 },
  obeyOrders: { text: 'Obey the Warden, the Second and your mentor.', severity: 6 },
  helpOutsiders: { text: 'Do not aid cats of other clans without the Warden\'s leave.', severity: 5 },
  dangerZones: { text: 'Stay clear of Tallfolk dens and roads.', severity: 3 },
  confinement: { text: 'A cat confined to camp must stay there.', severity: 8 },
};

export const RIVAL_CAT_COUNT = 10;

/** Clover Ashshade: dark slate-blue tabby with black stripes, a white chest and green eyes. */
export const CLOVER_APP = { pattern: 'mackerel' as const, base: '#535c73', second: '#15171c', white: 0.16, eye: '#78c24c', eye2: '#5aa2e6', tailTip: '#f4f1ea', fur: 'medium' as const, body: 'average' as const };

export class ClanSim {
  cats: Record<string, Cat> = {};
  leaderId: string | null = null;
  deputyId: string | null = null;
  medicineId: string | null = null;
  food = 10;
  journal: JournalEntry[] = [];
  rivals: RivalState[] = [];
  playerId = '';
  generation = 1;
  lineage: string[] = [];
  /** Herbs stored in the medicine den. */
  herbStore = { silverleaf: 2, sunpetal: 2, bitterroot: 1 };
  herbTotal() { return this.herbStore.silverleaf + this.herbStore.sunpetal + this.herbStore.bitterroot; }
  patrols: Patrol[] = [];
  pending: PendingDecision[] = [];
  unpopularDays = 0;
  recentInfractions = 0;
  lastRecent = '';
  borderSafety = 60;
  kitPunishPending = false; // 0..100 how well-marked the borders are
  usedNames = new Set<string>();

  constructor(private game: Game) {}

  // --------------------------------------------------------------- queries
  get player(): Cat { return this.cats[this.playerId]; }
  get(id: string | null | undefined): Cat | undefined { return id ? this.cats[id] : undefined; }
  get leader() { return this.get(this.leaderId); }
  get deputy() { return this.get(this.deputyId); }
  get medicine() { return this.get(this.medicineId); }

  home(includePlayer = true): Cat[] {
    return Object.values(this.cats).filter((c) => c.alive && !c.ghost && c.clan === 'home' && !c.exiled && !c.caged && (includePlayer || !c.isPlayer));
  }
  rivalCats(index: number): Cat[] {
    return Object.values(this.cats).filter((c) => c.alive && c.clan === index);
  }
  dead(): Cat[] {
    return Object.values(this.cats).filter((c) => !c.alive && c.clan === 'home').sort((a, b) => (b.deathDay ?? 0) - (a.deathDay ?? 0));
  }

  rel(a: Cat, b: Cat): Relation {
    let r = a.relations[b.id];
    if (!r) {
      const comp = compatibility(a, b);
      const fam = isFamily(a, b);
      r = { opinion: Math.round(comp * 15 + (fam ? 45 : 0) + (a.clan === b.clan ? 5 : -10)), familiarity: fam ? 60 : a.clan === b.clan ? 15 : 0, romance: 0 };
      a.relations[b.id] = r;
    }
    return r;
  }

  opinion(a: Cat, b: Cat): number { return this.rel(a, b).opinion; }

  adjust(a: Cat, b: Cat, dOpinion: number, memory?: { text: string; weight: number }, dFam = 2) {
    if (a.id === b.id) return;
    const r = this.rel(a, b);
    const wasBest = r.opinion >= 85 && r.familiarity >= 45;
    r.opinion = clamp(r.opinion + dOpinion, -100, 100);
    r.familiarity = clamp(r.familiarity + dFam, 0, 100);
    if (memory) this.remember(a, memory.text, memory.weight, b.id);
    // becoming best friends with the player is a big moment
    const isBest = r.opinion >= 85 && r.familiarity >= 45;
    if (b.isPlayer && !wasBest && isBest && a.mate !== b.id && a.clan === 'home') {
      this.game.ui.toast(`💛 ${displayName(a)} is now your BEST FRIEND!`, 'good');
      this.game.audio.purr();
      this.remember(a, `${b.given} is my best friend.`, 8, b.id);
      this.remember(b, `${displayName(a)} and I are best friends now.`, 8, a.id);
      this.game.npcs.agents.get(a.id)?.say(`${b.given}… you're my best friend, you know that?`, 4);
    }
  }

  remember(c: Cat, text: string, weight: number, about?: string) {
    c.memories.push({ day: this.game.time.day, text, weight, about });
    if (c.memories.length > 30) {
      // forget the least significant memory
      let idx = 0, best = Infinity;
      c.memories.forEach((m, i) => { const s = Math.abs(m.weight) + (m.day / 1000); if (s < best) { best = s; idx = i; } });
      c.memories.splice(idx, 1);
    }
    if (c.isPlayer) this.log(text, 'memory');
  }

  log(text: string, kind: JournalKind) {
    this.journal.push({ day: this.game.time.day, hour: Math.floor(this.game.time.hour), text, kind });
    if (this.journal.length > 600) this.journal.splice(0, this.journal.length - 600);
    this.game.bus.emit('journal', { text, kind });
  }

  setRecent(text: string) { this.lastRecent = text; }

  /** Only one cat may be called Clover: extra Clovers (and extra Clover Ashshades) get new names. */
  dedupeClover() {
    const clovers = Object.values(this.cats).filter((c) => c.given === 'Clover' && !c.isPlayer);
    const ash = clovers.filter((c) => c.epithet === 'Ashshade' && c.alive);
    const keep = ash.find((c) => c.role === 'medicine') ?? ash.find((c) => c.bookId === 'CloverAshshade') ?? ash[0] ?? null;
    for (const c of clovers) {
      if (c === keep || (keep === null && c === clovers[0] && c.epithet === 'Ashshade')) continue;
      let nm = simRng.pick(GIVEN_NAMES), guard = 0;
      while ((nm === 'Clover' || this.usedNames.has(nm)) && guard++ < 50) nm = simRng.pick(GIVEN_NAMES);
      c.given = nm;
      if (c.epithet === 'Ashshade') c.epithet = makeEpithet(simRng, c);
      if (c.bookId === 'CloverAshshade') c.bookId = undefined;
      this.usedNames.add(nm);
    }
    this.usedNames.add('Clover');
    // nobody else wears Clover's striped slate coat
    const isCloverCoat = (c: Cat) => c.app.pattern === 'mackerel' && ['#535c73', '#4d5568'].includes(c.app.base) && c.app.second === '#15171c';
    const oldCoat = (c: Cat) => c.app.pattern === 'tabby' && c.app.base === '#9a9da3' && c.app.second === '#45474d';
    for (const c of Object.values(this.cats)) {
      if (c === keep || c.isPlayer || (c.given === 'Clover' && c.epithet === 'Ashshade')) continue;
      if (isCloverCoat(c) || oldCoat(c)) {
        const fresh = randomAppearance(simRng);
        c.app = { ...fresh, accessories: c.app.accessories, accessory: c.app.accessory };
      }
    }
  }

  /** Clover Ashshade, the striped she-cat medicine cat, lives in every clan. */
  ensureClover(rng: RNG = simRng) {
    this.dedupeClover();
    if (Object.values(this.cats).some((c) => c.given === 'Clover' && c.epithet === 'Ashshade')) return;
    const look = (c: Cat) => {
      c.given = 'Clover';
      c.epithet = 'Ashshade';
      c.bookId = 'CloverAshshade';
      c.sex = 'she';
      c.stage = 'warrior';
      c.role = 'medicine';
      c.age = Math.min(Math.max(c.age, 24), 30);
      c.traits = ['kind', 'calm'];
      c.pers = personalityFrom(c.traits, rng);
      c.skills.healing = Math.max(c.skills.healing, 80);
      c.app = { ...c.app, ...CLOVER_APP };
      this.usedNames.add('Clover');
    };
    const med = this.medicine;
    if (med && !med.bookId && !med.isPlayer) { look(med); return; }
    // the clan already has a famous medicine cat: Clover joins as a second healer
    const c = createCat({ age: 28, day: this.game.time.day, usedNames: this.usedNames, rng, sex: 'she' });
    this.cats[c.id] = c;
    look(c);
    if (!this.medicineId) this.medicineId = c.id;
  }

  /** Make sure every den has cats in it: plenty of warriors, elders, nursing queens with kits, and a medicine apprentice. */
  fillDens(rng: RNG = simRng) {
    const day = this.game.time.day;
    const add = (age: number, extra: Partial<Cat> = {}) => {
      const c = createCat({ age, day, usedNames: this.usedNames, rng, ...(extra.sex ? { sex: extra.sex } : {}) });
      Object.assign(c, extra);
      c.bornDay = day - Math.floor(age);
      this.cats[c.id] = c;
      return c;
    };
    const home = () => this.home();
    // warriors
    let warriors = home().filter((c) => c.stage === 'warrior' && c.role !== 'medicine');
    while (warriors.length < 12) { add(rng.range(16, 30)); warriors = home().filter((c) => c.stage === 'warrior' && c.role !== 'medicine'); }
    // elders' den
    let elders = home().filter((c) => c.stage === 'elder').length;
    while (elders < 3) { add(rng.range(82, 96)); elders++; }
    // nursery: a busy nursery — at least four queens with young kits
    const queens = () => home().filter((c) => c.sex === 'she' && c.kits.some((k) => this.get(k)?.stage === 'kit' && this.get(k)?.alive));
    let guard = 0;
    while (queens().length < 4 && guard++ < 8) {
      const mother = home().find((c) => c.sex === 'she' && c.stage === 'warrior' && c.role === 'none' && !c.isPlayer && c.age < 45 && !c.kits.some((k) => this.get(k)?.stage === 'kit'));
      if (!mother) break;
      let father = this.get(mother.mate);
      if (!father) {
        father = home().find((c) => c.sex === 'tom' && c.stage === 'warrior' && !c.mate && !c.isPlayer && !isFamily(c, mother)) ?? undefined;
        if (father) { mother.mate = father.id; father.mate = mother.id; this.rel(mother, father).opinion = 80; this.rel(father, mother).opinion = 80; }
      }
      const n = rng.int(3, 5);
      for (let i = 0; i < n; i++) {
        const k = createCat({ age: rng.range(0.5, 4), parents: father ? [mother, father] : [mother, mother], day, usedNames: this.usedNames, rng });
        k.parents = father ? [mother.id, father.id] : [mother.id];
        k.bornDay = day - Math.floor(k.age);
        this.cats[k.id] = k;
        mother.kits.push(k.id);
        if (father) father.kits.push(k.id);
        this.rel(mother, k).opinion = 90; this.rel(k, mother).opinion = 80;
      }
    }
    // medicine den: an apprentice for the medicine cat
    const med = this.medicine;
    if (med && !med.isPlayer && !home().some((c) => c.role === 'medicineApprentice')) {
      const ap = add(rng.range(7, 11), { role: 'medicineApprentice', medicinePath: true });
      ap.mentor = med.id;
      if (!med.apprentice) med.apprentice = ap.id;
    }
  }

  // ------------------------------------------------------------- creation
  newClan(playerCat: Cat, rng: RNG) {
    const day = this.game.time.day;
    const mk = (age: number, extra: Partial<Cat> = {}) => {
      const c = createCat({ age, day, usedNames: this.usedNames, rng });
      Object.assign(c, extra);
      this.cats[c.id] = c;
      return c;
    };
    const leader = mk(rng.range(48, 66));
    leader.role = 'leader';
    leader.reputation = 70;
    leader.skills.fighting = Math.max(leader.skills.fighting, 65);
    this.leaderId = leader.id;
    const deputy = mk(rng.range(28, 44));
    deputy.role = 'deputy';
    deputy.reputation = 50;
    this.deputyId = deputy.id;
    const med = mk(rng.range(30, 60));
    med.role = 'medicine';
    med.skills.healing = 80;
    med.traits = med.traits.includes('aggressive') ? ['kind', 'calm'] : med.traits;
    this.medicineId = med.id;
    const warriors: Cat[] = [];
    for (let i = 0; i < 13; i++) warriors.push(mk(rng.range(14, 60)));
    // elders
    for (let i = 0; i < 3; i++) mk(rng.range(82, 100));
    // apprentices with mentors
    const mentors = rng.shuffle(warriors.filter((w) => w.age > 20).slice());
    for (let i = 0; i < 2; i++) {
      const ap = mk(rng.range(6.5, 11));
      const m = mentors[i] ?? deputy;
      ap.mentor = m.id;
      m.apprentice = ap.id;
    }
    // Player's family: mother (queen) and father
    const mother = createCat({ age: rng.range(20, 40), sex: 'she', day, usedNames: this.usedNames, rng });
    const father = warriors.find((w) => w.sex === 'tom' && w.age > 18) ?? mk(rng.range(20, 40), { sex: 'tom' });
    this.cats[mother.id] = mother;
    mother.mate = father.id;
    father.mate = mother.id;
    playerCat.parents = [mother.id, father.id];
    playerCat.age = 3;
    playerCat.stage = 'kit';
    playerCat.bornDay = day - 3;
    playerCat.isPlayer = true;
    this.cats[playerCat.id] = playerCat;
    this.playerId = playerCat.id;
    this.usedNames.add(playerCat.given);
    // littermates
    const litter = rng.int(1, 2);
    const kits = [playerCat];
    for (let i = 0; i < litter; i++) {
      const k = createCat({ age: 3, parents: [mother, father], day, usedNames: this.usedNames, rng });
      k.bornDay = day - 3;
      this.cats[k.id] = k;
      kits.push(k);
    }
    for (const k of kits) {
      mother.kits.push(k.id);
      father.kits.push(k.id);
    }
    // another queen expecting
    const q2 = warriors.find((w) => w.sex === 'she' && !w.mate && w.age < 50);
    const t2 = warriors.find((w) => w.sex === 'tom' && !w.mate && w.age < 50);
    if (q2 && t2) {
      q2.mate = t2.id;
      t2.mate = q2.id;
      q2.expectingUntil = day + 2;
    }
    // initial relationships
    const all = this.home();
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        const r = this.rel(a, b);
        r.familiarity = clamp(r.familiarity + rng.range(10, 50) * (a.stage === 'kit' || b.stage === 'kit' ? 0.3 : 1), 0, 100);
        r.opinion = clamp(r.opinion + rng.range(-20, 25), -100, 100);
        if (a.mate === b.id) { r.opinion = 80; r.romance = 80; }
      }
    }
    for (const k of kits) {
      this.rel(k, mother).opinion = 85;
      this.rel(mother, k).opinion = 90;
      this.rel(k, father).opinion = 70;
      this.rel(father, k).opinion = 75;
      for (const k2 of kits) if (k !== k2) { this.rel(k, k2).opinion = 60; this.rel(k, k2).familiarity = 90; }
    }
    // rival clans
    this.rivals = this.game.territories.rivals.map((r) => ({
      index: r.index,
      strength: rng.range(45, 70),
      attitude: r.temperament === 'hostile' ? -40 : r.temperament === 'friendly' ? 20 : r.temperament === 'proud' ? -10 : 0,
    }));
    for (const r of this.rivals) this.populateRival(r.index, rng);
    if (isClassic()) this.seedBookCats(playerCat, rng);
    this.log(`You were born into ${clanTitle(this.game.territories.homeName)}, the kit of ${displayName(mother)} and ${displayName(father)}.`, 'birth');
    this.log(`${displayName(leader)} leads the clan as Warden, with ${displayName(deputy)} as Second.`, 'politics');
  }

  /** Classic mode: famous cats from the books take their places in each clan. */
  private seedBookCats(player: Cat, rng: RNG) {
    const protectedIds = new Set([player.id, ...player.parents]);
    const apply = (c: Cat, b: BookCat) => {
      c.given = b.prefix;
      c.bookId = b.prefix + b.suffix;
      c.epithet = b.stage === 'apprentice' ? null : b.suffix;
      c.sex = b.sex;
      c.age = b.age;
      c.traits = b.traits.slice();
      c.pers = personalityFrom(c.traits, rng);
      c.app = { ...c.app, ...b.app, second: b.app.second ?? c.app.second, white: b.app.white ?? (b.app.pattern ? 0 : c.app.white) };
      c.stage = b.stage ?? (b.age >= 80 && !b.role ? 'elder' : 'warrior');
      if (b.role === 'leader') c.skills.fighting = Math.max(c.skills.fighting, 70);
      if (b.role === 'medicine') c.skills.healing = 85;
      this.usedNames.add(b.prefix);
    };
    const place = (clan: Cat['clan'], list: BookCat[]) => {
      const pool = Object.values(this.cats).filter((c) => c.alive && c.clan === clan && !protectedIds.has(c.id) && !c.mate && c.stage !== 'kit');
      const used = new Set<string>();
      for (const b of list) {
        let target: Cat | undefined;
        if (b.role === 'leader') target = clan === 'home' ? this.leader : pool.find((c) => c.role === 'leader');
        else if (b.role === 'deputy' && clan === 'home') target = this.deputy;
        else if (b.role === 'medicine' && clan === 'home') target = this.medicine;
        else if (b.stage === 'apprentice') target = pool.find((c) => !used.has(c.id) && c.stage === 'apprentice' && c.role === 'none');
        else if (b.stage === 'elder') target = pool.find((c) => !used.has(c.id) && c.stage === 'elder');
        target = target && !used.has(target.id) && !protectedIds.has(target.id) ? target : pool.find((c) => !used.has(c.id) && c.role === 'none' && c.stage === 'warrior');
        if (!target) continue;
        used.add(target.id);
        if (clan !== 'home' && b.role) {
          if (b.role === 'leader') for (const o of pool) if (o.role === 'leader') o.role = 'none';
          target.role = b.role;
        }
        apply(target, b);
        if (b.stage === 'apprentice' && !target.mentor && clan === 'home') {
          const m = this.pickMentor(target);
          if (m) { target.mentor = m.id; m.apprentice = target.id; }
        }
      }
    };
    place('home', BOOK_CATS[this.game.territories.homeName] ?? []);
    for (const r of this.game.territories.rivals) place(r.index, BOOK_CATS[r.name] ?? []);
  }

  populateRival(index: number, rng: RNG = simRng) {
    const day = this.game.time.day;
    const existing = this.rivalCats(index);
    const need = RIVAL_CAT_COUNT - existing.length;
    for (let i = 0; i < need; i++) {
      const c = createCat({ age: rng.range(8, 70), clan: index, day, usedNames: this.usedNames, rng });
      this.cats[c.id] = c;
    }
    const cats = this.rivalCats(index);
    if (!cats.some((c) => c.role === 'leader')) {
      const l = cats.filter((c) => c.stage === 'warrior').sort((a, b) => b.age - a.age)[0];
      if (l) l.role = 'leader';
    }
  }

  // ------------------------------------------------------------- ticking
  tickHour() {
    const t = this.game.time;
    const hour = Math.floor(t.hour);
    const drought = this.game.events.isActive('drought');
    const cold = this.game.events.isActive('coldSnap') || this.game.weather.temperature < 0;
    for (const c of this.home()) {
      const drain = (c.stage === 'kit' ? 0.9 : 1.05) * (cold ? 1.3 : 1) * (drought ? 1.15 : 1);
      c.hunger = clamp(c.hunger - drain, 0, 100);
      // healing and sickness
      // (your own wounds and sickness only heal with a medicine cat's care, herbs or the vet)
      if (c.injury > 0 && !c.isPlayer) c.injury = Math.max(0, c.injury - (c.role === 'medicine' ? 1.2 : 0.6) - (this.medicine ? 0.4 : 0));
      if (c.sick > 0 && !c.isPlayer) {
        const care = this.medicine && !this.medicine.isPlayer ? 0.35 : 0.1;
        c.sick = clamp(c.sick + (cold ? 0.5 : 0.1) - care - (c.age < 80 ? 0.3 : 0), 0, 100);
      }
      const cap = 100 - c.injury * 0.6 - c.sick * 0.4;
      c.maxHealth = Math.max(15, cap);
      if (c.hunger < 8) c.health -= 0.6;
      else if (!c.isPlayer) c.health = Math.min(c.maxHealth, c.health + 2);
      if (c.health <= 0 && !c.isPlayer) this.kill(c, c.hunger < 8 ? 'starvation' : 'wounds');
    }
    // off-screen hunting: warriors and apprentices keep the pile stocked
    if (hour >= 6 && hour <= 20) {
      const abundance = this.game.events.preyAbundance();
      let caught = 0;
      for (const c of this.home(false)) {
        if ((c.stage !== 'warrior' && c.stage !== 'apprentice') || c.role === 'medicine' || c.role === 'medicineApprentice') continue;
        if (c.injury > 50 || c.sick > 50 || c.expectingUntil !== null) continue;
        const skill = 0.6 + c.skills.hunting / 100;
        const lazy = c.traits.includes('lazy') ? 0.6 : 1;
        caught += 0.075 * abundance * skill * lazy * (c.stage === 'apprentice' ? 0.6 : 1);
      }
      if (this.game.weather.p.rain > 0.6 || this.game.weather.p.snow > 0.6) caught *= 0.7;
      if (this.food < this.home().length * 0.6) caught *= 1.6; // hungry clans hunt harder
      this.addFood(caught);
    }
    // meals at dawn and dusk
    if (hour === 7 || hour === 19) this.mealTime();
    // patrols
    if (hour === 6 || hour === 15) this.organizePatrols();
    // passive border decay
    this.borderSafety = clamp(this.borderSafety - 0.6, 0, 100);
  }

  mealTime() {
    const pl = this.player;
    if (pl && pl.alive && !pl.exiled && pl.stage === 'kit' && pl.hunger < 70) {
      pl.hunger = clamp(pl.hunger + 45, 0, 100);
      this.food = Math.max(0, this.food - 0.5);
      this.game.notify('Your mother nudges a morsel of fresh-kill toward you. You eat.', 'info');
    }
    const order = this.home(false).sort((a, b) => this.feedPriority(b) - this.feedPriority(a));
    for (const c of order) {
      if (c.hunger > 62) continue;
      const ration = this.game.events.rationing && c.stage !== 'kit' && c.stage !== 'elder';
      if (this.food >= 1) {
        this.food -= c.stage === 'kit' || ration ? 0.5 : 1;
        c.hunger = clamp(c.hunger + (ration ? 30 : 50), 0, 100);
      }
    }
    this.food = Math.max(0, this.food);
    this.game.camp.setPileCount(this.food);
  }

  private feedPriority(c: Cat) {
    return c.stage === 'kit' ? 4 : c.stage === 'elder' ? 3 : c.expectingUntil || c.kits.some((k) => this.get(k)?.stage === 'kit') ? 3 : c.sick > 30 ? 2 : 1;
  }

  addFood(n: number) {
    this.food = Math.min(this.food + n, 8 + this.home().length * 2.5); // excess prey spoils
    this.game.camp.setPileCount(this.food);
  }

  /** Runs at dawn (hour 6) each day — one moon passes. */
  /** Kits get crushes on other kits (which can blossom into romance when they grow up). */
  crushTick() {
    const young = (c: Cat) => c.alive && !c.exiled && c.clan === 'home' && (c.stage === 'kit' || c.stage === 'apprentice' || (c.isPlayer && c.age <= 18));
    for (const c of Object.values(this.cats)) {
      if (c.crush) { const t = this.get(c.crush); if (!t || !t.alive || t.exiled) c.crush = undefined; continue; }
      if (c.isPlayer || c.stage !== 'kit' || c.age < 1 || !young(c) || !simRng.chance(0.2)) continue;
      const opts = Object.values(this.cats).filter((o) => o !== c && young(o) && !isFamily(c, o) && Math.abs(o.age - c.age) < (o.isPlayer ? 14 : 5));
      if (!opts.length) continue;
      // you're everyone's favourite: kits often get a crush on you
      const score = (o: Cat) => this.opinion(c, o) + (o.sex !== c.sex ? 15 : 0) + (o.isPlayer ? 40 : 0) + simRng.range(0, 30);
      const pick = opts.sort((x, y) => score(y) - score(x))[0];
      c.crush = pick.id;
      this.rel(c, pick).romance = clamp(this.rel(c, pick).romance + 25, 0, 100);
      this.adjust(c, pick, 5);
      if (pick.isPlayer) this.game.ui.toast(`💕 Psst… you've heard a rumour that ${displayName(c)} has a crush on you!`, 'info');
    }
  }

  /** Deathberries: kits sometimes eat them. Poison hurts every hour until the medicine cat treats it. */
  poisonTick() {
    const g = this.game;
    // clan cats with mates get hurt easily too: falls, scrapes, going hungry
    if (!g.time.isNight) for (const c of this.home()) {
      if (c.isPlayer || !c.mate || c.stage === 'kit' || !c.alive) continue;
      if (simRng.chance(0.015)) { c.health = Math.max(5, c.health - 40); g.npcs.agents.get(c.id)?.say(simRng.pick(['*stumbles and falls* Oof!', '*trips over a root* Ow…']), 3); }
      else if (simRng.chance(0.01)) { c.health = Math.max(5, c.health - 50); c.injury = Math.min(100, c.injury + 15); g.npcs.agents.get(c.id)?.say('Ow! A thorn scraped me!', 3); }
      if (c.hunger < 20 && simRng.chance(0.3)) c.health = Math.max(5, c.health - 40);
    }
    const kits = this.home().filter((c) => c.stage === 'kit' && !c.isPlayer && c.poisoned === undefined);
    if (kits.length && !g.time.isNight && simRng.chance(0.02)) {
      const k = simRng.pick(kits);
      k.poisoned = 0;
      g.npcs.agents.get(k.id)?.say('*wobbles* My tummy hurts… I ate some pretty red berries…', 5);
      g.ui.toast(`⚠ ${displayName(k)} is wobbling and drooling — did ${pronoun(k, 'subj')} eat deathberries?! Get the medicine cat!`, 'danger');
      this.log(`${displayName(k)} ate deathberries.`, 'clan');
    }
    for (const c of this.home()) {
      if (c.poisoned === undefined || c.isPlayer) continue;
      c.poisoned++;
      c.health = Math.max(0, c.health - (c.stage === 'kit' ? 18 : 10));
      c.sick = Math.max(c.sick, 50);
      if (c.health <= 0) { c.poisoned = undefined; this.kill(c, 'eating deathberries'); continue; }
      // the medicine cat notices on their own after a while
      const med = this.medicine;
      if (c.poisoned >= 3 && med && med.alive && !med.isPlayer && med.id !== c.id) g.npcs.sendHealer(med, c, false);
    }
  }

  /** Make sure the nursery is lively: queens with litters until there are about `target` kits. Returns the new mothers. */
  fillNursery(target = 10): Cat[] {
    const day = this.game.time.day;
    const kitsNow = () => this.home().filter((c) => c.stage === 'kit').length;
    const mothers: Cat[] = [];
    let guard = 0;
    while (kitsNow() < target && guard++ < 6) {
      const pc = this.player;
      const mother = this.home().find((c) => c.sex === 'she' && c.stage === 'warrior' && c.role === 'none' && !c.isPlayer && c.age < 60 && c.expectingUntil === null && !c.labour
        && !c.kits.some((k) => (this.get(k)?.age ?? 99) < 6) && !mothers.includes(c) && !(pc && pc.mate === c.id));
      if (!mother) break;
      let father = this.get(mother.mate);
      if (!father || !father.alive || father.isPlayer) {
        father = this.home().find((c) => c.sex === 'tom' && c.stage === 'warrior' && !c.mate && !c.isPlayer && !isFamily(c, mother)) ?? undefined;
        if (father) { mother.mate = father.id; father.mate = mother.id; this.rel(mother, father).romance = 80; this.rel(father, mother).romance = 80; }
      }
      const n = Math.min(simRng.int(3, 5), target - kitsNow() + 2);
      for (let i = 0; i < n; i++) {
        const k = createCat({ age: simRng.range(0.3, 3), parents: father ? [mother, father] : [mother, mother], day, usedNames: this.usedNames });
        k.parents = father ? [mother.id, father.id] : [mother.id];
        k.bornDay = day - Math.floor(k.age);
        this.cats[k.id] = k;
        this.usedNames.add(k.given);
        mother.kits.push(k.id);
        if (father) father.kits.push(k.id);
        this.rel(mother, k).opinion = 90; this.rel(k, mother).opinion = 80;
        if (father) { this.rel(father, k).opinion = 80; this.rel(k, father).opinion = 70; }
      }
      mother.lastLitterDay = day - 1;
      this.log(`${displayName(mother)}'s litter of ${n} joined the nursery.`, 'birth');
      mothers.push(mother);
    }
    if (mothers.length) { this.game.npcs.syncRoster(); this.game.npcs.refreshModels(); }
    return mothers;
  }

  /** A queen who won't survive her birth says goodbye to her mate. */
  private lastWords(mother: Cat, helper: Cat | null) {
    const g = this.game;
    if (!mother.alive) return;
    const mate = this.get(mother.mate);
    const mateHere = mate && mate.alive ? mate : null;
    const banner = (who: Cat, text: string) => { g.npcs.agents.get(who.id)?.say(text.replace(/\*[^*]*\*\s*/g, '').trim() || text, 5); g.ui.showBanner(`${displayName(who)}: ${text}`, 5); };
    const kitsAlive = mother.kits.map((k) => this.get(k)).filter((k): k is Cat => !!k && k.alive && k.age < 1);
    const healerOf = () => helper && helper.alive && !helper.isPlayer ? helper : this.medicine && this.medicine.alive && this.medicine.id !== mother.id ? this.medicine : null;
    const griefFor = () => {
      if (!mateHere) return;
      this.remember(mateHere, `${displayName(mother)} died giving birth to our kits. I'll never forget her last words.`, -10, mother.id);
      // grief can darken a heart
      if (!mateHere.isPlayer && simRng.chance(0.35)) {
        mateHere.griefDark = true;
        mateHere.traits = [...mateHere.traits.filter((t) => t !== 'kind' && t !== 'friendly' && t !== 'calm'), 'aggressive'].slice(-2) as Cat['traits'];
        this.log(`Grief has darkened ${displayName(mateHere)}'s heart.`, 'clan');
      }
    };
    // where everyone gathers: the mate at her reaching paw, the kits pressed against her
    const pos = mother.isPlayer ? g.player.pos : g.npcs.agents.get(mother.id)?.pos;
    const ma = mateHere ? g.npcs.agents.get(mateHere.id) : undefined;
    const gather = (secs: number) => {
      if (!pos) return;
      const p = { x: pos.x, z: pos.z };
      let face = 0;
      if (ma) face = Math.atan2(ma.pos.z - p.z, ma.pos.x - p.x);
      if (mother.isPlayer) {
        g.player.heading = face;
        g.player.posePick = 'reach';
        g.player.holdSpot = { x: p.x, z: p.z, until: g.clock + secs + 30, heading: face };
      } else {
        const qa = g.npcs.agents.get(mother.id);
        if (qa) g.npcs.playScene(qa, null, ma ? { x: ma.pos.x, z: ma.pos.z } : null, 'reach', secs);
      }
      if (ma) {
        g.npcs.playScene(ma, { x: p.x + Math.cos(face) * 0.55, z: p.z + Math.sin(face) * 0.55 }, p, 'groomOther', secs + 25, 3.5);
        ma.tears = true;
      }
      kitsAlive.forEach((k, i) => {
        const ka = g.npcs.agents.get(k.id);
        if (!ka) return;
        const ang = face + Math.PI * (0.55 + i * 0.3);
        g.npcs.playScene(ka, { x: p.x + Math.cos(ang) * 0.38, z: p.z + Math.sin(ang) * 0.38 }, p, i % 2 ? 'groomOther' : 'suckle', secs + 25, 1.4);
      });
    };
    const preset = 'Goodbye… I will join the stars, waiting for you.';
    if (mother.isPlayer) {
      const to = mateHere ? displayName(mateHere) : 'your clan';
      const say = (w: string) => {
        g.ui.closeDialog(false);
        gather(20);
        g.player.deathCam = { t: 0, a0: g.player.heading + Math.PI * 0.65 };
        g.ui.showHud(false);
        banner(mother, w);
        g.ui.toast('🐾 Your paw stretches out toward your mate one last time…', 'info');
        if (mateHere) setTimeout(() => banner(mateHere, '*tears stream down his face* No… please don\'t! Please don\'t leave me!'), 3500);
        if (kitsAlive.length) setTimeout(() => g.ui.toast(`🍼 Your tiny kits squirm close, nuzzling and licking your fur…`, 'info'), 6500);
        setTimeout(() => {
          g.ui.fade(true, '');
          setTimeout(() => g.ui.starSparkles('StarClan is waiting for you…', 4500, () => {
            mother.fatalBirth = false;
            g.player.deathCam = null;
            griefFor();
            g.cinematicDeath = true;
            this.kill(mother, 'complications after giving birth');
          }), 1800);
        }, 10500);
      };
      g.ui.choice('💫 Your last words', `You feel yourself slipping away toward StarClan… What do you say to ${to}?`, [
        { label: `"${preset}"`, action: () => say(preset) },
        { label: '"Take care of our kits… tell them I loved them."', action: () => say('Take care of our kits… tell them I loved them.') },
        { label: '"Don\'t be sad. I\'ll always be watching over you."', action: () => say('Don\'t be sad. I\'ll always be watching over you.') },
      ]);
      return;
    }
    // a clan queen's last moments
    gather(16);
    banner(mother, `*stretches a paw toward ${mateHere ? mateHere.given : 'the stars'}* ${preset}`);
    setTimeout(() => {
      if (mateHere) banner(mateHere, '*tears stream down his face* No… please don\'t!');
      setTimeout(() => {
        mother.fatalBirth = false;
        this.kill(mother, 'complications after giving birth');
        griefFor();
        const healer = healerOf();
        if (healer && !healer.isPlayer) setTimeout(() => banner(healer, '…I\'m sorry…'), 2500);
        if (mateHere && ma) setTimeout(() => banner(mateHere, '*licks her still fur, again and again*'), 5000);
        // one of her kits doesn't understand yet
        const kitT = mother.kits.map((k) => this.get(k)).find((k) => k && k.alive && k.stage === 'kit');
        if (kitT && mateHere) {
          setTimeout(() => banner(kitT, 'Where\'s Mama? Is she sleeping?'), 9500);
          setTimeout(() => banner(mateHere, `*voice breaking* No, ${displayName(kitT)}… she's not coming back.`), 13500);
        }
      }, 4500);
    }, 4000);
  }

  /** When labour starts, the queen's mate hurries to her side and stays for the birth. */
  private callMate(mother: Cat) {
    const g = this.game;
    const mate = this.get(mother.mate);
    if (!mate || !mate.alive || mate.exiled) return;
    if (mate.isPlayer) {
      const n = g.camp.dens.nursery;
      g.ui.toast(`🍼 ${displayName(mother)}'s kits are coming! Hurry to the nursery to be by her side!`, 'objective');
      g.objectives.add({ id: `mate-birth-${mother.id}`, kind: 'visit', title: `🍼 Be with ${displayName(mother)}`, desc: `Your mate is having your kits. Go to the nursery and stay by her side.`, target: { x: n.x, z: n.z }, radius: 3.5, need: 1 });
      return;
    }
    g.npcs.stayForBirth(mate);
  }

  /** A medicine cat's secret kits: carried to a queen with a story about the Thunderpath. */
  hideSecretKits(mother: Cat, kits: Cat[]) {
    const g = this.game;
    const alive = kits.filter((k) => k.alive);
    if (!alive.length || mother.medRevealed) return;
    const father = this.get(mother.mate);
    const carrier = father && father.alive ? father : mother;
    const queens = this.home(false).filter((q) => q.sex === 'she' && q.id !== mother.id && q.stage === 'warrior' && q.role === 'none' && !q.isPlayer)
      .sort((a, b) => Number(isQueen(b, (id) => this.get(id))) - Number(isQueen(a, (id) => this.get(id)))).slice(0, 5);
    const names = alive.map((k) => displayName(k)).join(', ');
    const ask = (q: Cat) => {
      const kind = q.traits.includes('kind') || q.traits.includes('friendly') || q.traits.includes('loyal');
      const yes = simRng.chance(clamp(0.55 + (kind ? 0.15 : 0) + (isQueen(q, (id) => this.get(id)) ? 0.1 : 0) + this.opinion(q, carrier) / 250, 0.15, 0.92));
      const say = (who: Cat, text: string) => { g.npcs.agents.get(who.id)?.say(text, 5); g.ui.showBanner(`${displayName(who)}: ${text}`, 5); };
      say(carrier, `${q.given}… I found these kits on the Thunderpath, all alone. Can you take care of them?`);
      setTimeout(() => {
        if (yes) {
          say(q, simRng.pick(['*gasps* On the Thunderpath?! Poor little things… of course I\'ll take them.', 'Give them here — they\'re freezing! I\'ll raise them as my own.']));
          q.fosterKits = [...(q.fosterKits ?? []), ...alive.map((k) => k.id)];
          for (const k of alive) { k.foster = q.id; k.secretKit = true; this.rel(q, k).opinion = Math.max(this.rel(q, k).opinion, 75); }
          this.log(`${displayName(q)} took in kits "found on the Thunderpath": ${names}.`, 'clan');
          g.ui.toast(`🍼 ${displayName(q)} will raise the kits. Nobody knows they're ${mother.given}'s… yet.`, 'good');
        } else {
          say(q, simRng.pick(['I can barely feed myself… I\'m sorry. I can\'t.', '*backs away* Thunderpath kits? No. Take them somewhere else.']));
          setTimeout(() => {
            for (const k of alive) this.kill(k, 'cold and hunger');
            g.ui.toast(`🕯 With no queen to feed them, the tiny kits fade away in the night… ${names}.`, 'danger');
            this.remember(mother, 'My secret kits did not survive. No queen would take them.', -12);
          }, 4000);
        }
      }, 4500);
    };
    if ((carrier.isPlayer || mother.isPlayer) && queens.length) {
      g.ui.choice('🤫 Your secret kits', `${names} — no one can know they're a medicine cat's kits. ${carrier.isPlayer ? 'Which queen will you take them to?' : `${carrier.given} will carry them. Which queen should they go to?`}`,
        queens.map((q) => ({ label: `${displayName(q)}${isQueen(q, (id) => this.get(id)) ? ' (nursing)' : ''}`, action: () => ask(q) })));
    } else if (queens.length) ask(queens[0]);
    else ask(mother); // nobody else: it can't work
  }

  /** The secret of a medicine cat's mate comes out. */
  private revealMedSecret(med: Cat, reporter?: Cat) {
    if (med.medRevealed) { this.strikeMed(med, reporter); return; }
    const mate = this.get(med.mate);
    med.medRevealed = true; if (mate) mate.medRevealed = true;
    for (const c of [med, mate]) if (c) c.reputation = clamp(c.reputation - 20, -100, 100);
    this.log(`The clan found out that ${displayName(med)}${mate ? ` and ${displayName(mate)}` : ''} broke the code: a medicine cat with a mate!`, 'politics');
    this.game.notify(`😱 The clan found out! ${displayName(med)}${mate ? ` and ${displayName(mate)} are mates` : ' has a mate'} — and ${med.given} is a medicine cat!`, 'danger');
    this.strikeMed(med, reporter);
  }

  /** The medicine cat gets a strike — no second chances for this one. */
  private strikeMed(med: Cat, reporter?: Cat) {
    const by = reporter ? ` ${displayName(reporter)} told the leader.` : '';
    if (med.isPlayer) {
      this.infraction('medicineMate', reporter ? [reporter.id] : this.home(false).slice(0, 4).map((c) => c.id), 'a medicine cat with a mate', true);
      this.game.ui.toast(`⚠ Strike! You broke the code: medicine cats must not take mates.${by} (${med.infractions} strike${med.infractions === 1 ? '' : 's'})`, 'danger');
    } else {
      med.infractions = (med.infractions ?? 0) + 1;
      this.log(`${displayName(med)} was given a strike for taking a mate as a medicine cat.${by}`, 'rule');
      this.game.notify(`⚠ ${displayName(med)} gets a strike for breaking the code — medicine cats must not take mates.${by} (${med.infractions} strike${med.infractions === 1 ? '' : 's'})`, 'danger');
    }
  }

  /** The medicine-cat parent of a secret kit (if any). */
  secretParent(k: Cat): Cat | undefined {
    if (!k.secretKit) return undefined;
    return k.parents.map((id) => this.get(id)).find((p): p is Cat => !!p && isMedCat(p));
  }

  /** A secret kit finds out their real mother (or father) is the medicine cat. */
  private kitLearnsTruth(k: Cat, med: Cat) {
    const g = this.game;
    k.knowsTruth = true;
    const other = k.parents.map((id) => this.get(id)).find((p) => p && p.id !== med.id);
    const parent = med.sex === 'she' ? 'mother' : 'father';
    const report = () => {
      this.adjust(k, med, -30, { text: `${displayName(med)} lied to me my whole life.`, weight: -8 });
      this.log(`${displayName(k)} found out ${displayName(med)} is their real ${parent} — and reported it to the leader.`, 'politics');
      const lead = this.leader;
      if (lead) g.npcs.agents.get(lead.id)?.say(`${med.given}… is this true? A medicine cat with kits?!`, 5);
      this.revealMedSecret(med, k);
    };
    const upset = () => {
      this.adjust(k, med, -25, { text: `${displayName(med)} is my real ${parent}, and never told me.`, weight: -6 });
      this.log(`${displayName(k)} found out ${displayName(med)} is their real ${parent}. They're furious, but kept the secret.`, 'clan');
    };
    const forgive = () => {
      this.adjust(k, med, 10, { text: `${displayName(med)} is my real ${parent}. I forgave them.`, weight: 5 });
      this.log(`${displayName(k)} found out ${displayName(med)} is their real ${parent} — and forgave them.`, 'clan');
    };
    if (k.isPlayer) {
      g.ui.choice('😢 The truth', `You overhear ${displayName(med)}${other ? ` and ${displayName(other)}` : ''} whispering… You weren't found on the Thunderpath. ${displayName(med)} — the medicine cat — is your real ${parent}! What will you do?`, [
        { label: '📢 Tell the leader', action: report },
        { label: '😠 Stay angry, but keep the secret', action: () => { upset(); g.ui.toast(`You can't even look at ${med.given}…`, 'info'); } },
        { label: '💗 Forgive them', action: () => { forgive(); g.ui.toast(`*${med.given} presses close* "I'm so sorry… I loved you every day."`, 'good'); } },
      ]);
      return;
    }
    // they'll be upset — forgiving is rare
    const roll = simRng.next();
    const choice = roll < 0.2 ? 'forgive' : roll < 0.6 ? 'report' : 'upset';
    const say = (who: Cat, text: string) => { g.npcs.agents.get(who.id)?.say(text, 5); };
    say(k, choice === 'forgive' ? `You're my ${parent}?… *sniffs* I'm angry… but I still love you.` : `You're my ${parent}?! You LIED to me! The Thunderpath story was all lies!`);
    const near = (med.isPlayer || other?.isPlayer);
    if (near) g.ui.showBanner(`${displayName(k)}: ${choice === 'forgive' ? `You're my ${parent}?… I'm angry… but I forgive you.` : `You're my real ${parent}?! You LIED to me!`}`, 6);
    if (choice === 'forgive') { forgive(); if (near) g.ui.toast(`💗 ${displayName(k)} found out the truth — and forgave you.`, 'good'); }
    else if (choice === 'upset') { upset(); if (near) g.ui.toast(`😠 ${displayName(k)} found out you're their real ${med.isPlayer ? parent : 'parent'}. They're furious… but they kept the secret. For now.`, 'danger'); }
    else { if (near) g.ui.toast(`📢 ${displayName(k)} found out the truth and is going to tell the leader!`, 'danger'); setTimeout(report, 3000); }
  }

  /** Childhood crushes grow into mates once both cats are grown up. */
  crushesToMates() {
    for (const a of Object.values(this.cats)) {
      const b = this.get(a.crush);
      if (!b || a.mate || b.mate || !a.alive || !b.alive || a.exiled || b.exiled || a.clan !== 'home' || b.clan !== 'home') continue;
      if (!this.grownUp(a) || !this.grownUp(b) || isFamily(a, b)) continue;
      // (if the crush is on you, you get to decide)
      const mutual = b.isPlayer || b.crush === a.id || this.rel(b, a).romance > 30 || this.opinion(b, a) > 40;
      if (!mutual) continue;
      if (a.isPlayer || b.isPlayer) {
        // your childhood crush asks you
        const other = a.isPlayer ? b : a;
        const pc = a.isPlayer ? a : b;
        if (other.crushAsked) continue;
        other.crushAsked = true;
        this.game.ui.dialog({ speaker: other, text: `*shuffles paws* ${pc.given}… do you remember when we were kits, and I had the biggest crush on you? I still do. Will you be my mate?`, options: [
          { label: '💕 Yes!', action: () => { this.makeMates(pc, other); this.game.ui.closeDialog(false); this.game.ui.toast(`💕 Your childhood crush ${displayName(other)} is now your mate!`, 'good'); } },
          { label: 'Not right now', action: () => { this.adjust(other, pc, -3); this.game.ui.closeDialog(false); } },
        ] });
        continue;
      }
      this.makeMates(a, b);
      this.log(`Childhood sweethearts ${displayName(a)} and ${displayName(b)} became mates.`, 'clan');
      this.setRecent(`${a.given} and ${b.given} were crushes as kits — now they're mates!`);
    }
  }

  makeMates(a: Cat, b: Cat) {
    a.mate = b.id; b.mate = a.id;
    a.crush = undefined; b.crush = undefined;
    this.rel(a, b).romance = 90; this.rel(b, a).romance = 90;
    this.remember(a, `${displayName(b)} and I became mates.`, 10, b.id);
    this.remember(b, `${displayName(a)} and I became mates.`, 10, a.id);
    this.matesFormed(a, b);
  }

  tickDay() {
    this.crushTick();
    for (const c of this.home()) if (isMedCat(c) && c.medSecret && c.medFound && !c.medRevealed && c.mate && (c.expectingUntil !== null || simRng.chance(0.15))) this.revealMedSecret(c);
    // secret kits might find out who their real parent is
    for (const k of this.home()) {
      if (!k.secretKit || k.knowsTruth || k.age < 3) continue;
      const med = this.secretParent(k);
      if (med && med.alive && simRng.chance(0.05)) { this.kitLearnsTruth(k, med); break; }
    }
    // a heart darkened by grief may turn its back on the clan
    for (const c of this.home()) if (c.griefDark && !c.isPlayer && simRng.chance(0.12)) {
      c.exiled = true; c.griefDark = false;
      if (c.mate) { const m = this.get(c.mate); if (m && m.mate === c.id && m.alive) m.mate = null; }
      this.log(`${displayName(c)}, twisted by grief, left the clan to walk a darker path.`, 'politics');
      this.game.notify(`🌑 ${displayName(c)}, twisted by grief, has left the clan to walk a darker path.`);
      this.game.npcs.syncRoster();
    }
    // a queen who was dying after her birth never pulls through
    for (const c of Object.values(this.cats)) if (c.fatalBirth && c.alive) { c.fatalBirth = false; this.kill(c, 'complications after giving birth'); }
    // the nursery never sits empty for long
    if (this.player && !this.player.exiled && this.home().filter((c) => c.stage === 'kit').length < 5) {
      const mums = this.fillNursery(8);
      if (mums.length) this.game.notify(`🍼 New kits in the nursery! ${mums.map((m) => displayName(m)).join(', ')} ${mums.length === 1 ? 'had' : 'had'} a litter.`);
    }
    this.crushesToMates();
    const day = this.game.time.day;
    const rng = simRng;
    const home = this.home();
    for (const c of home) {
      c.age += c.stage === 'kit' ? 2 : 1; // kits grow up fast
      // training for NPC apprentices
      if (c.stage === 'apprentice' && !c.isPlayer) {
        const l = rng.pick(LESSONS);
        c.training[l] = Math.min(3, c.training[l] + (rng.chance(0.7) ? 1 : 0));
        c.skills.hunting = Math.min(90, c.skills.hunting + rng.range(1, 3));
        c.skills.fighting = Math.min(90, c.skills.fighting + rng.range(1, 3));
        c.skills.tracking = Math.min(90, c.skills.tracking + rng.range(0.5, 2));
      }
      if (c.stage === 'kit' || c.stage === 'apprentice') c.strength = Math.min(95, c.strength + rng.range(1.5, 3));
      // expecting queens give birth
      if (c.expectingUntil !== null && day >= c.expectingUntil) this.startLabour(c);
    }
    this.nurseryTick();
    // stage transitions (sorted so ceremonies read nicely)
    for (const c of this.home()) this.checkStage(c);
    // deaths from age / sickness / injury
    for (const c of this.home()) {
      let p = 0, cause = '';
      if (c.age > 88) { p = (c.age - 88) * 0.006; cause = 'old age'; }
      if (c.sick > 85) { p += 0.3; cause = 'sickness'; }
      if (c.injury > 90) { p += 0.2; cause = 'their wounds'; }
      if (!c.isPlayer && c.stage === 'warrior' && p === 0 && rng.chance(0.004)) { p = 1; cause = rng.pick(['a fall from a tall tree', 'a monster on the Thunderpath', 'a fox attack on patrol', 'a sudden fever', 'the river in flood']); }
      if (c.isPlayer) p *= 0.8;
      if (p > 0 && rng.chance(p)) this.kill(c, cause);
    }
    this.medApprenticeTick();
    this.romanceTick();
    this.politicsTick();
    this.rivalTick();
    // infraction memory fades
    for (const c of this.home()) if (c.infractions > 0 && rng.chance(c.isPlayer ? 0.8 : 0.3)) c.infractions--;
    // following the code is noticed and rewarded
    const pl = this.player;
    if (pl && !pl.exiled && pl.infractions === 0) {
      pl.goodDays = (pl.goodDays ?? 0) + 1;
      pl.reputation = clamp(pl.reputation + 2, -100, 100);
      for (const c of this.home()) if (!c.isPlayer && (c.traits.includes('loyal') || c.traits.includes('serious') || c.role === 'leader' || c.role === 'deputy')) this.adjust(c, pl, 1, undefined, 0);
      if (pl.goodDays % 5 === 0) {
        this.game.ui.toast(`${this.leader && !this.leader.isPlayer ? displayName(this.leader) : 'The clan'} notices how well you keep the code. (+reputation)`, 'good');
        pl.reputation = clamp(pl.reputation + 4, -100, 100);
        this.remember(pl, 'The clan has noticed how faithfully I follow the code.', 2);
      }
    } else if (pl) pl.goodDays = 0;
    this.recentInfractions = Math.max(0, this.recentInfractions - 1);
    // pending decisions expire
    this.pending = this.pending.filter((p) => {
      if (p.expiresDay < day) { this.game.decisions.autoResolve(p); return false; }
      return true;
    });
  }

  /** A medicine cat with no apprentice: now and then a young cat asks to learn from them. */
  private medApprenticeTick() {
    const med = this.medicine;
    if (!med || !med.alive || med.apprentice || this.home().some((x) => x.role === 'medicineApprentice')) return;
    const cands = this.home().filter((x) => x.stage === 'apprentice' && x.role === 'none' && !x.isPlayer && x.age < 10 && (x.pers.kindness > 0.5 || x.traits.includes('curious') || x.traits.includes('kind') || x.traits.includes('calm')));
    if (!cands.length || !simRng.chance(med.isPlayer ? 0.3 : 0.15)) return;
    const ap = simRng.pick(cands);
    const take = () => {
      const old = this.get(ap.mentor);
      if (old && old.apprentice === ap.id) old.apprentice = null;
      ap.role = 'medicineApprentice';
      ap.mentor = med.id;
      med.apprentice = ap.id;
      ap.training = { hunting: 0, tracking: 0, fighting: 0, exploring: 0, territory: 0, rules: 0 };
      this.adjust(ap, med, 12);
      this.log(`${displayName(ap)} left warrior training to become ${displayName(med)}'s medicine cat apprentice.`, 'ceremony');
      this.game.ceremony(`${displayName(ap)} has chosen the path of a medicine cat. ${displayName(med)} will be their mentor.`, [ap.id, med.id]);
    };
    if (med.isPlayer) {
      this.game.ui.choice('🌿 A new apprentice?', `${displayName(ap)} creeps into your den, eyes shining. "I've been watching you heal the clan. I don't want to be a warrior — I want to learn herbs, like you. Will you teach me?"`, [
        { label: `Take ${displayName(ap)} as your apprentice`, action: () => { take(); this.game.notify(`🌿 ${displayName(ap)} is your apprentice now. Talk to them to teach them.`); } },
        { label: 'Not yet', action: () => this.adjust(ap, med, -2) },
      ]);
    } else take();
  }

  /** New mates: the next day the she-cat moves into the nursery, expecting kits. */
  /** Remove the mate label between two cats. Feelings, memories and kits stay exactly as they are. */
  unmate(a: Cat, b: Cat) {
    if (a.mate === b.id) a.mate = null;
    if (b.mate === a.id) b.mate = null;
    a.nurseryDay = undefined; b.nurseryDay = undefined;
    this.log(`${displayName(a)} and ${displayName(b)} are no longer mates.`, 'clan');
  }

  matesFormed(a: Cat, b: Cat) {
    // a medicine cat taking a mate breaks the code: it has to stay secret (60% it never comes out)
    if (isMedCat(a) || isMedCat(b)) {
      const found = simRng.chance(0.4);
      a.medSecret = b.medSecret = true; a.medFound = b.medFound = found; a.medRevealed = b.medRevealed = false;
      if (a.isPlayer || b.isPlayer) this.game.ui.toast('🤫 A medicine cat taking a mate breaks the warrior code! Keep it secret — if the clan finds out, there will be trouble.', 'danger');
    }
    // your own mate: expecting kits right away, straight to the nursery (two she-cats: you carry them)
    if (a.isPlayer || b.isPlayer) { this.playerMateNursery(true); return; }
    if (a.sex === b.sex) return;
    const she = a.sex === 'she' ? a : b;
    she.nurseryDay = this.game.time.day + 1;
  }

  /** You and your mate: the she-cat goes to the nursery (expecting) whenever she has no young kits. */
  /** A grown cat (medicine cats count even if they were never given a warrior ceremony). */
  grownUp(c: Cat): boolean {
    if (c.stage === 'kit') return false;
    if (c.stage === 'apprentice') return c.role === 'medicine' && c.age >= 12;
    return true;
  }

  /** Who carries the kits for you and your mate: the she-cat (for two she-cats, you — unless your mate is already expecting). */
  mateMother(pc: Cat, mate: Cat): Cat | null {
    if (pc.sex !== mate.sex) return pc.sex === 'she' ? pc : mate;
    if (pc.sex !== 'she') return null;
    return mate.labour ? mate : pc;
  }

  playerMateNursery(announce = false) {
    const pc = this.player;
    if (!pc || !pc.alive || pc.exiled) return;
    const mate = this.get(pc.mate) ?? Object.values(this.cats).find((x) => x.mate === pc.id && x.alive);
    if (!mate || !mate.alive || mate.exiled) return;
    if (pc.mate !== mate.id) pc.mate = mate.id;
    if (mate.mate !== pc.id) mate.mate = pc.id;
    // two she-cats: you carry the kits — if your mate was expecting from before, the kits are yours now
    if (pc.sex === 'she' && mate.sex === 'she' && mate.expectingUntil !== null && !mate.labour && pc.expectingUntil === null) {
      pc.expectingUntil = mate.expectingUntil;
      mate.expectingUntil = null;
      mate.nurseryDay = undefined;
      this.game.ui.toast(`🍼 You are the one expecting your and ${displayName(mate)}'s kits! Rest in the nursery.`, 'good');
      this.game.ui.showBanner(`🍼 You are expecting kits with ${displayName(mate)}!`, 7);
    }
    if (pc.sex === 'she' && mate.sex === 'she') mate.nurseryDay = undefined;
    const she = this.mateMother(pc, mate);
    if (!she) { if (announce) this.game.ui.toast('💕 Two toms can\'t have kits of their own — but the nursery kits would love you both!', 'info'); return; }
    if (!this.grownUp(pc) || !this.grownUp(mate) || she.expectingUntil !== null || she.labour) return;
    const who = she.isPlayer ? 'You' : displayName(she);
    const day = this.game.time.day;
    // a rest between litters: the next litter only comes 3 moons after the last one was born
    const last = she.lastLitterDay ?? Math.max(-999, ...she.kits.map((k) => this.get(k)?.bornDay ?? -999));
    const gap = 3;
    if (day - last < gap) { if (announce) this.game.ui.toast(`🍼 ${who} had kits not long ago. New kits can come in ${gap - (day - last)} more moon${gap - (day - last) === 1 ? '' : 's'}.`, 'info'); return; }
    she.nurseryDay = undefined;
    she.expectingUntil = day + 2;
    if (isMedCat(she) && she.medSecret && !she.medRevealed) {
      this.game.ui.toast(she.isPlayer ? '🤫 You\'re expecting kits… but medicine cats can\'t have kits! Hide it, keep working, and don\'t let anyone notice.' : `🤫 ${displayName(she)} is secretly expecting your kits. Medicine cats can't have kits — no one must find out!`, 'danger');
      return;
    }
    this.log(`${displayName(she)} moved into the nursery — she is expecting kits.`, 'clan');
    if (she.isPlayer) {
      this.game.notify(`🍼 You are expecting ${displayName(mate)}'s kits! Go rest in the nursery — they'll arrive in two moons.`);
      this.game.ui.showBanner(`🍼 You are expecting kits with ${displayName(mate)}!`, 7);
    } else {
      this.game.notify(`🍼 Your mate ${displayName(she)} is expecting kits! She is going to the nursery to rest.`);
      this.game.ui.showBanner(`🍼 Your mate ${displayName(she)} is expecting your kits!`, 7);
      const ag = this.game.npcs.agents.get(she.id);
      if (ag) ag.say('I\'m going to rest in the nursery now. Come visit me!', 4);
    }
  }

  nurseryTick() {
    const day = this.game.time.day;
    this.playerMateNursery();
    // mates paired before this was added: the she-cat still gets her turn in the nursery (once)
    for (const c of this.home()) {
      if (c.sex !== 'she' || !c.mate || c.nurseryDay !== undefined || c.expectingUntil !== null || c.stage !== 'warrior') continue;
      const m = this.get(c.mate);
      if (!m || !m.alive || m.sex !== 'tom' || m.mate !== c.id || !(c.isPlayer || m.isPlayer)) continue;
      if (c.kits.some((k) => this.get(k)?.parents.includes(m.id))) continue;
      c.nurseryDay = day;
    }
    for (const c of this.home()) {
      if (c.nurseryDay === undefined || c.nurseryDay > day) continue;
      c.nurseryDay = undefined;
      const m = this.get(c.mate);
      if (!m || !m.alive || c.expectingUntil !== null || c.stage !== 'warrior' || c.kits.some((k) => (this.get(k)?.age ?? 99) < 6)) continue;
      if (m.isPlayer && m.sex === c.sex) continue; // two she-cats: you carry the kits, not her
      c.expectingUntil = day + 2;
      this.log(`${displayName(c)} moved into the nursery — she is expecting ${displayName(m)}'s kits.`, 'clan');
      this.setRecent(`${c.given} is expecting kits!`);
      if (c.isPlayer) {
        this.game.ui.toast('🍼 You\'re expecting kits! Move into the nursery — they\'ll arrive in two moons.', 'good');
        const n = this.game.camp.dens.nursery;
        this.game.objectives.add({ id: 'to-nursery', kind: 'visit', title: '🍼 Move into the nursery', desc: 'You are expecting kits. Make your nest in the nursery, where it is warm and safe.', target: { x: n.x, z: n.z }, radius: 3, need: 1 });
      } else {
        if (m.isPlayer) this.game.ui.toast(`🍼 ${displayName(c)} has moved into the nursery — she\'s expecting your kits!`, 'good');
        const ag = this.game.npcs.agents.get(c.id);
        if (ag) { const n = this.game.camp.dens.nursery; ag.say(simRng.pick(['Time to move into the nursery!', 'I\'m expecting kits!', '*purrs* The nursery will be my den for a while.']), 4); ag.activity = 'idle'; ag.setTarget(n.x, n.z); }
      }
    }
  }

  /** Set a cat to a chosen age (in moons); they move to the right stage with the proper ceremony. */
  setAge(c: Cat, moons: number) {
    const ranked = c.role === 'leader' || c.role === 'deputy' || c.role === 'medicine';
    let m = Math.round(clamp(moons, 0, 150));
    if (ranked && m < 13) m = 13; // leaders, deputies and medicine cats stay grown
    const want = stageForAge(m);
    const old = c.stage;
    c.age = m;
    c.ceremonyDelay = 0;
    if (want === 'kit' && old !== 'kit') {
      if (c.mentor) { const mt = this.get(c.mentor); if (mt && mt.apprentice === c.id) mt.apprentice = null; c.mentor = null; }
      if (c.apprentice) { const ap = this.get(c.apprentice); if (ap && ap.mentor === c.id) { ap.mentor = null; const nm = this.pickMentor(ap); if (nm) { ap.mentor = nm.id; nm.apprentice = ap.id; } } c.apprentice = null; }
      if (c.mate) { const mt = this.get(c.mate); if (mt && mt.mate === c.id) mt.mate = null; c.mate = null; }
      if (c.role === 'medicineApprentice') c.role = 'none';
      c.expectingUntil = null; c.labour = false;
      c.stage = 'kit';
    } else if (want === 'apprentice' && old === 'kit') this.apprenticeCeremony(c);
    else if (want === 'apprentice' && old !== 'apprentice') {
      if (c.apprentice) { const ap = this.get(c.apprentice); if (ap && ap.mentor === c.id) ap.mentor = null; c.apprentice = null; }
      c.stage = 'apprentice';
      const mt = this.pickMentor(c); if (mt) { c.mentor = mt.id; mt.apprentice = c.id; }
    } else if (want === 'warrior' && (old === 'kit' || old === 'apprentice')) {
      if (old === 'kit') c.stage = 'apprentice';
      this.warriorCeremony(c);
    } else if (want === 'warrior' && old === 'elder') c.stage = 'warrior';
    else if (want === 'elder' && old !== 'elder') this.retire(c);
    this.log(`${displayName(c)} is now ${m} moons old.`, 'clan');
    this.game.npcs.syncRoster();
    this.game.npcs.refreshModels();
    if (c.isPlayer) this.game.player.refreshStage();
  }

  checkStage(c: Cat) {
    const want = stageForAge(c.age);
    if (c.stage === 'kit' && c.age >= 6 + (c.ceremonyDelay ?? 0)) this.apprenticeCeremony(c);
    else if (c.isPlayer && c.stage === 'apprentice' && c.age < 12) {
      // a hard-working apprentice can earn their name early
      const ready = LESSONS.every((l) => c.training[l] >= 1) && LESSONS.reduce((s, l) => s + c.training[l], 0) >= 9;
      if (ready && c.age >= 8 && !this.game.objectives.has('assessment')) this.game.training.offerAssessment();
    } else if (c.stage === 'apprentice' && c.age >= 12) {
      const ready = LESSONS.every((l) => c.training[l] >= 1) && LESSONS.reduce((s, l) => s + c.training[l], 0) >= 9;
      if (c.isPlayer) {
        if ((ready || c.age >= 15) && !this.game.objectives.has('assessment')) this.game.training.offerAssessment();
        if (c.age >= 20 && !ready) {
          c.reputation -= 2;
          if (simRng.chance(0.3)) this.game.notify('The clan wonders why your training is taking so long.');
        }
      } else if (ready || c.age > 16) this.warriorCeremony(c);
    } else if (c.isPlayer && c.stage === 'warrior' && c.age >= 80) {
      if (c.age >= 100 && c.role !== 'leader') this.retire(c);
      else if (!this.pending.some((p) => p.kind === 'retire') && (Math.floor(c.age) % 6 === 0 || c.age < 81)) {
        this.game.decisions.push({ id: `retire-${Math.floor(c.age)}`, kind: 'retire', title: 'Your paws grow weary', text: `You have seen ${Math.floor(c.age)} moons. Will you retire to the elders' den${c.role === 'leader' ? ' and hand leadership to your Second' : ''}?`,
          options: [{ id: 'stay', label: 'Not yet — I still have work to do' }, { id: 'retire', label: 'Retire to the elders\' den' }] }, (opt) => {
          if (opt !== 'retire') return;
          if (c.role === 'leader') this.leaderSteppedDown(c, 'retired');
          this.retire(c);
        });
      }
    } else if (c.stage === 'warrior' && want === 'elder' && c.role !== 'leader') {
      if (!c.isPlayer && simRng.chance(0.25 + (c.age - 80) * 0.03)) this.retire(c);
    } else if (c.role === 'leader' && c.age > 100 && !c.isPlayer && simRng.chance(0.2)) this.retire(c);
  }

  private pathAsked = false;

  apprenticeCeremony(c: Cat, mentorOverride?: Cat, path?: 'warrior' | 'medicine') {
    const med = this.medicine;
    // the player chooses their path: warrior or medicine cat
    if (c.isPlayer && !path && !mentorOverride && c.medicinePath && med && med.alive && !med.isPlayer) path = 'medicine';
    if (c.isPlayer && !path && !mentorOverride) {
      if (this.pathAsked) return;
      this.pathAsked = true;
      const medName = med && med.alive ? displayName(med) : null;
      this.game.ui.choice('Your apprentice ceremony', `You have reached six moons. The clan gathers beneath the High Rock. Which path calls to you, ${c.given}kit?`, [
        { label: 'The warrior\'s path', hint: 'hunt, fight, patrol, lead', action: () => { this.pathAsked = false; this.apprenticeCeremony(c, undefined, 'warrior'); } },
        { label: 'The medicine cat\'s path', hint: medName ? `learn herbs and healing from ${medName}` : 'no medicine cat to teach you!', action: () => { this.pathAsked = false; this.apprenticeCeremony(c, undefined, medName ? 'medicine' : 'warrior'); } },
      ]);
      return;
    }
    if (c.isPlayer && path === 'medicine' && med && med.alive && !med.isPlayer) {
      c.stage = 'apprentice';
      c.role = 'medicineApprentice';
      c.mentor = med.id;
      med.apprentice = c.id;
      this.adjust(c, med, 10);
      this.adjust(med, c, 10);
      const leaderName = this.leader ? displayName(this.leader) : 'The clan';
      this.game.ceremony(`${leaderName}: "${displayName(c)}, you have chosen the path of a medicine cat. ${displayName(med)} will teach you the ways of herbs and healing."`, [c.id, med.id]);
      this.log(`${displayName(c)} became ${displayName(med)}'s healer apprentice.`, 'ceremony');
      this.remember(c, `I chose the path of a medicine cat. ${displayName(med)} is my mentor.`, 7);
      c.reputation += 3;
      this.game.onPlayerStageChange();
      return;
    }
    // medicine cats want an apprentice to pass their knowledge on to (a player medicine cat especially)
    const medWants = med && med.alive && !med.apprentice && !this.home().some((x) => x.role === 'medicineApprentice');
    const gentle = c.pers.kindness > 0.55 || c.traits.includes('curious') || c.traits.includes('calm') || c.traits.includes('kind');
    const medApprentice = !c.isPlayer && !!medWants && simRng.chance(med!.isPlayer ? (gentle ? 0.8 : 0.55) : (gentle ? 0.65 : 0.3));
    c.stage = 'apprentice';
    if (medApprentice && med) {
      c.role = 'medicineApprentice';
      c.mentor = med.id;
      med.apprentice = c.id;
      this.adjust(c, med, 10);
      this.game.ceremony(`${displayName(med)} will teach ${displayName(c)} the healer's craft.`, [c.id, med.id]);
      this.log(`${c.given} became ${displayName(med)}'s healer apprentice.`, 'ceremony');
      if (med.isPlayer) {
        this.game.notify(`🌿 ${displayName(c)} is your medicine cat apprentice! Talk to them to teach them herbs and healing.`);
        this.remember(med, `${displayName(c)} became my medicine cat apprentice.`, 6, c.id);
      }
      return;
    }
    // choose mentor
    const leader = this.leader;
    if (!mentorOverride && leader?.isPlayer && !c.isPlayer) {
      this.game.decisions.chooseMentor(c);
      return;
    }
    const mentor = mentorOverride ?? this.pickMentor(c);
    if (mentor) {
      c.mentor = mentor.id;
      mentor.apprentice = c.id;
      this.adjust(c, mentor, 10);
      this.adjust(mentor, c, 8);
    }
    const leaderName = leader ? displayName(leader) : 'The clan';
    const text = mentor
      ? `${leaderName}: "${displayName(c)}, from this moon you are an apprentice. ${displayName(mentor)} will be your mentor."`
      : `${leaderName}: "${displayName(c)}, from this moon you are an apprentice."`;
    this.game.ceremony(text, [c.id, mentor?.id ?? '']);
    this.log(`${c.given} became an apprentice${mentor ? `, mentored by ${displayName(mentor)}` : ''}.`, 'ceremony');
    if (c.isPlayer) {
      this.remember(c, `I became an apprentice. ${mentor ? displayName(mentor) + ' is my mentor.' : ''}`, 6);
      c.reputation += 3;
      this.game.onPlayerStageChange();
    }
    if (mentor?.isPlayer) {
      this.game.notify(`You have been given an apprentice: ${c.given}! Talk to them to begin training.`);
      this.remember(mentor, `I was given ${c.given} as my first apprentice.`, 5, c.id);
    }
  }

  pickMentor(c: Cat): Cat | undefined {
    const leader = this.leader;
    const cands = this.home().filter((w) => w.stage === 'warrior' && !w.apprentice && w.role !== 'medicine' && w.role !== 'leader' && w.id !== c.id);
    if (!cands.length) return undefined;
    const score = (w: Cat) => {
      let s = w.reputation * 0.5 + (w.skills.hunting + w.skills.fighting) * 0.25 + simRng.range(0, 20);
      if (leader) s += this.opinion(leader, w) * 0.3;
      if (c.parents.includes(w.id)) s -= 40; // parents don't mentor their own kits
      if (w.isPlayer) {
        const warriorDays = this.game.time.day - (w.joinedDay ?? 0);
        if (w.reputation < 10 || w.infractions > 2 || warriorDays < 0) s -= 100;
        else s += 10;
      }
      return s;
    };
    return cands.sort((a, b) => score(b) - score(a))[0];
  }

  warriorCeremony(c: Cat, epithet?: string) {
    epithet = epithet ?? c.starName; // the name StarClan chose for them
    const mentor = this.get(c.mentor);
    c.stage = 'warrior';
    if (c.role === 'medicineApprentice') {
      c.stage = 'warrior';
      c.role = 'medicine';
      if (!this.medicine || !this.medicine.alive) this.medicineId = c.id;
    }
    c.epithet = epithet ?? makeEpithet(simRng, c);
    if (mentor) {
      mentor.apprentice = null;
      mentor.mentored++;
      mentor.reputation += 4;
      this.adjust(c, mentor, 8, { text: `${displayName(mentor)} trained me well.`, weight: 4 });
    }
    c.formerMentor = c.mentor;
    c.mentor = null;
    c.joinedDay = this.game.time.day;
    const leader = this.leader;
    const text = c.role === 'medicine' && mentor?.role === 'medicine'
      ? `${displayName(mentor)}: "${c.given}, you have learned the ways of a medicine cat. From this moon you will be known as ${displayName(c)}!"`
      : `${leader ? displayName(leader) : 'The clan'}: "${c.given}, you have earned your warrior name. From this moon you will be known as ${displayName(c)}!"`;
    this.game.ceremony(text, [c.id]);
    this.log(`${c.given} earned the warrior name ${displayName(c)}.`, 'ceremony');
    if (c.isPlayer) {
      c.reputation += 6;
      this.remember(c, `I became a warrior: ${displayName(c)}.`, 8);
      this.game.onPlayerStageChange();
    }
    if (mentor?.isPlayer) {
      this.game.notify(`${displayName(c)} is a warrior now. You trained them well!`);
      this.remember(mentor, `My apprentice ${c.given} became the warrior ${displayName(c)}.`, 6, c.id);
    }
  }

  epithetChoices(c: Cat) { return epithetOptions(c, 3); }

  retire(c: Cat) {
    c.stage = 'elder';
    if (c.apprentice) {
      const ap = this.get(c.apprentice);
      c.apprentice = null;
      if (ap) {
        ap.mentor = null;
        const m = this.pickMentor(ap);
        if (m) { ap.mentor = m.id; m.apprentice = ap.id; }
      }
    }
    if (c.role === 'deputy') { this.deputyId = null; c.role = 'none'; }
    if (c.role === 'leader') this.leaderSteppedDown(c, 'retired to the elders\' den');
    this.log(`${displayName(c)} retired to the elders' den.`, 'clan');
    if (c.isPlayer) {
      this.remember(c, 'I have joined the elders. My paws have earned their rest.', 6);
      this.game.onPlayerStageChange();
    }
  }

  /** Labour begins: the medicine cat hurries to the nursery to help. */
  startLabour(mother: Cat) {
    const g = this.game;
    const secret = isMedCat(mother) && !mother.medRevealed;
    // a medicine cat hiding her kits can't ask another medicine cat for help
    const med = secret ? null : this.medicine && this.medicine.alive && this.medicine.id !== mother.id ? this.medicine : this.home().find((x) => x.role === 'medicineApprentice' && x.id !== mother.id) ?? null;
    if (mother.labour) { this.birth(mother, med); return; } // already waited a whole day
    if (secret && mother.isPlayer) g.ui.toast('🤫 You slip away to a hidden hollow. No one can help you — not even another medicine cat.', 'danger');
    mother.labour = true;
    mother.litterSize = this.rollLitter();
    this.callMate(mother);
    if (mother.litterSize >= 5) setTimeout(() => this.game.ui.toast(`🌿 ${displayName(mother)} is having a BIG litter — ${mother.litterSize === 6 ? 'six' : 'five'} kits! The birth will take ${this.herbsForLitter(5)} herbs. Medicine cats, bring plenty!`, 'objective'), 1500);
    this.game.npcs.agents.get(mother.id)?.say('Oh… I think the kits are coming!', 6);
    if (mother.isPlayer) this.game.ui.showBanner(`${displayName(mother)}: Oh… I think the kits are coming!`, 5);
    if (med?.isPlayer) {
      // you are the medicine cat: go and help
      const n = g.camp.dens.nursery;
      g.ui.toast(`🍼 ${displayName(mother)}'s kits are coming! Hurry to the nursery to help her.`, 'objective');
      g.objectives.add({ id: `birth-${mother.id}`, kind: 'free', title: `🍼 Help ${displayName(mother)} give birth`, desc: `${displayName(mother)} is having her kits! Go to the nursery and talk to her. Bring a poultice or herbs if you have them.`, target: { x: n.x, z: n.z }, radius: 4, need: 1, data: { birthOf: mother.id } });
      g.objectives.focus(`birth-${mother.id}`);
      // if you don't come, the kits arrive anyway by evening
      setTimeout(() => { if (mother.labour && mother.alive) this.birth(mother, null); }, 150000);
      return;
    }
    const ag = med ? g.npcs.agents.get(med.id) : undefined;
    const mAg = g.npcs.agents.get(mother.id);
    const n = g.camp.dens.nursery;
    if (ag) { ag.activity = 'idle'; ag.moveSpeed = 3; ag.setTarget(n.x + 0.6, n.z + 0.6); ag.say(`${mother.given}'s kits are coming! Out of my way!`, 4); }
    if (mother.isPlayer) g.ui.toast(`🍼 Your kits are coming! ${med ? `${displayName(med)} rushes into the nursery to help you.` : 'You curl up in the nursery…'}`, 'objective');
    // a long, hard labour: contractions, yowls and the medicine cat coaching her through it
    const say = (who: Cat | null, text: string) => {
      if (!who || !mother.labour || !mother.alive) return;
      const near = mother.isPlayer || who.isPlayer || Math.hypot(g.player.pos.x - n.x, g.player.pos.z - n.z) < 30;
      g.npcs.agents.get(who.id)?.say(text, 5);
      if (near) g.ui.showBanner(`${displayName(who)}: ${text}`, 4.5);
    };
    const steps: [number, () => void][] = [
      [6000, () => say(mother, '*pants* They\'re coming…')],
      [13000, () => say(mother, simRng.pick(['*yowls* It hurts so much!', '*claws at the moss* Ohhh…', '*gasps* I can\'t— it hurts!']))],
      [20000, () => say(med, simRng.pick([`Breathe, ${mother.given}… slow and steady. You're doing well.`, 'Easy, easy. Breathe with me.']))],
      [27000, () => say(mother, simRng.pick(['*strains and yowls*', '*whimpers* How much longer?', '*pants hard* I\'m so tired…']))],
      [34000, () => say(med, simRng.pick(['Bite down on this stick. Push when the pain comes.', 'Almost there — I can see the first one!']))],
      [41000, () => say(mother, '*one last yowl*')],
      [45000, () => say(med, 'Here comes the first one!')],
      [48000, () => { if (mother.alive && mother.labour) this.birth(mother, med); }],
    ];
    if (mother.isPlayer) g.ui.toast('🍼 Labour has begun. It will take a while… stay in your nest.', 'info');
    for (const [t, fn] of steps) setTimeout(fn, t);
  }

  /** Called when the player medicine cat reaches the queen in labour. */
  /** Litter size: 1–6 kits; big litters of five or six are common. */
  rollLitter(): number { return simRng.weighted<number>([[1, 10], [2, 20], [3, 25], [4, 10], [5, 25], [6, 10]]); }

  /** Herbs a birth needs: a litter of five takes a lot more. */
  herbsForLitter(n: number): number { return n >= 5 ? 4 : n >= 4 ? 2 : 1; }

  /** Use herbs for a birth (your poultices and herbs first, then the medicine den store). Returns how many were missing. */
  private useBirthHerbs(n: number, playerHelped: boolean): number {
    let need = this.herbsForLitter(n);
    if (playerHelped) {
      const pc = this.player;
      for (const k of Object.keys(pc.poultices ?? {})) while (need > 0 && pc.poultices![k] > 0) { pc.poultices![k]--; need -= 2; }
      const h = this.game.player.herbs;
      for (const k of ['silverleaf', 'sunpetal', 'bitterroot'] as const) while (need > 0 && h[k] > 0) { h[k]--; need--; }
    }
    for (const k of ['silverleaf', 'sunpetal', 'bitterroot'] as const) while (need > 0 && this.herbStore[k] > 0) { this.herbStore[k]--; need--; }
    return Math.max(0, need);
  }

  helpBirth(mother: Cat) {
    const g = this.game;
    const pc = this.player;
    g.objectives.list = g.objectives.list.filter((o) => o.id !== `birth-${mother.id}`);
    const poultice = Object.entries(pc.poultices ?? {}).find(([, v]) => v > 0);
    const big = (mother.litterSize ?? 0) >= 5;
    const have = Object.values(pc.poultices ?? {}).reduce((x, v) => x + v * 2, 0) + g.player.herbs.silverleaf + g.player.herbs.sunpetal + g.player.herbs.bitterroot + this.herbTotal();
    g.ui.dialog({ speaker: mother, text: `*panting* ${pc.given}, you came! ${poultice ? 'You press a soothing poultice into her fur and give her a stick to bite on.' : 'You give her a stick to bite on and count her breaths with her.'} "Breathe… breathe… here comes the first one!"${big ? ` (A big litter — this will take ${this.herbsForLitter(5)} herbs. ${have >= this.herbsForLitter(5) ? 'You have enough.' : 'You don\'t have enough… you\'ll do your best.'})` : ''}`, options: [{ label: 'Help the kits into the world', action: () => {
      pc.skills.healing = Math.min(99, pc.skills.healing + 4);
      pc.reputation = clamp(pc.reputation + 4, -100, 100);
      this.adjust(mother, pc, 15, { text: `${pc.given} helped me give birth to my kits.`, weight: 8 });
      this.birth(mother, pc, true);
    } }] });
  }

  birth(mother: Cat, helper: Cat | null = null, playerHelped = false) {
    if (!mother.labour && mother.expectingUntil === null) return;
    mother.labour = false;
    const father = this.get(mother.mate);
    const born = mother.litterSize ?? this.rollLitter();
    mother.litterSize = undefined;
    const herbShort = this.useBirthHerbs(born, playerHelped);
    // not every kit survives being born, and not every queen does either
    const healed = !!helper;
    const secretBirth = isMedCat(mother) && !mother.medRevealed;
    const riskK = secretBirth ? 1.4 : 1; // no other medicine cat to help: 40% more dangerous
    const kitRisk = clamp((0.06 + 0.07 * herbShort + (healed ? 0 : 0.1) - (playerHelped ? 0.03 : 0)) * riskK, 0.02, 0.55);
    let lost = 0;
    for (let i = 0; i < born; i++) if (simRng.chance(kitRisk)) lost++;
    let n = born - lost;
    const queenRisk = clamp((0.03 + 0.05 * herbShort + (healed ? 0 : 0.08) - (playerHelped ? 0.02 : 0)) * (mother.isPlayer ? 0.5 : 1) * riskK, 0.01, 0.42);
    // a weak queen (under half health) almost never survives giving birth
    // under 30 health: no chance at all; under 50: almost certain
    const queenDies = mother.health < 30 || simRng.chance(mother.health < 50 ? 0.9 : queenRisk);
    if (queenDies) mother.fatalBirth = true;
    // if you won't survive, only three kits live — the rest come to StarClan with you
    if (queenDies && mother.isPlayer && n > 3) { lost += n - 3; n = 3; }
    if (queenDies && mother.isPlayer) mother.starKits = Array.from({ length: lost }, () => simRng.pick(GIVEN_NAMES));
    const kits: Cat[] = [];
    for (let i = 0; i < n; i++) {
      const k = createCat({ age: 0, parents: father ? [mother, father] : [mother, mother], day: this.game.time.day, usedNames: this.usedNames });
      k.parents = father ? [mother.id, father.id] : [mother.id];
      k.bornDay = this.game.time.day;
      k.hunger = 80;
      this.cats[k.id] = k;
      kits.push(k);
      mother.kits.push(k.id);
      if (father) father.kits.push(k.id);
      this.rel(k, mother).opinion = 80;
      this.rel(mother, k).opinion = 90;
      if (father) { this.rel(father, k).opinion = 80; this.rel(k, father).opinion = 70; }
    }
    mother.expectingUntil = null;
    mother.lastLitterDay = this.game.time.day;
    if (herbShort > 0) {
      // not enough herbs for a big litter: the queen is worn out and the smallest kits are sickly
      mother.health = Math.max(10, mother.health - 15 * herbShort);
      mother.sick = Math.min(100, (mother.sick ?? 0) + 20 * herbShort);
      for (const k of kits.slice(-Math.min(kits.length, herbShort))) k.sick = 45;
      setTimeout(() => this.game.ui.toast(`🌿 There weren't enough herbs for such a big litter (${herbShort} short). ${displayName(mother)} is worn out and ${Math.min(kits.length, herbShort)} kit${herbShort > 1 ? 's are' : ' is'} sickly — the medicine cat should treat them!`, 'danger'), 2500);
    }
    const names = kits.map((k) => k.given).join(', ') || 'none survived';
    if (lost > 0) {
      this.log(`${lost} of ${displayName(mother)}'s kits did not survive their birth.`, 'death');
      setTimeout(() => this.game.ui.toast(`🕯 ${lost === born ? `None of ${displayName(mother)}'s kits survived their birth.` : `${lost} of ${displayName(mother)}'s kits did not survive their birth.`} They walk with StarClan now.`, 'danger'), 4000);
      for (const c of this.home()) if (c.id === mother.id || c.id === father?.id) this.remember(c, `We lost ${lost} of our kits the day they were born.`, -8);
    }
    if (n > 0) {
      this.log(`${displayName(mother)} welcomed ${n} new kit${n > 1 ? "s" : ""} to the nursery${helper ? ` with ${displayName(helper)}'s help` : ''}: ${names}.`, 'birth');
      this.game.notify(`🍼 New kits in the nursery! ${displayName(mother)}'s litter: ${names}.${helper && !playerHelped ? ` ${displayName(helper)} helped them into the world.` : ''}`);
      if (playerHelped) this.game.ui.toast(`🌿 You helped ${displayName(mother)} give birth to ${n} healthy kit${n > 1 ? 's' : ''}!`, 'good');
      this.setRecent(`${displayName(mother)} had ${n} kits!`);
    }
    if (mother.isPlayer && queenDies) {
      // no time to name them — you're slipping away
      this.remember(mother, `My kits were born: ${names}.`, 10);
    } else if (mother.isPlayer || father?.isPlayer) {
      const me = mother.isPlayer ? mother : father!;
      this.remember(me, `My kits were born: ${names}.`, 10);
      // you get to name your own kits
      const nameNext = (i: number) => {
        if (i >= kits.length) { this.game.npcs.syncRoster(); this.game.npcs.refreshModels(); return; }
        const k = kits[i];
        const pool = isClassic() ? CLASSIC_PREFIXES : GIVEN_NAMES;
        const opts = new Set<string>([k.given]);
        while (opts.size < 3) opts.add(simRng.pick(pool));
        this.game.ui.nameChoice(`Name your kit (${i + 1} of ${kits.length})`, `A tiny ${k.sex === 'tom' ? 'tom' : 'she-cat'} with ${PATTERN_LABEL[k.app.pattern].toLowerCase()} fur and ${(EYE_COLORS.find((e) => e.hex === k.app.eye)?.name ?? 'bright').toLowerCase()} eyes mews at you. What will you call them? (They'll be ___kit.)`,
          [...opts].map((o) => o + 'kit'), (picked) => {
            let nm = picked.replace(/kit$/i, '').trim();
            nm = nm.charAt(0).toUpperCase() + nm.slice(1).toLowerCase();
            if (nm) { this.usedNames.delete(k.given); k.given = nm; this.usedNames.add(nm); }
            nameNext(i + 1);
          });
      };
      nameNext(0);
    } else {
      // a friend (or the cat you helped) asks you to help name one of the kits
      const pc = this.player;
      const close = pc && (this.opinion(mother, pc) >= 50 || isFamily(mother, pc) || playerHelped);
      if (close && pc.alive && !pc.exiled) {
        const k = kits[0];
        const pool = isClassic() ? CLASSIC_PREFIXES : GIVEN_NAMES;
        const opts = new Set<string>([k.given]);
        while (opts.size < 3) opts.add(simRng.pick(pool));
        setTimeout(() => this.game.ui.nameChoice(`${displayName(mother)} asks you to name a kit`, `"Would you name this one for me, ${pc.given}?" A tiny ${k.sex === 'tom' ? 'tom' : 'she-cat'} with ${PATTERN_LABEL[k.app.pattern].toLowerCase()} fur squirms beside ${mother.given}. (They'll be ___kit.)`,
          [...opts].map((o) => o + 'kit'), (picked) => {
            let nm = picked.replace(/kit$/i, '').trim();
            nm = nm.charAt(0).toUpperCase() + nm.slice(1).toLowerCase();
            if (nm) { this.usedNames.delete(k.given); k.given = nm; this.usedNames.add(nm); }
            this.adjust(mother, pc, 6, { text: `${pc.given} named my kit ${nm}kit.`, weight: 4 });
            this.game.npcs.refreshModels();
          }), 1500);
      }
    }
    this.game.npcs.syncRoster();
    // the queen licks her newborns until they're warm and dry, then they snuggle up to nurse
    if (kits.length) this.game.npcs.newbornCare(mother, kits);
    if (secretBirth && kits.length) setTimeout(() => this.hideSecretKits(mother, kits), 9000);
    const roundsTime = this.medicineRounds(mother, kits, helper, lost);
    if (queenDies) setTimeout(() => this.lastWords(mother, helper), roundsTime + 3000);
  }

  /** After a birth the medicine cat treats the queen and each kit in turn: "Hold still, eat this poultice…" */
  private medicineRounds(mother: Cat, kits: Cat[], med: Cat | null, lost = 0): number {
    const g = this.game;
    const healer = med ?? (this.medicine && this.medicine.alive && this.medicine.id !== mother.id ? this.medicine : null);
    if (!healer) return 0;
    const pc = this.player;
    const n = g.camp.dens.nursery;
    const involved = mother.isPlayer || healer.isPlayer || kits.some((k) => k.parents.includes(pc.id));
    if (!involved && Math.hypot(g.player.pos.x - n.x, g.player.pos.z - n.z) > 35) return 0;
    const name = displayName(healer);
    const ag = g.npcs.agents.get(healer.id);
    const line = (text: string, secs = 3.4) => {
      if (g.state !== 'playing') return;
      g.ui.showBanner(`${name}: ${text}`, secs);
      ag?.say(text.replace(/\*[^*]*\*\s*/g, '').trim() || text, secs);
    };
    const steps: string[] = [`"Hold still, ${mother.given}. Eat this poultice — it'll ease the pain."`];
    kits.forEach((k, i) => {
      steps.push(i % 2 === 0
        ? `*licks ${displayName(k)} warm* "Hold still, little one… there you go."`
        : `"Hold still…" *presses a tiny poultice to ${displayName(k)} and licks them warm*`);
    });
    for (let i = 0; i < lost; i++) steps.splice(1 + Math.floor(simRng.next() * (steps.length - 1)) + 1, 0, '*nudges a tiny, still kit… and licks it again and again* …Come on, little one, breathe… *bows head* …I\'m sorry…');
    steps.push(kits.length ? `"${kits.length === 1 ? 'A healthy kit' : `${kits.length} healthy kits`}! Well done, ${mother.given}. Now rest."` : `"I'm so sorry, ${mother.given}… I did everything I could."`);
    steps.forEach((t, i) => setTimeout(() => line(t), 1800 + i * 3600));
    return 1800 + steps.length * 3600;
  }

  kill(c: Cat, cause: string) {
    if (!c.alive || c.ghost) return;
    // dying while expecting: your unborn kits come to StarClan with you
    if (c.isPlayer && (c.expectingUntil !== null || c.labour) && !c.fatalBirth) {
      const n = c.litterSize ?? this.rollLitter();
      c.starKits = [...(c.starKits ?? []), ...Array.from({ length: n }, () => simRng.pick(GIVEN_NAMES))];
      c.expectingUntil = null; c.labour = false;
    }
    c.alive = false;
    c.deathDay = this.game.time.day;
    c.deathCause = cause;
    c.health = 0;
    const name = displayName(c);
    if (c.clan === 'home') {
      // her young kits still need milk: another queen takes them in
      const orphans = c.kits.map((k) => this.get(k)).filter((k): k is Cat => !!k && k.alive && k.age < 6 && k.parents?.[0] === c.id);
      if (orphans.length) {
        const queens = this.home().filter((q) => q.id !== c.id && q.alive && q.sex === 'she' && !q.isPlayer && isQueen(q, (id) => this.get(id)));
        const foster = queens[0] ?? this.home().find((q) => q.id !== c.id && q.alive && q.sex === 'she' && q.stage === 'warrior' && q.role === 'none' && !q.isPlayer);
        if (foster) {
          foster.fosterKits = [...(foster.fosterKits ?? []), ...orphans.map((k) => k.id)];
          for (const k of orphans) { k.foster = foster.id; this.rel(foster, k).opinion = Math.max(this.rel(foster, k).opinion, 70); }
          setTimeout(() => this.game.notify(`🍼 ${displayName(foster)} will nurse ${name}'s kits as her own.`), 6000);
          this.log(`${displayName(foster)} took in ${name}'s kits to nurse them.`, 'clan');
        }
      }
      this.log(`${name} died of ${cause}. They walk the Long Meadow now.`, 'death');
      this.setRecent(`${name} has died.`);
      // grief & memories
      for (const o of this.home()) {
        const op = o.relations[c.id]?.opinion ?? 0;
        if (op > 40 || isFamily(o, c) || o.mate === c.id) this.remember(o, `${name} died of ${cause}. I miss ${pronoun(c, 'obj')}.`, -6, c.id);
      }
      if (c.mate) { const m = this.get(c.mate); if (m && m.mate === c.id) { m.mate = null; m.widowOf = c.id; } }
      if (c.apprentice) {
        const ap = this.get(c.apprentice);
        c.apprentice = null;
        if (ap && ap.alive) {
          ap.mentor = null;
          const m = this.pickMentor(ap);
          if (m) { ap.mentor = m.id; m.apprentice = ap.id; this.log(`${displayName(m)} took over ${ap.given}'s training.`, 'clan'); }
        }
      }
      if (c.mentor) { const m = this.get(c.mentor); if (m && m.apprentice === c.id) m.apprentice = null; }
      if (this.deputyId === c.id) { this.deputyId = null; }
      if (this.medicineId === c.id) {
        this.medicineId = null;
        const ap = this.home().find((x) => x.role === 'medicine' && x.alive) ?? this.home().find((x) => x.role === 'medicineApprentice');
        if (ap) { ap.role = 'medicine'; if (ap.stage === 'apprentice') ap.stage = 'warrior'; this.medicineId = ap.id; this.log(`${displayName(ap)} is now the clan's healer.`, 'politics'); }
      }
      if (this.leaderId === c.id) this.leaderSteppedDown(c, 'died');
      if (!c.isPlayer) this.game.notify(`${name} has died (${cause}).`, 'death');
    }
    this.game.npcs.onCatDied(c);
    this.game.afterlife?.onCatDied(c);
    if (!c.isPlayer) this.game.vigils?.onDeath(c, cause);
    if (c.isPlayer) this.game.onPlayerDeath(cause);
  }

  // ------------------------------------------------------------- romance
  private romanceTick() {
    const adults = this.home().filter((c) => c.stage === 'warrior' && c.age >= 14);
    // off-screen courtship: each single adult warms to a favourite single clanmate
    for (const a of adults) {
      if (a.mate || a.isPlayer || (a.widowOf && !a.freeToLove)) continue;
      let best: Cat | null = null, bs = -1e9;
      for (const b of adults) {
        if (b === a || b.mate || b.isPlayer || isFamily(a, b)) continue;
        const sc = this.opinion(a, b) + compatibility(a, b) * 30 + this.rel(a, b).romance * 0.5 + simRng.range(0, 15);
        if (sc > bs) { bs = sc; best = b; }
      }
      if (!best || this.opinion(a, best) < 10) continue;
      const k = 4 + compatibility(a, best) * 5;
      this.rel(a, best).romance = clamp(this.rel(a, best).romance + simRng.range(1, k), 0, 100);
      this.rel(best, a).romance = clamp(this.rel(best, a).romance + simRng.range(0, k * 0.8), 0, 100);
      this.adjust(a, best, 2.5);
      this.adjust(best, a, 2);
    }
    for (const a of adults) {
      if (a.mate) continue;
      for (const b of adults) {
        if (a === b || b.mate || a.isPlayer || b.isPlayer || isFamily(a, b)) continue;
        if ((a.widowOf && !a.freeToLove) || (b.widowOf && !b.freeToLove)) continue; // still grieving their lost mate
        const ra = this.rel(a, b), rb = this.rel(b, a);
        if (ra.romance > 38 && rb.romance > 32 && ra.opinion > 30 && rb.opinion > 25) {
          a.mate = b.id;
          b.mate = a.id;
          this.matesFormed(a, b);
          this.log(`${displayName(a)} and ${displayName(b)} became mates.`, 'clan');
          this.setRecent(`${displayName(a)} and ${displayName(b)} are mates now!`);
          break;
        }
      }
    }
    // expecting kits
    const size = this.home().length;
    for (const c of this.home()) {
      if (c.sex !== 'she' || !c.mate || c.expectingUntil !== null || c.age < 14 || c.age > 75 || c.stage !== 'warrior') continue;
      const m = this.get(c.mate);
      if (!m || !m.alive || m.sex !== 'tom') continue;
      const young = c.kits.some((k) => (this.get(k)?.age ?? 99) < 6);
      if (young) continue;
      let p = 0.22 * (this.game.time.season === 'winter' ? 0.6 : 1) * (size > 40 ? 0.2 : size > 34 ? 0.45 : size > 29 ? 0.75 : size < 18 ? 2 : 1.2) * (this.food < size * 0.5 ? 0.5 : 1);
      if (c.isPlayer || m.isPlayer) p *= 1.5;
      // a quiet nursery: couples are much more likely to start a litter
      const kitsNow = this.home().filter((k) => k.stage === 'kit').length;
      if (kitsNow < 8) p *= 2.2;
      if (simRng.chance(p)) {
        c.expectingUntil = this.game.time.day + 2;
        this.log(`${displayName(c)} is expecting ${displayName(m)}'s kits.`, 'clan');
        if (c.isPlayer) this.game.notify('You are expecting kits! They will arrive in two moons. Rest in the nursery when you can.');
        if (m.isPlayer) this.game.notify(`${displayName(c)} is expecting your kits!`);
      }
    }
  }

  // ------------------------------------------------------------- politics
  private electLeader() {
    const cands = this.home().filter((x) => x.stage === 'warrior' && (x.role === 'none' || x.role === 'deputy'));
    const best = this.deputy ?? cands.sort((a, b) => this.leadershipScore(b) - this.leadershipScore(a))[0];
    if (!best) return;
    if (best.role === 'deputy') this.deputyId = null;
    best.role = 'leader';
    this.leaderId = best.id;
    this.log(`${displayName(best)} became the clan's Warden.`, 'politics');
    this.game.notify(`${displayName(best)} is the clan's new Warden.`, 'politics');
    if (best.isPlayer) this.game.onPlayerRoleChange();
  }

  leaderSteppedDown(c: Cat, how: string) {
    const was = displayName(c);
    if (c.alive && c.role === 'leader') c.role = 'none';
    this.leaderId = null;
    const dep = this.deputy;
    if (dep && dep.alive && !dep.exiled) {
      dep.role = 'leader';
      this.leaderId = dep.id;
      this.deputyId = null;
      dep.reputation = Math.max(dep.reputation, 40);
      this.log(`${was} ${how}. ${displayName(dep)} became the new Warden after a night's vigil at the Stargazing Stone.`, 'politics');
      this.game.notify(`${displayName(dep)} is the clan's new Warden.`, 'politics');
      this.setRecent(`${displayName(dep)} is our new Warden.`);
      if (dep.isPlayer) {
        this.remember(dep, 'I became the Warden of the clan. The clan\'s fate rests on my shoulders.', 12);
        this.game.onPlayerRoleChange();
      }
    } else {
      // senior warriors choose
      const cands = this.home().filter((x) => x.stage === 'warrior' && x.role === 'none');
      const best = cands.sort((a, b) => this.leadershipScore(b) - this.leadershipScore(a))[0];
      if (best) {
        best.role = 'leader';
        this.leaderId = best.id;
        this.log(`${was} ${how}. With no Second, the senior warriors chose ${displayName(best)} as Warden.`, 'politics');
        this.game.notify(`${displayName(best)} is the clan's new Warden.`, 'politics');
        if (best.isPlayer) {
          this.remember(best, 'The warriors chose me to lead the clan.', 12);
          this.game.onPlayerRoleChange();
        }
      }
    }
  }

  leadershipScore(c: Cat) {
    const others = this.home().filter((o) => o !== c);
    const approval = others.reduce((s, o) => s + this.opinion(o, c), 0) / Math.max(1, others.length);
    return c.reputation * 0.8 + approval * 0.8 + (c.skills.fighting + c.skills.hunting + c.skills.knowledge) * 0.12 + c.mentored * 8 + c.deeds * 3 + c.pers.ambition * 10 - c.infractions * 8;
  }

  approvalOf(c: Cat) {
    const others = this.home().filter((o) => o !== c && o.stage !== 'kit');
    return others.reduce((s, o) => s + this.opinion(o, c), 0) / Math.max(1, others.length);
  }

  appointDeputy(c: Cat, byPlayer = false) {
    const old = this.deputy;
    if (old && old !== c) old.role = 'none';
    c.role = 'deputy';
    this.deputyId = c.id;
    const leader = this.leader;
    this.log(`${leader ? displayName(leader) : 'The clan'} named ${displayName(c)} the new Second.`, 'politics');
    this.game.ceremony(`${leader ? displayName(leader) : 'The Warden'}: "I name ${displayName(c)} as Second of ${clanTitle(this.game.territories.homeName)}."`, [c.id]);
    this.setRecent(`${displayName(c)} is the new Second.`);
    if (c.isPlayer) {
      this.remember(c, 'I was named Second of the clan.', 10);
      this.game.onPlayerRoleChange();
    }
    // reactions
    for (const o of this.home()) {
      if (o === c) continue;
      if (o.pers.ambition > 0.65 && o.stage === 'warrior') this.adjust(o, c, -8, { text: `${displayName(c)} was made Second instead of me.`, weight: -3 });
      else if (this.opinion(o, c) > 20) this.adjust(o, c, 3);
      if (byPlayer && leader) this.adjust(o, leader, this.opinion(o, c) > 10 ? 3 : -4);
    }
  }

  private politicsTick() {
    const leader = this.leader;
    if (!leader) {
      this.electLeader();
      return;
    }
    // appoint deputy
    if (!this.deputy) {
      if (leader.isPlayer) {
        if (!this.pending.some((p) => p.kind === 'deputy')) this.game.decisions.chooseDeputy();
      } else {
        const cands = this.home().filter((c) => c.stage === 'warrior' && c.role === 'none' && !c.exiled && c.age >= 14);
        const score = (c: Cat) => {
          let s = this.leadershipScore(c) * 0.6 + this.opinion(leader, c) * 0.9 + (c.mentored > 0 ? 25 : 0) + simRng.range(0, 15);
          if (c.isPlayer && (c.reputation < 20 || c.infractions > 1)) s -= 200;
          return s;
        };
        const best = cands.sort((a, b) => score(b) - score(a))[0];
        if (best) this.appointDeputy(best);
      }
    }
    // unpopular leader can be pressured to step down
    const approval = this.approvalOf(leader);
    if (approval < -25) this.unpopularDays++;
    else this.unpopularDays = Math.max(0, this.unpopularDays - 1);
    if (this.unpopularDays >= 4 && this.deputy) {
      this.unpopularDays = 0;
      this.log(`The clan lost faith in ${displayName(leader)}. The warriors demanded a new Warden.`, 'politics');
      if (leader.isPlayer) {
        this.remember(leader, 'The clan forced me to step down. I lost their trust.', -12);
        this.game.notify('The clan has lost faith in you. You are no longer Warden.', 'politics');
      }
      leader.role = 'none';
      leader.reputation -= 20;
      this.leaderSteppedDown(leader, 'was forced to step down');
      if (leader.isPlayer) this.game.onPlayerRoleChange();
    }
    // player deputy may be demoted for misconduct
    const dep = this.deputy;
    if (dep?.isPlayer && dep.infractions >= 4) {
      dep.role = 'none';
      this.deputyId = null;
      this.log(`${displayName(dep)} was stripped of the rank of Second.`, 'politics');
      this.remember(dep, 'I lost my place as Second because I kept breaking the code.', -10);
      this.game.notify('You have been stripped of your rank as Second.', 'politics');
      this.game.onPlayerRoleChange();
    }
    // cats leaving: deeply unhappy cats may go
    for (const c of this.home(false)) {
      if (c.stage !== 'warrior' || c.role !== 'none') continue;
      const op = this.opinion(c, leader);
      if (op < -55 && simRng.chance(0.08)) {
        c.exiled = false;
        c.clan = 'loner';
        this.log(`${displayName(c)} left the clan, unwilling to follow ${displayName(leader)}.`, 'clan');
        this.game.notify(`${displayName(c)} has left the clan.`);
        this.game.npcs.onCatLeft(c);
      }
    }
  }

  private rivalTick() {
    for (const r of this.rivals) {
      for (const c of this.rivalCats(r.index)) {
        c.age += 1;
        if (c.age > 90 && simRng.chance(0.1)) { c.alive = false; c.deathDay = this.game.time.day; }
      }
      this.populateRival(r.index);
      r.attitude = clamp(r.attitude + simRng.range(-3, 3) + (0 - r.attitude) * 0.03, -100, 100);
      r.strength = clamp(r.strength + simRng.range(-2, 2), 20, 90);
    }
  }

  // ------------------------------------------------------------- patrols
  organizePatrols() {
    const hour = Math.floor(this.game.time.hour);
    this.patrols = this.patrols.filter((p) => p.state !== 'done');
    const organizer = this.deputy ?? this.leader;
    if (organizer?.isPlayer) {
      this.game.decisions.organizePatrols();
      return;
    }
    this.autoPatrols(hour);
  }

  autoPatrols(hour: number, forced?: { kind: 'hunt' | 'border'; members: string[] }[]) {
    const busy = (c: Cat) => { const a = this.game.npcs.agents.get(c.id); return !!a && this.game.npcs.busyWithPlayer(a); };
    const avail = this.home().filter((c) => !busy(c) && (c.stage === 'warrior' || c.stage === 'apprentice') && c.role !== 'medicine' && c.role !== 'medicineApprentice' && c.injury < 40 && c.sick < 40 && !c.expectingUntil && !this.patrols.some((p) => p.members.includes(c.id)));
    const pool = simRng.shuffle(avail.filter((c) => !c.isPlayer));
    const plans: { kind: 'hunt' | 'border'; members: string[] }[] = forced ?? [];
    if (!forced) {
      const hunts = this.food < this.home().length * 0.8 ? 3 : 2;
      const take = (n: number) => pool.splice(0, n).map((c) => c.id);
      plans.push({ kind: 'border', members: take(3) });
      for (let i = 0; i < hunts; i++) plans.push({ kind: 'hunt', members: take(2) });
      // include apprentices with their mentors
      for (const p of plans) {
        for (const id of [...p.members]) {
          const c = this.get(id);
          const ap = this.get(c?.apprentice);
          if (ap && !ap.isPlayer && pool.includes(ap)) { p.members.push(ap.id); pool.splice(pool.indexOf(ap), 1); }
        }
      }
      // maybe include the player
      const pl = this.player;
      if (pl && (pl.stage === 'warrior' || pl.stage === 'apprentice') && pl.role !== 'medicine' && pl.role !== 'medicineApprentice' && !pl.exiled && pl.injury < 40 && simRng.chance(0.55) && !this.game.objectives.busy()) {
        const p = plans.find((x) => x.members.length > 0 && (pl.stage !== 'apprentice' || x.members.includes(pl.mentor ?? '')));
        const target = p ?? plans[0];
        if (target && target.members.length) target.members.push(pl.id);
      }
    }
    for (const plan of plans) {
      if (!plan.members.length) continue;
      const patrol: Patrol = {
        id: `p${this.game.time.day}_${hour}_${plan.kind}_${Math.floor(simRng.next() * 1000)}`,
        kind: plan.kind,
        members: plan.members,
        leaderId: plan.members.find((m) => !this.get(m)?.isPlayer && this.get(m)?.stage === 'warrior') ?? plan.members[0],
        startHour: this.game.time.totalHours,
        day: this.game.time.day,
        state: 'forming',
      };
      this.patrols.push(patrol);
      if (patrol.members.includes(this.playerId)) this.game.objectives.joinPatrol(patrol);
    }
    this.game.npcs.onPatrolsChanged();
  }

  // ------------------------------------------------------------- rules
  /** Player broke a rule. Witnesses are cat ids that saw it. */
  infraction(rule: RuleId, witnesses: string[], detail?: string, force = false) {
    const p = this.player;
    if (!p || p.exiled) return;
    const sev = RULES[rule].severity * 0.5;
    const seen = witnesses.length > 0;
    // only what is actually seen counts — no surprise punishments
    if (!seen) return;
    // a cat in good standing gets the benefit of the doubt
    if (!force && p.reputation >= 10 && p.infractions === 0 && simRng.chance(0.7)) {
      const w = this.get(witnesses[0]);
      this.game.ui.toast(`${w ? displayName(w) : 'A clanmate'} saw that, but lets it go: "Just don't do it again, alright?" (${RULES[rule].text})`, 'info');
      p.reputation = clamp(p.reputation - 1, -100, 100);
      return;
    }
    p.infractions++;
    this.recentInfractions++;
    p.reputation = clamp(p.reputation - sev, -100, 100);
    const text = `I broke the code: ${RULES[rule].text}${detail ? ' (' + detail + ')' : ''}`;
    this.log(`${seen ? 'Seen' : 'Found out'}: ${RULES[rule].text}`, 'rule');
    for (const id of witnesses) {
      const w = this.get(id);
      if (!w) continue;
      const strict = w.traits.includes('loyal') || w.traits.includes('serious') || w.role === 'leader' || w.role === 'deputy';
      const lenient = w.traits.includes('mischievous') || w.traits.includes('playful');
      this.adjust(w, p, strict ? -sev : lenient ? -0.5 : -sev * 0.5, { text: `I saw ${p.given} break the code.`, weight: -2 });
    }
    this.remember(p, text, -2);
    this.game.consequence(rule);
  }

  playerReputationLabel(): string {
    const r = this.player?.reputation ?? 0;
    if (r > 70) return 'Revered';
    if (r > 40) return 'Respected';
    if (r > 15) return 'Trusted';
    if (r > -10) return 'Ordinary';
    if (r > -40) return 'Doubted';
    return 'Disgraced';
  }

  // ------------------------------------------------------------- loners
  addLoner(c: Cat, joined: boolean) {
    this.cats[c.id] = c;
    if (joined) {
      c.clan = 'home';
      c.joinedDay = this.game.time.day;
      if (c.stage === 'kit' || c.stage === 'apprentice') { /* nothing */ }
      this.log(`${displayName(c)} joined the clan.`, 'clan');
      this.game.npcs.syncRoster();
    }
  }
}
