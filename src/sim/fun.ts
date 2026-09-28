// Little things to do around the territory: races, elders' stories, treasures, basking and stargazing.
import type { Game } from '../game';
import type { NpcAgent } from '../ai/npc';
import type { Cat } from '../cats/types';
import { CatModel } from '../cats/model';
import { displayName } from '../cats/types';
import { TREASURE_INFO, TreasureKind } from '../world/chunks';
import { simRng } from '../core/rng';
import { clamp } from '../core/math';

const STAGE_SPEED: Record<string, number> = { kit: 0.55, apprentice: 0.85, warrior: 1, elder: 0.7 };

export class FunActivities {
  race: { rival: NpcAgent; target: { x: number; z: number; name: string }; t: number; started: boolean } | null = null;
  constructor(private game: Game) {}

  // ------------------------------------------------------------ racing
  startRace(a: NpcAgent) {
    const g = this.game;
    const p = g.player.pos;
    const inCamp = Math.hypot(p.x, p.z) < 17.5;
    let target: { x: number; z: number; name: string };
    if (inCamp) {
      const far = [
        { x: g.camp.highRock.x, z: g.camp.highRock.z + 1.5, name: 'the High Rock' },
        { x: g.camp.pile.x, z: g.camp.pile.z, name: 'the fresh-kill pile' },
        { x: g.camp.dens.elders.x, z: g.camp.dens.elders.z, name: 'the elders\' den' },
        { x: g.camp.dens.nursery.x, z: g.camp.dens.nursery.z, name: 'the nursery' },
      ].sort((u, v) => Math.hypot(v.x - p.x, v.z - p.z) - Math.hypot(u.x - p.x, u.z - p.z));
      target = far[0];
    } else {
      const lm = g.territories.landmarks
        .map((l) => ({ l, d: Math.hypot(l.x - p.x, l.z - p.z) }))
        .filter((x) => x.d > 20 && x.d < 90)
        .sort((u, v) => u.d - v.d)[0];
      target = lm ? { x: lm.l.x, z: lm.l.z, name: lm.l.name } : { x: 0, z: 6, name: 'camp' };
    }
    a.activity = 'talkPlayer';
    a.actTimer = 9999;
    a.target = null;
    this.race = { rival: a, target, t: 3, started: false };
    a.say(simRng.pick(['You\'re on!', 'Ha! Eat my dust!', 'Ready when you are!']), 2);
    g.ui.toast(`🏁 Race ${a.name} to ${target.name}! Hold Shift / 💨 to sprint. Get ready…`, 'objective');
    g.objectives.add({ id: 'race', kind: 'free', title: `Race to ${target.name}`, desc: `Beat ${a.name} there!`, need: 1, target: { x: target.x, z: target.z } });
    g.objectives.focus('race');
  }

  private updateRace(dt: number) {
    const r = this.race;
    if (!r) return;
    const g = this.game;
    const a = r.rival;
    if (!g.npcs.agents.has(a.id)) { this.race = null; return; }
    a.actTimer = 9999;
    if (!r.started) {
      const before = Math.ceil(r.t);
      r.t -= dt;
      const now = Math.ceil(r.t);
      if (now !== before && now > 0) g.ui.floatText(String(now), '#ffe08a');
      if (r.t <= 0) {
        r.started = true;
        g.ui.floatText('GO!', '#9fe870');
        g.audio.chime();
        const sf = STAGE_SPEED[a.cat.stage] ?? 1;
        a.moveSpeed = 7.2 * 0.84 * sf * simRng.range(0.85, 1.05);
        a.setTarget(r.target.x, r.target.z);
      }
      return;
    }
    if (!a.target) a.setTarget(r.target.x, r.target.z);
    const p = g.player.pos;
    const pd = Math.hypot(p.x - r.target.x, p.z - r.target.z);
    const ad = Math.hypot(a.pos.x - r.target.x, a.pos.z - r.target.z);
    if (pd < 2.2 || ad < 2.2) {
      const won = pd < 2.2 && (ad >= 2.2 || pd <= ad);
      this.race = null;
      g.objectives.fail('race', true);
      a.activity = 'idle';
      a.actTimer = 0;
      a.moveSpeed = 1.35;
      const pc = g.clan.player;
      g.clan.adjust(a.cat, pc, 5, { text: `${pc.given} and I raced to ${r.target.name}.`, weight: 2 });
      if (won) {
        pc.skills.fighting = Math.min(99, pc.skills.fighting + 0.5);
        g.ui.toast(`🏆 You beat ${a.name} to ${r.target.name}!`, 'good');
        a.say(simRng.pick(['No way! Rematch!', 'You\'re fast!', '*pants* Next time…']), 3);
      } else {
        g.ui.toast(`${a.name} got to ${r.target.name} first!`, 'info');
        a.say(simRng.pick(['I win! I win!', 'Too slow, slug-paws!', 'Better luck next time!']), 3);
      }
    }
  }

