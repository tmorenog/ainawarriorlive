// Clan simulation: population, aging, ceremonies, births, deaths, food,
// politics (leader/deputy), reputation and the clan code.
import type { Game } from '../game';
import { clanTitle } from '../lore';
import { Cat, LESSONS, Lesson, Relation, displayName, pronoun } from '../cats/types';
import { createCat, epithetOptions, makeEpithet, personalityFrom, stageForAge } from '../cats/generate';
import { BOOK_CATS, BookCat, isClassic } from '../lore';
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

export type RuleId = 'kitLeaveCamp' | 'crossBorder' | 'feedClanFirst' | 'obeyOrders' | 'helpOutsiders' | 'dangerZones' | 'confinement';
export const RULES: Record<RuleId, { text: string; severity: number }> = {
  kitLeaveCamp: { text: 'Kits must not leave the camp.', severity: 4 },
  crossBorder: { text: "Do not hunt or trespass on another clan's land.", severity: 7 },
  feedClanFirst: { text: 'Feed the kits, elders and queens before yourself.', severity: 5 },
  obeyOrders: { text: 'Obey the Warden, the Second and your mentor.', severity: 6 },
  helpOutsiders: { text: 'Do not aid cats of other clans without the Warden\'s leave.', severity: 5 },
  dangerZones: { text: 'Stay clear of Tallfolk dens and roads.', severity: 3 },
  confinement: { text: 'A cat confined to camp must stay there.', severity: 8 },
};

