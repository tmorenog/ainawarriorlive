// Procedural event engine. Events are chosen by weighted, condition-aware
// rolls every game hour, never in a fixed order, and they change the actual
// world: water levels, prey, weather, burned forest, fallen trees, the clan.
import type { Game } from '../game';
import { simRng } from '../core/rng';
import { clamp, dist2 } from '../core/math';
import { createCat } from '../cats/generate';
import { Cat, displayName } from '../cats/types';
import { BASE_WATER } from '../world/terrain';
import type { Creature } from '../wildlife/creatures';
import type { Fighter } from '../player/combat';
import type { Fire } from '../world/fire';

export type EventType =
  | 'fire' | 'flood' | 'drought' | 'storm' | 'coldSnap' | 'badger' | 'fox' | 'dog' | 'shortage' | 'fallenTree'
  | 'rockslide' | 'loner' | 'illness' | 'rivalSkirmish' | 'gathering' | 'abandonedKit' | 'npcInfraction' | 'deathberries';

export interface ActiveEvent {
  id: string;
  type: EventType;
  start: number; // totalHours
  end: number; // totalHours
  data: any;
}

const MAJOR: EventType[] = ['fire', 'flood', 'drought', 'storm', 'coldSnap', 'badger', 'illness', 'rivalSkirmish', 'shortage'];

export class EventSystem {
  active: ActiveEvent[] = [];
  cooldown: Partial<Record<EventType, number>> = {};
  waterTarget = BASE_WATER;
  private scentMarks: { x: number; z: number; text: string; hour: number }[] = [];
  heavyRainHours = 0;
  searchParties = false;
  rationing = false;

  constructor(private game: Game) {}

  isActive(t: EventType) { return this.active.some((e) => e.type === t); }
  get(t: EventType) { return this.active.find((e) => e.type === t); }

  preyAbundance(): number {
    const s = this.game.time.season;
    let a = s === 'spring' ? 1 : s === 'summer' ? 1.1 : s === 'autumn' ? 0.9 : 0.7;
    if (this.isActive('drought')) a *= 0.45;
    if (this.isActive('shortage')) a *= 0.5;
    if (this.isActive('coldSnap')) a *= 0.7;
    return a;
  }

  // ------------------------------------------------------------ scheduling
  tickHour() {
    const game = this.game;
    const t = game.time;
    const now = t.totalHours;
    // heavy rain bookkeeping for floods
    if (game.weather.p.rain > 0.7) this.heavyRainHours++;
    else this.heavyRainHours = Math.max(0, this.heavyRainHours - 0.5);
    // expire events
    for (const e of [...this.active]) {
      this.hourly(e);
      if (now >= e.end) this.finish(e);
    }
    // gathering every 4th night
    if (t.day % 4 === 2 && Math.floor(t.hour) === 20 && !this.isActive('gathering')) this.startGathering();
    // random events
    if (game.clan.player?.exiled && simRng.chance(0.5)) return;
    const majorActive = this.active.some((e) => MAJOR.includes(e.type));
    if (simRng.chance(0.075)) {
      const type = this.pick(majorActive);
      if (type) this.trigger(type);
    }
    // flood from sustained heavy rain
    if (this.heavyRainHours > 5 && !this.isActive('flood') && !this.isActive('drought') && simRng.chance(0.25)) this.trigger('flood');
  }

  private ready(t: EventType) {
    return (this.cooldown[t] ?? -1) < this.game.time.day;
  }

  private pick(majorActive: boolean): EventType | null {
    const g = this.game;
    const s = g.time.season;
    const w = g.weather;
    const drought = this.isActive('drought');
    const opts: [EventType, number][] = [
      ['fox', 3], ['fallenTree', w.p.wind > 0.6 ? 3 : 1], ['deathberries', g.clan.home().some((c) => c.stage === 'kit' && !c.isPlayer) && g.time.season !== 'winter' ? 0.7 : 0], ['loner', g.clan.home().length > 26 ? 0.2 : g.clan.home().length < 15 ? 3 : 1.2], ['npcInfraction', 1.2], ['abandonedKit', 0.3],
      ['dog', 0.8], ['rockslide', w.p.rain > 0.5 ? 1.2 : 0.4],
    ];
    if (!majorActive) {
      opts.push(
        ['fire', s === 'summer' ? (drought ? 3 : 0.8) : s === 'autumn' ? 0.3 : 0.05],
        ['drought', s === 'summer' ? 1 : 0],
        ['storm', s === 'winter' ? 0.3 : 1.2],
        ['coldSnap', s === 'winter' ? 1.8 : s === 'autumn' ? 0.3 : 0],
        ['badger', 0.9],
        ['illness', s === 'winter' ? 1.5 : 0.5],
        ['rivalSkirmish', 1.1 + Math.max(0, -Math.min(...g.clan.rivals.map((r) => r.attitude))) / 60],
        ['shortage', s === 'winter' ? 1 : 0.5],
        ['flood', (s === 'spring' || s === 'autumn') && !drought ? 0.5 : 0],
      );
    }
    const filtered = opts.filter(([t, wgt]) => wgt > 0 && this.ready(t) && !this.isActive(t));
    if (!filtered.length) return null;
    return simRng.weighted(filtered);
  }

