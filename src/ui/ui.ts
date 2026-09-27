// Minimal in-game UI: HUD, prompts, toasts, speech bubbles, dialogs, modals.
import * as THREE from 'three';
import { clanTitle } from '../lore';
import type { Game } from '../game';
import { Cat, displayName, roleLabel } from '../cats/types';
import { WEATHER_ICON, WEATHER_LABEL } from '../world/weather';
import { SEASON_NAMES } from '../world/worldState';
import { relLabel, REL_COLOR, isFamily } from '../sim/social';
import { Panels } from './panels';
import { clamp } from '../core/math';
import { loreText } from '../lore';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  parent?.appendChild(el);
  return el;
}
export function esc(s: string) {
  return loreText(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

export interface DialogOpt { label: string; action: () => void; hint?: string; disabled?: boolean }
export interface DialogSpec { speaker?: Cat; text: string; sub?: string; options: DialogOpt[]; onClose?: () => void; input?: (text: string) => void; said?: string }

export class UI {
  root: HTMLElement;
  hud: HTMLElement;
  private status: HTMLElement;
  private time: HTMLElement;
  private compass: HTMLElement;
  private area: HTMLElement;
  private obj: HTMLElement;
  private prompt: HTMLElement;
  private toasts: HTMLElement;
  private bubbles: HTMLElement;
  private hurt: HTMLElement;
  private lowHp: HTMLElement;
  fadeEl: HTMLElement;
  private banner: HTMLElement;
  private badge: HTMLElement;
  private fps: HTMLElement;
  private giveUp: HTMLElement;
  private pounce: HTMLElement;
  private crosshair: HTMLElement;
  private dialogEl: HTMLElement | null = null;
  private dialogSpec: DialogSpec | null = null;
  private modalEl: HTMLElement | null = null;
  private bubblePool: HTMLElement[] = [];
  private platePool: HTMLElement[] = [];
  private placePool: HTMLElement[] = [];
  private placeLayer!: HTMLElement;
  private hudT = 0;
  panels: Panels;
  showFps = false;
  private frames = 0;
  private fpsT = 0;
  private v = new THREE.Vector3();
  private modalQueue: (() => void)[] = [];

  constructor(private game: Game) {
    this.root = document.getElementById('ui')!;
    this.hud = h('div', 'hud hidden', undefined, this.root);
    this.status = h('div', 'hud-status', '', this.hud);
    this.time = h('div', 'hud-time', '', this.hud);
    this.compass = h('div', 'hud-compass', '', this.hud);
    this.area = h('div', 'hud-area', '', this.hud);
    this.obj = h('div', 'hud-obj interactive', '', this.hud);
    this.obj.onclick = () => this.panels.open('journal', 'duties');
    this.prompt = h('div', 'hud-prompt hidden', '', this.hud);
    this.crosshair = h('div', 'crosshair', '', this.hud);
    this.pounce = h('div', 'pounce-meter hidden', '', this.hud);
    this.placeLayer = h('div', '', '', this.hud);
    this.bubbles = h('div', '', '', this.hud);
    this.toasts = h('div', 'toasts', '', this.root);
    this.hurt = h('div', 'hurt', '', this.root);
    this.lowHp = h('div', 'lowhealth', '', this.root);
    this.banner = h('div', 'banner hidden', '', this.root);
    this.badge = h('div', 'decision-badge interactive hidden', '', this.hud);
    this.badge.onclick = () => this.game.decisions.showNext();
    this.fps = h('div', 'fps hidden', '', this.root);
    this.giveUp = h('button', 'giveup hidden', '🏳 Give up <kbd>X</kbd>', this.hud);
    this.giveUp.onclick = () => this.game.combat.playerYield();
    this.fadeEl = h('div', 'fade', '', this.root);
    this.panels = new Panels(game, this);
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  showHud(v: boolean) { this.hud.classList.toggle('hidden', !v); }

  isBusy() { return !!this.dialogEl || !!this.modalEl || this.panels.isOpen || this.game.state !== 'playing'; }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' && e.code !== 'Escape') return;
    if (this.dialogEl && this.dialogSpec) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= this.dialogSpec.options.length) {
        e.preventDefault();
        const o = this.dialogSpec.options[n - 1];
        if (!o.disabled) this.pickDialog(o);
      } else if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeDialog(true);
      }
      return;
    }
    if (this.modalEl) {
      const btns = [...this.modalEl.querySelectorAll('button.opt')] as HTMLButtonElement[];
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= btns.length && (e.target as HTMLElement)?.tagName !== 'INPUT') { e.preventDefault(); btns[n - 1].click(); }
    }
  }

  // ------------------------------------------------------------ toasts etc.
  toast(text: string, kind: string = 'info') {
    const t = h('div', `toast ${kind}`, esc(text), this.toasts);
    while (this.toasts.children.length > 6) this.toasts.removeChild(this.toasts.firstChild!);
    const life = kind === 'danger' || kind === 'objective' ? 7000 : 5200;
    setTimeout(() => t.classList.add('out'), life);
    setTimeout(() => t.remove(), life + 700);
  }

  floatText(text: string, color: string) {
    const el = h('div', 'float-text', esc(text), this.root);
    el.style.color = color;
    setTimeout(() => el.remove(), 950);
  }

  hurtFlash() {
    this.hurt.classList.add('on');
    setTimeout(() => this.hurt.classList.remove('on'), 60);
  }

  areaLabel(label: string) {
    this.area.textContent = loreText(label);
    this.area.classList.remove('flash');
    void this.area.offsetWidth;
    this.area.classList.add('flash');
  }

  showBanner(text: string, seconds = 8) {
    this.banner.innerHTML = esc(text);
    this.banner.classList.remove('hidden');
    clearTimeout((this.banner as any)._t);
    (this.banner as any)._t = setTimeout(() => this.banner.classList.add('hidden'), seconds * 1000);
  }

  fade(on: boolean, text = '') {
    this.fadeEl.textContent = loreText(text);
    this.fadeEl.classList.toggle('on', on);
  }

  // ------------------------------------------------------------ dialog
  dialog(spec: DialogSpec) {
    this.closeDialog(false);
    const g = this.game;
    g.player.busy = true;
    g.input.unlock();
    this.dialogSpec = spec;
    const el = h('div', 'dialog interactive', '', this.root);
    if (spec.speaker) {
      const c = spec.speaker;
      const who = h('div', 'who', '', el);
      const sw = h('div', 'swatch', '', who);
      sw.style.background = `radial-gradient(circle at 35% 35%, ${c.app.base}, ${c.app.second})`;
      const pc = g.clan.player;
      const rel = c.id !== pc.id ? relLabel(c.relations[pc.id], isFamily(c, pc), c.mate === pc.id) : '';
      h('div', '', `<div class="nm">${esc(displayName(c))}</div><div class="rl">${esc(spec.sub ?? roleLabel(c))}${rel ? ` · <span style="color:${REL_COLOR[rel]}">${rel}</span>` : ''} · ${c.traits.join(', ')}</div>`, who);
    }
    if (spec.said) h('div', 'said', `You: “${esc(spec.said)}”`, el);
    h('div', 'txt', esc(spec.text), el);
    if (spec.input) {
      const row = h('div', 'say-row', '', el);
      const inp = h('input', 'say-input', undefined, row) as HTMLInputElement;
      inp.type = 'text';
      inp.maxLength = 200;
      inp.placeholder = 'Say something… (type and press Enter)';
      const send = h('button', 'btn say-send', 'Say', row);
      const go = () => {
        const t = inp.value.trim();
        if (!t) return;
        const fn = spec.input!;
        this.closeDialog(false);
        fn(t);
      };
      send.onclick = go;
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); go(); }
        if (e.key === 'Escape') { inp.blur(); }
      };
      inp.onkeyup = (e) => e.stopPropagation();
    }
    const opts = h('div', 'opts', '', el);
    spec.options.forEach((o, i) => {
      const b = h('button', 'opt', `<span class="n">${i + 1}</span>${esc(o.label)}${o.hint ? `<span class="h">(${esc(o.hint)})</span>` : ''}`, opts);
      if (o.disabled) b.setAttribute('disabled', '');
      b.onclick = () => { if (!o.disabled) this.pickDialog(o); };
    });
    this.dialogEl = el;
  }

  private pickDialog(o: DialogOpt) {
    const spec = this.dialogSpec;
    this.closeDialog(false);
    this.game.audio.click();
    o.action();
    void spec;
    this.afterClose();
  }

  closeDialog(user: boolean) {
    if (!this.dialogEl) return;
    const spec = this.dialogSpec;
    this.dialogEl.remove();
    this.dialogEl = null;
    this.dialogSpec = null;
    if (user) {
      spec?.onClose?.();
      this.afterClose();
    }
  }

  private afterClose() {
    // defer so chained dialogs can open first
    setTimeout(() => {
      if (!this.dialogEl && !this.modalEl) {
        this.game.player.busy = this.panels.isOpen;
        if (this.game.state === 'playing' && !this.panels.isOpen) this.game.input.lock();
        const next = this.modalQueue.shift();
        if (next) next();
        else this.game.decisions.flushQueue();
      }
    }, 30);
  }

  // ------------------------------------------------------------ modals
  choice(title: string, text: string, options: DialogOpt[], onDefer?: () => void) {
    if (this.modalEl || this.dialogEl) {
      this.modalQueue.push(() => this.choice(title, text, options, onDefer));
      return;
    }
    const g = this.game;
    g.player.busy = true;
    g.input.unlock();
    const back = h('div', 'modal-back', '', this.root);
    const m = h('div', 'modal', `<h2>${esc(title)}</h2><p>${esc(text)}</p>`, back);
    const opts = h('div', 'opts', '', m);
    options.forEach((o, i) => {
      const b = h('button', 'opt', `<span class="n">${i + 1}</span>${esc(o.label)}${o.hint ? `<span class="h">(${esc(o.hint)})</span>` : ''}`, opts);
      b.onclick = () => { this.closeModal(); g.audio.click(); o.action(); this.afterClose(); };
    });
    if (onDefer) {
      const later = h('button', 'btn dim', 'Decide later', m);
      later.style.marginTop = '10px';
      later.onclick = () => { this.closeModal(); onDefer(); this.afterClose(); };
    }
    this.modalEl = back;
  }

  nameChoice(title: string, text: string, options: string[], onPick: (s: string) => void) {
    if (this.modalEl || this.dialogEl) {
      this.modalQueue.push(() => this.nameChoice(title, text, options, onPick));
      return;
    }
    const g = this.game;
    g.player.busy = true;
    g.input.unlock();
    const back = h('div', 'modal-back', '', this.root);
    const m = h('div', 'modal', `<h2>${esc(title)}</h2><p>${esc(text)}</p>`, back);
    const opts = h('div', 'opts', '', m);
    const pick = (s: string) => {
      const clean = s.trim().replace(/[^A-Za-z' -]/g, '').slice(0, 16);
      if (!clean) return;
      const name = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
      this.closeModal();
      onPick(name);
      this.afterClose();
    };
    options.forEach((o, i) => {
      const b = h('button', 'opt', `<span class="n">${i + 1}</span>${esc(o)}`, opts);
      b.onclick = () => pick(o);
    });
    const inp = h('input', '', undefined, m) as HTMLInputElement;
    inp.type = 'text';
    inp.placeholder = 'Or type your own (e.g. Swiftpaw)';
    const ok = h('button', 'btn', 'Use my own', m);
    ok.onclick = () => pick(inp.value);
    inp.onkeydown = (e) => { if (e.key === 'Enter') pick(inp.value); e.stopPropagation(); };
    this.modalEl = back;
  }

  closeModal() {
    this.modalEl?.remove();
    this.modalEl = null;
  }

  openLeader() { this.panels.open('leader'); }

  // ------------------------------------------------------------ per-frame
  update(dt: number) {
    const g = this.game;
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      this.fps.textContent = `${Math.round(this.frames / this.fpsT)} fps`;
      this.frames = 0;
      this.fpsT = 0;
    }
    this.fps.classList.toggle('hidden', !this.showFps);
    if (g.state !== 'playing') return;
    this.giveUp.classList.toggle('hidden', !g.combat.playerInCombat);
    this.updateBubbles();
    this.updatePlaceLabels();
    this.updatePrompt();
    this.updateCompass();
    const p = g.player;
    if (p.charging) {
      this.pounce.classList.remove('hidden');
      const k = p.pounceCharge;
      const sweet = k > 0.55 && k < 0.95;
      this.pounce.style.background = `conic-gradient(${sweet ? '#8fd07a' : '#e8b865'} ${k * 360}deg, rgba(255,255,255,0.12) 0deg)`;
      this.pounce.style.mask = this.pounce.style.webkitMask = 'radial-gradient(circle, transparent 15px, #000 16px)';
    } else this.pounce.classList.add('hidden');
    this.hudT -= dt;
    if (this.hudT > 0) return;
    this.hudT = 0.2;
    this.updateStatus();
    this.updateTime();
    this.updateObjective();
    const pending = g.clan.pending.length;
    this.badge.classList.toggle('hidden', pending === 0);
    this.badge.textContent = `⚖ ${pending} decision${pending > 1 ? 's' : ''} waiting`;
    const c = g.clan.player;
    this.lowHp.style.opacity = c ? String(clamp(1 - c.health / 35, 0, 1)) : '0';
  }

  private updateStatus() {
    const g = this.game;
    const c = g.clan.player;
    if (!c) return;
    const p = g.player;
    const inv: string[] = [];
    for (const pr of p.prey) inv.push(`🐭 ${pr.kind}`);
    if (p.moss) inv.push(`🌿 moss ×${p.moss}`);
    for (const [k, v] of Object.entries(p.herbs)) if (v) inv.push(`🍃 ${k} ×${v}`);
    const hp = (c.health / 100) * 100;
    const extra = [c.sick > 20 ? '🤒 sick' : '', c.injury > 25 ? '🩹 injured' : '', c.expectingUntil !== null ? '🍼 expecting' : '', c.confinedUntil !== null && c.confinedUntil > g.time.day ? '⛓ confined' : ''].filter(Boolean).join(' ');
    this.status.innerHTML = `
      <div class="hud-name">${esc(displayName(c))}</div>
      <div class="hud-sub">${esc(roleLabel(c))} · ${Math.floor(c.age)} moons · ${g.clan.playerReputationLabel()}${extra ? ' · ' + extra : ''}</div>
      <div class="bar-label"><span>Health</span><span>${Math.round(c.health)}</span></div><div class="bar health"><i style="width:${hp}%"></i></div>
      <div class="bar-label"><span>Hunger</span><span>${c.hunger < 20 ? 'starving' : c.hunger < 45 ? 'hungry' : 'fed'}</span></div><div class="bar hunger"><i style="width:${c.hunger}%"></i></div>
      <div class="bar stamina"><i style="width:${p.stamina}%"></i></div>
      <div class="hud-inv">${inv.length ? esc(inv.join('  ')) : '<span style="color:var(--ink-dim)">Carrying nothing</span>'}</div>`;
  }

  private updateTime() {
    const g = this.game;
    const t = g.time;
    const icon = t.isNight ? '🌙' : t.isDawn || t.isDusk ? '🌅' : '☀️';
    const w = g.weather;
    this.time.innerHTML = `<div class="big">${icon} ${t.label()}</div>
      <div class="dim">Moon ${t.day + 1} · ${SEASON_NAMES[t.season]}</div>
      <div class="dim">${WEATHER_ICON[w.kind]} ${WEATHER_LABEL[w.kind]} · ${Math.round(w.temperature)}°</div>
      <div class="dim">${clanTitle(g.territories.homeName)} · 🍖 ${Math.floor(g.clan.food)}</div>`;
  }

  private updateObjective() {
    const g = this.game;
    const o = g.objectives.primary;
    if (!o) {
      this.obj.innerHTML = `<div class="t">${esc(this.freeHint())}</div><div class="more"><kbd>J</kbd>journal · <kbd>M</kbd>map · <kbd>Esc</kbd>menu</div>`;
      return;
    }
    const prog = o.need > 1 ? ` (${o.progress ?? 0}/${o.need})` : '';
    const left = o.deadline !== undefined ? Math.max(0, Math.round(o.deadline - g.time.totalHours)) : null;
    this.obj.innerHTML = `<div class="t">${esc(o.title)}${prog}</div><div class="d">${esc(o.desc)}</div>
      <div class="more">${left !== null ? `⏳ ${left}h left · ` : ''}${g.objectives.list.length > 1 ? `+${g.objectives.list.length - 1} more · ` : ''}<kbd>J</kbd>journal</div>`;
  }

  private freeHint(): string {
    const g = this.game;
    const c = g.clan.player;
    if (c.exiled) return 'Exiled — survive, and seek a way home';
    if (c.stage === 'kit') return 'Explore the camp, play, visit the elders';
    if (c.hunger < 30) return 'You are hungry — hunt or eat';
    if (g.clan.food < g.clan.home().length * 0.6) return 'The fresh-kill pile is low — hunt for the clan';
    if (c.role === 'leader') return 'Lead your clan (L)';
    if (c.stage === 'apprentice') return 'Train, hunt and help the clan';
    if (c.stage === 'elder') return 'Rest, share stories, guide the young';
    return 'Hunt, patrol, explore, help your clan';
  }

  private updatePrompt() {
    const g = this.game;
    const cur = g.interactions.current;
    if (cur && !g.player.busy) {
      this.prompt.classList.remove('hidden');
      this.prompt.innerHTML = `<kbd>E</kbd>${esc(cur.text)}`;
    } else this.prompt.classList.add('hidden');
  }

  private updateCompass() {
    const g = this.game;
    const yaw = g.player.yaw;
    const W = this.compass.clientWidth || 400;
    const heading = ((-yaw * 180) / Math.PI + 360) % 360; // 0 = north (-z)
    const items: { label: string; ang: number; cls: string }[] = [];
    const cards: [string, number][] = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
    for (const [l, a] of cards) items.push({ label: l, ang: a, cls: l.length === 1 ? 'card' : '' });
    const p = g.player.pos;
    const bearingTo = (x: number, z: number) => ((Math.atan2(x - p.x, -(z - p.z)) * 180) / Math.PI + 360) % 360;
    if (Math.hypot(p.x, p.z) > 16) items.push({ label: '🏠', ang: bearingTo(0, 0), cls: 'mark' });
    const o = g.objectives.primary;
    if (o?.target) items.push({ label: '◆', ang: bearingTo(o.target.x, o.target.z), cls: 'mark' });
    if (g.events.isActive('gathering')) items.push({ label: '🌕', ang: bearingTo(g.territories.council.x, g.territories.council.z), cls: 'mark' });
    let html = '';
    for (const it of items) {
      let d = it.ang - heading;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      if (Math.abs(d) > 75) continue;
      const x = W / 2 + (d / 75) * (W / 2);
      html += `<span class="${it.cls}" style="left:${x}px${it.label === '◆' ? ';color:#e8b865' : ''}">${it.label}</span>`;
    }
    this.compass.innerHTML = html;
  }

  /** Floating signs over every den and camp landmark. */
  private updatePlaceLabels() {
    const g = this.game;
    const camp = g.camp;
    const pp = g.player.pos;
    const W = window.innerWidth, H = window.innerHeight;
    let i = 0;
    if (Math.hypot(pp.x, pp.z) < 45) {
      const places: { label: string; icon: string; x: number; z: number; y: number }[] = [];
      const icons: Record<string, string> = { leader: '👑', warriors: '⚔️', apprentices: '🐾', nursery: '🍼', elders: '🌙', medicine: '🌿' };
      for (const d of Object.values(camp.dens)) places.push({ label: d.label, icon: icons[d.name] ?? '🏠', x: d.x, z: d.z, y: g.groundAt(d.x, d.z) + d.radius * 0.85 + 0.55 });
      places.push({ label: 'High Rock', icon: '🪨', x: camp.highRock.x, z: camp.highRock.z, y: camp.highRock.top + 0.6 });
      places.push({ label: `Fresh-kill pile (${Math.floor(g.clan.food)})`, icon: '🍖', x: camp.pile.x, z: camp.pile.z, y: g.groundAt(camp.pile.x, camp.pile.z) + 0.6 });
      places.push({ label: 'Camp entrance', icon: '🌲', x: camp.entrance.x, z: camp.entrance.z - 2, y: g.groundAt(camp.entrance.x, camp.entrance.z - 2) + 1.2 });
      for (const p of places) {
        const d = Math.hypot(p.x - pp.x, p.z - pp.z);
        if (d > 32) continue;
        this.v.set(p.x, p.y, p.z).project(g.camera);
        if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
        const el = this.placePool[i] ?? (this.placePool[i] = h('div', 'place-label', '', this.placeLayer));
        el.style.display = '';
        const html = `${p.icon} ${esc(p.label)}`;
        if (el.innerHTML !== html) el.innerHTML = html;
        el.style.left = `${(this.v.x * 0.5 + 0.5) * W}px`;
        el.style.top = `${(-this.v.y * 0.5 + 0.5) * H}px`;
        el.style.opacity = String(clamp(1.25 - d / 32, 0.35, 1));
        i++;
      }
    }
    for (let k = i; k < this.placePool.length; k++) this.placePool[k].style.display = 'none';
  }

  private updateBubbles() {
    const g = this.game;
    const cam = g.camera;
    const W = window.innerWidth, H = window.innerHeight;
    let bi = 0, pi = 0;
    const pp = g.player.pos;
    for (const a of g.npcs.agents.values()) {
      const d = a.pos.distanceTo(pp);
      if (d > 22 || !a.model.root.visible) continue;
      this.v.set(a.pos.x, a.pos.y + (a.model.eyeHeight + 0.18) * 1, a.pos.z);
      this.v.project(cam);
      if (this.v.z > 1 || this.v.x < -1.1 || this.v.x > 1.1 || this.v.y < -1.1 || this.v.y > 1.1) continue;
      const sx = (this.v.x * 0.5 + 0.5) * W, sy = (-this.v.y * 0.5 + 0.5) * H;
      if (a.bubble && d < 18) {
        const el = this.bubblePool[bi] ?? (this.bubblePool[bi] = h('div', 'bubble', '', this.bubbles));
        el.style.display = '';
        const html = `<b>${esc(a.name)}</b>${esc(a.bubble.text)}`;
        if (el.innerHTML !== html) el.innerHTML = html;
        el.style.left = `${sx}px`;
        el.style.top = `${sy - 6}px`;
        el.style.opacity = String(clamp(1.3 - d / 18, 0.3, 1));
        bi++;
      } else if (d < 7) {
        const el = this.platePool[pi] ?? (this.platePool[pi] = h('div', 'nameplate', '', this.bubbles));
        el.style.display = '';
        const c = a.cat;
        const pc = g.clan.player;
        const rel = c.clan === 'home' ? relLabel(c.relations[pc.id], isFamily(c, pc), c.mate === pc.id) : (typeof c.clan === 'number' ? g.territories.rivals[c.clan].name : 'Loner');
        const html = `${esc(a.name)}<small>${esc(rel)}</small>`;
        if (el.innerHTML !== html) el.innerHTML = html;
        el.style.left = `${sx}px`;
        el.style.top = `${sy}px`;
        pi++;
      }
    }
    for (let i = bi; i < this.bubblePool.length; i++) this.bubblePool[i].style.display = 'none';
    for (let i = pi; i < this.platePool.length; i++) this.platePool[i].style.display = 'none';
  }
}
