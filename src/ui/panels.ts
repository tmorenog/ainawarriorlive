// Full-screen panels: journal (duties, events, relationships, clan, code,
// memories, discoveries, controls), territory map and the leader's council.
import type { Game } from '../game';
import { clanTitle } from '../lore';
import type { UI } from './ui';
import { h, esc } from './ui';
import { Cat, LESSONS, LESSON_LABEL, displayName, roleLabel } from '../cats/types';
import { TrainingSystem } from '../sim/training';
import { REL_COLOR, isFamily, relLabel } from '../sim/social';
import { RULES } from '../sim/clan';
import { PATTERN_LABEL } from '../cats/generate';

type PanelKind = 'journal' | 'map' | 'leader';

export const CONTROLS_HTML = `
<div class="kv">
<b>Move</b><span>W A S D / arrows (Shift sprint, Alt walk)</span>
<b>Look</b><span>Mouse (click the game to capture the mouse)</span>
<b>Interact / talk</b><span>E</span>
<b>Crouch / stalk</b><span>C (toggle) or hold Ctrl</span>
<b>Jump</b><span>Space</span>
<b>Pounce</b><span>While crouched hold Space to gather strength, release to leap. Green = sweet spot.</span>
<b>Swipe / attack</b><span>Left click or F</span>
<b>Heavy pounce attack</b><span>Right click or R</span>
<b>Dodge (in a fight)</b><span>Space + a direction</span>
<b>Give up a fight</b><span>X (or the 🏳 button) — back away and end the fight</span>
<b>Sniff / track</b><span>Q — reveals scent trails to prey, danger and herbs</span>
<b>Eat what you carry</b><span>G (breaks the code unless starving or the clan is fed)</span>
<b>Drop what you carry</b><span>B · ⤵ on touch (onto the pile if you're next to it)</span>
<b>Camera</b><span>V toggles first / third person</span>
<b>Journal · Map · Council</b><span>J · M · L</span>
<b>Menu / pause</b><span>Esc (or P)</span>
<b>Dialogue choices</b><span>Number keys 1–9</span>
</div>
<h3>Hunting tips</h3>
<p>Prey hears heavy paws, sees movement and smells you when the wind carries your scent to them. Crouch, move slowly,
keep the wind in your face, and pounce from a few tail-lengths away. Rain and wind mask your approach. Birds watch; rabbits bolt in zig-zags;
squirrels race for trees; fish can be swiped from the shallows.</p>
<h3>Life in the clan</h3>
<p>Kits stay in camp. At six moons you become an apprentice and your mentor will fetch you for lessons. Complete lessons in all six
skills, then pass your assessment to earn a warrior name. Warriors hunt, patrol, mentor, find mates and raise kits. Earn reputation and
the Warden may name you Second — and one day you may lead. When your cat dies, the story continues through another.</p>`;

export class Panels {
  private el: HTMLElement | null = null;
  private kind: PanelKind | null = null;
  private tab = 'duties';
  private selected: string | null = null;
  private mapCache: { canvas: HTMLCanvasElement; seed: number } | null = null;
  private mapZoom = 1;

  constructor(private game: Game, private ui: UI) {}

  get isOpen() { return !!this.el; }

  toggle(kind: PanelKind, tab?: string) {
    if (this.kind === kind) this.close();
    else this.open(kind, tab);
  }

  open(kind: PanelKind, tab?: string) {
    this.close();
    const g = this.game;
    if (kind === 'leader' && !(g.clan.leader?.isPlayer || g.clan.deputy?.isPlayer)) {
      this.ui.toast('Only the Warden and the Second may call the clan council.', 'info');
      return;
    }
    this.kind = kind;
    if (tab) this.tab = tab;
    else if (kind === 'journal' && !['duties', 'events', 'memories', 'relations', 'clan', 'code', 'discoveries', 'help'].includes(this.tab)) this.tab = 'duties';
    else if (kind === 'leader') this.tab = 'council';
    g.player.busy = true;
    g.input.unlock();
    this.el = h('div', 'panel', '', this.ui.root);
    this.render();
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.kind = null;
    const g = this.game;
    g.player.busy = false;
    if (g.state === 'playing') g.input.lock();
    setTimeout(() => g.decisions.flushQueue(), 50);
  }