  trigger(type: EventType, force = false): boolean {
    const g = this.game;
    const t = g.time;
    const now = t.totalHours;
    const add = (hours: number, data: any = {}) => {
      const e: ActiveEvent = { id: `${type}${Math.floor(now)}`, type, start: now, end: now + hours, data };
      this.active.push(e);
      return e;
    };
    const cool = (days: number) => { this.cooldown[type] = t.day + days; };
    const clan = g.clan;
    switch (type) {
      case 'fire': {
        const ang = simRng.range(0, Math.PI * 2);
        const d = simRng.range(45, 170);
        const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
        if (g.terrain.sample(x, z).river > 0 || g.chunks.waterDepthAt(x, z) > 0) return false;
        g.fire.start(x, z, simRng.range(26, 46));
        add(40, { x, z });
        cool(12);
        g.ui.toast('🔥 Smoke on the wind! A fire has broken out in the forest!', 'danger');
        clan.log('A forest fire broke out in the territory.', 'event');
        clan.setRecent('There\'s a fire in the forest!');
        g.audio.alarm();
        if (d < 90) g.decisions.fireResponse(x, z);
        return true;
      }
      case 'flood': {
        const rise = simRng.range(1.1, 1.8);
        add(20, { rise });
        this.waterTarget = BASE_WATER + rise;
        cool(8);
        g.ui.toast('🌊 The river is bursting its banks! Low ground is flooding!', 'danger');
        clan.log('Floodwater swept through the low ground.', 'event');
        clan.setRecent('The river flooded!');
        g.decisions.floodResponse();
        // strand a cat
        setTimeout(() => this.strandCat(), 8000);
        return true;
      }
      case 'drought': {
        add(24 * simRng.range(3, 5));
        this.waterTarget = BASE_WATER - 1.0;
        g.weather.force('sunny', 12);
        cool(10);
        g.ui.toast('☀️ Drought. Streams are shrinking and prey is scarce.', 'event');
        clan.log('A drought began. The streams shrank and prey grew thin.', 'event');
        clan.setRecent('The streams are drying up.');
        g.decisions.droughtResponse();
        return true;
      }
      case 'storm': {
        add(simRng.range(5, 9));
        g.weather.force('thunderstorm', 7);
        cool(3);
        g.ui.toast('⛈️ A great storm is rolling in!', 'event');
        clan.log('A violent storm lashed the forest.', 'event');
        return true;
      }
      case 'coldSnap': {
        add(24 * simRng.range(1, 2.5));
        g.weather.force('snow', 16);
        cool(6);
        g.ui.toast('❄️ A bitter cold snap grips the forest.', 'event');
        clan.log('A cold snap froze the forest. The elders shivered in their den.', 'event');
        return true;
      }
      case 'badger': {
        const ang = simRng.range(0, Math.PI * 2);
        const x = Math.cos(ang) * 70, z = Math.sin(ang) * 70;
        const b = g.creatures.spawn('badger', x, z, { goal: { x: g.camp.dens.nursery.x, z: g.camp.dens.nursery.z }, tag: 'badger' });
        add(10, { id: b.id });
        cool(6);
        g.ui.toast('🦡 A badger is heading for the camp!', 'danger');
        clan.log('A badger came toward the camp.', 'event');
        clan.setRecent('A badger was seen near camp!');
        g.audio.alarm();
        g.objectives.add({ id: 'badger', kind: 'drive', title: 'Defend the camp', desc: 'A badger is heading for the nursery. Drive it off!', target: { x, z }, targetId: b.id, need: 1, reward: { rep: 12 } });
        return true;
      }
      case 'fox': {
        const p = g.player.pos;
        if (Math.hypot(p.x, p.z) < 25) return false;
        const ang = simRng.range(0, Math.PI * 2);
        g.creatures.spawn('fox', p.x + Math.cos(ang) * 30, p.z + Math.sin(ang) * 30);
        this.scentMarks.push({ x: p.x, z: p.z, text: 'Fresh fox scent lingers here.', hour: g.time.totalHours });
        cool(1);
        return true;
      }
      case 'dog': {
        const p = g.player.pos;
        const houses = g.chunks.structuresNear(p.x, p.z, 120).filter((s) => s.type === 'house');
        const o = g.territories.ownerAt(p.x, p.z);
        if (!houses.length && o === 'home') return false;
        const ang = simRng.range(0, Math.PI * 2);
        const c = g.creatures.spawn('dog', p.x + Math.cos(ang) * 40, p.z + Math.sin(ang) * 40);
        c.state = 'stalk';
        c.fightTarget = g.player;
        c.chase = 18;
        g.ui.toast('🐕 Barking! A dog is loose and coming your way!', 'danger');
        cool(2);
        return true;
      }
      case 'shortage':
        add(24 * 3);
        cool(8);
        g.ui.toast('🐾 Prey has become scarce across the territory.', 'event');
        clan.log('Prey grew scarce.', 'event');
        clan.setRecent('The prey is running thin.');
        return true;
      case 'fallenTree': {
        const ang = simRng.range(0, Math.PI * 2);
        const d = simRng.range(30, 150);
        const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
        if (g.chunks.waterDepthAt(x, z) > 0) return false;
        g.mods.logs.push({ x, z, rot: simRng.range(0, Math.PI), len: simRng.range(7, 13), day: t.day });
        g.chunks.invalidateArea(x, z, 10);
        g.audio.crash();
        clan.log('A great tree crashed down in the territory, blocking an old path.', 'event');
        if (dist2(x, z, g.player.pos.x, g.player.pos.z) < 60) g.ui.toast('🌲 CRACK! A tree came crashing down nearby!', 'event');
        cool(1);
        // chance a cat was hurt
        for (const a of g.npcs.agents.values()) {
          if (dist2(a.pos.x, a.pos.z, x, z) < 8 && simRng.chance(0.5)) {
            a.cat.injury = clamp(a.cat.injury + 35, 0, 100);
            clan.log(`${a.name} was hurt by the falling tree.`, 'event');
          }
        }
        return true;
      }
      case 'rockslide': {
        const pts = g.chunks.spawnPointsNear(g.player.pos.x, g.player.pos.z, 20, 150).filter((s) => s.biome === 'rocky' || s.biome === 'mountain' || s.biome === 'hills');
        if (!pts.length) return false;
        const sp = simRng.pick(pts);
        g.mods.rockslides.push({ x: sp.x, z: sp.z, r: simRng.range(5, 9), day: t.day });
        g.chunks.invalidateArea(sp.x, sp.z, 12);
        g.audio.crash();
        clan.log('A rockslide tumbled down the slopes.', 'event');
        if (dist2(sp.x, sp.z, g.player.pos.x, g.player.pos.z) < 30) {
          g.ui.toast('⛰️ Rocks tumble down the slope!', 'danger');
          if (dist2(sp.x, sp.z, g.player.pos.x, g.player.pos.z) < 8) {
            const c = clan.player;
            c.health -= 25;
            c.injury = clamp(c.injury + 25, 0, 100);
            g.ui.hurtFlash();
          }
        }
        cool(3);
        return true;
      }
      case 'loner': {
        const loner = createCat({ age: simRng.range(10, 50), clan: 'loner', day: t.day, usedNames: clan.usedNames });
        clan.cats[loner.id] = loner;
        const a = g.npcs.spawnOutsider(loner, g.camp.entrance.x + simRng.range(-4, 4), g.camp.entrance.z + 12, false, 'idle');
        a.moveSpeed = 1.2;
        a.setTarget(g.camp.entrance.x, g.camp.entrance.z + 3);
        a.userHome = { x: g.camp.entrance.x, z: g.camp.entrance.z + 5 };
        add(8, { id: loner.id });
        cool(3);
        clan.log(`A loner named ${loner.given} appeared at the camp entrance, asking to join.`, 'event');
        g.ui.toast(`A loner, ${loner.given}, waits at the camp entrance.`, 'event');
        g.decisions.lonerArrives(loner);
        return true;
      }
      case 'illness': {
        const cats = simRng.shuffle(clan.home().filter((c) => !c.isPlayer || simRng.chance(0.3))).slice(0, simRng.int(2, 4));
        for (const c of cats) c.sick = clamp(c.sick + simRng.range(35, 60), 0, 100);
        add(24 * 3, { ids: cats.map((c) => c.id) });
        cool(8);
        const names = cats.map((c) => displayName(c)).join(', ');
        g.ui.toast(`🦠 Coughing spreads through the camp. Sick: ${names}.`, 'danger');
        clan.log(`Sickness struck: ${names} fell ill.`, 'event');
        clan.setRecent('Sickness is spreading in camp.');
        g.decisions.illnessResponse();
        if (!clan.player.exiled) g.objectives.add({ id: 'herbs', kind: 'herbs', title: 'Gather healing herbs', desc: 'The healer needs herbs — sunpetal and bitterroot help most. Bring them to the medicine den.', need: 3, reward: { rep: 8 } });
        return true;
      }
      case 'rivalSkirmish': {
        const r = simRng.pick(g.clan.rivals);
        const def = g.territories.rivals[r.index];
        const p = g.player.pos;
        const bd = g.territories.homeBorderDist(p.x, p.z);
        add(4, { rival: r.index });
        cool(4);
        r.attitude = clamp(r.attitude - 10, -100, 100);
        if (Math.abs(bd) < 70 && !clan.player.exiled && clan.player.stage !== 'kit') {
          // play it out near the player
          const ang = Math.atan2(def.cz - p.z, def.cx - p.x);
          this.spawnRivals(r.index, p.x + Math.cos(ang) * 25, p.z + Math.sin(ang) * 25, simRng.int(2, 3), true);
          g.ui.toast(`⚔️ A ${def.name} patrol is crossing the border!`, 'danger');
          clan.log(`${def.name} warriors crossed the border near ${clan.player.given}.`, 'event');
        } else {
          // off-screen skirmish
          const home = clan.home().filter((c) => c.stage === 'warrior' && !c.isPlayer);
          const strength = home.length * 5 + clan.borderSafety * 0.4;
          const win = simRng.chance(clamp(strength / (strength + r.strength), 0.2, 0.85));
          const hurt = simRng.pick(home);
          if (hurt) hurt.injury = clamp(hurt.injury + simRng.range(20, 50), 0, 100);
          clan.log(win ? `Our warriors drove a ${def.name} patrol back across the border.` : `A ${def.name} patrol pushed past our border markers before withdrawing.`, 'event');
          g.ui.toast(win ? `Warriors fought off a ${def.name} patrol at the border.` : `${def.name} cats raided our border!`, 'event');
          clan.setRecent(win ? `We beat back ${def.name}!` : `${def.name} raided our border.`);
          if (!win) g.clan.food = Math.max(0, g.clan.food - 1);
          g.decisions.rivalResponse(r.index);
        }
        return true;
      }
      case 'abandonedKit': {
        const kit = createCat({ age: simRng.range(1, 3), day: t.day, usedNames: clan.usedNames });
        kit.parents = [];
        clan.cats[kit.id] = kit;
        const queen = clan.home().find((c) => c.sex === 'she' && c.kits.some((k) => (clan.get(k)?.age ?? 99) < 6));
        clan.addLoner(kit, true);
        if (queen) {
          queen.kits.push(kit.id);
          clan.log(`A patrol found an abandoned kit, ${kit.given}, near the Tallfolk fields. ${displayName(queen)} took them in.`, 'birth');
        } else {
          clan.log(`A patrol found an abandoned kit, ${kit.given}, near the Tallfolk fields.`, 'birth');
          g.decisions.fosterKit(kit);
        }
        g.ui.toast(`A lost kit, ${kit.given}, was brought to camp.`, 'event');
        cool(15);
        return true;
      }
      case 'npcInfraction': {
        const cands = clan.home(false).filter((c) => c.stage !== 'kit' && (c.pers.mischief > 0.4 || c.pers.aggression > 0.55 || c.pers.loyalty < 0.4));
        if (!cands.length) return false;
        const c = simRng.pick(cands);
        const crime = simRng.pick(['ate before the elders', 'crossed into rival territory to hunt', 'skipped a patrol', 'picked a fight with a clanmate', 'left camp at night without leave']);
        clan.log(`${displayName(c)} ${crime}.`, 'rule');
        c.reputation -= 5;
        g.decisions.punishNpc(c, crime);
        cool(2);
        return true;
      }
      case 'deathberries': {
        const kits = clan.home(false).filter((c) => c.stage === 'kit' || c.stage === 'apprentice');
        if (!kits.length) return false;
        const k = simRng.pick(kits);
        k.sick = clamp(k.sick + 85, 0, 100);
        add(8, { id: k.id });
        cool(6);
        clan.log(`${displayName(k)} ate deathberries!`, 'event');
        clan.setRecent(`${displayName(k)} ate deathberries!`);
        g.ui.toast(`☠ ${displayName(k)} ate deathberries! The medicine cat needs herbs — quickly!`, 'danger');
        g.audio.alarm();
        const ka = g.npcs.agents.get(k.id);
        if (ka) { ka.activity = 'sleep'; ka.actTimer = 999; ka.target = null; ka.say('My tummy hurts…', 4); }
        if (!clan.player.exiled) g.objectives.add({ id: 'berry-kit', kind: 'free', title: `Save ${displayName(k)}`, desc: `${displayName(k)} ate deathberries! Follow the compass to them. Pick any healing herb on the way, then talk to ${k.given} to make them retch the berries up.`, need: 1, deadline: g.time.totalHours + 8, reward: { rep: 10 }, data: { follow: k.id }, target: ka ? { x: ka.pos.x, z: ka.pos.z } : undefined });
        g.objectives.focus?.('berry-kit');
        return true;
      }
      case 'gathering':
        return this.startGathering();
    }
    void force;
    return false;
  }

