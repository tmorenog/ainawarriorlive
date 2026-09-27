// Title screen, character creation, pause menu, settings, and the memorial
// / successor screen that continues the story after a cat dies.
import type { Game } from '../game';
import { clanTitle } from '../lore';
import { h, esc } from './ui';
import { ACCESSORY_LABEL, Accessory, Appearance, BodyType, Cat, EarShape, FurLength, Pattern, Sex, TailShape, displayName, roleLabel } from '../cats/types';
import { BREEDS, EYE_COLORS, FUR_COLORS, GIVEN_NAMES, PATTERNS, PATTERN_LABEL, randomAppearance, secondFor } from '../cats/generate';
import { RNG } from '../core/rng';
import { CONTROLS_HTML } from './panels';
import { HOME_CLAN_NAMES } from '../world/territory';
import { CLASSIC_CLANS, CLASSIC_PREFIXES, LoreMode, lore } from '../lore';
import { isFamily } from '../sim/social';
import { SaveSummary, listSaves, newSlot, setSlot } from '../save/save';

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  shadows: boolean;
  volume: number;
  sensitivity: number;
  invertY: boolean;
  dayMinutes: number;
  showFps: boolean;
  aiChat: boolean;
}

export const DEFAULT_SETTINGS: Settings = { quality: 'medium', shadows: true, volume: 0.8, sensitivity: 1, invertY: false, dayMinutes: 7, showFps: false, aiChat: true };

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem('mistwood-settings') ?? '{}');
    return { ...DEFAULT_SETTINGS, ...s };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem('mistwood-settings', JSON.stringify(s)); } catch { /* ignore */ }
}

export interface NewGameSpec { name: string; sex: Sex; app: Appearance; seed: number; clanName: string; lore: LoreMode; joinSlot?: number }

export class Menus {
  private screen: HTMLElement | null = null;
  constructor(private game: Game) {}

  get root() { return this.game.ui.root; }

  clear() {
    this.screen?.remove();
    this.screen = null;
  }

  // ------------------------------------------------------------ title
  title(hasSave: boolean) {
    this.clear();
    const s = h('div', 'screen title-screen', '', this.root);
    this.screen = s;
    h('h1', '', 'Mistwood', s);
    h('div', 'tag', 'a forest clan life — from kit to legend, and beyond', s);
    const menu = h('div', 'menu', '', s);
    const saves = listSaves();
    if (saves.length) {
      h('div', 'tag', saves.length > 1 ? 'Your cats' : 'Your cat', menu);
      for (const sv of saves.slice(0, 8)) {
        const c = h('button', '', `▶ ${esc(sv.name)} — ${esc(sv.stage)}${sv.generation > 1 ? ` · gen ${sv.generation}` : ''}`, menu);
        c.onclick = () => { this.game.audio.start(); setSlot(sv.slot); this.game.continueGame(); };
      }
    }
    const n = h('button', '', saves.length ? '＋ Begin a new life (your other cats stay saved)' : 'Begin your life', menu);
    n.onclick = () => {
      this.game.audio.start();
      if (!saves.length) { this.joinSlot = undefined; newSlot(); this.create(); return; }
      this.whereBorn(saves, () => this.title(hasSave));
    };
    const ctl = h('button', '', 'How to play', menu);
    ctl.onclick = () => this.help(() => this.title(hasSave));
    const st = h('button', '', 'Settings', menu);
    st.onclick = () => this.settings(() => this.title(hasSave));
    h('div', 'foot', 'An original world. Keyboard & mouse, or touch. Best with sound on. Progress saves automatically in your browser.', s);
  }

  private joinSlot: number | undefined;