  // ------------------------------------------------------------ elders' stories
  tellStory(elder: Cat): string {
    const g = this.game;
    const clan = g.clan;
    const home = g.territories.homeName;
    const rival = g.territories.rivals.length ? simRng.pick(g.territories.rivals).name : 'the other clans';
    const deadCats = clan.dead().filter((d) => d.clan === 'home');
    const hero = deadCats.length ? displayName(simRng.pick(deadCats)) : 'a warrior whose name even I have forgotten';
    const Hero = hero.charAt(0).toUpperCase() + hero.slice(1);
    const stories = [
      `Long ago, before the first Warden, the cats of ${home} had no camp at all. They slept under the stars, and the Long Meadow watched over them. That's why we still look up at night.`,
      `When I was an apprentice, a fox stole into camp during a storm. ${Hero} stood in front of the nursery and would not move — not for claws, not for teeth. The fox left, and every kit lived.`,
      `They say ${rival} once tried to take the Sunning Stones. Our warriors stood shoulder to shoulder at the border until the sun went down, and not one claw was unsheathed. Sometimes courage is just standing still.`,
      `There was a leaf-bare so cold the river froze solid. We shared every scrap of prey, even the thin ones. Nobody went hungry, because nobody ate first. That is what a clan is.`,
      `Have you heard of the Moonpool? A place where the stars touch the water. Healers go there to dream with the Long Meadow. Maybe one day you'll see it.`,
      `${Hero} could catch a bird mid-flight. Jumped higher than the brambles! Or maybe the story has grown a little each time I told it… *purrs*`,
      `The Tallfolk once built a roaring path through the woods. Two of our warriors never came home. Never forget: the road is not a place for cats.`,
      `Deathberries look like treats, but they're poison. A kit once ate three — the healer ran through the night for herbs. The kit lived… and never touched a red berry again.`,
    ];
    elder.lastStory = g.time.day;
    return simRng.pick(stories);
  }

  // ------------------------------------------------------------ treasures
  collectTreasure(kind: TreasureKind) {
    const g = this.game;
    const pc = g.clan.player;
    pc.treasures = pc.treasures ?? [];
    if (pc.treasures.length >= 8) { g.ui.toast('You have too many treasures already! Give some away as gifts.', 'info'); return false; }
    pc.treasures.push(kind);
    g.audio.pick();
    g.ui.toast(`✨ You found a ${TREASURE_INFO[kind].name}! (${pc.treasures.length} treasures) — give it to a friend as a gift.`, 'good');
    return true;
  }