  private strandCat() {
    const g = this.game;
    const flood = this.get('flood');
    if (!flood) return;
    const cands = [...g.npcs.agents.values()].filter((a) => a.cat.clan === 'home' && a.cat.stage !== 'elder' && a.activity !== 'fight');
    if (!cands.length) return;
    const a = simRng.pick(cands);
    // find a spot near the river but above water level (a small island / bank)
    const r = g.terrain;
    let spot: { x: number; z: number } | null = null;
    for (let i = 0; i < 80 && !spot; i++) {
      const ang = simRng.range(0, Math.PI * 2);
      const d = simRng.range(40, 120);
      const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
      const s = r.sample(x, z);
      if (s.bank > 0.3 && s.river < 0.1 && s.h > this.waterTarget - 0.3 && s.h < this.waterTarget + 0.4) spot = { x, z };
    }
    if (!spot) return;
    g.npcs.endConvo(a);
    a.patrol = null;
    a.pos.set(spot.x, g.groundAt(spot.x, spot.z), spot.z);
    a.activity = 'stranded';
    a.target = null;
    flood.data.stranded = a.id;
    g.clan.log(`${a.name} was trapped by the floodwater!`, 'event');
    g.ui.toast(`${a.name} is trapped by the flood! Follow their cries (sniff with Q).`, 'danger');
    g.objectives.add({ id: 'rescue', kind: 'rescue', title: `Rescue ${a.name}`, desc: `${a.name} is stranded by the floodwater. Reach them and lead them back to camp.`, target: { ...spot }, targetId: a.id, need: 1, reward: { rep: 15 } });
  }

