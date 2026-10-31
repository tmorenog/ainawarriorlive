// Everything the player can *do* with the world: talk, groom, share prey,
// court a mate, deliver herbs and moss, sleep, escort cats, give orders.
import * as THREE from 'three';
import type { Game } from '../game';
import { clanTitle } from '../lore';
import type { NpcAgent, ApproachIntent } from '../ai/npc';
import type { PreyKind } from '../wildlife/models';
import { PREY } from '../wildlife/prey';
import { Cat, displayName, isExpecting, isQueen, pronoun, queenComplaint, roleLabel } from '../cats/types';
import { adviceLine, greetPlayer, isFamily, relLabel } from './social';
import { FLOWER_INFO, FlowerKind, HERB_INFO, HerbKind, Interactable, TREASURE_INFO, TreasureKind } from '../world/chunks';
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
  private healedDay = new Map<string, number>();
  private boredAsked = new Set<string>();
  private remindedOf = new Set<string>();
  /** Prey the player has dropped on the ground; it can be picked up again. */
  dropped: { kind: PreyKind; mesh: THREE.Mesh; x: number; z: number }[] = [];
  constructor(private game: Game) {}

  /** Put down what you're carrying (onto the pile if you're next to it). */
  drop() {
    const g = this.game;
    const pl = g.player;
    if (g.mossBalls?.held) { g.mossBalls.toss(pl.forward().x, pl.forward().z, 0.6); g.ui.toast('You put the moss ball down.', 'info'); return; }
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

  /** Your own cat crouches at the water and laps it up with a real tongue (close-up camera). */
  showLapping(seconds = 2.2) {
    const g = this.game;
    g.player.startDrink(seconds);
    for (let i = 0; i < Math.round(seconds * 2.2); i++) setTimeout(() => g.audio.lap(), i * 450);
  }

  drink(amount = 100) {
    const g = this.game;
    const pl = g.player;
    const pc = g.clan.player;
    pc.thirst = Math.min(100, (pc.thirst ?? 100) + amount);
    this.showLapping();
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

  takeHerbs() {
    const g = this.game;
    const pl = g.player;
    const st = g.clan.herbStore;
    let n = 0;
    for (const k of ['sunpetal', 'silverleaf', 'bitterroot'] as HerbKind[]) {
      while (st[k] > 0 && pl.herbs.silverleaf + pl.herbs.sunpetal + pl.herbs.bitterroot < 4) { st[k]--; pl.herbs[k]++; n++; }
    }
    pl.updateCarryVisual();
    g.camp.setHerbCount(g.clan.herbTotal());
    g.audio.pick();
    g.ui.toast(n ? `You take ${n} herb${n > 1 ? 's' : ''} in your jaws. Bring them to a sick or hurt cat and talk to them to heal.` : 'Your jaws are already full.', 'info');
  }

  saveBerryCat(a: NpcAgent) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const pl = g.player;
    const herb = (['bitterroot', 'sunpetal', 'silverleaf'] as HerbKind[]).find((k) => pl.herbs[k] > 0);
    if (herb) { pl.herbs[herb]--; pl.updateCarryVisual(); }
    const kit = a.cat;
    kit.sick = 0;
    const ev = g.events.get('deathberries');
    if (ev) g.events.active.splice(g.events.active.indexOf(ev), 1);
    clan.adjust(kit, pc, 30, { text: `${pc.given} saved me from the deathberries.`, weight: 8 });
    clan.remember(pc, `I saved ${displayName(kit)} from deathberry poison.`, 6, kit.id);
    pc.deeds++;
    for (const c of clan.home()) if (!c.isPlayer && (kit.parents.includes(c.id) || c.role === 'medicine' || c.role === 'leader')) clan.adjust(c, pc, 8);
    g.objectives.complete('berry-kit');
    if (pc.role === 'medicine' || pc.role === 'medicineApprentice') g.training.medProgress('treat');
    a.activity = 'idle'; a.actTimer = 0;
    a.say('*coughs up the berries* …I feel better. Thank you!', 4);
    g.ui.dialog({ speaker: kit, text: `You make ${a.name} chew the ${herb ?? 'herbs'}. A moment later ${pronoun(kit, 'subj')} retches up the deathberries. "Th-thank you… I'll never eat those again!"`, options: [{ label: 'You\'re safe now', action: () => {} }] });
  }

  /** Breathe in the scent of flowers: it calms you, and you can carry one away to give. */
  /** Smell a flower, pick one to carry, or (dandelions) blow the seeds away. */
  private flowerMenu(it: Interactable) {
    const g = this.game;
    const pc = g.clan.player;
    const fi = FLOWER_INFO[it.kind as FlowerKind];
    const opts = [
      { label: `👃 Smell the ${fi.name}s`, action: () => this.smellFlower(it, false) },
      { label: `✋ Pick a ${fi.name} to carry (${(pc.flowers ?? []).length}/3)`, action: () => this.smellFlower(it, true) },
    ];
    if (it.kind === 'dandelion') opts.push({ label: '🌬 Blow the fluffy seeds', action: () => {
      const p = g.player.pos;
      for (let i = 0; i < 6; i++) setTimeout(() => g.combat.puff(new THREE.Vector3(p.x + Math.random() - 0.5, p.y + 0.3 + i * 0.12, p.z + Math.random() - 0.5), 6, 0.35), i * 120);
      g.audio.sniff();
      g.player.calmUntil = g.clock + 40;
      g.ui.toast(simRng.pick(['🌬 Phffff! Fluffy dandelion seeds float away on the breeze. Make a wish!', '🌬 The seeds swirl up around your whiskers and tickle your nose. Achoo!', '🌬 A cloud of tiny parachutes drifts off over the grass.']), 'good');
      g.chunks.takeInteractable(it);
    } });
    opts.push({ label: 'Leave them', action: () => {} });
    g.ui.choice(`${it.kind === 'dandelion' ? '🌼' : '🌸'} ${fi.name[0].toUpperCase() + fi.name.slice(1)}s`, it.kind === 'daisy' ? 'Little white daisies with sunny yellow middles.' : it.kind === 'dandelion' ? 'Bright yellow dandelions — and a few fluffy seed heads.' : `A patch of ${fi.name}s.`, opts);
  }

  // ------------------------------------------------------------ wild animal friends
  talkAnimal(beast: import('../wildlife/creatures').Creature) {
    const g = this.game;
    const pc = g.clan.player;
    pc.animalFriends = pc.animalFriends ?? {};
    const af = pc.animalFriends;
    const kind = beast.type;
    const nm = beast.name.toLowerCase();
    const fr = af[kind] ?? 0;
    const voice: Record<string, { friend: string[]; wary: string[]; cross: string[] }> = {
      badger: { friend: ['*grunts warmly* Little cat. You came back.', 'The earth is soft after rain. Good digging. You want worms? No? Hm.', '*snuffles your fur* You smell of the clan. And of friend.'], wary: ['*stares with small black eyes* …Hrrm. What do you want, cat?', '*sniffs the air* You are not food. Not today.'], cross: ['*rumbles deep in its chest* GO AWAY.', '*shows its claws* My sett. My land.'] },
      fox: { friend: ['*yips softly* Hey, whiskers. Hunting\'s good by the river today.', '*grins with all its teeth* Friends, you and me. Strange, isn\'t it?'], wary: ['*tilts its sly red head* A cat who talks to foxes? How curious.', '*circles you slowly* Hm. You\'re braver than most.'], cross: ['*snarls* Keep your distance, little morsel.', '*bares sharp teeth*'] },
      raccoon: { friend: ['*chitters happily* Shiny-thing friend! Look, I found a bottle cap!', '*washes its paws* You want to share? The bins have fish tonight.'], wary: ['*clutches a wrapper* Mine. All mine. …What do you want?', '*chitters* Cat. Hmm. Cat.'], cross: ['*hisses and chatters* MINE! GO!', '*puffs up and swipes the air*'] },
      dog: { friend: ['*tail thumps* FRIEND! FRIEND! You smell great!', '*rolls over* Belly rub? No? Okay! Still friends!'], wary: ['*sniffs you loudly* Cat?! CAT! …Are you a nice cat?', '*whines and wags uncertainly*'], cross: ['*barks* WOOF WOOF GET OUT!', '*growls low*'] },
    };
    const v = voice[kind] ?? voice.badger;
    const anger = () => {
      beast.state = 'stalk'; beast.fightTarget = g.player; beast.chase = 10;
      g.ui.toast(`The ${nm} doesn't trust you yet — it lunges!`, 'danger');
    };
    const raise = (n: number, text: string) => {
      const before = af[kind] ?? 0;
      af[kind] = Math.min(100, before + n);
      if (before < 50 && af[kind] >= 50) { g.ui.toast(`💛 The ${nm} trusts you now! ${kind === 'dog' ? 'Dogs' : `${beast.name}s`} won't attack you anymore.`, 'good'); g.clan.remember(pc, `I befriended a ${nm}. Nobody in the clan would believe it.`, 5); }
      g.ui.dialog({ text: `${beast.name}: ${text}`, options: [{ label: 'Continue', action: () => this.talkAnimal(beast) }, { label: 'Goodbye', action: () => {} }] });
    };
    const opts: { label: string; action: () => void }[] = [];
    if (g.player.prey.length) opts.push({ label: `Offer your ${g.player.prey[0].kind}`, action: () => {
      g.player.prey.shift(); g.player.updateCarryVisual(); g.audio.eat();
      raise(30, simRng.pick(['*gobbles it down* …Thank you, cat.', '*sniffs, then eats* Hm. Not bad. Not bad at all.', '*takes it gently* For me? You are a strange cat.']));
    } });
    opts.push({ label: 'Speak softly and slowly', action: () => {
      if (fr < 15 && simRng.chance(beast.def.aggression * 0.5)) { anger(); return; }
      raise(fr >= 50 ? 2 : 8, simRng.pick(fr >= 50 ? v.friend : v.wary));
    } });
    opts.push({ label: 'Back away carefully', action: () => {} });
    g.ui.dialog({ text: `${beast.name} (${fr >= 50 ? '💛 friend' : fr >= 15 ? 'wary of you' : 'unfriendly'} · trust ${Math.round(Math.min(fr, 50))}/50): ${simRng.pick(fr >= 50 ? v.friend : fr >= 15 ? v.wary : v.cross)}`, options: opts });
  }

  // ------------------------------------------------------------ herbs and poultices
  /** The herb menu (H): chew herbs into poultices and press them onto your own wounds. */
  herbsMenu() {
    const g = this.game;
    const pl = g.player;
    const pc = g.clan.player;
    if (pl.busy || pl.sleeping || g.ui.isBusy()) return;
    pc.poultices = pc.poultices ?? {};
    const ps = pc.poultices;
    const herbs = (['silverleaf', 'sunpetal', 'bitterroot'] as HerbKind[]);
    const opts: { label: string; hint?: string; action: () => void }[] = [];
    for (const k of herbs) if (pl.herbs[k] > 0) opts.push({ label: `🦷 Chew ${HERB_INFO[k].name} into a poultice`, hint: `${pl.herbs[k]} in your jaws`, action: () => this.chew(k) });
    for (const k of herbs) if ((ps[k] ?? 0) > 0) opts.push({ label: `🩹 Press the ${HERB_INFO[k].name} poultice on yourself`, hint: HERB_INFO[k].use, action: () => this.applyPoultice(k, null) });
    if (!opts.length) { g.ui.toast('🌿 You have no herbs. Pick some (or take them from the herb store in the medicine den), then press H to chew them into a poultice.', 'info'); return; }
    opts.push({ label: 'Close', action: () => {} });
    const carried = herbs.filter((k) => (ps[k] ?? 0) > 0).map((k) => `${ps[k]} ${HERB_INFO[k].name}`).join(', ');
    g.ui.choice('🌿 Herbs & poultices', `Chew herbs into a poultice, then press it onto a wound. Silverleaf soothes wounds, sunpetal eases fever and cough, bitterroot fights sickness and poison.${carried ? ` Poultices ready: ${carried}.` : ''}`, opts);
  }

  /** Chew a herb into a poultice (takes a moment). */
  chew(k: HerbKind, then?: () => void) {
    const g = this.game;
    const pl = g.player;
    const pc = g.clan.player;
    if (pl.herbs[k] <= 0) return;
    pl.herbs[k]--;
    pl.updateCarryVisual();
    pl.busy = true;
    pl.model.pose = 'eat';
    for (let i = 0; i < 4; i++) setTimeout(() => g.audio.eat(), i * 300);
    g.ui.floatText('*chew chew*', '#9fd08a');
    setTimeout(() => {
      pl.busy = false;
      pc.poultices = pc.poultices ?? {};
      pc.poultices[k] = (pc.poultices[k] ?? 0) + 1;
      g.ui.toast(`🌿 You chew the ${HERB_INFO[k].name} into a soft green poultice.${then ? '' : ' Press H to use it, or talk to a hurt cat to treat them.'}`, 'good');
      then?.();
    }, 1400);
  }

  /** Press a poultice onto yourself (cat = null) or a clanmate. */
  applyPoultice(k: HerbKind, cat: Cat | null) {
    const g = this.game;
    const pc = g.clan.player;
    const ps = pc.poultices ?? {};
    if ((ps[k] ?? 0) <= 0) return false;
    ps[k]--;
    const c = cat ?? pc;
    if (k === 'silverleaf') { c.injury = Math.max(0, c.injury - 55); c.health = Math.min(c.maxHealth, c.health + 35); }
    else if (k === 'sunpetal') { c.sick = Math.max(0, c.sick - 45); c.health = Math.min(c.maxHealth, c.health + 20); }
    else { c.sick = Math.max(0, c.sick - 55); c.health = Math.min(c.maxHealth, c.health + 15); if (!cat) g.player.poison = Math.max(0, g.player.poison - 0.6); }
    pc.skills.healing = Math.min(99, pc.skills.healing + 1);
    g.audio.pick();
    if (!cat) g.ui.toast(`🩹 You press the ${HERB_INFO[k].name} poultice onto ${k === 'silverleaf' ? 'your wounds. The sting fades.' : 'your fur and lick it in. You feel better already.'}`, 'good');
    return true;
  }

  private smellFlower(it: Interactable, pick = true) {
    const g = this.game;
    const pc = g.clan.player;
    const fi = FLOWER_INFO[it.kind as FlowerKind];
    g.audio.purr();
    pc.health = Math.min(pc.maxHealth, pc.health + 5);
    g.player.stamina = Math.min(100, g.player.stamina + 30);
    g.player.calmUntil = g.clock + 60;
    pc.flowers = pc.flowers ?? [];
    let picked = false;
    if (pick && pc.flowers.length < 3) { pc.flowers.push(it.kind as string); picked = true; g.chunks.takeInteractable(it); }
    else if (pick) g.ui.toast('You can only carry three flowers. Give one away first!', 'info');
    g.ui.toast(`🌸 You breathe in the sweet scent of the ${fi.name}s. Any anger melts away — you feel calm.${picked ? ` You pick one to carry (${pc.flowers.length}/3). Give it to a clanmate to cheer them up — or calm them down!` : ''}`, 'good');
    if (it.bees && Math.random() < 0.7) setTimeout(() => g.bees.sting(), 600);
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
    if (pl.busy || pl.sleeping || !pl.alive || pl.drinkT > 0) { this.current = null; return; }
    const p = pl.pos;
    const f = pl.forward();
    const pc = g.clan.player;
    this.current = null;
    if (g.mossBalls?.canCatchNow()) { this.current = { text: 'Catch the moss ball!', action: () => g.mossBalls.tryCatch() }; return; }
    if (g.mossBalls?.catchGame && g.mossBalls.held) { const cg = g.mossBalls.catchGame; this.current = { text: `Toss the moss ball to ${cg.partner.name}`, action: () => { g.mossBalls.toss(cg.partner.pos.x - p.x, cg.partner.pos.z - p.z, pc.stage === 'kit' ? 3.2 : 4); g.audio.swipe(); } }; return; }
    // vigil for a clanmate who died
    const vg = g.vigils?.nearest(p.x, p.z);
    if (vg) { const dc = g.clan.get(vg.catId); this.current = { text: `Sit vigil for ${dc ? displayName(dc) : 'them'}`, action: () => g.vigils.sitVigil(vg) }; return; }
    // Twoleg things: bowls, beds, owners, cages, vans…
    const tp = g.twolegs.prompt();
    if (tp) { this.current = tp; return; }
    // wild animals you can try to talk to (or are already friends with)
    const beast = g.creatures.list.find((c) => c.alive && c.state !== 'fight' && dist2(c.pos.x, c.pos.z, p.x, p.z) < 2.6);
    if (beast) {
      const fr = pc.animalFriends?.[beast.type] ?? 0;
      this.current = { text: `${fr >= 50 ? '💛 ' : ''}Talk to the ${beast.name.toLowerCase()}${fr >= 50 ? ' (friend)' : ''}`, action: () => this.talkAnimal(beast) };
      return;
    }
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
    // moss balls in camp
    if (g.mossBalls?.held) {
      this.current = { text: 'Toss the moss ball', action: () => {
        g.mossBalls.toss(f.x, f.z, pc.stage === 'kit' ? 4 : 5.5);
        g.audio.swipe();
        for (const a of g.npcs.agents.values()) if (a.cat.stage === 'kit' && a.cat.clan === 'home' && dist2(a.pos.x, a.pos.z, p.x, p.z) < 8 && simRng.chance(0.3)) a.say('I\'ll get it!', 1.5);
      } };
      return;
    }
    const mb = g.mossBalls?.nearest(p.x, p.z, 0.9 * Math.max(0.7, pl.scale) + 0.2);
    if (mb && !pl.prey.length) {
      this.current = { text: 'Pick up the moss ball', action: () => { g.mossBalls.pickUp(mb); g.audio.pick(); g.ui.toast('You carry the moss ball in your jaws. Press E / ✋ to toss it, or walk into another to bat it.', 'info'); } };
      return;
    }
    if (mb) {
      this.current = { text: 'Bat the moss ball', action: () => {
        g.mossBalls.kick(mb, f.x, f.z, pc.stage === 'kit' ? 4.5 : 6, 'player');
        g.audio.swipe();
        if (simRng.chance(0.3)) g.ui.toast(simRng.pick(['Whee! The moss ball goes flying!', 'You pounce and bat the moss ball across camp!', 'Got it! …it got away again.']), 'info');
        for (const a of g.npcs.agents.values()) if (a.cat.stage === 'kit' && a.cat.clan === 'home' && dist2(a.pos.x, a.pos.z, p.x, p.z) < 8) { g.clan.adjust(a.cat, pc, 1, undefined, 1); if (simRng.chance(0.25)) a.say('My turn! My turn!', 1.5); }
      } };
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
    // the camp's drinking pool
    if (dist2(p.x, p.z, g.camp.pool.x, g.camp.pool.z) < 1.6) { this.current = { text: 'Drink from the camp pool 💧', action: () => this.drink() }; return; }
    // water: lap from the edge of a stream, pond or lake
    {
      const ax = p.x + f.x * 1.1, az = p.z + f.z * 1.1;
      if (g.chunks.waterDepthAt(ax, az) > 0.02 || g.chunks.waterDepthAt(p.x, p.z) > 0.02) {
        this.current = { text: 'Drink water', action: () => this.drink() };
        return;
      }
    }
    // sunny rocks and starry hollows
    const spot = g.fun.spotAction();
    if (spot) { this.current = spot; }
    // herbs & moss
    const its = g.chunks.interactablesNear(p.x, p.z, 1.3 * Math.max(0.7, pl.scale));
    if (its.length) {
      const it = its[0];
      if (it.type === 'berries') {
        const kit = pc.stage === 'kit';
        this.current = { text: kit ? 'Taste the shiny red berries' : 'Deathberries! Eat them anyway? (deadly poison)', action: () => this.eatDeathberries(it) };
        return;
      }
      if (it.type === 'flower') {
        const fi = FLOWER_INFO[it.kind as FlowerKind];
        this.current = { text: `${it.kind === 'dandelion' ? '🌼' : '🌸'} The ${fi.name}s — smell or pick`, action: () => this.flowerMenu(it) };
        return;
      }
      if (it.type === 'treasure') { const ti = TREASURE_INFO[it.kind as TreasureKind]; this.current = { text: `Pick up the ${ti.name} ✨`, action: () => { if (g.fun.collectTreasure(it.kind as TreasureKind)) g.chunks.takeInteractable(it); } }; return; }
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
      const carrying = pl.herbs.silverleaf + pl.herbs.sunpetal + pl.herbs.bitterroot;
      const healer = pc.role === 'medicine' || pc.role === 'medicineApprentice';
      if (den.name === 'medicine' && carrying > 0) { this.current = { text: `Put your herbs in the herb store (${g.clan.herbTotal()} stored)`, action: () => this.deliverHerbs() }; return; }
      if (den.name === 'medicine' && healer && g.clan.herbTotal() > 0) { this.current = { text: `Take herbs from the store (${g.clan.herbStore.silverleaf} silverleaf · ${g.clan.herbStore.sunpetal} sunpetal · ${g.clan.herbStore.bitterroot} bitterroot)`, action: () => this.takeHerbs() }; return; }
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
    const berryEv = g.events.get('deathberries');
    if (berryEv && berryEv.data.id === c.id && c.alive) {
      const herbs = g.player.herbs.silverleaf + g.player.herbs.sunpetal + g.player.herbs.bitterroot;
      g.ui.dialog({ speaker: c, text: `${a.name} is curled up, shaking, with red juice on ${pronoun(c, 'poss')} whiskers. "I… I ate the shiny berries… it hurts…"`, options: herbs > 0
        ? [{ label: 'Give them herbs to retch the berries up', action: () => this.saveBerryCat(a) }, { label: 'Hold on — I\'ll be back', action: () => {} }]
        : [{ label: 'I need herbs! I\'ll find some — hold on!', action: () => g.ui.toast('Look for herbs nearby (sniff with Q / 👃), then come back.', 'objective') }] });
      return;
    }
    if (g.codeBreakers.current?.agentId === a.id) { a.activity = 'talkPlayer'; if (g.codeBreakers.confront(a, () => {})) return; }
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
    const permitted = pc.stage === 'kit' && (pc.outsideUntil ?? -1) > g.time.totalHours;
    if (pc.stage === 'kit' && Math.hypot(g.player.pos.x, g.player.pos.z) > 17.5 && c.stage !== 'kit' && !pc.exiled && !permitted) {
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
    // sometimes a clanmate is just bored
    const boredKey = c.id + ':' + g.time.day;
    if (!pc.exiled && !g.time.isNight && c.stage !== 'kit' && !this.boredAsked.has(boredKey) && simRng.chance(0.18) && !g.objectives.list.some((o) => o.data?.companion)) {
      this.boredAsked.add(boredKey);
      this.boredTalk(a, done);
      return;
    }
    if (a.cantSleep && g.time.isNight) {
      const lines = ['I can\'t sleep… too many thoughts. Stay with me a while?', '*gazing at the stars* Do you think StarClan can see us right now?', 'You\'re awake too? The night is so quiet…'];
      const opts0 = this.talkOptions(a, done);
      opts0.unshift({ label: 'Keep them company', action: () => { clan.adjust(c, pc, 5, { text: `${pc.given} kept me company when I couldn't sleep.`, weight: 3 }); g.audio.purr(); g.ui.dialog({ speaker: c, text: '*leans against you* Thank you… I think I could sleep now.', options: [{ label: 'Goodnight', action: () => { done(); a.cantSleep = false; a.activity = 'idle'; a.actTimer = 0; } }], onClose: done }); } });
      g.ui.dialog({ speaker: c, text: simRng.pick(lines), options: opts0, onClose: done, input: (t) => this.freeTalk(a, t, done) });
      return;
    }
    let text = greetPlayer(c, pc, op, { night: g.time.isNight, food: clan.food, clanSize: clan.home().length, weather: g.weatherLabel(), recent: clan.lastRecent });
    if (pc.lifestyle && pc.lifestyle !== 'clan') text = this.outsiderChat(c);
    else if (pc.exiled && g.npcs.isPlayerFriend(a)) text = simRng.pick([
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

    if (pc.lifestyle && pc.lifestyle !== 'clan') {
      opts.push({ label: 'Chat', action: () => {
        clan.adjust(c, pc, talkedToday ? 0.3 : 2, undefined, 3);
        this.lastSpoke.set(key, (this.lastSpoke.get(key) ?? 0) + 1);
        g.ui.dialog({ speaker: c, text: this.outsiderChat(c), options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
      } });
      if (c.stage !== 'kit') opts.push({ label: 'Ask to join the clan', hint: 'become an apprentice', action: () => this.askJoin(a, done) });
      opts.push({ label: 'Leave', action: done });
      return opts;
    }
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
    // ask your mentor for a lesson yourself instead of waiting to be found
    if (pc.stage === 'apprentice' && c.id === pc.mentor && !g.objectives.busy()) opts.push({ label: 'Ask for a lesson', action: () => {
      const since = g.time.totalHours - g.training.lastLessonHour;
      if (since < 2) { g.ui.dialog({ speaker: c, text: 'We just trained! Rest your paws a little, then come back.', options: [{ label: 'Alright', action: again }], onClose: done }); return; }
      if (g.time.isNight) { g.ui.dialog({ speaker: c, text: 'It\'s too dark to train now. Find me in the morning.', options: [{ label: 'Alright', action: again }], onClose: done }); return; }
      done();
      g.training.offerLesson(a);
    } });
    // apprentices can ask their mentor (or the leaders) for their assessment
    if (pc.stage === 'apprentice' && (c.id === pc.mentor || c.role === 'leader' || c.role === 'deputy' || (pc.role === 'medicineApprentice' && c.role === 'medicine'))) {
      const med = pc.role === 'medicineApprentice';
      opts.push({ label: med ? 'Am I ready to be a full medicine cat?' : 'Am I ready for my warrior name?', action: () => {
        const missing = g.training.missingLessons(pc);
        if (g.objectives.has('assessment')) { g.ui.dialog({ speaker: c, text: med ? 'You already have your task: bring three healing herbs to the medicine den.' : 'You already have your assessment: hunt alone and bring two pieces of prey to the fresh-kill pile.', options: [{ label: 'Right!', action: again }], onClose: done }); return; }
        if (!missing.length || pc.age >= 15) {
          g.training.offerAssessment();
          g.objectives.focus('assessment');
          g.ui.dialog({ speaker: c, text: med ? `Yes, ${pc.given}. You know your herbs. Gather three on your own and bring them to the medicine den, and you'll earn your full name.` : `Yes, ${pc.given}. You've learned everything I can teach. Hunt alone and bring two pieces of prey to the fresh-kill pile — then you'll earn your warrior name!`, options: [{ label: 'I won\'t let you down!', action: done }], onClose: done });
        } else {
          g.ui.dialog({ speaker: c, text: `Not yet. You still need: ${missing.join(', ')}. ${c.id === pc.mentor ? 'I\'ll find you for lessons — or come and ask me.' : 'Ask your mentor for lessons.'}`, options: [{ label: 'I\'ll keep training', action: again }], onClose: done });
        }
      } });
    }
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
    if (!pc.exiled && Math.hypot(g.player.pos.x, g.player.pos.z) < 17.5 && g.mossBalls?.balls.length && !g.mossBalls.catchGame && c.stage !== 'elder' && (c.stage === 'kit' || c.stage === 'apprentice' || op > 15)) {
      opts.push({ label: 'Play catch with a moss ball', hint: 'whoever drops it loses', action: () => { g.ui.closeDialog(false); g.mossBalls.startCatch(a); } });
    }
    // famous cats from the books have quests
    if (g.quests.available(a)) opts.push({ label: '★ Do you need help with anything?', hint: 'a quest', action: () => g.quests.offer(a, done) });
    // share a StarClan dream with a medicine cat (or, if you are the medicine cat, with the leader)
    const proph = g.pendingProphecy;
    const healerPc = pc.role === 'medicine' || pc.role === 'medicineApprentice';
    if (proph && !proph.solved && ((c.role === 'medicine' && !healerPc) || (healerPc && c.role === 'leader'))) {
      opts.push({ label: '✨ Tell them about your StarClan dream', hint: 'they may understand it', action: () => {
        const MEANING: Record<string, [string, string]> = {
          fire: ['A red beast that eats the trees… that is fire.', 'We must clear the dry brush around camp and keep the kits near the stream. I will warn the leader.'],
          flood: ['A stream forgetting its banks — a flood is coming.', 'We will move the nursery bedding to high ground and keep the kits close.'],
          badger: ['Black and white in the dark… a badger! And the smallest — the kits.', 'I will ask the leader to set warriors on guard by the nursery every night.'],
          illness: ['A cold breath from den to den. Sickness — greencough, perhaps.', 'I will gather extra sunpetal and bitterroot while I still can.'],
          shortage: ['The forest holding its breath… the prey will vanish.', 'Tell the hunters to stock the fresh-kill pile now, while prey is fat.'],
          fox: ['Red fur at the border — a fox.', 'The border patrols must be doubled. I will speak to the deputy.'],
          storm: ['The sky roaring, great trees kneeling — a terrible storm.', 'Everyone must stay close to camp when the clouds gather.'],
        };
        const [meaning, plan] = MEANING[proph.type] ?? ['StarClan speaks in riddles…', 'We will be ready.'];
        proph.solved = true;
        proph.by = c.id;
        clan.adjust(c, pc, 5, { text: `${pc.given} shared a StarClan dream with me.`, weight: 3 });
        clan.remember(pc, `${displayName(c)} explained my StarClan dream: ${meaning}`, 4, c.id);
        g.ui.dialog({ speaker: c, text: `*listens with half-closed eyes* ${proph.omen ? `"${proph.omen.replace(/"/g, '')}"… ` : ''}${meaning} ${plan} Thank you for telling me — StarClan chose you for a reason.`, options: [{ label: 'I\'m glad I told you', action: again }, { label: 'Goodbye', action: done }], onClose: done });
        g.ui.toast('✨ The clan will prepare for what StarClan foretold.', 'good');
      } });
    }
    // pick a fight with a clanmate (never with friends)
    const isFriend = op >= 40 || c.mate === pc.id || isFamily(c, pc) || clan.opinion(pc, c) >= 40;
    if (!pc.exiled && c.stage !== 'kit' && !isFriend) opts.push({ label: 'Attack them!', hint: 'breaks the code', action: () => {
      done();
      const fightsBack = c.traits.includes('aggressive') || c.traits.includes('brave') || c.pers.aggression > 0.45 || (c.stage === 'warrior' && Math.random() < 0.6);
      clan.adjust(c, pc, -20, { text: `${pc.given} attacked me!`, weight: -6 });
      clan.infraction('obeyOrders', g.npcs.witnesses(g.player.pos.x, g.player.pos.z, 18), 'attacked a clanmate');
      if (fightsBack) {
        a.userAggressive = true;
        a.say(simRng.pick(['You want a fight? You\'ve got one!', '*HISS* Big mistake!', 'Fine — come on then!']), 3);
        g.combat.engage(a, g.player);
      } else {
        a.say(simRng.pick(['Hey! What\'s wrong with you?!', 'Get away from me!', 'I\'m telling the leader!']), 3);
        a.activity = 'flee'; a.mood = 'afraid';
        a.setTarget(a.pos.x + (a.pos.x - g.player.pos.x) * 4, a.pos.z + (a.pos.z - g.player.pos.z) * 4);
        setTimeout(() => { if (a.activity === 'flee') { a.activity = 'idle'; a.mood = 'neutral'; } }, 6000);
      }
    } });
    // kits can ask a grown cat for permission to go outside camp
    if (pc.stage === 'kit' && !pc.exiled && c.stage !== 'kit' && c.stage !== 'apprentice' && !((pc.outsideUntil ?? -1) > g.time.totalHours)) {
      opts.push({ label: 'Can I go outside the camp?', hint: 'ask permission', action: () => {
        const strict = c.traits.includes('serious') || c.traits.includes('suspicious');
        const soft = c.traits.includes('kind') || c.traits.includes('friendly') || c.traits.includes('playful') || c.role === 'medicine' || c.kits.includes(pc.id);
        let p = 0.45 + op / 150 + (soft ? 0.25 : 0) - (strict ? 0.25 : 0);
        if (g.time.isNight) p = 0.05;
        if (g.events.active.some((e) => ['fire', 'flood', 'badger', 'fox', 'dog'].includes(e.type))) p = 0;
        if (pc.confinedUntil !== null && pc.confinedUntil > g.time.day) p = 0;
        if (simRng.chance(clamp(p, 0, 0.95))) {
          pc.outsideUntil = g.time.totalHours + 4;
          pc.outsideBy = c.id;
          g.ui.dialog({ speaker: c, text: simRng.pick([
            'Alright, little one. You may go outside — but stay close to camp, and be back before long!',
            'Yes, you can explore for a while. Stay away from the Thunderpath and the borders!',
            '*purrs* Go on then. If anyone asks, tell them I said it was fine.',
          ]), options: [{ label: 'Thank you! ★', action: done }], onClose: done });
          g.ui.toast(`✅ ${displayName(c)} gave you permission to go outside camp for a while. No one will scold you.`, 'good');
        } else {
          g.ui.dialog({ speaker: c, text: g.time.isNight ? 'At night? Absolutely not. Back to the nursery with you.' : simRng.pick(['No. Kits stay in camp — it\'s the code.', 'Not today. It\'s too dangerous out there.', 'Ask me again when you\'re a little bigger.']), options: [{ label: 'Aww…', action: done }], onClose: done });
        }
      } });
    }
    // elders tell stories
    if ((c.stage === 'elder' || (c.stage === 'warrior' && c.age >= 28)) && c.lastStory !== g.time.day) opts.push({ label: 'Ask for a story', hint: 'older cats know the old tales', action: () => {
      const story = g.fun.tellStory(c);
      clan.adjust(c, pc, 4, undefined, 3);
      pc.skills.knowledge = Math.min(99, pc.skills.knowledge + 1);
      for (const k of g.npcs.agents.values()) if (k.cat.stage === 'kit' && k.cat.clan === 'home' && dist2(k.pos.x, k.pos.z, a.pos.x, a.pos.z) < 12 && k.activity === 'idle') { k.setTarget(a.pos.x + simRng.range(-1, 1), a.pos.z + simRng.range(-1, 1)); clan.adjust(k.cat, c, 2); }
      g.ui.dialog({ speaker: c, text: story, options: [{ label: 'Wow… thank you', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
    // playground games
    if (!pc.exiled && !g.fun.game2 && (c.stage === 'kit' || c.stage === 'apprentice' || (op > 25 && c.stage !== 'elder'))) {
      opts.push({ label: 'Play hide-and-seek', hint: 'find them!', action: () => { g.ui.closeDialog(false); g.fun.startHide(a); } });
      opts.push({ label: 'Play chase', hint: 'catch them!', action: () => { g.ui.closeDialog(false); g.fun.startChase(a); } });
    }
    // grown cats can tell kits stories and teach them to pounce
    if (c.stage === 'kit' && (pc.stage === 'warrior' || pc.stage === 'elder')) {
      if (c.lastStory !== g.time.day) opts.push({ label: 'Tell the kits a story', hint: 'kits nearby gather round', action: () => {
        c.lastStory = g.time.day;
        let n = 0;
        for (const k of g.npcs.agents.values()) if (k.cat.stage === 'kit' && k.cat.clan === 'home' && dist2(k.pos.x, k.pos.z, g.player.pos.x, g.player.pos.z) < 15) { n++; clan.adjust(k.cat, pc, 6, { text: `${pc.given} told us a story!`, weight: 2 }); k.setTarget(g.player.pos.x + simRng.range(-1.2, 1.2), g.player.pos.z + simRng.range(-1.2, 1.2)); }
        pc.reputation = clamp(pc.reputation + 1, -100, 100);
        g.ui.dialog({ speaker: c, text: `*${n > 1 ? `${n} kits pile around you,` : 'eyes wide,'} ears pricked* And then what happened?! Tell it again! Tell it again!`, options: [{ label: '*purrs*', action: again }, { label: 'Goodbye', action: done }], onClose: done });
      } });
      opts.push({ label: 'Teach them to pounce', hint: 'a hunting lesson', action: () => {
        c.skills.hunting = Math.min(99, c.skills.hunting + 3);
        clan.adjust(c, pc, 5, { text: `${pc.given} taught me how to pounce!`, weight: 3 });
        a.forcedPose = 'crouch';
        setTimeout(() => (a.forcedPose = null), 2500);
        g.ui.dialog({ speaker: c, text: simRng.pick(['*wiggles bottom… POUNCE!* Did you see? Did you see?!', 'Tail low, eyes on the prey… got it! I\'m going to be the best hunter EVER!', '*pounces on your tail* Oops. That counts, right?']), options: [{ label: 'Well done!', action: again }, { label: 'Goodbye', action: done }], onClose: done });
      } });
    }
    // races
    if (!pc.exiled && c.stage !== 'elder' && !g.fun.race && (c.stage === 'kit' || c.stage === 'apprentice' || op > 20)) {
      opts.push({ label: 'Challenge them to a race', hint: 'first one there wins', action: () => { g.ui.closeDialog(false); g.fun.startRace(a); } });
    }
    // flowers calm angry cats (and cheer up happy ones)
    if (pc.flowers?.length) opts.push({ label: `Give ${pronoun(c, 'obj')} a ${FLOWER_INFO[pc.flowers[0] as FlowerKind].name} 🌸`, hint: a.mood === 'angry' || op < 0 ? 'it might calm them down' : 'a little gift', action: () => {
      const fl = FLOWER_INFO[pc.flowers!.shift() as FlowerKind].name;
      const wasAngry = a.mood === 'angry' || op < 0;
      a.mood = 'neutral';
      clan.adjust(c, pc, wasAngry ? 15 : 6, { text: `${pc.given} gave me a ${fl}.`, weight: 2 });
      g.audio.purr();
      const isMate = pc.mate === c.id || c.mate === pc.id;
      if (isMate) { clan.adjust(c, pc, 4, { text: `${pc.given} brought me a ${fl}. I'll tell our kits about it one day.`, weight: 3 }); g.ui.dialog({ speaker: c, text: '*purr* I\'m going to tell our kits about this when they grow up! *purr*', options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done }); return; }
      g.ui.dialog({ speaker: c, text: wasAngry ? `*sniffs the ${fl}… and their fur slowly flattens* …Alright. I'm not angry anymore. Thank you.` : simRng.pick([`A ${fl}! It smells wonderful. Thank you!`, `*tucks the ${fl} behind an ear* How do I look?`, `You picked this for me? *purrs*`]), options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
    // gifts
    if (pc.treasures?.length) opts.push({ label: `Give ${pronoun(c, 'obj')} your ${TREASURE_INFO[pc.treasures[0] as TreasureKind].name} ✨`, hint: 'a gift', action: () => {
      const line = g.fun.giveTreasure(a);
      g.ui.dialog({ speaker: c, text: line, options: [{ label: 'Continue', action: again }, { label: 'Goodbye', action: done }], onClose: done });
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
    if ((pc.role === 'medicine' || pc.role === 'medicineApprentice') && (hurt(c) || (c.stage === 'elder' && this.healedDay.get(c.id) !== g.time.day)) && c.id !== pc.id) {
      opts.push({ label: `Treat ${pronoun(c, 'poss')} ${c.sick > c.injury ? 'sickness' : 'wounds'}`, action: () => this.treatCat(a, done) });
    }
    // a queen in labour: the medicine cat helps her
    if (c.labour && (pc.role === 'medicine' || pc.role === 'medicineApprentice')) opts.unshift({ label: '🍼 Help her give birth', action: () => { done(); clan.helpBirth(c); } });
    // name (or rename) your own young kits
    if (c.stage === 'kit' && c.age < 3 && c.parents.includes(pc.id)) opts.push({ label: `Give ${pronoun(c, 'obj')} a new name`, hint: `${c.given}kit`, action: () => {
      done();
      const pool = ['Moss', 'Bramble', 'Fern', 'Sky', 'Pebble', 'Ember', 'Willow', 'Hazel', 'Robin', 'Ivy', 'Thistle', 'Dove'];
      const opts2 = new Set<string>([c.given]);
      while (opts2.size < 3) opts2.add(simRng.pick(pool));
      g.ui.nameChoice('Name your kit', `What should ${c.given}kit be called? (They'll be ___kit, then ___paw.)`, [...opts2].map((o) => o + 'kit'), (picked) => {
        let nm = picked.replace(/kit$/i, '').trim();
        nm = nm.charAt(0).toUpperCase() + nm.slice(1).toLowerCase();
        if (nm) { clan.usedNames.delete(c.given); c.given = nm; clan.usedNames.add(nm); g.ui.toast(`Your kit is now ${nm}kit!`, 'good'); }
      });
    } });
    // crushes between young cats
    const youngCat = (x: Cat) => x.stage === 'kit' || x.stage === 'apprentice';
    if (youngCat(pc) && youngCat(c) && !isFamily(c, pc) && pc.crush !== c.id) opts.push({ label: '💕 Tell them you have a crush', hint: 'eep!', action: () => {
      const likes = c.crush === pc.id || (op > 30 && simRng.chance(0.4 + op / 200));
      pc.crush = c.id;
      clan.rel(pc, c).romance = clamp(clan.rel(pc, c).romance + 20, 0, 100);
      if (likes) { c.crush = pc.id; clan.rel(c, pc).romance = clamp(clan.rel(c, pc).romance + 25, 0, 100); clan.adjust(c, pc, 8, { text: `${pc.given} told me they have a crush on me!`, weight: 5 }); }
      else clan.adjust(c, pc, -1);
      g.audio.purr();
      g.ui.dialog({ speaker: c, text: likes ? simRng.pick(['*blushes all the way to the tips of their ears* I… I like you too!', '*squeaks* Really?! Me too! Don\'t tell anyone!', '*hides face behind tail* You\'re my favourite cat in the whole clan.']) : simRng.pick(['*giggles* Ew! Crushes are yucky!', 'Oh… um. I like someone else. Sorry!', '*blinks* We\'re friends, silly!']), options: [{ label: likes ? '💕' : 'Oh…', action: again }, { label: 'Goodbye', action: done }], onClose: done });
    } });
    // family: nurse from your mother, let your kits nurse, play with your kits / your parents
    const myMum = pc.stage === 'kit' && pc.parents?.[0] === c.id;
    const myParent = pc.stage === 'kit' && pc.parents?.includes(c.id);
    const myKit = c.stage === 'kit' && c.parents?.includes(pc.id);
    if (myMum && a.queenRest) opts.unshift({ label: '🍼 Drink milk', hint: 'snuggle up to your mother', action: () => {
      done();
      const px = Math.cos(a.heading - Math.PI / 2), pz = Math.sin(a.heading - Math.PI / 2);
      const x = a.pos.x + px * 0.3, z = a.pos.z + pz * 0.3;
      const heading = Math.atan2(a.pos.z - z, a.pos.x - x);
      g.player.placeAt(x, z, -heading - Math.PI / 2);
      g.player.heading = heading;
      g.player.holdSpot = { x, z, until: g.clock + 18, heading };
      g.player.posePick = 'suckle';
      a.nursingUntil = g.clock + 18;
      pc.hunger = 100;
      clan.adjust(c, pc, 3);
      a.say(simRng.pick(['*purrs* There you go, little one.', 'Drink up — you\'ll grow big and strong.', '*licks your head* My sweet kit.']), 3);
      g.ui.toast('🍼 You snuggle against your mother\'s warm belly and drink her milk. You\'re full!', 'good');
    } });
    if (myParent || myKit) opts.unshift({ label: myKit ? `🐾 Play with ${c.given}kit` : `🐾 Play with ${c.sex === 'she' ? 'Mama' : 'Papa'}`, hint: 'pounce and roll about', action: () => {
      done();
      if (myKit) g.npcs.startParentPlay(a, 'player');
      else {
        const dur = 16;
        if (a.queenRest) a.nursingUntil = g.clock + dur;
        else { g.npcs.endConvo(a); a.activity = 'parentPlay'; a.playWith = 'player'; a.actTimer = dur; a.target = null; }
        a.say(simRng.pick([`Come here, ${pc.given}kit! Show me your best pounce!`, '*rolls over* Oof! You got me!', 'Catch my tail if you can!']), 3);
      }
      clan.adjust(c, pc, 4, { text: myKit ? `My ${pc.sex === 'she' ? 'mother' : 'father'} played with me!` : `I played with my kit ${pc.given}.`, weight: 3 });
      g.audio.purr();
    } });
    if (myKit && c.parents?.[0] === pc.id && isQueen(pc, (id) => clan.get(id))) opts.unshift({ label: '🍼 Let your kits nurse', hint: 'they snuggle up for milk', action: () => {
      done();
      const kits = pc.kits.map((k) => g.npcs.agents.get(k)).filter((k): k is NpcAgent => !!k && k.cat.stage === 'kit' && k.cat.alive && Math.hypot(k.pos.x - g.player.pos.x, k.pos.z - g.player.pos.z) < 12);
      for (const k of kits) g.npcs.startSuckle(k, 'player');
      g.player.posePick = 'layDown';
      g.player.holdSpot = { x: g.player.pos.x, z: g.player.pos.z, until: g.clock + 22, heading: g.player.heading };
      g.ui.toast(`🍼 You lie down on your side and ${kits.length > 1 ? 'your kits snuggle' : 'your kit snuggles'} up to drink your milk.`, 'good');
    } });
    // your mate grooms you until you fall asleep
    if (pc.mate === c.id && c.mate === pc.id && clan.grownUp(c)) opts.unshift({ label: '😴 Groom me to sleep', hint: 'they stay with you until you wake', action: () => {
      done();
      g.npcs.endConvo(a);
      a.tuckIn = true; a.tuckSlept = false; a.tuckBest = undefined; a.tuckStuck = 0;
      a.say(simRng.pick(['Lie down, my love. I\'ll groom you until you fall asleep.', '*purrs* Come here. Close your eyes.', 'Rest — I\'m not going anywhere.']), 4);
      clan.adjust(c, pc, 3);
      g.player.posePick = 'lie';
      g.player.holdSpot = { x: g.player.pos.x, z: g.player.pos.z, until: g.clock + 30, heading: g.player.heading };
      const tryNod = (left: number) => setTimeout(() => {
        if (!a.tuckIn || g.player.sleeping) return;
        const close = a.forcedPose === 'groomOther' || Math.hypot(a.pos.x - g.player.pos.x, a.pos.z - g.player.pos.z) < 1.2;
        if (close || left <= 0) { g.ui.toast(`💤 ${displayName(c)} gently grooms you… your eyes grow heavy…`, 'good'); setTimeout(() => { if (!g.player.sleeping) g.sleep(); }, 4000); }
        else tryNod(left - 1);
      }, 3000);
      tryNod(6);
    } });
    // your mate resting in the nursery: groom her while she naps, or sleep beside her
    const queenMate = c.sex === 'she' && (c.mate === pc.id || pc.mate === c.id) && isQueen(c, (id) => clan.get(id));
    if (queenMate) {
      const besideHer = () => {
        const n = g.camp.dens.nursery;
        let dx = n.x - a.pos.x, dz = n.z - a.pos.z;
        const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
        const x = a.pos.x + dx * 0.5, z = a.pos.z + dz * 0.5;
        const heading = Math.atan2(a.pos.z - z, a.pos.x - x);
        g.player.placeAt(x, z, -heading - Math.PI / 2); // face her
        g.player.heading = heading;
        g.player.holdSpot = { x, z, until: g.clock + 60, heading };
      };
      opts.unshift({ label: '💤 Sleep beside her', hint: 'curl up together until you wake', action: () => {
        done();
        if (g.combat.playerInCombat) { g.ui.toast('You can\'t sleep while in danger!', 'danger'); return; }
        besideHer();
        a.napUntil = g.clock + 20;
        a.say(simRng.pick(['*snuggles close* Stay with me…', 'Mmm… you\'re so warm.', '*purrs sleepily* Goodnight, my love.']), 3);
        clan.adjust(c, pc, 4, { text: `${pc.given} slept beside me in the nursery.`, weight: 3 });
        clan.adjust(pc, c, 2);
        g.audio.purr();
        setTimeout(() => g.sleep(), 1200);
      } });
      opts.unshift({ label: '🐾 Groom her', hint: 'she drifts off to sleep', action: () => {
        done();
        besideHer();
        g.player.posePick = 'groomOther';
        a.napUntil = g.clock + 60;
        a.forcedPose = 'sleep';
        a.say(simRng.pick(['*purrs* Mmm… that feels so nice…', '*yawns* Don\'t stop… zzz…', 'You always know what I need… *drifts off*']), 3.5);
        clan.adjust(c, pc, 5, { text: `${pc.given} groomed me until I fell asleep.`, weight: 3 });
        clan.adjust(pc, c, 2);
        g.audio.purr();
        g.ui.toast(`🐾 You gently groom ${displayName(c)}. She falls asleep, purring.`, 'good');
      } });
    }
    // have kits with your mate
    const mother = (pc.mate === c.id || c.mate === pc.id) ? clan.mateMother(pc, c) : null;
    if (mother && clan.grownUp(pc) && clan.grownUp(c)) {
      const she = mother;
      const lastLitter = she.lastLitterDay ?? Math.max(-999, ...she.kits.map((k) => clan.get(k)?.bornDay ?? -999));
      const busyKits = she.expectingUntil !== null || g.time.day - lastLitter < 3;
      if (!busyKits) opts.push({ label: 'Ask to have kits together', hint: 'they\'d arrive in two moons', action: () => {
        she.expectingUntil = g.time.day + 2;
        clan.adjust(c, pc, 6, { text: `${pc.given} and I are going to have kits!`, weight: 8 });
        clan.log(`${displayName(she)} is expecting ${displayName(she === pc ? c : pc)}'s kits.`, 'clan');
        g.audio.purr();
        g.ui.dialog({ speaker: c, text: she === pc ? '*purrs so loud the whole den can hear* Kits! Our kits! You should rest in the nursery, my love.' : '*eyes shining* Kits… our own kits. I\'ll move to the nursery. Will you bring me fresh-kill?', options: [{ label: '*presses close*', action: done }], onClose: done });
        g.notify(she === pc ? 'You are expecting kits! They will arrive in two moons. You will get to name them.' : `${displayName(c)} is expecting your kits! You will get to name them.`);
        g.ui.showBanner(she === pc ? `🍼 You are expecting kits with ${displayName(c)}!` : `🍼 Your mate ${displayName(c)} is expecting your kits!`, 7);
      } });
      else opts.push({ label: 'When will we have kits?', action: () => {
        const wait = Math.max(0, 3 - (g.time.day - lastLitter));
        const text = she.expectingUntil !== null ? `${she === pc ? 'You are' : 'I am'} already expecting! The kits will come in ${Math.max(0, she.expectingUntil - g.time.day)} moon${she.expectingUntil - g.time.day === 1 ? '' : 's'}.`
          : `We had kits not long ago. In ${wait} more moon${wait === 1 ? '' : 's'} we can have more.`;
        g.ui.dialog({ speaker: c, text, options: [{ label: '*purr*', action: done }], onClose: done });
      } });
    }
    // unmate — only the label changes, nobody gets upset
    if (pc.mate === c.id || c.mate === pc.id) opts.push({ label: '💔 Unmate', hint: 'just removes the mate label', action: () => {
      g.ui.dialog({ speaker: c, text: `*blinks* You want us to just be clanmates again? That's alright — I'm still your friend.`, options: [
        { label: '💔 Yes, unmate', action: () => { clan.unmate(pc, c); g.ui.toast(`You and ${displayName(c)} are no longer mates.`, 'info'); done(); } },
        { label: 'Never mind', action: done },
      ], onClose: done });
    } });
    // mates
    const pr = clan.rel(c, pc);
    if (pc.mate !== c.id && c.mate !== pc.id) {
      opts.push({ label: 'Ask to become mates', hint: `they ${pr.romance > 40 ? 'seem fond of you' : 'may not feel the same'}`, action: () => {
        // some cats can't say yes — they tell you why
        const no = (text: string) => g.ui.dialog({ speaker: c, text, options: [{ label: 'Oh… okay', action: again }, { label: 'Goodbye', action: done }], onClose: done });
        if (!clan.grownUp(pc)) return no('*blinks* You\'re far too young for that! Come back when you\'re a warrior.');
        if (!clan.grownUp(c)) return no(c.stage === 'kit' ? '*giggles* I\'m just a kit! Mates are for grown-up cats.' : 'I\'m only an apprentice! I need to finish my training first.');
        if (isFamily(c, pc)) return no('*wrinkles nose* We\'re family! That would be so weird.');
        if (pc.mate) { const m = clan.get(pc.mate); return no(`You already have a mate${m ? ` — ${displayName(m)}` : ''}! What would they say?`); }
        if (c.mate) { const m = clan.get(c.mate); return no(`I'm sorry… I already have a mate${m ? `, ${displayName(m)}` : ''}.`); }
        if (c.clan !== pc.clan && c.clan !== 'home') return no('Mates? With a cat from another clan? That\'s against the warrior code!');
        this.proposeMate(a, done);
      } });
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
    if (isExpecting(c) && simRng.chance(0.8)) {
      const m = clan.get(c.mate);
      const left = c.expectingUntil !== null ? c.expectingUntil - g.time.day : 0;
      const kitLines = [
        '*rests a paw on her round belly* I can feel them kicking! They\'re going to be strong, I just know it.',
        left <= 1 ? 'It won\'t be long now… the medicine cat says any day.' : `Only ${left} more moons until my kits come.`,
        'I\'m so slow these days. I can barely chase a mouse, let alone fight!',
        'I keep thinking of names for my kits. Do you have any ideas?',
        m ? `${displayName(m)} brings me fresh-kill every day. I think they\'re more nervous than I am!` : 'I wonder if my kits will look like me.',
        'The nursery moss is so soft. I don\'t want to leave it — my kits are heavy!',
        'I hope they\'re healthy… StarClan, watch over them.',
        'Will you play with my kits when they\'re born? They\'ll need clanmates like you.',
      ];
      return simRng.chance(0.6) ? queenComplaint(c, (l) => simRng.pick(l), clan.get(c.mate)) : simRng.pick(kitLines);
    }
    if (c.mate) { const m = clan.get(c.mate); if (m) lines.push(`${displayName(m)} and I watched the stars last night.`); }
    if (c.apprentice) { const ap = clan.get(c.apprentice); if (ap) lines.push(`${ap.given} is learning quickly. ${pronoun(ap, 'subj').replace(/^./, (s) => s.toUpperCase())} might make a fine warrior.`); }
    if (c.sick > 30) lines.push('*cough* This sickness has me weak as a newborn kit.');
    if (c.injury > 30) lines.push('My leg still aches from that fight.');
    if (c.stage === 'elder') lines.push(simRng.pick(['In my day, we hunted in the snow without complaint.', 'The Long Meadow calls to me some nights. Not yet, though.', `I remember when ${clan.leader ? displayName(clan.leader) : 'our Warden'} was a scrawny kit.`]));
    if (c.stage === 'kit') lines.push(simRng.pick(['When I grow up I\'m going to fight a badger!', 'Do you know any stories?', 'I found a feather! It\'s mine.']));
    if (c.crush) {
      const cr = clan.get(c.crush);
      if (cr && cr === pc) return simRng.pick([`*blushes and looks at their paws* Um… hi, ${displayName(pc)}…`, '*tail twitches shyly* D-do you want to play with me later?', '*squeaks* Oh! I wasn\'t staring at you! …Okay maybe a little.']);
      if (cr && simRng.chance(0.6)) return simRng.pick([`*whispers* Don't tell anyone, but I have a crush on ${displayName(cr)}!`, `Do you think ${displayName(cr)} likes me? *blushes*`, `${displayName(cr)} has the prettiest eyes in the whole clan…`, `I saved the best feather for ${displayName(cr)}. Is that weird?`]);
    }
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
    const hurtMe = g.player.poison > 0 || pc.sick > 10 || pc.injury > 10 || pc.health < pc.maxHealth - 15;
    if (c.role === 'medicine' && hurtMe) {
      // a medicine cat never refuses a patient, even half asleep
      a.say(simRng.pick(['*yawns* You\'re hurt? Come here, let me see.', 'Mmf… wounded? Right. Herbs. Hold still.', 'Wha—? Oh, you\'re hurt! Quickly, into the den.']), 3);
      setTimeout(() => {
        this.seekHealing(c);
        if (simRng.chance(0.6)) setTimeout(() => { if (a.activity === 'idle') { a.say('*curls back up* Wake me if it gets worse…', 3); a.activity = 'sleep'; a.actTimer = 40; } }, 5000);
        else a.say('I\'m awake now anyway. I\'ll sort the herbs.', 3);
      }, 900);
      return;
    }
    if (clan.opinion(c, pc) >= 45 && !grumpy && simRng.chance(0.7)) {
      a.say(simRng.pick([`*blinks* ${pc.given}? For you, I'll get up. What's wrong?`, 'Mm? Can\'t sleep either? Come, sit with me.', '*stretches* Alright, alright, I\'m up. What is it?']), 3.5);
      clan.adjust(c, pc, 1);
      setTimeout(() => { if (a.activity === 'idle') this.talk(a); }, 700);
      return;
    }
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
      clan.matesFormed(pc, c);
      r.romance = 90;
      clan.rel(pc, c).romance = 90;
      clan.log(`${displayName(pc)} and ${displayName(c)} became mates.`, 'clan');
      clan.remember(pc, `${displayName(c)} became my mate.`, 10, c.id);
      clan.remember(c, `${displayName(pc)} and I became mates.`, 10, pc.id);
      clan.setRecent(`${pc.given} and ${c.given} are mates!`);
      g.audio.purr();
      const mum = clan.mateMother(pc, c);
      const expecting = !!mum && mum.expectingUntil !== null;
      g.ui.dialog({ speaker: c, text: 'Yes. Yes, of course! I\'ve hoped you would ask.' + (expecting ? (mum === c ? ' …And — I\'m expecting your kits! I\'ll go rest in the nursery.' : ' And our kits… you should go rest in the nursery, my love.') : ''), options: [{ label: '*purr*', action: done }], onClose: done });
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
    // forbidden romance across clan borders
    if (isRival && !pc.exiled && (pc.stage === 'warrior' || pc.stage === 'apprentice') && c.stage !== 'kit' && c.stage !== 'elder' && c.sex !== pc.sex && !a.hostile) {
      const r = clan.rel(c, pc);
      const caughtCheck = (risk: number) => {
        const w = g.npcs.witnesses(g.player.pos.x, g.player.pos.z, 28);
        if (w.length || simRng.chance(risk)) {
          clan.infraction('helpOutsiders', w.length ? w : (clan.leader && !clan.leader.isPlayer ? [clan.leader.id] : []), `secret romance with a ${clanName} cat`);
          g.ui.toast(`⚠ Strike! Someone saw you with ${displayName(c)} of ${clanName}. A forbidden romance breaks the code!`, 'danger');
          return true;
        }
        return false;
      };
      if (pc.secretMate === c.id) {
        opts.push({ label: 'Meet in secret 💕', hint: 'you might get caught!', action: () => {
          r.romance = clamp(r.romance + 5, 0, 100);
          clan.adjust(c, pc, 4);
          const caught = caughtCheck(0.12);
          g.audio.purr();
          g.ui.dialog({ speaker: c, text: caught ? '*ears flatten* Someone saw us! Go — quickly!' : simRng.pick(['I counted the moons until I could see you again.', '*presses close* Our clans would never understand… but I don\'t care.', 'Meet me by the border stones at moonhigh?']), options: [{ label: '*purrs*', action: done }], onClose: done });
        } });
      } else {
        opts.push({ label: 'Flirt', hint: 'forbidden — careful!', action: () => {
          const likes = op > 5 && !c.mate;
          if (likes) { r.romance = clamp(r.romance + 8, 0, 100); clan.adjust(c, pc, 3); }
          else clan.adjust(c, pc, -2);
          const caught = caughtCheck(0.05);
          g.ui.dialog({ speaker: c, text: caught ? 'We shouldn\'t be seen like this!' : likes ? simRng.pick(['*whiskers twitch* You\'re bold, for a ' + g.territories.homeName + ' cat.', 'Maybe I\'ll see you at the next Gathering…', '*purrs quietly* Don\'t let anyone hear you say that.']) : 'Hmph. Go back to your own clan.', options: [{ label: 'Farewell', action: done }], onClose: done });
        } });
        if (!pc.mate && !pc.secretMate && r.romance >= 30 && op >= 35 && !c.mate) opts.push({ label: 'Ask to be your secret mate 💕', hint: 'forbidden — you might get caught!', action: () => {
          const yes = r.romance >= 45 || simRng.chance(0.5);
          const caught = caughtCheck(0.08);
          if (yes) {
            pc.secretMate = c.id; c.secretMate = pc.id;
            r.romance = clamp(r.romance + 10, 0, 100);
            clan.remember(pc, `${c.given} of ${clanName} and I are secret mates. No one can know.`, 8, c.id);
          }
          g.ui.dialog({ speaker: c, text: yes ? `*glances around, then touches noses with you* Yes. But no one can ever know — not your clan, not mine.${caught ? ' …Oh no. Did someone see us?' : ''}` : 'I… I can\'t. It\'s against the code. I\'m sorry.', options: [{ label: yes ? '💕' : 'I understand', action: done }], onClose: done });
        } });
      }
    }
    if (!truce && isRival) opts.push({ label: 'Challenge them', hint: 'fight', action: () => { done(); a.hostile = true; a.userAggressive = true; g.combat.engage(a, g.player); } });
    if (c.clan === 'loner' && !pc.exiled && clan.leader && !clan.leader.isPlayer) opts.push({ label: 'Suggest they ask to join the clan', action: () => {
      clan.adjust(c, pc, 5);
      g.ui.dialog({ speaker: c, text: 'Maybe I will. Thank you for the kindness.', options: [{ label: 'Farewell', action: done }], onClose: done });
    } });
    opts.push({ label: 'Leave', action: done });
    g.ui.dialog({ speaker: c, text, sub: isRival ? `${clanTitle(clanName)}` : 'Loner', options: opts, onClose: done, input: (t) => this.freeTalk(a, t, done) });
  }

  private outsiderChat(c: Cat): string {
    const pc = this.game.clan.player;
    const op = this.game.clan.opinion(c, pc);
    if (pc.lifestyle === 'kittypet') return simRng.pick(op > 20
      ? ['You\'re not like other kittypets. You\'ve got the heart of a warrior, I think.', 'Do your Twolegs really give you food in a bowl? Every day?', 'Your collar jingles every time you move! Every mouse in the forest can hear you.']
      : ['Kittypets don\'t belong in the forest. You\'re soft and you smell like Twolegs.', 'Go home to your Twolegs, kittypet.', 'Hmph. A kittypet who wants to play warrior.']);
    if (pc.lifestyle === 'rogue') return simRng.pick(op > 20 ? ['Not all rogues are bad, I suppose.', 'I\'ll pretend I didn\'t see you. This time.'] : ['I don\'t talk to rogues. Get out of here before the patrol comes.', 'Rogues steal our prey and attack our kits. Why should I trust you?']);
    return simRng.pick(op > 20 ? ['Living alone must be hard. Do you ever get lonely?', 'You\'re a good hunter, for a loner.'] : ['Loners don\'t follow the warrior code. Keep to your own patch.', 'What do you want, loner?']);
  }

  /** A kittypet, loner or rogue asks a clan cat to be taken into the clan. */
  private askJoin(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    const dayKey = `join:${c.id}:${g.time.day}`;
    if (this.boredAsked.has(dayKey)) { g.ui.dialog({ speaker: c, text: 'You already asked me today. Come back another time.', options: [{ label: 'Alright', action: done }], onClose: done }); return; }
    this.boredAsked.add(dayKey);
    const op = clan.opinion(c, pc);
    const leaderOp = clan.leader ? clan.opinion(clan.leader, pc) : 0;
    const isLeader = c.role === 'leader';
    let chance = 0.18 + op / 120 + leaderOp / 200 + (isLeader ? 0.2 : 0) + (pc.lifestyle === 'loner' ? 0.08 : pc.lifestyle === 'rogue' ? -0.12 : 0) + pc.skills.hunting / 400;
    chance = clamp(chance, 0.05, 0.9);
    if (!simRng.chance(chance)) {
      clan.adjust(c, pc, 1);
      g.ui.dialog({ speaker: c, text: pc.lifestyle === 'kittypet' ? 'A kittypet in the clan? You wouldn\'t last a moon. Prove you can hunt and fight, and maybe I\'ll speak to the leader.' : 'Not yet. Clan cats need to trust you first. Help us, hunt for us, and ask again.', options: [{ label: 'I\'ll prove myself', action: done }], onClose: done });
      return;
    }
    const leader = clan.leader;
    const leaderName = leader ? displayName(leader) : 'The leader';
    const wasKp = pc.lifestyle === 'kittypet';
    pc.exiled = false;
    pc.clan = 'home';
    pc.lifestyle = 'clan';
    pc.infractions = 0;
    pc.reputation = Math.max(pc.reputation, -5);
    pc.app = { ...pc.app, accessories: (pc.app.accessories ?? []).filter((x) => x !== 'collar' && x !== 'bellCollar') };
    pc.stage = 'apprentice';
    pc.age = Math.max(pc.age, 6);
    g.objectives.list = g.objectives.list.filter((o) => o.id !== 'exile');
    const mentor = clan.pickMentor(pc);
    if (mentor) { pc.mentor = mentor.id; mentor.apprentice = pc.id; clan.adjust(pc, mentor, 10); }
    g.player.attach();
    clan.log(`${pc.given} the ${wasKp ? 'kittypet' : 'outsider'} joined the clan as ${displayName(pc)}.`, 'ceremony');
    clan.remember(pc, `I joined the clan. I am ${displayName(pc)} now${wasKp ? ', and I left my collar behind' : ''}.`, 10);
    g.npcs.syncRoster();
    g.ui.dialog({ speaker: c, text: isLeader ? `Very well. From this day on, you will be known as ${displayName(pc)}.` : `I spoke to ${leaderName}. You can join us! Come to camp — you'll be an apprentice.`, options: [{ label: 'Thank you!', action: () => {
      done();
      g.ceremony(`${leaderName}: "This ${wasKp ? 'kittypet' : 'cat'} has asked to join us. From this day on, you will be known as ${displayName(pc)}.${mentor ? ` ${displayName(mentor)} will be your mentor.` : ''}"`, [pc.id, mentor?.id ?? '']);
      if (wasKp) g.ui.toast('You wriggle out of your jingly collar and leave it in the grass. You are a clan cat now!', 'good');
      g.onPlayerStageChange();
    } }], onClose: done });
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
  /** A clanmate walks up and starts a conversation on their own. */
  private npcChat(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    const inCamp = Math.hypot(g.player.pos.x, g.player.pos.z) < 17.5;
    const young = c.stage === 'kit' || c.stage === 'apprentice';
    const others = clan.home().filter((x) => x.id !== c.id && !x.isPlayer);
    const reply = (text: string, dOp = 0) => () => {
      clan.adjust(c, pc, dOp, undefined, 3);
      g.ui.dialog({ speaker: c, text, options: [{ label: 'Goodbye', action: done }], onClose: done });
    };
    const topics: { w: number; run: () => void }[] = [];
    // share tongues
    if (c.stage !== 'kit') topics.push({ w: 2, run: () => g.ui.dialog({ speaker: c, text: simRng.pick([`${pc.given}! Your fur's a mess. Want to share tongues?`, 'Share tongues with me? It\'s been a long day.']), options: [
      { label: 'Sure!', action: () => { clan.adjust(c, pc, 4, { text: `${pc.given} and I shared tongues.`, weight: 2 }); clan.adjust(pc, c, 2); a.forcedPose = 'groom'; setTimeout(() => (a.forcedPose = null), 3000); g.audio.purr(); reply('*purrs* That\'s better.')(); } },
      { label: 'Maybe later', action: reply('Oh. Alright then.', -1) },
    ], onClose: done }) });
    // eat together
    if (inCamp && clan.food >= 1) topics.push({ w: 2, run: () => g.ui.dialog({ speaker: c, text: 'I\'m starving. Want to share a piece of fresh-kill with me?', options: [
      { label: 'Yes, let\'s eat!', action: () => this.shareFreshKill(a, done) },
      { label: 'I\'m not hungry', action: reply('More for me, then!') },
    ], onClose: done }) });
    // play
    if (young && inCamp && g.mossBalls?.balls.length && !g.mossBalls.catchGame) topics.push({ w: 3, run: () => g.ui.dialog({ speaker: c, text: `${pc.given}! Play catch with me? Pleeease?`, options: [
      { label: 'Okay!', action: () => { g.ui.closeDialog(false); g.mossBalls.startCatch(a); } },
      { label: 'Not now', action: reply('Aww…', -1) },
    ], onClose: done }) });
    if (c.stage !== 'elder' && !g.fun.race) topics.push({ w: young ? 2 : 1, run: () => g.ui.dialog({ speaker: c, text: simRng.pick(['Bet I can beat you in a race!', 'I\'m feeling fast today. Race me?']), options: [
      { label: 'You\'re on!', action: () => { g.ui.closeDialog(false); g.fun.startRace(a); } },
      { label: 'No thanks', action: reply('Scared you\'ll lose? *teasing purr*') },
    ], onClose: done }) });
    // hunt together
    if (c.stage === 'warrior' && (pc.stage === 'warrior' || pc.stage === 'apprentice') && pc.role !== 'medicine' && pc.role !== 'medicineApprentice') topics.push({ w: 1.5, run: () => g.ui.dialog({ speaker: c, text: 'I\'m heading out to hunt. Want to come with me?', options: [
      { label: 'Let\'s go!', action: () => { done(); a.activity = 'follow'; a.followTarget = 'player'; g.ui.toast(`${a.name} is hunting with you. Lead the way!`, 'info'); clan.adjust(c, pc, 3); } },
      { label: 'Another time', action: reply('Suit yourself.') },
    ], onClose: done }) });
    // gossip
    const mates = others.filter((x) => x.mate && clan.get(x.mate)?.alive);
    const foes = others.filter((x) => others.some((y) => y !== x && (x.relations[y.id]?.opinion ?? 0) < -30));
    if (others.length > 2) topics.push({ w: c.traits.includes('mischievous') || c.pers.sociability > 0.6 ? 3 : 1.5, run: () => {
      let line = '';
      if (mates.length && simRng.chance(0.5)) { const m = simRng.pick(mates); line = `Have you noticed how ${displayName(m)} looks at ${displayName(clan.get(m.mate)!)}? They're always sharing tongues…`; }
      else if (foes.length) { const f = simRng.pick(foes); const e = others.find((y) => (f.relations[y.id]?.opinion ?? 0) < -30)!; line = `Don't tell anyone, but ${displayName(f)} can't stand ${displayName(e)}. I saw them hiss at each other by the fresh-kill pile!`; }
      else { const x = simRng.pick(others); line = `Did you hear? ${displayName(x)} ${simRng.pick(['caught a squirrel twice their size', 'fell in the stream yesterday', 'snores louder than a badger', 'has been sneaking extra fresh-kill'])}!`; }
      g.ui.dialog({ speaker: c, text: line, options: [
        { label: 'Really?! Tell me more!', action: reply('*whispers* I\'ve said too much already…', 2) },
        { label: 'We shouldn\'t gossip', action: reply(c.traits.includes('mischievous') ? 'You\'re no fun.' : 'You\'re right. Forget I said anything.', c.traits.includes('loyal') ? 2 : -1) },
      ], onClose: done });
    } });
    // opinion question
    if (others.length) topics.push({ w: 1.5, run: () => {
      const x = simRng.pick(others);
      g.ui.dialog({ speaker: c, text: `What do you think of ${displayName(x)}?`, options: [
        { label: 'I like them a lot', action: () => { clan.adjust(c, x, 2); reply((c.relations[x.id]?.opinion ?? 0) > 20 ? 'Me too! They\'re great.' : 'Hmm. Maybe I should give them another chance.', 1)(); } },
        { label: 'They\'re alright', action: reply('Yeah, that\'s fair.') },
        { label: 'Not much, honestly', action: () => { clan.adjust(c, x, -2); reply((c.relations[x.id]?.opinion ?? 0) < 0 ? 'I knew it wasn\'t just me!' : 'Oh… I think they\'re nice.', (c.relations[x.id]?.opinion ?? 0) < 0 ? 2 : -2)(); } },
      ], onClose: done });
    } });
    // worries / compliments
    topics.push({ w: 1.5, run: () => {
      const worry = clan.food < clan.home().length * 0.5 ? 'The fresh-kill pile is so low. I\'m worried about the elders and kits.'
        : g.events.active.length ? 'Everything that\'s been happening lately… it scares me a little.'
        : simRng.pick([`You've been doing so well lately, ${pc.given}. The whole clan has noticed.`, 'Do you ever wonder what the Long Meadow is like?', 'I had the strangest dream last night. I was flying over the forest like a bird!']);
      g.ui.dialog({ speaker: c, text: worry, options: [
        { label: 'It\'ll be alright. We\'ll get through it together.', action: reply('Thanks. I feel better already.', 3) },
        { label: 'Hmm.', action: reply('…right.') },
      ], onClose: done });
    } });
    const total = topics.reduce((s2, t) => s2 + t.w, 0);
    let r = simRng.next() * total;
    for (const t of topics) { r -= t.w; if (r <= 0) { t.run(); return; } }
    topics[topics.length - 1].run();
  }


  /** A bored clanmate: leave them be, or find something to do together. */
  private boredTalk(a: NpcAgent, done: () => void) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const c = a.cat;
    const healer = pc.role === 'medicine' || pc.role === 'medicineApprentice';
    const together = (kind: 'herbs' | 'hunt' | 'markBorder', title: string, desc: string, need: number, extra: any = {}) => {
      done();
      a.activity = 'follow';
      a.followTarget = 'player';
      a.actTimer = 999;
      g.objectives.add({ id: 'together', kind, title, desc, need, giver: c.id, reward: { rep: 2, opinion: 8 }, deadline: g.time.totalHours + 10, data: { companion: a.id }, ...extra });
      g.objectives.focus('together');
      a.say(simRng.pick(['Finally, something to do!', 'Let\'s go!', 'Lead the way!']), 2.5);
    };
    const opts: { label: string; action: () => void; hint?: string }[] = [
      { label: 'Leave them be', action: () => { a.say('*yawns*', 2); done(); } },
      { label: 'Look for herbs together', hint: 'they follow you', action: () => together('herbs', `Find herbs with ${displayName(c)} (2)`, `Gather two herbs with ${a.name} and bring them to the medicine den.`, 2) },
    ];
    if (pc.stage !== 'kit' && !healer) opts.push({ label: 'Hunt together', hint: 'they follow you', action: () => together('hunt', `Hunt with ${displayName(c)} (2)`, `Hunt with ${a.name} and bring two pieces of prey to the fresh-kill pile.`, 2) });
    if (pc.stage !== 'kit') {
      const stones = g.territories.landmarks.filter((l) => l.kind === 'borderStone')
        .sort((u, v) => Math.hypot(u.x - g.player.pos.x, u.z - g.player.pos.z) - Math.hypot(v.x - g.player.pos.x, v.z - g.player.pos.z)).slice(0, 2);
      if (stones.length) opts.push({ label: 'Go on patrol together', hint: 'mark the border', action: () => together('markBorder', `Patrol with ${displayName(c)}`, `Walk the border with ${a.name} and renew ${stones.length} border markers.`, stones.length, { targets: stones.map((x) => ({ x: x.x, z: x.z })), target: { x: stones[0].x, z: stones[0].z } }) });
    }
    g.ui.dialog({ speaker: c, text: simRng.pick([
      `*sighs dramatically* I'm soooo bored, ${pc.given}. There's nothing to do.`,
      'Ugh. I\'ve counted every leaf on that bush twice. I\'m SO bored.',
      '*flops over* Is it just me, or is today the most boring day ever?',
      'I\'m bored out of my whiskers. Want to do something?',
    ]), options: opts, onClose: done });
  }

  lastNpcChat = -999;

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
        if (pc.stage === 'kit') { done(); return; }
        const task = this.makeOrder(a.cat);
        g.ui.dialog({ speaker: a.cat, text: `${intent.text} ${task.speech}`, options: [
          { label: 'At once', action: () => { g.objectives.add(task.obj); done(); } },
          { label: 'Refuse', hint: 'breaks the code', action: () => { clan.infraction('obeyOrders', [a.id]); clan.adjust(a.cat, pc, -8); done(); } },
        ], onClose: done });
        return;
      }
      case 'chat':
        this.lastNpcChat = g.clock;
        this.npcChat(a, done);
        return;
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
    const healer = pc.role === 'medicine' || pc.role === 'medicineApprentice';
    if (healer) {
      const hurtCats = clan.home().filter((x) => !x.isPlayer && (x.sick > 10 || x.injury > 10));
      if (hurtCats.length && r < 0.5) {
        const t = hurtCats[0];
        return { speech: `${displayName(t)} is hurting. Gather herbs and treat them.`, obj: { id: 'order-herbs', kind: 'herbs' as const, title: `Herbs to treat ${t.given} (2)`, desc: 'Find herbs, bring them to the medicine den, then talk to the sick cat to treat them.', need: 2, giver: giver.id, order: true, deadline: now + 20, reward: { rep: 4 } } };
      }
      return { speech: 'Our herb stores are low. Gather three herbs for the medicine den.', obj: { id: 'order-herbs', kind: 'herbs' as const, title: 'Stock the medicine den (3)', desc: 'Find herbs in the territory and bring them to the medicine den.', need: 3, giver: giver.id, order: true, deadline: now + 20, reward: { rep: 4 } } };
    }
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
    pc.coins = (pc.coins ?? 0) + n * 2;
    g.ui.toast(`You add your catch to the pile. (+${total} food, +reputation, +${n * 2} 🪙)`, 'good');
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
    // the right poultice for what's wrong (or any poultice you've got)
    pc.poultices = pc.poultices ?? {};
    const want: HerbKind = c.sick > c.injury ? (c.sick > 40 ? 'bitterroot' : 'sunpetal') : 'silverleaf';
    const ready = ([want, 'silverleaf', 'sunpetal', 'bitterroot'] as HerbKind[]).find((k) => (pc.poultices![k] ?? 0) > 0);
    if (ready) {
      this.applyPoultice(ready, c);
      c.injury = 0; c.sick = 0; c.health = c.maxHealth;
      this.healedDay.set(c.id, g.time.day);
      pc.reputation = clamp(pc.reputation + 1.5, -100, 100);
      clan.adjust(c, pc, 6, { text: `${pc.given} treated me with a poultice.`, weight: 2 });
      g.ui.dialog({ speaker: c, text: `You press the ${HERB_INFO[ready].name} poultice onto ${a.name}'s ${ready === 'silverleaf' ? 'wounds' : 'fur'}. ${a.name} sighs with relief. "I feel so much better. Thank you!" (${a.name} is fully healed.)`, options: [{ label: 'Rest now', action: done }], onClose: done });
      const o0 = g.objectives.get('lesson');
      if (o0?.data?.medLesson === 'treat') g.objectives.complete('lesson');
      else g.training.medProgress('treat');
      return;
    }
    const herb = ([want, 'sunpetal', 'bitterroot', 'silverleaf'] as HerbKind[]).find((k) => pl.herbs[k] > 0);
    if (herb) {
      g.ui.dialog({ speaker: c, text: `Herbs work best chewed into a poultice. ${a.name} watches while you get ready.`, options: [
        { label: `🦷 Chew the ${HERB_INFO[herb].name} into a poultice`, action: () => { done(); this.chew(herb, () => this.treatCat(a, () => {})); } },
        { label: 'Not now', action: done },
      ], onClose: done });
      return;
    }
    if (!herb) {
      g.ui.dialog({ speaker: c, text: `You have no herbs with you. Fetch some from the herb store in the medicine den (or gather fresh ones), then bring them to ${a.name}.`, options: [{ label: 'I\'ll be right back', action: done }], onClose: done });
      return;
    }
    pl.herbs[herb]--; pl.updateCarryVisual();
    const left = pl.herbs.silverleaf + pl.herbs.sunpetal + pl.herbs.bitterroot;
    g.ui.toast(`🌿 The ${herb} is used up. (${left} herb${left === 1 ? '' : 's'} left in your jaws)`, 'info');
    // one proper treatment fully heals them
    c.injury = 0;
    c.sick = 0;
    c.health = c.maxHealth;
    this.healedDay.set(c.id, g.time.day);
    pc.skills.healing = Math.min(99, pc.skills.healing + 2);
    pc.reputation = clamp(pc.reputation + 1.5, -100, 100);
    clan.adjust(c, pc, 6, { text: `${pc.given} treated me.`, weight: 2 });
    g.audio.pick();
    g.ui.dialog({ speaker: c, text: herb ? `You chew the ${herb} into a poultice and press it on. ${a.name} sighs with relief. "I feel completely better. Thank you!" (${a.name} is fully healed.)` : `You press cobweb and moss where it hurts. "Thank you… that helps a little."`, options: [{ label: 'Rest now', action: done }], onClose: done });
    const o = g.objectives.get('lesson');
    if (o?.data?.medLesson === 'treat') g.objectives.complete('lesson');
    else g.training.medProgress('treat');
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
    const pcr = clan.player.role;
    if (pcr === 'medicine' || pcr === 'medicineApprentice') {
      for (const k of ['silverleaf', 'sunpetal', 'bitterroot'] as HerbKind[]) clan.herbStore[k] += pl.herbs[k];
      pl.herbs = { silverleaf: 0, sunpetal: 0, bitterroot: 0 };
      pl.updateCarryVisual();
      g.camp.setHerbCount(clan.herbTotal());
      g.audio.drop();
      g.ui.toast(`You add ${n} herb${n > 1 ? 's' : ''} to the herb store (${clan.herbTotal()} stored). Take them to sick cats to heal them.`, 'good');
      g.objectives.onHerbs(n);
      if (!g.objectives.get('lesson')?.data?.medLesson) { g.training.medProgress('gather'); if (n >= 2) g.training.medProgress('herblore'); }
      return;
    }
    for (const k of ['silverleaf', 'sunpetal', 'bitterroot'] as HerbKind[]) clan.herbStore[k] += Math.floor(pl.herbs[k] / 2);
    g.camp.setHerbCount(clan.herbTotal());
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
      g.objectives.complete('berry-kit');
      if (berryEv) g.events.active.splice(g.events.active.indexOf(berryEv), 1);
    }
    pl.herbs = { silverleaf: 0, sunpetal: 0, bitterroot: 0 };
    pl.updateCarryVisual();
    const pcm = clan.player;
    if (n > 0 && (pcm.role === 'medicine' || pcm.role === 'medicineApprentice') && !g.objectives.get('lesson')?.data?.medLesson) {
      g.training.medProgress('gather');
      if (n >= 2) g.training.medProgress('herblore');
    }
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
