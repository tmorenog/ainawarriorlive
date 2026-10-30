// Big story moments from the books, played out live in camp. After about
// 20–30 minutes of play in classic ThunderClan, Tigerclaw turns on Bluestar —
// and Fireheart exposes him.
import type { Game } from '../game';
import type { NpcAgent } from '../ai/npc';
import { Cat, displayName } from '../cats/types';
import { createCat, personalityFrom } from '../cats/generate';
import { isClassic } from '../lore';
import { simRng } from '../core/rng';

export class Story {
  private checkT = 5;
  running = false;
  private pendingDeputy = -1;

  constructor(private game: Game) {}

  private find(id: string): Cat | undefined {
    return Object.values(this.game.clan.cats).find((c) => c.bookId === id && c.alive);
  }

  update(dt: number) {
    const g = this.game;
    const pc = g.clan.player;
    if (!pc || !pc.alive) return;
    pc.playSeconds = (pc.playSeconds ?? 0) + dt;
    this.checkT -= dt;
    if (this.checkT > 0 || this.running) return;
    this.checkT = 5;
    // the new deputy is named the day after the exile
    if (this.pendingDeputy >= 0 && g.time.day > this.pendingDeputy && g.time.hour > 7) this.nameDeputy();
    if (!this.ready()) return;
    this.tigerclawExiled();
  }

  /** Can the Tigerclaw scene happen right now? */
  private ready(): boolean {
    const g = this.game;
    const pc = g.clan.player;
    if (!isClassic() || g.territories.homeName !== 'ThunderClan') return false;
    if (pc.storyTiger) return false;
    pc.storyAt = pc.storyAt ?? 1200 + Math.floor(simRng.next() * 600); // 20–30 minutes
    if ((pc.playSeconds ?? 0) < pc.storyAt) return false;
    const blue = g.clan.leader;
    const tiger = this.find('Tigerclaw');
    if (!blue || blue.bookId !== 'Bluefur' || blue.isPlayer || !tiger || tiger.isPlayer || tiger.exiled || tiger.clan !== 'home') return false;
    if (g.time.hour < 7 || g.time.hour > 19 || g.combat.playerInCombat || g.ui.isBusy() || g.player.busy || g.twolegs.ac) return false;
    return Math.hypot(g.player.pos.x, g.player.pos.z) < 50;
  }

  /** Make sure Fireheart (and Cinderpelt) are in the clan for the scene. */
  private ensureBookCat(id: 'Fireheart' | 'Cinderpelt'): Cat {
    const g = this.game;
    const clan = g.clan;
    const have = this.find(id);
    if (have) return have;
    const fire = id === 'Fireheart';
    const c = createCat({ age: fire ? 22 : 18, sex: fire ? 'tom' : 'she', given: fire ? 'Fire' : 'Cinder', day: g.time.day, usedNames: clan.usedNames });
    c.epithet = fire ? 'heart' : 'pelt';
    c.bookId = id;
    c.stage = 'warrior';
    c.role = fire ? 'none' : 'medicine';
    c.traits = fire ? ['brave', 'loyal', 'kind'] : ['kind', 'curious'];
    c.pers = personalityFrom(c.traits, simRng);
    c.app = fire
      ? { ...c.app, base: '#e07a2a', second: '#b85a1a', pattern: 'solid', white: 0, eye: '#78c24c', fur: 'short', body: 'average', size: 1.02 }
      : { ...c.app, base: '#5a5c62', second: '#3a3c40', pattern: 'solid', white: 0, eye: '#5aa2e6', fur: 'medium', body: 'slender' };
    if (fire) c.skills.fighting = Math.max(c.skills.fighting, 65);
    else c.skills.healing = Math.max(c.skills.healing, 75);
    clan.cats[c.id] = c;
    clan.usedNames.add(c.given);
    g.npcs.syncRoster();
    return c;
  }

  private agent(c: Cat): NpcAgent | undefined { return this.game.npcs.agents.get(c.id); }