  spawnRivals(index: number, x: number, z: number, n: number, hostile: boolean, activity: 'rivalPatrol' | 'gathering' = 'rivalPatrol') {
    const g = this.game;
    const cats = simRng.shuffle(g.clan.rivalCats(index).filter((c) => c.stage !== 'kit' && !g.npcs.agents.has(c.id))).slice(0, n);
    for (const c of cats) {
      const a = g.npcs.spawnOutsider(c, x + simRng.range(-3, 3), z + simRng.range(-3, 3), hostile, activity);
      a.userHome = { x, z };
      if (hostile && activity === 'rivalPatrol') a.userAggressive = this.isActive('rivalSkirmish');
    }
  }

  private startGathering(): boolean {
    const g = this.game;
    const t = g.time;
    const clan = g.clan;
    const e: ActiveEvent = { id: `gathering${t.day}`, type: 'gathering', start: t.totalHours, end: t.totalHours + 5, data: { spawned: false, spoke: 0 } };
    this.active.push(e);
    g.npcs.gatheringActive = true;
    const leader = clan.leader;
    const cands = clan.home().filter((c) => (c.stage === 'warrior' || c.stage === 'apprentice') && c.injury < 50 && c.sick < 50);
    const attendees = new Set<string>();
    if (leader) attendees.add(leader.id);
    if (clan.deputy) attendees.add(clan.deputy.id);
    for (const c of simRng.shuffle(cands.slice()).slice(0, 5)) attendees.add(c.id);
    const p = clan.player;
    const chosen = p && !p.exiled && p.stage !== 'kit' && p.reputation > -5 && (p.confinedUntil ?? -1) <= t.day && (simRng.chance(0.65) || p.role !== 'none');
    if (chosen) attendees.add(p.id);
    else attendees.delete(p.id);
    e.data.attendees = [...attendees];
    for (const id of attendees) {
      const a = g.npcs.agents.get(id);
      if (!a) continue;
      g.npcs.endConvo(a);
      a.patrol = null;
      a.activity = 'gathering';
      a.target = null;
    }
    clan.log('Tonight the clans meet in peace at the Council Stones.', 'event');
    if (chosen) {
      g.ui.toast('🌕 Gathering tonight! You have been chosen to attend at the Council Stones.', 'event');
      const c = g.territories.council;
      g.objectives.add({ id: 'gathering', kind: 'visit', title: 'Attend the Gathering', desc: 'Travel with your clanmates to the Council Stones. The clans meet in peace tonight.', target: { x: c.x, z: c.z }, need: 1, radius: 16, reward: { rep: 3 }, deadline: t.totalHours + 5 });
    } else if (p && !p.exiled) {
      g.ui.toast('🌕 The Gathering is tonight. You were not chosen to go.', 'info');
    }
    return true;
  }

