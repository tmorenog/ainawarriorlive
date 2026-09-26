// Touch controls: virtual joystick, drag-to-look and action buttons.
import type { Game } from '../game';
import { h } from './ui';

export function isTouchDevice() {
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0 || matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  el: HTMLElement;
  private crouchBtn!: HTMLElement;
  private sprintBtn!: HTMLElement;
  private sprint = false;

  constructor(private game: Game) {
    this.el = h('div', 'touch hidden', '', game.ui.root);
    const input = game.input;
    input.touchActive = true;
    // look zone
    const look = h('div', 'lookzone', '', this.el);
    let lastLook: { id: number; x: number; y: number } | null = null;
    look.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lastLook = { id: t.identifier, x: t.clientX, y: t.clientY }; e.preventDefault(); }, { passive: false });
    look.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (lastLook && t.identifier === lastLook.id) {
          input.addLook((t.clientX - lastLook.x) * 1.6, (t.clientY - lastLook.y) * 1.6);
          lastLook.x = t.clientX; lastLook.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    look.addEventListener('touchend', () => (lastLook = null));
    // joystick
    const joy = h('div', 'joy', '', this.el);
    const knob = h('i', '', '', joy);
    let jid: number | null = null;
    const setJoy = (x: number, y: number) => {
      const r = joy.getBoundingClientRect();
      let dx = (x - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (y - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      input.touchMove.x = dx;
      input.touchMove.y = -dy;
      knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
      if (this.sprint) input.virtualDown('ShiftLeft');
    };
    joy.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; jid = t.identifier; setJoy(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    joy.addEventListener('touchmove', (e) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === jid) setJoy(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    const endJoy = () => { jid = null; input.touchMove.x = input.touchMove.y = 0; knob.style.transform = ''; };
    joy.addEventListener('touchend', endJoy);
    joy.addEventListener('touchcancel', endJoy);
    // buttons
    const btns = h('div', 'tbtns', '', this.el);
    const hold = (label: string, sub: string, code: string, parent = btns) => {
      const b = h('div', 'tbtn', `${label}<small>${sub}</small>`, parent);
      b.addEventListener('touchstart', (e) => { input.virtualDown(code); b.classList.add('on'); e.preventDefault(); }, { passive: false });
      const up = () => { input.virtualUp(code); b.classList.remove('on'); };
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
      return b;
    };
    hold('👃', 'sniff', 'KeyQ');
    hold('✋', 'use', 'KeyE');
    hold('🐾', 'swipe', 'KeyF');
    this.crouchBtn = h('div', 'tbtn', '⬇<small>crouch</small>', btns);
    this.crouchBtn.addEventListener('touchstart', (e) => { input.virtualDown('KeyC'); setTimeout(() => input.virtualUp('KeyC'), 50); e.preventDefault(); }, { passive: false });
    hold('⤴', 'jump/pounce', 'Space');
    this.sprintBtn = h('div', 'tbtn', '💨<small>sprint</small>', btns);
    this.sprintBtn.addEventListener('touchstart', (e) => {
      this.sprint = !this.sprint;
      this.sprintBtn.classList.toggle('on', this.sprint);
      if (!this.sprint) input.virtualUp('ShiftLeft');
      e.preventDefault();
    }, { passive: false });
    const top = h('div', 'ttop', '', this.el);
    const tap = (label: string, fn: () => void) => { const b = h('div', 'tbtn', label, top); b.addEventListener('touchstart', (e) => { fn(); e.preventDefault(); }, { passive: false }); };
    tap('☰', () => game.pause());
    tap('📖', () => game.ui.panels.toggle('journal'));
    tap('🗺', () => game.ui.panels.toggle('map'));
    tap('🍖', () => game.interactions.eatCarried());
    tap('👁', () => { input.virtualDown('KeyV'); setTimeout(() => input.virtualUp('KeyV'), 50); });
  }

  show(v: boolean) {
    this.el.classList.toggle('hidden', !v);
  }

  update() {
    this.crouchBtn.classList.toggle('on', this.game.player.crouchToggle);
  }
}