  /** The scene: Tigerclaw attacks Bluestar, Fireheart pins him, and the truth about Redtail comes out. */
  private tigerclawExiled() {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const blue = clan.leader!;
    const tiger = this.find('Tigerclaw')!;
    const fire = this.ensureBookCat('Fireheart');
    const playerHeals = pc.role === 'medicine' || pc.role === 'medicineApprentice';
    const healer = playerHeals ? pc : this.ensureBookCat('Cinderpelt');
    const healerName = displayName(healer);
    pc.storyTiger = true;
    this.running = true;
    const hr = g.camp.highRock;
    const B = this.agent(blue), T = this.agent(tiger), F = this.agent(fire);
    const hold = (a: NpcAgent | undefined, x: number, z: number, speed = 2.5) => {
      if (!a) return;
      g.npcs.endConvo(a);
      a.activity = 'ceremony';
      a.actTimer = 80;
      a.moveSpeed = speed;
      a.setTarget(x, z);
    };
    // the whole clan comes running at the noise
    g.npcs.ceremonyUntil = g.clock + 75;
    let i = 0;
    for (const a of g.npcs.agents.values()) {
      if (a.cat.clan !== 'home' || a === B || a === T || a === F || a.activity === 'sleep' || Math.hypot(a.pos.x, a.pos.z) > 60) continue;
      const ang = Math.PI * 0.25 + (i++ % 9) * 0.18;
      hold(a, hr.x + Math.cos(ang) * (7 + (i % 3)), hr.z + 4 + Math.sin(ang) * (5 + (i % 3)), 2);
    }
    hold(B, hr.x + 1.5, hr.z + 3.2, 2);
    hold(T, hr.x + 2.3, hr.z + 3.6, 2);
    hold(F, hr.x - 4, hr.z + 7, 2);
    const line = (who: Cat | 'Clan', text: string, secs = 5) => {
      if (g.state !== 'playing') return;
      const name = who === 'Clan' ? 'The clan' : displayName(who);
      g.ui.showBanner(`${name}: ${text}`, secs);
      if (who !== 'Clan') this.agent(who)?.say(text.replace(/\*[^*]*\*\s*/g, '').trim() || text, secs);
    };
    const clawing = () => { for (let k = 0; k < 4; k++) setTimeout(() => { g.audio.hiss(); g.audio.hit(k % 2 === 0); }, k * 220); };
    const steps: [number, () => void][] = [
      [0, () => { g.ui.toast('📣 Yowls and screeches echo from beneath the Highrock!', 'danger'); g.audio.alarm(); if (B) { B.forcedPose = 'fight'; B.mood = 'angry'; } if (T) { T.forcedPose = 'fight'; T.mood = 'angry'; } clawing(); }],
      [2500, () => { line(blue, 'Tigerclaw, what do you mean? TIGERCLAW, YOU CAN\'T DO THAT — I\'M YOUR LEADER!'); clawing(); }],
      [7500, () => { line(tiger, 'Not for much longer, Bluestar. This clan will be MINE!'); clawing(); }],
      [11500, () => {
        if (F) { F.moveSpeed = 6; F.setTarget(hr.x + 2.6, hr.z + 3.9); F.mood = 'angry'; }
        g.audio.pounce();
      }],
      [13000, () => {
        line(fire, `*pounces on Tigerclaw* Here, I'll help you — I'll hold him down! Go to ${healerName}!`, 6);
        if (F) F.forcedPose = 'fight';
        if (T) T.forcedPose = 'lie';
        if (B) { B.forcedPose = null; B.setTarget(hr.x - 0.5, hr.z + 1.5); }
        clawing();
        if (playerHeals) g.ui.toast(`🌿 Bluestar is hurt! She's coming to you, ${displayName(pc)}. Have a poultice ready (H).`, 'objective');
      }],
      [19500, () => {
        if (B) { B.forcedPose = null; B.mood = 'angry'; B.moveSpeed = 4; B.setTarget(hr.x, hr.z + 0.2); }
        g.audio.jump();
      }],
      [21000, () => { line(blue, '*leaps onto the Highrock* TIGERCLAW, YOU ARE EXILED FROM OUR CLAN! FIREHEART — EXPLAIN.', 6); g.audio.chime(); }],
      [27000, () => { line(fire, 'So… well, uh… remember when Redtail died?'); if (F) F.forcedPose = null; }],
      [31500, () => {
        line('Clan', 'Yes!', 3);
        for (const a of g.npcs.agents.values()) if (a.activity === 'ceremony' && a !== B && a !== T && a !== F && simRng.chance(0.7)) a.say('Yes!', 2.5);
      }],
      [34500, () => line(fire, 'Well, Oakheart couldn\'t have done it, \'cause I spoke with RiverClan — they said Oakheart died in a rockfall. So it can\'t be him. That leaves… Tigerclaw.', 8)],
      [43000, () => {
        line('Clan', '*gasps*', 3);
        for (const a of g.npcs.agents.values()) if (a.activity === 'ceremony' && a !== B && a !== T && a !== F && simRng.chance(0.6)) a.say(simRng.pick(['*gasps*', 'Tigerclaw?!', 'No… not Tigerclaw!', 'Traitor!', 'I knew it!']), 3);
      }],
      [46500, () => { line(blue, 'I will name my new deputy tomorrow. Until then — clan dismissed.', 6); }],
      [50500, () => {
        if (B) { B.forcedPose = null; B.setTarget(hr.x + 2, hr.z + 2.5); }
        g.ui.toast('*Bluestar leaps down from the Highrock*', 'info');
        this.exileTiger(tiger, blue);
      }],
      [54000, () => {
        if (T) T.say('You\'ll regret this, Bluestar. All of you will!', 5);
        g.npcs.ceremonyUntil = g.clock;
        for (const a of g.npcs.agents.values()) if (a.activity === 'ceremony') { a.activity = 'idle'; a.actTimer = 0; a.forcedPose = null; a.mood = 'neutral'; }
        this.running = false;
      }],
    ];
    for (const [t, fn] of steps) setTimeout(() => { if (g.state === 'playing' || g.state === 'paused') fn(); }, t);
  }