  gatheringTruce(x: number, z: number) {
    if (!this.isActive('gathering')) return false;
    const c = this.game.territories.council;
    return Math.hypot(x - c.x, z - c.z) < 40;
  }

  // ------------------------------------------------------------ hourly & per-frame
  private hourly(e: ActiveEvent) {
    const g = this.game;
    const clan = g.clan;
    switch (e.type) {
      case 'flood':
        if (g.time.totalHours > e.end - 6) this.waterTarget = BASE_WATER;
        if (this.searchParties && e.data.stranded && g.time.totalHours - e.start > 6 && simRng.chance(0.25)) {
          const a = g.npcs.agents.get(e.data.stranded);
          if (a && a.activity === 'stranded') {
            a.activity = 'idle';
            a.setTarget(0, 5);
            clan.log(`A search party brought ${a.name} home from the flood.`, 'event');
            g.ui.toast(`A search party rescued ${a.name}.`, 'event');
            g.objectives.fail('rescue', true);
            e.data.stranded = null;
          }
        }
        break;
      case 'illness':
        // spread in camp
        for (const c of clan.home()) {
          if (c.sick > 30) {
            const other = simRng.pick(clan.home());
            if (other.sick < 10 && simRng.chance(0.08)) other.sick = 30;
          }
        }
        break;
      case 'coldSnap':
        for (const c of clan.home()) if (c.stage === 'elder' && simRng.chance(0.05)) c.sick = clamp(c.sick + 15, 0, 100);
        break;
      case 'drought':
        g.weather.force(simRng.chance(0.8) ? 'sunny' : 'windy', 4);
        if (simRng.chance(0.03) && !g.fire.active) this.trigger('fire');
        break;
      case 'storm':
        if (simRng.chance(0.2)) this.trigger('fallenTree');
        if (simRng.chance(0.05) && g.time.season === 'summer' && !g.fire.active) this.trigger('fire');
        break;
      case 'gathering': {
        const h = g.time.hour;
        if (h >= 22 && h < 23.8 && !e.data.spoke) e.data.spoke = 1;
        break;
      }
    }
  }