  /** Choose to start fresh, or be born into the clan of one of your saved stories (same cats!). */
  whereBorn(saves: SaveSummary[], back: () => void) {
    this.clear();
    const s = h('div', 'screen title-screen', '', this.root);
    this.screen = s;
    h('h1', '', 'Where will you be born?', s);
    const menu = h('div', 'menu', '', s);
    const fresh = h('button', '', '🌱 A brand-new clan', menu);
    fresh.onclick = () => { this.joinSlot = undefined; newSlot(); this.create(); };
    for (const sv of saves.slice(0, 8)) {
      const b = h('button', '', `🏡 Into ${esc(clanTitle(sv.clan))} — with ${esc(sv.name)}'s clanmates`, menu);
      b.onclick = () => { this.joinSlot = sv.slot; newSlot(); this.create(); };
    }
    const bk = h('button', '', '← Back', menu);
    bk.onclick = back;
    h('div', 'foot', 'Being born into a saved clan keeps every cat in it — they will still be there, and your old cat lives on as a clanmate.', s);
  }

  confirm(title: string, text: string, yes: () => void) {
    const back = h('div', 'modal-back', '', this.root);
    const m = h('div', 'modal', `<h2>${esc(title)}</h2><p>${esc(text)}</p>`, back);
    const y = h('button', 'btn', 'Yes', m);
    const no = h('button', 'btn dim', 'Cancel', m);
    y.onclick = () => { back.remove(); yes(); };
    no.onclick = () => back.remove();
  }

  help(back: () => void) {
    this.clear();
    const s = h('div', 'screen title-screen', '', this.root);
    this.screen = s;
    const m = h('div', 'modal', `<h2>How to play</h2>${CONTROLS_HTML}`, s);
    const b = h('button', 'btn', 'Back', m);
    b.onclick = back;
  }