  private header(title: string, tabs: [string, string][]) {
    const hd = h('header', '', `<h2>${esc(title)}</h2>`, this.el!);
    for (const [id, label] of tabs) {
      const b = h('button', `tab ${this.tab === id ? 'on' : ''}`, label, hd);
      b.onclick = () => { this.tab = id; this.selected = null; this.render(); };
    }
    const c = h('button', 'close', 'Close ✕', hd);
    c.onclick = () => this.close();
  }

  render() {
    if (!this.el) return;
    this.el.innerHTML = '';
    if (this.kind === 'journal') this.renderJournal();
    else if (this.kind === 'map') this.renderMap();
    else if (this.kind === 'leader') this.renderLeader();
  }

  // ------------------------------------------------------------ journal
  private renderJournal() {
    const g = this.game;
    this.header('Journal', [['duties', 'Duties'], ['events', 'Clan history'], ['memories', 'Memories'], ['relations', 'Relationships'], ['clan', 'Clan'], ['code', 'The code'], ['discoveries', 'Discoveries'], ['help', 'Controls']]);
    const body = h('div', 'body', '', this.el!);
    const clan = g.clan;
    const pc = clan.player;
    switch (this.tab) {
      case 'duties': {
        if (!g.objectives.list.length) h('p', '', 'No current duties. Hunt, explore, or talk to your clanmates — the Warden, Second and your mentor will find work for you.', body);
        for (const o of g.objectives.list) {
          const d = h('div', 'detail', `<b style="color:var(--accent)">${esc(o.title)}</b>${o.need > 1 ? ` (${o.progress ?? 0}/${o.need})` : ''}${o.order ? ' <span class="pill" style="background:#e8b865">order</span>' : ''}<br>${esc(o.desc)}`, body);
          const row = h('div', 'row', '', d);
          const f = h('button', 'btn dim', 'Track on compass', row);
          f.onclick = () => { g.objectives.focus(o.id); this.render(); };
          if (!['rescue', 'drive', 'escort'].includes(o.kind)) {
            const ab = h('button', 'btn dim', o.order ? 'Abandon (disobeys an order)' : 'Abandon', row);
            ab.onclick = () => { g.objectives.abandon(o.id); this.render(); };
          }
        }
        const MED = { gather: 'Gathering herbs', treat: 'Treating the sick', herblore: 'Herb lore' } as const;
        const medRow = (c: Cat) => (Object.keys(MED) as (keyof typeof MED)[]).map((k) => {
          const n = TrainingSystem.MED_LESSONS[k].reduce((s2, l) => s2 + c.training[l], 0);
          return `<b>${MED[k]}</b><span>${'●'.repeat(n)}${'○'.repeat(6 - n)}</span>`;
        }).join('');
        if (pc.stage === 'apprentice' && pc.role === 'medicineApprentice') {
          h('h3', '', 'Medicine training', body);
          h('div', 'kv', medRow(pc), body);
          h('p', '', 'You never hunt for progress. Gather herbs, bring them to the medicine den, and treat sick, hurt or aching clanmates (talk to them). Keep going and your mentor will set your medicine cat assessment.', body);
        } else if (pc.role === 'medicine') {
          h('h3', '', 'Medicine cat', body);
          h('div', 'kv', `<b>Healing skill</b><span>${Math.round(pc.skills.healing)}</span><b>Herbs carried</b><span>${pc.isPlayer ? g.player.herbs.silverleaf + g.player.herbs.sunpetal + g.player.herbs.bitterroot : 0}</span><b>Clanmates hurt or sick</b><span>${clan.home().filter((c) => !c.isPlayer && (c.sick > 10 || c.injury > 10)).length}</span>`, body);
          h('p', '', 'Your path: gather herbs → heal your clanmates → repeat. Every herb you bring and every cat you treat raises your skill and reputation.', body);
        } else if (pc.stage === 'apprentice') {
          h('h3', '', 'Training progress', body);
          h('div', 'kv', LESSONS.map((l) => `<b>${LESSON_LABEL[l]}</b><span>${'●'.repeat(pc.training[l])}${'○'.repeat(3 - pc.training[l])}</span>`).join(''), body);
          h('p', '', 'Complete at least one lesson of each kind (nine in total) and be twelve moons old to take your warrior assessment.', body);
        }
        const ap = clan.get(pc.apprentice);
        if (ap) {
          h('h3', '', `Your apprentice: ${esc(ap.given)}`, body);
          h('div', 'kv', ap.role === 'medicineApprentice' ? medRow(ap) : LESSONS.map((l) => `<b>${LESSON_LABEL[l]}</b><span>${'●'.repeat(ap.training[l])}${'○'.repeat(3 - ap.training[l])}</span>`).join(''), body);
          h('p', '', g.training.readyForWarrior(ap) && ap.age >= 12 ? `${ap.given} is ready! Tell the Warden.` : 'Talk to your apprentice to train them.', body);
        }
        break;
      }
      case 'events': {
        const list = clan.journal.filter((e) => e.kind !== 'memory').slice().reverse();
        for (const e of list.slice(0, 250)) h('div', `entry ${e.kind}`, `<span class="day">Moon ${e.day + 1}</span>${esc(e.text)}`, body);
        break;
      }
      case 'memories': {
        const mem = pc.memories.slice().reverse();
        if (!mem.length) h('p', '', 'Your story has only just begun.', body);
        for (const m of mem) h('div', 'entry', `<span class="day">Moon ${m.day + 1}</span>${m.weight > 0 ? '💛' : m.weight < 0 ? '🖤' : '·'} ${esc(m.text)}`, body);
        if (clan.lineage.length) {
          h('h3', '', 'Those who came before', body);
          for (const id of clan.lineage) { const c = clan.get(id); if (c) h('div', 'entry', `${esc(displayName(c))} — ${roleLabel(c)}; lived ${Math.floor(c.age)} moons; died of ${esc(c.deathCause ?? 'unknown')}.`, body); }
        }
        break;
      }
      case 'relations': this.renderRelations(body); break;
      case 'clan': this.renderClan(body); break;
      case 'code': {
        h('p', '', 'The code keeps the clan alive. Breaking it costs reputation and trust; repeated offences bring punishment, loss of rank or even exile.', body);
        for (const r of Object.values(RULES)) h('div', 'entry', `📜 ${esc(r.text)}`, body);
        h('h3', '', 'Your standing', body);
        h('div', 'kv', `<b>Reputation</b><span>${Math.round(pc.reputation)} (${clan.playerReputationLabel()})</span><b>Recent offences</b><span>${pc.infractions}</span><b>Good deeds</b><span>${pc.deeds}</span>`, body);
        break;
      }
      case 'discoveries': {
        const list = clan.journal.filter((e) => e.kind === 'discovery').slice().reverse();
        h('p', '', `You have found ${g.mods.discovered.length} places and things.`, body);
        for (const e of list) h('div', 'entry discovery', `<span class="day">Moon ${e.day + 1}</span>${esc(e.text)}`, body);
        break;
      }
      case 'help': h('div', '', CONTROLS_HTML, body); break;
    }
  }