  private exileTiger(tiger: Cat, blue: Cat) {
    const g = this.game;
    const clan = g.clan;
    tiger.exiled = true;
    if (clan.deputyId === tiger.id) clan.deputyId = null;
    tiger.role = 'none';
    if (tiger.apprentice) { const ap = clan.get(tiger.apprentice); if (ap) { ap.mentor = null; const m = clan.pickMentor(ap); if (m) { ap.mentor = m.id; m.apprentice = ap.id; } } tiger.apprentice = null; }
    clan.log('Tigerclaw attacked Bluestar and was exiled. Fireheart revealed that Tigerclaw killed Redtail.', 'politics');
    for (const c of clan.home()) clan.remember(c, 'Tigerclaw betrayed the clan. Fireheart saved Bluestar.', -4);
    const T = g.npcs.agents.get(tiger.id);
    if (T) { T.forcedPose = null; T.mood = 'angry'; T.activity = 'leaving'; T.moveSpeed = 3; const a = Math.random() * Math.PI * 2; T.setTarget(Math.cos(a) * 260, Math.sin(a) * 260); T.actTimer = 60; }
    setTimeout(() => g.npcs.syncRoster(), 9000);
    this.pendingDeputy = g.time.day;
    void blue;
  }

  /** The next day: Bluestar names Fireheart her new deputy. */
  private nameDeputy() {
    const g = this.game;
    const clan = g.clan;
    this.pendingDeputy = -1;
    const fire = this.find('Fireheart');
    const blue = clan.leader;
    if (!fire || !blue || fire.exiled || clan.deputyId) return;
    clan.deputyId = fire.id;
    fire.role = 'deputy';
    g.ceremony(`${displayName(blue)}: "I say these words before the spirits of StarClan, that they may hear and approve my choice. Fireheart will be the new deputy of ThunderClan."`, [fire.id]);
    clan.log('Fireheart became deputy of ThunderClan.', 'politics');
  }
}