  // ------------------------------------------------------------ creation
  create(existing?: NewGameSpec) {
    this.clear();
    const g = this.game;
    const rng = new RNG((Math.random() * 1e9) | 0);
    const spec: NewGameSpec = existing ?? {
      name: rng.pick(CLASSIC_PREFIXES),
      sex: rng.chance(0.5) ? 'tom' : 'she',
      app: randomAppearance(rng),
      seed: (Math.random() * 1e6) | 0,
      clanName: 'ThunderClan',
      lore: 'classic',
    };
    let asKit = false;
    const s = h('div', 'screen create', '', this.root);
    this.screen = s;
    const form = h('div', 'form', '', s);
    const label = h('div', 'preview-label', '', s);
    const refresh = () => {
      g.showPreview(spec.app, asKit ? 'kit' : 'warrior');
      label.innerHTML = `${esc(spec.lore === 'classic' ? spec.name + (asKit ? 'kit' : 'heart') : spec.name)}<br><small style="font-size:14px">${spec.sex === 'tom' ? 'tom' : 'she-cat'} · ${spec.app.breed ? esc(spec.app.breed) + ' · ' : ''}${PATTERN_LABEL[spec.app.pattern].toLowerCase()}</small>`;
    };
    h('h2', '', 'Your cat', form);
    h('div', '', '<span style="color:var(--ink-dim);font-size:13px">You will be born as a kit in the nursery. This is how you will look when grown.</span>', form);

    const field = (name: string) => { const f = h('div', 'field', `<label>${name}</label>`, form); return h('div', 'row', '', f); };
    // name
    const nr = field(spec.lore === 'classic' ? 'Name (e.g. Fire → Firekit, Firepaw, Fireheart)' : 'Name');
    const ni = h('input', '', undefined, nr) as HTMLInputElement;
    ni.type = 'text';
    ni.maxLength = 14;
    ni.value = spec.name;
    ni.oninput = () => { spec.name = ni.value.replace(/[^A-Za-z' -]/g, '').slice(0, 14); refresh(); };
    ni.onkeydown = (e) => e.stopPropagation();
    const rn = h('button', 'chip', '🎲', nr);
    rn.onclick = () => { spec.name = rng.pick(spec.lore === 'classic' ? CLASSIC_PREFIXES : GIVEN_NAMES); ni.value = spec.name; refresh(); };
    const chips = <T extends string>(name: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const r = field(name);
      const els: HTMLElement[] = [];
      for (const [v, l] of opts) {
        const b = h('button', `chip ${get() === v ? 'on' : ''}`, l, r);
        els.push(b);
        b.onclick = () => { set(v); els.forEach((e) => e.classList.remove('on')); b.classList.add('on'); refresh(); };
      }
    };
    chips<Sex>('Sex', [['tom', 'Tom'], ['she', 'She-cat']], () => spec.sex, (v) => (spec.sex = v));
    // breed preset
    const br = field('Breed');
    const bs = h('select', '', '', br) as HTMLSelectElement;
    for (const b of BREEDS) { const o = h('option', '', b.name, bs) as HTMLOptionElement; o.value = b.name; }
    bs.value = spec.app.breed ?? BREEDS[0].name;
    bs.onchange = () => {
      const b = BREEDS.find((x) => x.name === bs.value)!;
      Object.assign(spec.app, b.app);
      spec.app.breed = b.name === BREEDS[0].name ? undefined : b.name;
      if (b.app.pattern || b.app.base) spec.app.second = secondFor(spec.app.base, spec.app.pattern, rng);
      this.create(spec);
    };
    // fur colour
    const fr = field('Fur colour');
    const furEls: HTMLElement[] = [];
    for (const c of FUR_COLORS) {
      const b = h('div', `sw ${spec.app.base === c.hex ? 'on' : ''}`, '', fr);
      b.title = c.name;
      b.style.background = c.hex;
      furEls.push(b);
      b.onclick = () => { spec.app.base = c.hex; spec.app.second = secondFor(c.hex, spec.app.pattern, rng); furEls.forEach((e) => e.classList.remove('on')); b.classList.add('on'); refresh(); };
    }
    const colorInput = (row: HTMLElement, get: () => string, set: (v: string) => void, title: string) => {
      const ci = h('input', 'colorpick', undefined, row) as HTMLInputElement;
      ci.type = 'color'; ci.title = title; ci.value = get();
      ci.oninput = () => { set(ci.value); refresh(); };
      return ci;
    };
    colorInput(fr, () => spec.app.base, (v) => { spec.app.base = v; furEls.forEach((e) => e.classList.remove('on')); }, 'Any colour you like');
    const sr2 = field('Second colour (stripes, spots, patches)');
    colorInput(sr2, () => spec.app.second, (v) => (spec.app.second = v), 'Second colour');
    // pattern
    const pr = field('Pattern');
    const ps = h('select', '', '', pr) as HTMLSelectElement;
    for (const p of PATTERNS) { const o = h('option', '', PATTERN_LABEL[p], ps) as HTMLOptionElement; o.value = p; }
    ps.value = spec.app.pattern;
    ps.onchange = () => {
      spec.app.pattern = ps.value as Pattern;
      spec.app.second = secondFor(spec.app.base, spec.app.pattern, rng);
      if (spec.app.pattern === 'bicolor' || spec.app.pattern === 'calico') spec.app.white = Math.max(spec.app.white, 0.4);
      wr.value = String(spec.app.white);
      refresh();
    };
    const wf = field('White markings');
    const wr = h('input', '', undefined, wf) as HTMLInputElement;
    wr.type = 'range'; wr.min = '0'; wr.max = '0.8'; wr.step = '0.05';
    wr.value = String(spec.app.white);
    wr.oninput = () => { spec.app.white = parseFloat(wr.value); refresh(); };
    // eyes
    const er = field('Eye colour');
    const eyeEls: HTMLElement[] = [];
    for (const c of EYE_COLORS) {
      const b = h('div', `sw ${spec.app.eye === c.hex ? 'on' : ''}`, '', er);
      b.title = c.name;
      b.style.background = c.hex;
      eyeEls.push(b);
      b.onclick = () => { spec.app.eye = c.hex; eyeEls.forEach((e) => e.classList.remove('on')); b.classList.add('on'); refresh(); };
    }
    colorInput(er, () => spec.app.eye, (v) => { spec.app.eye = v; eyeEls.forEach((e) => e.classList.remove('on')); }, 'Any eye colour');
    const oe = field('Odd eyes (different second eye)');
    const oeCheck = h('input', '', undefined, oe) as HTMLInputElement;
    oeCheck.type = 'checkbox'; oeCheck.checked = !!spec.app.eye2;
    const oePick = colorInput(oe, () => spec.app.eye2 ?? '#5aa2e6', (v) => { spec.app.eye2 = v; oeCheck.checked = true; }, 'Second eye colour');
    oeCheck.onchange = () => { spec.app.eye2 = oeCheck.checked ? oePick.value : undefined; refresh(); };
    chips<FurLength>('Fur length', [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']], () => spec.app.fur, (v) => (spec.app.fur = v));
    chips<BodyType>('Body type', [['slender', 'Slender'], ['average', 'Average'], ['stocky', 'Stocky'], ['large', 'Large']], () => spec.app.body, (v) => (spec.app.body = v));
    chips<EarShape>('Ears', [['pointed', 'Pointed'], ['rounded', 'Rounded'], ['tufted', 'Tufted'], ['folded', 'Folded']], () => spec.app.ears, (v) => (spec.app.ears = v));
    chips<TailShape>('Tail', [['long', 'Long'], ['bushy', 'Bushy'], ['short', 'Short'], ['kinked', 'Kinked']], () => spec.app.tail, (v) => (spec.app.tail = v));
    const szr = field('Size');
    const szi = h('input', '', undefined, szr) as HTMLInputElement;
    szi.type = 'range'; szi.min = '0.85'; szi.max = '1.15'; szi.step = '0.01'; szi.value = String(spec.app.size);
    szi.oninput = () => { spec.app.size = parseFloat(szi.value); refresh(); };
    chips<Accessory>('Accessory', (Object.keys(ACCESSORY_LABEL) as Accessory[]).map((a) => [a, ACCESSORY_LABEL[a]] as [Accessory, string]), () => spec.app.accessory ?? 'none', (v) => (spec.app.accessory = v));
    const acr = field('Accessory colour');
    colorInput(acr, () => spec.app.accessoryColor ?? '#b8323a', (v) => (spec.app.accessoryColor = v), 'Accessory colour');
    const kr = field('Preview');
    const kb = h('button', 'chip', 'Show as kit', kr);
    kb.onclick = () => { asKit = !asKit; kb.classList.toggle('on', asKit); refresh(); };
    const rb = h('button', 'chip', '🎲 Randomise look', kr);
    rb.onclick = () => { spec.app = randomAppearance(rng); this.create(spec); };
    h('h2', '', 'Your world', form).style.marginTop = '20px';
    lore.mode = spec.lore;
    chips<LoreMode>('Clans & naming', [['classic', 'Forest Clans (Thunder, River, Wind, Shadow)'], ['original', 'Original Mistwood clans']], () => spec.lore, (v) => {
      spec.lore = v;
      lore.mode = v;
      spec.clanName = v === 'classic' ? 'ThunderClan' : HOME_CLAN_NAMES[0];
      this.create(spec);
    });
    const cr = field('Your clan');
    const cs = h('select', '', '', cr) as HTMLSelectElement;
    for (const n of spec.lore === 'classic' ? CLASSIC_CLANS : HOME_CLAN_NAMES) { const o = h('option', '', `${clanTitle(n)}`, cs) as HTMLOptionElement; o.value = n; }
    cs.value = spec.clanName;
    cs.onchange = () => (spec.clanName = cs.value);
    const sr = field('World seed (same seed = same forest)');
    const si = h('input', '', undefined, sr) as HTMLInputElement;
    si.type = 'number';
    si.value = String(spec.seed);
    si.style.width = '140px';
    si.oninput = () => (spec.seed = Math.abs(parseInt(si.value, 10) || 0));
    si.onkeydown = (e) => e.stopPropagation();
    const sd = h('button', 'chip', '🎲', sr);
    sd.onclick = () => { spec.seed = (Math.random() * 1e6) | 0; si.value = String(spec.seed); };
    const go = h('button', 'go', 'Be born into the clan ➜', form);
    go.onclick = () => {
      if (!spec.name.trim()) { ni.focus(); return; }
      spec.name = spec.name.trim().charAt(0).toUpperCase() + spec.name.trim().slice(1);
      this.clear();
      spec.joinSlot = this.joinSlot;
      g.newGame(spec);
    };
    const back = h('button', 'btn dim', '← Back', form);
    back.onclick = () => g.toTitle();
    refresh();
  }

  // ------------------------------------------------------------ pause
  pause() {
    this.clear();
    const g = this.game;
    const s = h('div', 'screen title-screen', '', this.root);
    s.style.background = 'rgba(0,0,0,0.5)';
    this.screen = s;
    h('h1', '', 'Paused', s).style.fontSize = '54px';
    const menu = h('div', 'menu', '', s);
    const add = (label: string, fn: () => void) => { const b = h('button', '', label, menu); b.onclick = fn; };
    add('Resume', () => g.resume());
    add('Journal', () => { g.resume(); g.ui.panels.open('journal'); });
    add('Map', () => { g.resume(); g.ui.panels.open('map'); });
    if (g.clan.leader?.isPlayer || g.clan.deputy?.isPlayer) add('Clan council', () => { g.resume(); g.ui.panels.open('leader'); });
    add('Rest for a moon (pass time)', () => {
      if (g.combat.playerInCombat) { g.ui.toast('Not while you are in danger!', 'danger'); return; }
      g.resume();
      g.passTime(24);
    });
    add('Save game', () => { g.save(); g.ui.toast('Game saved.', 'good'); });
    add('Settings', () => this.settings(() => this.pause()));
    add('How to play', () => this.help(() => this.pause()));
    add('Save & quit to title', () => { g.save(); g.toTitle(); });
  }

  // ------------------------------------------------------------ settings
  settings(back: () => void) {
    this.clear();
    const g = this.game;
    const st = g.settings;
    const s = h('div', 'screen title-screen', '', this.root);
    s.style.background = 'rgba(0,0,0,0.55)';
    this.screen = s;
    const m = h('div', 'modal create', '<h2>Settings</h2>', s);
    m.style.display = 'block';
    const field = (name: string) => { const f = h('div', 'field', `<label>${name}</label>`, m); return h('div', 'row', '', f); };
    const chips = <T extends string | boolean | number>(name: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const r = field(name);
      const els: HTMLElement[] = [];
      for (const [v, l] of opts) {
        const b = h('button', `chip ${get() === v ? 'on' : ''}`, l, r);
        els.push(b);
        b.onclick = () => { set(v); els.forEach((e) => e.classList.remove('on')); b.classList.add('on'); g.applySettings(); saveSettings(st); };
      }
    };
    chips('Graphics quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], () => st.quality, (v) => (st.quality = v as Settings['quality']));
    chips('Shadows', [[true, 'On'], [false, 'Off']], () => st.shadows, (v) => (st.shadows = v as boolean));
    chips('Length of a day', [[4, '4 min'], [7, '7 min'], [12, '12 min'], [20, '20 min']], () => st.dayMinutes, (v) => (st.dayMinutes = v as number));
    chips('Invert mouse Y', [[false, 'No'], [true, 'Yes']], () => st.invertY, (v) => (st.invertY = v as boolean));
    chips('Cat replies to your own words', [[true, 'Smart (AI when available)'], [false, 'Simple (offline)']], () => st.aiChat, (v) => (st.aiChat = v as boolean));
    chips('Show FPS', [[false, 'No'], [true, 'Yes']], () => st.showFps, (v) => (st.showFps = v as boolean));
    const vr = field('Volume');
    const vi = h('input', '', undefined, vr) as HTMLInputElement;
    vi.type = 'range'; vi.min = '0'; vi.max = '1'; vi.step = '0.05'; vi.value = String(st.volume);
    vi.oninput = () => { st.volume = parseFloat(vi.value); g.applySettings(); saveSettings(st); };
    const sr = field('Mouse sensitivity');
    const si = h('input', '', undefined, sr) as HTMLInputElement;
    si.type = 'range'; si.min = '0.3'; si.max = '2.5'; si.step = '0.1'; si.value = String(st.sensitivity);
    si.oninput = () => { st.sensitivity = parseFloat(si.value); g.applySettings(); saveSettings(st); };
    const b = h('button', 'btn', 'Back', m);
    b.onclick = back;
  }

  // ------------------------------------------------------------ death & succession
  memorial(dead: Cat, cause: string) {
    this.clear();
    const g = this.game;
    const clan = g.clan;
    const s = h('div', 'screen memorial', '', this.root);
    this.screen = s;
    this.game.ui.hideBanner();
    h('h1', '', esc(`${displayName(dead)} walks the Long Meadow`), s);
    const kits = dead.kits.map((k) => clan.get(k)).filter((k) => k) as Cat[];
    const summary = [
      `${roleLabel({ ...dead, alive: true })} of ${clanTitle(esc(g.territories.homeName))}`,
      `lived ${Math.floor(dead.age)} moons`,
      `died of ${esc(cause)}`,
      dead.mentored ? `mentored ${dead.mentored} apprentice${dead.mentored > 1 ? 's' : ''}` : '',
      kits.length ? `${kits.length} kit${kits.length > 1 ? 's' : ''}` : '',
      dead.deeds ? `${dead.deeds} good deeds remembered` : '',
    ].filter(Boolean).join(' · ');
    h('div', 'epitaph', summary, s);
    const mourners = clan.home().filter((c) => (c.relations[dead.id]?.opinion ?? 0) > 40).slice(0, 5).map((c) => displayName(c));
    if (mourners.length) h('div', 'epitaph', `Mourned by ${esc(mourners.join(', '))}.`, s);
    this.lifeCard(dead, s);
    const cands = this.successors(dead);
    const box = h('div', 'succ modal', '', s);
    if (!cands.length) {
      h('h2', '', 'No one remains to carry the story', box);
      h('p', '', 'The clan has scattered. Perhaps a new clan will rise in these woods.', box);
      const b = h('button', 'btn', 'Begin a new life', box);
      b.onclick = () => this.create();
      return;
    }
    h('h2', '', 'Continue the story as…', box);
    h('p', '', 'The forest goes on. Choose who will carry your clan\'s story forward.', box);
    const cards = h('div', 'cards', '', box);
    for (const [c, why] of cands) {
      const card = h('div', 'card', `<div class="cn">${esc(displayName(c))}</div><div class="cr">${esc(roleLabel(c))} · ${Math.floor(c.age)} moons · ${c.traits.join(', ')}</div><div class="cr" style="color:var(--accent)">${esc(why)}</div>`, cards);
      card.onclick = () => { this.clear(); g.continueAs(c); };
    }
  }

  /** A look back at the life that just ended: moons, personality, deeds. */
  lifeCard(dead: Cat, parent: HTMLElement) {
    const g = this.game;
    const clan = g.clan;
    const TRAIT_TEXT: Record<string, string> = {
      friendly: 'warm and quick to make friends', shy: 'quiet and gentle', brave: 'fearless when it mattered', curious: 'always wondering what lay beyond the next tree',
      serious: 'steady and dutiful', playful: 'full of mischief and fun', suspicious: 'watchful and slow to trust', aggressive: 'fierce and quick to fight',
      loyal: 'loyal to the clan above all', ambitious: 'driven to rise higher', kind: 'kind to every cat', mischievous: 'a born troublemaker', calm: 'calm in every storm', lazy: 'fond of a long nap in the sun',
    };
    const stageAt = (m: number) => (m < 6 ? 'kit' : m < 12 ? 'apprentice' : 'warrior');
    const moons = Math.floor(dead.age);
    const mate = clan.get(dead.mate);
    const kits = dead.kits.map((k) => clan.get(k)).filter(Boolean) as Cat[];
    const friends = Object.entries(dead.relations).filter(([, r]) => r.opinion > 55).map(([id]) => clan.get(id)).filter((c) => c && c.clan === 'home').slice(0, 4) as Cat[];
    const rivals = Object.entries(dead.relations).filter(([, r]) => r.opinion < -30).map(([id]) => clan.get(id)).filter(Boolean).slice(0, 3) as Cat[];
    const best = dead.memories.slice().sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 4);
    const skill = (n: number) => '●'.repeat(Math.max(1, Math.round(n / 20))) + '○'.repeat(5 - Math.max(1, Math.round(n / 20)));
    const card = h('div', 'succ modal life-card', '', parent);
    card.innerHTML = `
      <h2>A life of ${moons} moon${moons === 1 ? '' : 's'}</h2>
      <div class="life-grid">
        <div class="big-moons"><div class="n">${moons}</div><div class="l">moons</div><div class="s">${esc(stageAt(0))} → ${esc(dead.stage === 'elder' ? 'elder' : stageAt(moons))}${dead.role === 'leader' ? ' → leader' : dead.role === 'deputy' ? ' → deputy' : dead.role === 'medicine' ? ' → medicine cat' : ''}</div></div>
        <div>
          <div class="kv">
            <b>Personality</b><span>${dead.traits.map((t) => `<b style="color:var(--accent)">${esc(t)}</b> — ${esc(TRAIT_TEXT[t] ?? t)}`).join('<br>')}</span>
            <b>Looks</b><span>${esc(PATTERN_LABEL[dead.app.pattern].toLowerCase())}, ${esc(dead.app.fur)} fur, ${esc(dead.app.body)} build</span>
            <b>Reputation</b><span>${Math.round(dead.reputation)} (${dead.reputation > 40 ? 'respected' : dead.reputation > 10 ? 'trusted' : dead.reputation > -10 ? 'ordinary' : 'doubted'})</span>
            <b>Hunting</b><span>${skill(dead.skills.hunting)}</span>
            <b>Fighting</b><span>${skill(dead.skills.fighting)}</span>
            <b>Tracking</b><span>${skill(dead.skills.tracking)}</span>
            <b>Healing</b><span>${skill(dead.skills.healing)}</span>
            ${mate ? `<b>Mate</b><span>${esc(displayName(mate))}</span>` : ''}
            ${kits.length ? `<b>Kits</b><span>${esc(kits.map((k) => displayName(k)).join(', '))}</span>` : ''}
            ${dead.mentored ? `<b>Apprentices</b><span>${dead.mentored} trained</span>` : ''}
            ${friends.length ? `<b>Closest friends</b><span>${esc(friends.map((f) => displayName(f)).join(', '))}</span>` : ''}
            ${rivals.length ? `<b>Rivals</b><span>${esc(rivals.map((f) => displayName(f)).join(', '))}</span>` : ''}
            <b>Good deeds</b><span>${dead.deeds}</span>
          </div>
        </div>
      </div>
      ${best.length ? `<h3>Remembered moments</h3>${best.map((m) => `<div class="entry"><span class="day">Moon ${m.day + 1}</span>${m.weight > 0 ? '💛' : '🖤'} ${esc(m.text)}</div>`).join('')}` : ''}`;
  }

  successors(dead: Cat): [Cat, string][] {
    const clan = this.game.clan;
    const home = clan.home().filter((c) => !c.isPlayer);
    const out: [Cat, string][] = [];
    const seen = new Set<string>();
    const add = (c: Cat | undefined, why: string) => { if (c && c.alive && !seen.has(c.id) && home.includes(c)) { seen.add(c.id); out.push([c, why]); } };
    for (const k of dead.kits) add(clan.get(k), 'your kit');
    add(clan.get(dead.mate), 'your mate');
    add(clan.get(dead.apprentice), 'your apprentice');
    for (const c of home) if (isFamily(c, dead)) add(c, 'family');
    const friends = home.filter((c) => (dead.relations[c.id]?.opinion ?? 0) > 40).sort((a, b) => dead.relations[b.id].opinion - dead.relations[a.id].opinion);
    for (const c of friends.slice(0, 4)) add(c, 'close friend');
    for (const c of home.filter((c) => c.stage === 'kit' || c.stage === 'apprentice').slice(0, 3)) add(c, 'a young cat with a whole life ahead');
    for (const c of home) add(c, 'clanmate');
    return out.slice(0, 12);
  }

  loading(text: string) {
    this.clear();
    const s = h('div', 'loading', esc(text), this.root);
    this.screen = s;
  }
}