  giveTreasure(a: NpcAgent): string {
    const g = this.game;
    const pc = g.clan.player;
    const c = a.cat;
    const kind = pc.treasures!.shift()! as TreasureKind;
    const name = TREASURE_INFO[kind].name;
    const big = c.stage === 'kit' || c.traits.includes('kind') || c.traits.includes('playful');
    g.clan.adjust(c, pc, big ? 14 : 10, { text: `${pc.given} gave me a ${name}.`, weight: 4 });
    const r = g.clan.rel(c, pc);
    if (c.stage === 'warrior' && pc.stage === 'warrior' && r.opinion > 40) r.romance = clamp(r.romance + 6, 0, 100);
    g.audio.purr();
    return simRng.pick([
      `A ${name}! For me? I'll put it in my nest. Thank you!`,
      `*eyes shine* It's beautiful… I'll keep it forever.`,
      c.stage === 'kit' ? `WOW! A ${name}! Wait till the other kits see this!` : `How thoughtful. You always know how to make me smile.`,
    ]);
  }

  // ------------------------------------------------------------ basking & stargazing
  spotAction(): { text: string; action: () => void } | null {
    const g = this.game;
    const p = g.player.pos;
    const lm = g.territories.landmarks.find((l) => (l.kind === 'sunRocks' || l.kind === 'hollow' || l.kind === 'bigTree') && Math.hypot(l.x - p.x, l.z - p.z) < Math.max(4, l.radius * 0.8));
    if (!lm || g.clan.player.exiled && false) return null;
    const night = g.time.isNight;
    const clear = g.weather.kind === 'sunny' || g.weather.kind === 'cloudy';
    if (!night && lm.kind === 'sunRocks' && clear) return { text: `Bask on ${lm.name}`, action: () => this.bask(lm.name) };
    if (night && clear) return { text: `Gaze at the stars from ${lm.name}`, action: () => this.stargaze() };
    return null;
  }

  private bask(where: string) {
    const g = this.game;
    const pc = g.clan.player;
    pc.health = Math.min(pc.maxHealth, pc.health + 25);
    pc.injury = Math.max(0, pc.injury - 10);
    g.player.stamina = 100;
    g.audio.purr();
    g.clan.remember(pc, `I basked in the sun on ${where}. Bliss.`, 1);
    g.ui.toast(`☀ You stretch out on the warm stone and doze in the sun. Every whisker feels content.`, 'good');
    g.passTime(2);
  }

  private stargaze() {
    const g = this.game;
    const pc = g.clan.player;
    g.audio.chime();
    const dead = g.clan.dead().filter((d) => d.clan === 'home' && (pc.relations[d.id]?.opinion ?? 0) > 20);
    if (Math.random() < 0.35) { g.starDream(); return; }
    const who = dead.length ? displayName(simRng.pick(dead)) : null;
    g.ui.toast(who ? `✨ One star twinkles brighter than the rest. You're sure it's ${who}, watching over you.` : '✨ The stars of the Long Meadow shimmer overhead. You feel very small, and very safe.', 'info');
    g.clan.remember(pc, 'I watched the stars of the Long Meadow.', 1);
  }

  private boredT = 15;
  private helpT = 0;

  update(dt: number) {
    this.updateRace(dt);
    const g = this.game;
    // now and then a clanmate nearby grumbles that they're bored (talk to them!)
    this.boredT -= dt;
    if (this.boredT <= 0) {
      this.boredT = simRng.range(25, 50);
      if (!g.time.isNight) {
        const p = g.player.pos;
        const idle = [...g.npcs.agents.values()].filter((a) => a.cat.clan === 'home' && a.cat.stage !== 'kit' && a.activity === 'idle' && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 20);
        if (idle.length) simRng.pick(idle).say(simRng.pick(['*sigh* I\'m so bored…', 'Nothing to do today…', '*yawns* Borrring.', 'Someone find me something to do!']), 3);
      }
    }
    // a clanmate doing a job with you pitches in
    const o = g.objectives.list.find((x) => x.data?.companion);
    if (o) {
      this.helpT += dt;
      if (this.helpT > 40 && !o.data.helped && (o.progress ?? 0) < o.need - 1) {
        o.data.helped = true;
        o.progress = (o.progress ?? 0) + 1;
        const a = g.npcs.agents.get(o.data.companion);
        const what = o.kind === 'herbs' ? 'found a herb' : o.kind === 'hunt' ? 'caught some prey' : 'marked a border stone';
        if (o.kind === 'hunt') g.clan.addFood(1);
        a?.say(simRng.pick(['Look what I got!', 'Got one!', 'Here, this counts too!']), 2.5);
        g.ui.toast(`${a ? a.name : 'Your clanmate'} ${what}! (${o.progress}/${o.need})`, 'good');
      }
    } else this.helpT = 0;
  }
}