  update(dt: number) {
    const g = this.game;
    // water level eases toward target
    const cur = g.chunks.waterLevel;
    const tgt = this.waterTarget + (g.weather.p.rain > 0.7 ? 0.15 : 0);
    if (Math.abs(cur - tgt) > 0.001) g.chunks.setWaterLevel(cur + clamp(tgt - cur, -dt * 0.02, dt * 0.02));
    const gat = this.get('gathering');
    if (gat) this.gatheringUpdate(gat, dt);
    // rescue follow-through
    const flood = this.get('flood');
    if (flood?.data.stranded) {
      const a = g.npcs.agents.get(flood.data.stranded);
      if (a && a.activity === 'follow' && Math.hypot(a.pos.x, a.pos.z) < 20) {
        a.activity = 'idle';
        a.followTarget = null;
        const c = a.cat;
        const p = clan(g);
        g.clan.adjust(c, p, 40, { text: `${p.given} saved me from the flood. I owe them my life.`, weight: 10 });
        for (const o of g.clan.home()) if (o !== p && (o.parents.includes(c.id) || c.parents.includes(o.id) || o.mate === c.id)) g.clan.adjust(o, p, 20, { text: `${p.given} saved ${c.given} from the flood.`, weight: 5 });
        p.deeds++;
        g.clan.remember(p, `I rescued ${a.name} from the floodwater.`, 8, c.id);
        g.objectives.complete('rescue');
        g.ui.toast(`${a.name} is safe! The clan won't forget this.`, 'good');
        flood.data.stranded = null;
      }
    }
  }