  private catCard(c: Cat, parent: HTMLElement) {
    const g = this.game;
    const pc = g.clan.player;
    const r = c.relations[pc.id];
    const lbl = c === pc ? 'You' : relLabel(r, isFamily(c, pc), c.mate === pc.id);
    const op = r?.opinion ?? 0;
    const card = h('div', 'card', `<div class="cn">${esc(displayName(c))}</div><div class="cr">${esc(roleLabel(c))} · ${Math.floor(c.age)} moons</div>
      <span class="pill" style="background:${REL_COLOR[lbl as keyof typeof REL_COLOR] ?? '#ccc'}">${lbl}</span>
      ${c !== pc ? `<div class="opbar"><i style="${op >= 0 ? `width:${op / 2}%;background:#8fd07a` : `width:${-op / 2}%;left:${50 + op / 2}%;background:#e8705a`}"></i></div>` : ''}`, parent);
    card.onclick = () => { this.selected = c.id; this.render(); };
  }

  private catDetail(c: Cat, parent: HTMLElement) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    const r = c.relations[pc.id];
    const mine = pc.relations[c.id];
    const fam: string[] = [];
    for (const pid of c.parents) { const p = clan.get(pid); if (p) fam.push(`parent: ${displayName(p)}${p.alive ? '' : ' (dead)'}`); }
    const mate = clan.get(c.mate);
    if (mate) fam.push(`mate: ${displayName(mate)}`);
    for (const kid of c.kits) { const k = clan.get(kid); if (k) fam.push(`kit: ${displayName(k)}${k.alive ? '' : ' (dead)'}`); }
    const d = h('div', 'detail', '', parent);
    h('h3', '', esc(displayName(c)), d);
    h('div', 'kv', `
      <b>Rank</b><span>${esc(roleLabel(c))}</span>
      <b>Age</b><span>${Math.floor(c.age)} moons (${c.sex === 'tom' ? 'tom' : 'she-cat'})</span>
      <b>Personality</b><span>${c.traits.join(', ')}</span>
      <b>Looks</b><span>${PATTERN_LABEL[c.app.pattern]}, ${c.app.fur} fur, ${c.app.body} build, ${c.app.ears} ears, ${c.app.tail} tail</span>
      <b>Skills</b><span>hunt ${Math.round(c.skills.hunting)} · fight ${Math.round(c.skills.fighting)} · track ${Math.round(c.skills.tracking)} · lore ${Math.round(c.skills.knowledge)}</span>
      <b>Health</b><span>${Math.round(c.health)}${c.sick > 20 ? ' · sick' : ''}${c.injury > 20 ? ' · injured' : ''}</span>
      <b>Reputation</b><span>${Math.round(c.reputation)}</span>
      ${c !== pc ? `<b>Their view of you</b><span>${Math.round(r?.opinion ?? 0)} (${relLabel(r, isFamily(c, pc), c.mate === pc.id)})</span><b>Your view of them</b><span>${Math.round(mine?.opinion ?? 0)}</span>` : ''}
      ${c.mentor ? `<b>Mentor</b><span>${esc(displayName(clan.get(c.mentor)!))}</span>` : ''}
      ${c.apprentice ? `<b>Apprentice</b><span>${esc(displayName(clan.get(c.apprentice)!))}</span>` : ''}
      <b>Family</b><span>${fam.length ? esc(fam.join('; ')) : '—'}</span>
      ${!c.alive ? `<b>Died</b><span>Moon ${(c.deathDay ?? 0) + 1}, of ${esc(c.deathCause ?? '?')}</span>` : ''}`, d);
    const mem = c.memories.filter((m) => m.about === pc.id).slice(-4);
    if (mem.length && c !== pc) {
      h('h3', '', 'What they remember about you', d);
      for (const m of mem) h('div', 'entry', `${m.weight > 0 ? '💛' : '🖤'} ${esc(m.text)}`, d);
    }
    const friends = Object.entries(c.relations).filter(([id, rr]) => rr.opinion > 40 && clan.get(id)?.alive && id !== pc.id).slice(0, 4).map(([id]) => displayName(clan.get(id)!));
    const foes = Object.entries(c.relations).filter(([id, rr]) => rr.opinion < -25 && clan.get(id)?.alive && id !== pc.id).slice(0, 3).map(([id]) => displayName(clan.get(id)!));
    if (friends.length || foes.length) h('div', 'kv', `<b>Friends</b><span>${esc(friends.join(', ') || '—')}</span><b>Rivals</b><span>${esc(foes.join(', ') || '—')}</span>`, d);
  }

  private renderRelations(body: HTMLElement) {
    const g = this.game;
    const clan = g.clan;
    const pc = clan.player;
    if (this.selected) { const c = clan.get(this.selected); if (c) { const back = h('button', 'btn dim', '← Back', body); back.onclick = () => { this.selected = null; this.render(); }; this.catDetail(c, body); return; } }
    const cats = clan.home(false).sort((a, b) => (b.relations[pc.id]?.opinion ?? 0) - (a.relations[pc.id]?.opinion ?? 0));
    h('p', '', 'How your clanmates feel about you. Click a cat for details.', body);
    const cards = h('div', 'cards', '', body);
    for (const c of cats) this.catCard(c, cards);
    const outsiders = Object.values(clan.cats).filter((c) => c.alive && c.clan !== 'home' && c.relations[pc.id] && c.relations[pc.id].familiarity > 5);
    if (outsiders.length) {
      h('h3', '', 'Cats beyond the clan', body);
      const oc = h('div', 'cards', '', body);
      for (const c of outsiders) this.catCard(c, oc);
    }
  }

  private renderClan(body: HTMLElement) {
    const g = this.game;
    const clan = g.clan;
    if (this.selected) { const c = clan.get(this.selected); if (c) { const back = h('button', 'btn dim', '← Back', body); back.onclick = () => { this.selected = null; this.render(); }; this.catDetail(c, body); return; } }
    const home = clan.home();
    h('div', 'kv', `
      <b>Clan</b><span>${clanTitle(esc(g.territories.homeName))} — ${home.length} cats</span>
      <b>Warden</b><span>${clan.leader ? esc(displayName(clan.leader)) : '—'}</span>
      <b>Second</b><span>${clan.deputy ? esc(displayName(clan.deputy)) : '—'}</span>
      <b>Healer</b><span>${clan.medicine ? esc(displayName(clan.medicine)) : '—'}</span>
      <b>Fresh-kill</b><span>${Math.floor(clan.food)} pieces</span>
      <b>Borders</b><span>${clan.borderSafety > 60 ? 'Well marked' : clan.borderSafety > 30 ? 'Fading' : 'Stale'}</span>
      <b>Generation</b><span>${clan.generation}</span>
      <b>Active events</b><span>${g.events.active.map((e) => e.type).join(', ') || 'none'}</span>`, body);
    const groups: [string, (c: Cat) => boolean][] = [
      ['Leaders & healers', (c) => c.role !== 'none' && c.role !== 'medicineApprentice'],
      ['Warriors', (c) => c.stage === 'warrior' && c.role === 'none'],
      ['Apprentices', (c) => c.stage === 'apprentice'],
      ['Kits', (c) => c.stage === 'kit'],
      ['Elders', (c) => c.stage === 'elder' && c.role === 'none'],
    ];
    const used = new Set<string>();
    for (const [title, f] of groups) {
      const list = home.filter((c) => !used.has(c.id) && f(c));
      if (!list.length) continue;
      h('h3', '', title, body);
      const cards = h('div', 'cards', '', body);
      for (const c of list) { used.add(c.id); this.catCard(c, cards); }
    }
    h('h3', '', 'Neighbouring clans', body);
    for (const r of clan.rivals) {
      const def = g.territories.rivals[r.index];
      h('div', 'entry', `<b style="color:${def.color}">${clanTitle(esc(def.name))}</b> — ${def.temperament}, strength ${Math.round(r.strength)}, feeling toward us: ${r.attitude > 20 ? 'friendly' : r.attitude < -30 ? 'hostile' : 'wary'} (${Math.round(r.attitude)})`, body);
    }
    const dead = clan.dead();
    if (dead.length) {
      h('h3', '', 'The Long Meadow — cats who have died', body);
      for (const c of dead.slice(0, 40)) h('div', 'entry death', `${esc(displayName(c))} — ${roleLabel({ ...c, alive: true })}, ${Math.floor(c.age)} moons; died moon ${(c.deathDay ?? 0) + 1} of ${esc(c.deathCause ?? '?')}${c.isPlayer || clan.lineage.includes(c.id) ? ' ✦' : ''}`, body);
    }
  }

  // ------------------------------------------------------------ map
  private renderMap() {
    const g = this.game;
    this.header('Territory map', []);
    const zin = h('button', 'btn dim', '＋', this.el!.querySelector('header')!);
    const zout = h('button', 'btn dim', '－', this.el!.querySelector('header')!);
    zin.onclick = () => { this.mapZoom = Math.min(4, this.mapZoom * 1.5); this.render(); };
    zout.onclick = () => { this.mapZoom = Math.max(0.5, this.mapZoom / 1.5); this.render(); };
    const wrap = h('div', 'map-wrap', '', this.el!);
    const size = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.78, 900);
    const cv = h('canvas', '', undefined, wrap) as HTMLCanvasElement;
    cv.width = cv.height = Math.floor(size);
    const ctx = cv.getContext('2d')!;
    const base = this.mapBase();
    const R = 700 / this.mapZoom; // world half-extent shown
    const p = g.player.pos;
    const cx = this.mapZoom > 1 ? p.x : 0, cz = this.mapZoom > 1 ? p.z : 0;
    const toS = (x: number, z: number) => [((x - cx) / R * 0.5 + 0.5) * cv.width, ((z - cz) / R * 0.5 + 0.5) * cv.height];
    // draw base (covers -800..800)
    const [bx0, bz0] = toS(-800, -800), [bx1, bz1] = toS(800, 800);
    ctx.fillStyle = '#10140f';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, bx0, bz0, bx1 - bx0, bz1 - bz0);
    // borders
    const ter = g.territories;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(240,210,140,0.9)';
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2; const r = ter.homeRadiusAt(a); const [x, y] = toS(Math.cos(a) * r, Math.sin(a) * r); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.font = '13px Nunito, sans-serif';
    ctx.textAlign = 'center';
    for (const rv of ter.rivals) {
      ctx.strokeStyle = rv.color;
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2; const r = ter.rivalRadiusAt(rv, a); const [x, y] = toS(rv.cx + Math.cos(a) * r, rv.cz + Math.sin(a) * r); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      const [x, y] = toS(rv.cx, rv.cz);
      ctx.fillStyle = rv.color;
      ctx.fillText(rv.name, x, y);
    }
    // camp
    const [cxs, czs] = toS(0, 0);
    ctx.fillStyle = '#f0d9a0';
    ctx.fillText(`🏠 ${ter.homeName} camp`, cxs, czs - 8);
    // landmarks
    for (const l of ter.landmarks) {
      if (l.kind === 'borderStone') { const [x, y] = toS(l.x, l.z); ctx.fillStyle = '#e8c070'; ctx.fillRect(x - 2, y - 2, 4, 4); continue; }
      const known = g.discoveries.has('lm:' + l.id) || l.kind === 'councilRocks' || l.kind === 'trainingHollow';
      if (!known) continue;
      const [x, y] = toS(l.x, l.z);
      ctx.fillStyle = '#cfe8ff';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      ctx.fillText(l.name, x, y - 6);
    }
    // discovered structures
    for (const key of g.mods.discovered) {
      if (!key.startsWith('st:')) continue;
      const [sx, sz] = key.slice(3).split(',').map(Number);
      const [x, y] = toS(sx, sz);
      ctx.fillStyle = '#b0d0f0';
      ctx.fillText('✦', x, y + 4);
    }
    // fires
    for (const f of g.fire.fires) { const [x, y] = toS(f.x, f.z); ctx.fillStyle = 'rgba(255,100,30,0.55)'; ctx.beginPath(); ctx.arc(x, y, (f.r / R) * cv.width * 0.5, 0, 7); ctx.fill(); }
    // objective
    const o = g.objectives.primary;
    if (o?.target) { const [x, y] = toS(o.target.x, o.target.z); ctx.fillStyle = '#e8b865'; ctx.font = '18px sans-serif'; ctx.fillText('◆', x, y + 6); }
    // player
    const [px, py] = toS(p.x, p.z);
    const f = g.player.forward();
    ctx.fillStyle = '#ff5a4a';
    ctx.beginPath();
    ctx.moveTo(px + f.x * 10, py + f.z * 10);
    ctx.lineTo(px - f.x * 6 - f.z * 6, py - f.z * 6 + f.x * 6);
    ctx.lineTo(px - f.x * 6 + f.z * 6, py - f.z * 6 - f.x * 6);
    ctx.fill();
    h('div', 'legend', `North is up · <span style="color:#f0d27a">■</span> border markers · ◆ objective · ✦ discoveries<br>${esc(ter.ownerName(ter.ownerAt(p.x, p.z)))} · ${esc(g.chunks.biomeAt(p.x, p.z))}`, wrap);
  }

  private mapBase(): HTMLCanvasElement {
    const g = this.game;
    if (this.mapCache && this.mapCache.seed === g.seed) return this.mapCache.canvas;
    const N = 160;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    const col: Record<string, [number, number, number]> = {
      forest: [52, 86, 40], pine: [38, 66, 42], meadow: [112, 140, 62], marsh: [74, 88, 52], hills: [104, 120, 64],
      mountain: [120, 118, 112], rocky: [110, 104, 90], farmland: [150, 136, 80],
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N) * 1600 - 800, z = (j / N) * 1600 - 800;
      const s = g.terrain.sample(x, z);
      let c = col[s.biome];
      if (s.h < 0.05 || s.river > 0.3 || s.lake > 0.3) c = [60, 110, 130];
      else if (s.road > 0.4) c = [80, 78, 76];
      else if (s.h > 62) c = [220, 225, 230];
      const shade = 0.85 + Math.min(0.3, s.h / 200);
      const k = (j * N + i) * 4;
      img.data[k] = c[0] * shade; img.data[k + 1] = c[1] * shade; img.data[k + 2] = c[2] * shade; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mapCache = { canvas: cv, seed: g.seed };
    return cv;
  }

  // ------------------------------------------------------------ leader council
  private renderLeader() {
    const g = this.game;
    const clan = g.clan;
    const isLeader = !!clan.leader?.isPlayer;
    this.header(isLeader ? 'Warden\'s council' : 'Second\'s duties', [['council', 'Council'], ['patrols', 'Patrols'], ['apprentices', 'Apprentices'], ['clan', 'Members'], ['rivals', 'Other clans']]);
    const body = h('div', 'body', '', this.el!);
    const btn = (label: string, fn: () => void, parent = body, cls = 'btn') => { const b = h('button', cls, esc(label), parent); b.onclick = fn; return b; };
    switch (this.tab) {
      case 'council': {
        const approval = isLeader ? clan.approvalOf(clan.player) : 0;
        h('div', 'kv', `${isLeader ? `<b>Clan approval</b><span>${Math.round(approval)} ${approval < -20 ? '⚠ the clan is losing faith in you' : approval > 30 ? '— they trust you' : ''}</span>` : ''}
          <b>Fresh-kill</b><span>${Math.floor(clan.food)} for ${clan.home().length} cats</span>
          <b>Borders</b><span>${Math.round(clan.borderSafety)}%</span>`, body);
        h('h3', '', 'Pending decisions', body);
        if (!clan.pending.length) h('p', '', 'Nothing awaits your judgement.', body);
        for (const p of clan.pending) btn(`⚖ ${p.title}`, () => { this.close(); g.decisions.showNext(p.id); });
        h('h3', '', 'Actions', body);
        btn('Organise patrols now', () => { this.close(); g.decisions.organizePatrols(); });
        if (isLeader) {
          btn('Choose a new Second', () => { this.close(); g.decisions.chooseDeputy(); });
          btn('Hold a clan meeting (raise spirits)', () => {
            if ((g as any)._lastMeeting === g.time.day) { g.ui.toast('You already spoke to the clan today.', 'info'); return; }
            (g as any)._lastMeeting = g.time.day;
            this.close();
            g.ceremony(`${displayName(clan.player)}: "${clan.food < clan.home().length * 0.6 ? 'Times are hard, but we endure together. Hunt well and share what you catch.' : 'Our clan is strong. I am proud of every one of you.'}"`, []);
            for (const c of clan.home()) if (c !== clan.player) clan.adjust(c, clan.player, c.pers.loyalty > 0.5 ? 3 : 1);
          });
        }
        break;
      }
      case 'patrols': {
        const pats = clan.patrols.filter((p) => p.state !== 'done');
        if (!pats.length) h('p', '', 'No patrols are out.', body);
        for (const p of pats) h('div', 'entry', `${p.kind === 'hunt' ? '🐾 Hunting' : '🛡 Border'} patrol (${p.state}) — ${p.members.map((m) => esc(clan.get(m)?.given ?? '?')).join(', ')}`, body);
        btn('Organise new patrols', () => { this.close(); g.decisions.organizePatrols(); });
        break;
      }
      case 'apprentices': {
        const aps = clan.home().filter((c) => c.stage === 'apprentice');
        for (const a of aps) {
          const m = clan.get(a.mentor);
          const ready = g.training.readyForWarrior(a) && a.age >= 12;
          const d = h('div', 'entry', `<b>${esc(a.given)}</b> — ${Math.floor(a.age)} moons, mentor ${m ? esc(displayName(m)) : 'none'} · training ${LESSONS.reduce((s, l) => s + a.training[l], 0)}/18 ${ready ? '✔ ready' : ''}`, body);
          if (isLeader && ready && !a.isPlayer) btn('Hold warrior ceremony', () => { this.close(); clan.warriorCeremony(a); }, d, 'btn dim');
          if (isLeader && !a.mentor) btn('Assign mentor', () => { this.close(); a.stage = 'kit'; g.decisions.chooseMentor(a); }, d, 'btn dim');
        }
        const kits = clan.home().filter((c) => c.stage === 'kit');
        if (kits.length) h('h3', '', 'Kits', body);
        for (const k of kits) h('div', 'entry', `${esc(k.given)} — ${Math.floor(k.age)} moons (${k.age >= 5 ? 'apprentice soon' : 'growing'})`, body);
        break;
      }
      case 'clan': {
        h('p', '', 'To give orders, name a Second or exile a cat, walk up and talk to them. Their opinion of you:', body);
        const cards = h('div', 'cards', '', body);
        for (const c of clan.home(false)) this.catCard(c, cards);
        if (this.selected) { const c = clan.get(this.selected); if (c) this.catDetail(c, body); }
        break;
      }
      case 'rivals': {
        for (const r of clan.rivals) {
          const def = g.territories.rivals[r.index];
          const d = h('div', 'detail', `<b style="color:${def.color}">${clanTitle(esc(def.name))}</b> — ${def.temperament}; strength ${Math.round(r.strength)}; attitude ${Math.round(r.attitude)}`, body);
          if (isLeader) {
            btn('Send a peace envoy', () => { r.attitude = Math.min(100, r.attitude + 8); g.clan.log(`An envoy carried words of peace to ${def.name}.`, 'politics'); g.decisions.react(['kind', 'cautious'], 2); g.ui.toast(`${def.name} seems a little warmer toward us.`, 'good'); this.render(); }, d, 'btn dim');
            btn('Order a border show of strength', () => { clan.borderSafety = Math.min(100, clan.borderSafety + 25); r.attitude = Math.max(-100, r.attitude - 5); g.decisions.react(['brave'], 2); g.ui.toast('Warriors paraded along the border.', 'info'); this.render(); }, d, 'btn dim');
          }
        }
        break;
      }
    }
  }
}