export const RIVAL_CAT_COUNT = 10;

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
    return Object.values(this.cats).filter((c) => c.alive && c.clan === 'home' && !c.exiled && (includePlayer || !c.isPlayer));
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
    r.opinion = clamp(r.opinion + dOpinion, -100, 100);
    r.familiarity = clamp(r.familiarity + dFam, 0, 100);
    if (memory) this.remember(a, memory.text, memory.weight, b.id);
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
    for (let i = 0; i < 9; i++) warriors.push(mk(rng.range(14, 60)));
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
    if (isClassic()) this.seedBookCats(playerCat);
    this.log(`You were born into ${clanTitle(this.game.territories.homeName)}, the kit of ${displayName(mother)} and ${displayName(father)}.`, 'birth');
    this.log(`${displayName(leader)} leads the clan as Warden, with ${displayName(deputy)} as Second.`, 'politics');
  }

  /** Classic mode: famous cats from the books take their places in each clan. */
  private seedBookCats(player: Cat) {
    const protectedIds = new Set([player.id, ...player.parents]);
    const apply = (c: Cat, b: BookCat) => {
      c.given = b.prefix;
      c.epithet = b.stage === 'apprentice' ? null : b.suffix;
      c.sex = b.sex;
      c.age = b.age;
      c.traits = b.traits.slice();
      c.pers = personalityFrom(c.traits, simRng);
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
      if (c.injury > 0) c.injury = Math.max(0, c.injury - (c.role === 'medicine' ? 1.2 : 0.6) - (this.medicine ? 0.4 : 0));
      if (c.sick > 0) {
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
  tickDay() {
    const day = this.game.time.day;
    const rng = simRng;
    const home = this.home();
    for (const c of home) {
      c.age += 1;
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
      if (c.expectingUntil !== null && day >= c.expectingUntil) this.birth(c);
    }
    // stage transitions (sorted so ceremonies read nicely)
    for (const c of this.home()) this.checkStage(c);
    // deaths from age / sickness / injury
    for (const c of this.home()) {
      let p = 0, cause = '';
      if (c.age > 88) { p = (c.age - 88) * 0.006; cause = 'old age'; }
      if (c.sick > 85) { p += 0.3; cause = 'sickness'; }
      if (c.injury > 90) { p += 0.2; cause = 'their wounds'; }
      if (c.isPlayer) p *= 0.8;
      if (p > 0 && rng.chance(p)) this.kill(c, cause);
    }
    this.romanceTick();
    this.politicsTick();
    this.rivalTick();
    // infraction memory fades
    for (const c of this.home()) if (c.infractions > 0 && rng.chance(0.3)) c.infractions--;
    this.recentInfractions = Math.max(0, this.recentInfractions - 1);
    // pending decisions expire
    this.pending = this.pending.filter((p) => {
      if (p.expiresDay < day) { this.game.decisions.autoResolve(p); return false; }
      return true;
    });
  }

  checkStage(c: Cat) {
    const want = stageForAge(c.age);
    if (c.stage === 'kit' && c.age >= 6 + (c.ceremonyDelay ?? 0)) this.apprenticeCeremony(c);
    else if (c.stage === 'apprentice' && c.age >= 12) {
      const ready = LESSONS.every((l) => c.training[l] >= 1) && LESSONS.reduce((s, l) => s + c.training[l], 0) >= 9;
      if (c.isPlayer) {
        if ((ready || c.age >= 18) && !this.game.objectives.has('assessment')) this.game.training.offerAssessment();
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
    const medApprentice = !c.isPlayer && med && !med.apprentice && (c.pers.kindness > 0.6 || c.traits.includes('curious')) && simRng.chance(0.5);
    c.stage = 'apprentice';
    if (medApprentice && med) {
      c.role = 'medicineApprentice';
      c.mentor = med.id;
      med.apprentice = c.id;
      this.game.ceremony(`${displayName(med)} will teach ${c.given} the healer's craft.`, [c.id, med.id]);
      this.log(`${c.given} became ${displayName(med)}'s healer apprentice.`, 'ceremony');
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

  birth(mother: Cat) {
    const father = this.get(mother.mate);
    const n = simRng.weighted<number>([[1, 2], [2, 4], [3, 3], [4, 1]]);
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
    const names = kits.map((k) => k.given).join(', ');
    this.log(`${displayName(mother)} gave birth to ${n} kit${n > 1 ? 's' : ''}: ${names}.`, 'birth');
    this.game.notify(`New kits in the nursery! ${displayName(mother)}'s litter: ${names}.`);
    this.setRecent(`${displayName(mother)} had ${n} kits!`);
    if (mother.isPlayer || father?.isPlayer) {
      const me = mother.isPlayer ? mother : father!;
      this.remember(me, `My kits were born: ${names}.`, 10);
    }
    this.game.npcs.syncRoster();
  }

  kill(c: Cat, cause: string) {
    if (!c.alive) return;
    c.alive = false;
    c.deathDay = this.game.time.day;
    c.deathCause = cause;
    c.health = 0;
    const name = displayName(c);
    if (c.clan === 'home') {
      this.log(`${name} died of ${cause}. They walk the Long Meadow now.`, 'death');
      this.setRecent(`${name} has died.`);
      // grief & memories
      for (const o of this.home()) {
        const op = o.relations[c.id]?.opinion ?? 0;
        if (op > 40 || isFamily(o, c) || o.mate === c.id) this.remember(o, `${name} died of ${cause}. I miss ${pronoun(c, 'obj')}.`, -6, c.id);
      }
      if (c.mate) { const m = this.get(c.mate); if (m && m.mate === c.id) m.mate = null; }
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
        if (ap) { ap.role = 'medicine'; this.medicineId = ap.id; this.log(`${displayName(ap)} is now the clan's healer.`, 'politics'); }
      }
      if (this.leaderId === c.id) this.leaderSteppedDown(c, 'died');
      if (!c.isPlayer) this.game.notify(`${name} has died (${cause}).`, 'death');
    }
    this.game.npcs.onCatDied(c);
    if (c.isPlayer) this.game.onPlayerDeath(cause);
  }

  // ------------------------------------------------------------- romance
  private romanceTick() {
    const adults = this.home().filter((c) => c.stage === 'warrior' && c.age >= 14);
    // off-screen courtship: each single adult warms to a favourite single clanmate
    for (const a of adults) {
      if (a.mate || a.isPlayer) continue;
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
        const ra = this.rel(a, b), rb = this.rel(b, a);
        if (ra.romance > 45 && rb.romance > 38 && ra.opinion > 35 && rb.opinion > 30) {
          a.mate = b.id;
          b.mate = a.id;
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
      let p = 0.09 * (this.game.time.season === 'winter' ? 0.5 : 1) * (size > 34 ? 0.03 : size > 29 ? 0.35 : size > 24 ? 0.8 : size < 18 ? 2.2 : 1.3) * (this.food < size * 0.5 ? 0.35 : 1);
      if (c.isPlayer || m.isPlayer) p *= 1.5;
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
      if (pl && (pl.stage === 'warrior' || pl.stage === 'apprentice') && !pl.exiled && pl.injury < 40 && simRng.chance(0.55) && !this.game.objectives.busy()) {
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
  infraction(rule: RuleId, witnesses: string[], detail?: string) {
    const p = this.player;
    if (!p || p.exiled) return;
    const sev = RULES[rule].severity;
    const seen = witnesses.length > 0;
    const discovered = seen || simRng.chance(0.3);
    if (!discovered) return;
    p.infractions++;
    this.recentInfractions++;
    p.reputation = clamp(p.reputation - sev * (seen ? 1 : 0.6), -100, 100);
    const text = `I broke the code: ${RULES[rule].text}${detail ? ' (' + detail + ')' : ''}`;
    this.log(`${seen ? 'Seen' : 'Found out'}: ${RULES[rule].text}`, 'rule');
    for (const id of witnesses) {
      const w = this.get(id);
      if (!w) continue;
      const strict = w.traits.includes('loyal') || w.traits.includes('serious') || w.role === 'leader' || w.role === 'deputy';
      const lenient = w.traits.includes('mischievous') || w.traits.includes('playful');
      this.adjust(w, p, strict ? -sev * 1.2 : lenient ? -1 : -sev * 0.6, { text: `I saw ${p.given} break the code.`, weight: -2 });
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