  private gatheringUpdate(e: ActiveEvent, dt: number) {
    const g = this.game;
    const c = g.territories.council;
    const d = dist2(g.player.pos.x, g.player.pos.z, c.x, c.z);
    if (!e.data.spawned && d < 110) {
      e.data.spawned = true;
      for (const r of g.clan.rivals) {
        const def = g.territories.rivals[r.index];
        const ang = Math.atan2(def.cz - c.z, def.cx - c.x);
        this.spawnRivals(r.index, c.x + Math.cos(ang) * 8, c.z + Math.sin(ang) * 8, simRng.int(3, 4), false, 'gathering');
      }
    }
    if (e.data.spoke === 1 && d < 40) {
      e.data.spoke = 2;
      this.gatheringSpeeches();
    }
    void dt;
  }

  private gatheringSpeeches() {
    const g = this.game;
    const clan = g.clan;
    const lines: [string, string][] = [];
    for (const r of clan.rivals) {
      const def = g.territories.rivals[r.index];
      const leader = clan.rivalCats(r.index).find((c) => c.role === 'leader');
      const news = r.attitude < -30 ? `${def.name} warns every clan: stay off our land.` : r.strength > 65 ? `${def.name} is strong. Our prey runs well and we have new apprentices.` : simRng.pick([`${def.name} has had a hard moon, but we endure.`, `Twolegs... Tallfolk dogs have been seen near ${def.name} land.`, `${def.name} welcomes new kits this season.`]);
      if (leader) lines.push([leader.id, news]);
    }
    const hl = clan.leader;
    if (hl) lines.push([hl.id, `${g.territories.homeName} is ${clan.food > clan.home().length ? 'well fed' : 'hungry but strong'}. ${clan.lastRecent || 'All is well.'}`]);
    lines.forEach(([id, text], i) => {
      setTimeout(() => {
        const a = g.npcs.agents.get(id);
        a?.say(text, 7);
        if (a) g.clan.log(`At the Gathering, ${a.name} said: "${text}"`, 'event');
      }, 1500 + i * 7500);
    });
    for (const r of clan.rivals) r.attitude = clamp(r.attitude + 3, -100, 100);
  }

  private finish(e: ActiveEvent) {
    const g = this.game;
    this.active.splice(this.active.indexOf(e), 1);
    switch (e.type) {
      case 'flood':
        this.waterTarget = BASE_WATER;
        g.clan.log('The floodwater drained away.', 'event');
        if (e.data.stranded) {
          const a = g.npcs.agents.get(e.data.stranded);
          if (a) {
            if (simRng.chance(0.35)) g.clan.kill(a.cat, 'the flood');
            else { a.activity = 'idle'; g.clan.log(`${a.name} struggled home after the flood, exhausted.`, 'event'); a.cat.injury = 40; }
          }
          g.objectives.fail('rescue');
        }
        g.decisions.clearFlood();
        break;
      case 'drought':
        this.waterTarget = BASE_WATER;
        g.clan.log('Rain returned and the drought ended.', 'event');
        g.weather.force('rain', 6);
        break;
      case 'illness':
        g.clan.log('The sickness in camp has passed.', 'event');
        g.objectives.fail('herbs', true);
        break;
      case 'shortage':
        g.clan.log('Prey is returning to the forest.', 'event');
        break;
      case 'deathberries': {
        const k = g.clan.get(e.data.id);
        if (k && k.alive) {
          const helped = k.sick < 50 || (g.clan.medicine && simRng.chance(0.5));
          if (helped) { k.sick = 0; g.clan.log(`${displayName(k)} recovered from the deathberries.`, 'event'); }
          else g.clan.kill(k, 'deathberries');
        }
        g.objectives.fail('berry-kit', true);
        break;
      }
      case 'badger':
        g.objectives.fail('badger', true);
        break;
      case 'gathering':
        g.npcs.gatheringActive = false;
        g.objectives.fail('gathering', true);
        break;
      case 'loner': {
        const a = g.npcs.agents.get(e.data.id);
        if (a && a.cat.clan === 'loner') { a.activity = 'leaving'; a.setTarget(a.pos.x, a.pos.z + 150); a.actTimer = 40; }
        break;
      }
    }
  }