/** When a clanmate dies their body lies in camp for a vigil, and friends gather. */
export class Vigils {
  list: { catId: string; model: CatModel; until: number; x: number; z: number; sat: boolean }[] = [];
  constructor(private game: Game) {}

  onDeath(c: Cat, cause: string) {
    const g = this.game;
    if (c.clan !== 'home' || c.isPlayer) return;
    const pc = g.clan.player;
    if (!pc || !pc.alive) return;
    g.ui.toast(`💔 ${displayName(c)} has died (${cause}). The clan will sit vigil in camp.`, 'danger');
    // the body lies in the middle of camp until the next dawn
    if (this.list.length < 3) {
      const ang = this.list.length * 2.1;
      const x = Math.cos(ang) * 1.6, z = 2 + Math.sin(ang) * 1.6;
      const model = new CatModel(c.app, c.stage);
      model.pose = 'sleep';
      for (let i = 0; i < 30; i++) model.update(0.1);
      model.root.position.set(x, g.groundAt(x, z), z);
      model.root.rotation.y = simRng.range(0, Math.PI * 2);
      g.scene.add(model.root);
      this.list.push({ catId: c.id, model, until: g.time.day + 1, x, z, sat: false });
      // friends and family gather around
      for (const a of g.npcs.agents.values()) {
        if (a.cat.clan !== 'home' || a.activity === 'fight' || a.activity === 'talkPlayer') continue;
        const close = (a.cat.relations[c.id]?.opinion ?? 0) > 35 || a.cat.mate === c.id || c.parents.includes(a.cat.id) || a.cat.parents.includes(c.id);
        if (!close) continue;
        const aa = simRng.range(0, Math.PI * 2);
        a.setTarget(x + Math.cos(aa) * 1.1, z + Math.sin(aa) * 1.1);
        a.mood = 'sad';
        a.say(simRng.pick(['No… not you…', '*presses nose to their fur*', 'Walk with StarClan, my friend.', '*quietly grieving*']), 4);
      }
    }
    // if they were your close friend, you grieve too
    const mine = Math.max(pc.relations[c.id]?.opinion ?? 0, (c.relations[pc.id]?.opinion ?? 0) - 10);
    if (mine >= 40 && g.state === 'playing') {
      g.player.frozen = true;
      g.menus.griefScene(pc, c, () => { g.menus.clearGrief(); g.player.frozen = false; });
    }
  }

  nearest(x: number, z: number) {
    return this.list.find((v) => !v.sat && Math.hypot(v.x - x, v.z - z) < 1.6);
  }

  sitVigil(v: Vigils['list'][number]) {
    const g = this.game;
    const c = g.clan.get(v.catId);
    const pc = g.clan.player;
    v.sat = true;
    if (!c) return;
    g.clan.remember(pc, `I sat vigil for ${displayName(c)}.`, 4, c.id);
    for (const o of g.clan.home()) if (!o.isPlayer && ((o.relations[c.id]?.opinion ?? 0) > 30 || o.mate === c.id)) g.clan.adjust(o, pc, 4);
    g.ui.toast(`You press your nose into ${displayName(c)}'s cold fur and sit with the clan through the night. Their friends are grateful you were there.`, 'info');
    g.passTime(3);
  }

  /** At dawn the bodies are buried by the elders. */
  dawn() {
    const g = this.game;
    this.list = this.list.filter((v) => {
      if (g.time.day < v.until) return true;
      v.model.root.removeFromParent();
      v.model.dispose();
      return false;
    });
  }

  clear() {
    for (const v of this.list) { v.model.root.removeFromParent(); v.model.dispose(); }
    this.list = [];
  }
}