  fireEnded(f: Fire) {
    const g = this.game;
    const e = this.get('fire');
    if (e) this.active.splice(this.active.indexOf(e), 1);
    g.npcs.evacuate = null;
    g.clan.log('The fire burned itself out, leaving blackened earth behind. In time the forest will return.', 'event');
    g.ui.toast('The fire is out. The forest is scarred, but it will regrow.', 'event');
    g.objectives.fail('escort', true);
    void f;
  }

  creatureDrivenOff(c: Creature, by: Fighter) {
    const g = this.game;
    if (c.eventTag === 'badger') {
      const e = this.get('badger');
      if (e) this.active.splice(this.active.indexOf(e), 1);
      g.clan.log(`The badger was driven away from camp${by.kind === 'player' ? ` by ${g.clan.player.given}` : ''}.`, 'event');
      g.clan.setRecent('We drove off the badger!');
      if (by.kind === 'player' || dist2(g.player.pos.x, g.player.pos.z, c.pos.x, c.pos.z) < 20) {
        const p = g.clan.player;
        p.deeds++;
        g.clan.remember(p, 'I helped drive a badger away from the nursery.', 7);
        for (const o of g.clan.home()) if (o !== p) g.clan.adjust(o, p, 6);
        g.objectives.complete('badger');
      }
    } else if (by.kind === 'player') {
      g.ui.toast(`You drove off the ${c.name.toLowerCase()}!`, 'good');
      const p = g.clan.player;
      p.reputation = clamp(p.reputation + 3, -100, 100);
      g.clan.remember(p, `I drove off a ${c.name.toLowerCase()}.`, 3);
    }
  }

  onBorderMarked(x: number, z: number, patrol: { members: string[] }) {
    void x; void z; void patrol;
  }

  onTrespass(owner: number) {
    const g = this.game;
    const r = g.clan.rivals[owner];
    r.attitude = clamp(r.attitude - 3, -100, 100);
    this.scentMarks.push({ x: g.player.pos.x, z: g.player.pos.z, text: '', hour: g.time.totalHours });
    // rival patrol may find the player
    if (simRng.chance(0.55)) {
      const p = g.player.pos;
      const def = g.territories.rivals[owner];
      const ang = Math.atan2(def.cz - p.z, def.cx - p.x) + simRng.range(-0.6, 0.6);
      setTimeout(() => {
        if (g.territories.ownerAt(g.player.pos.x, g.player.pos.z) === owner) this.spawnRivals(owner, g.player.pos.x + Math.cos(ang) * 22, g.player.pos.z + Math.sin(ang) * 22, simRng.int(1, 3), true);
      }, simRng.range(4000, 12000));
    }
  }

  staleScents(x: number, z: number): string {
    const now = this.game.time.totalHours;
    this.scentMarks = this.scentMarks.filter((s) => now - s.hour < 12);
    const s = this.scentMarks.find((m) => m.text && dist2(m.x, m.z, x, z) < 25);
    const o = this.game.territories.homeBorderDist(x, z);
    if (s) return s.text;
    if (Math.abs(o) < 12) return 'The border scent-marks are here' + (this.game.clan.borderSafety < 30 ? ', faded and stale.' : ', fresh and strong.');
    return '';
  }

  serialize() {
    return { active: this.active, cooldown: this.cooldown, waterTarget: this.waterTarget, fires: this.game.fire.serialize() };
  }
  load(d: any) {
    this.active = (d.active ?? []).filter((e: ActiveEvent) => !['badger', 'loner', 'gathering', 'rivalSkirmish'].includes(e.type));
    for (const e of this.active) if (e.type === 'flood') e.data.stranded = null;
    this.cooldown = d.cooldown ?? {};
    this.waterTarget = d.waterTarget ?? BASE_WATER;
    this.game.fire.load(d.fires ?? []);
  }
}

function clan(g: Game): Cat { return g.clan.player; }
