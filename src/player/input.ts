// Keyboard, mouse (pointer lock) and touch input unified into simple queries.
export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  sensitivity = 1;
  invertY = false;
  touchMove = { x: 0, y: 0 };
  touchActive = false;
  enabled = true;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      this.pressedSet.add(code);
      this.down.add(code);
    });
    window.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.down.delete(code);
      this.releasedSet.add(code);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (this.touchActive) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch { /* ignore */ }
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string) { return this.enabled && this.down.has(code); }
  pressed(code: string) { return this.enabled && this.pressedSet.has(code); }
  released(code: string) { return this.releasedSet.has(code); }
  anyPressed(...codes: string[]) { return codes.some((c) => this.pressed(c)); }
  anyDown(...codes: string[]) { return codes.some((c) => this.isDown(c)); }

  /** Virtual keys for touch buttons. */
  virtualDown(code: string) { if (!this.down.has(code)) this.pressedSet.add(code); this.down.add(code); }
  virtualUp(code: string) { this.down.delete(code); this.releasedSet.add(code); }
  addLook(dx: number, dy: number) { this.mouseDX += dx; this.mouseDY += dy; }

  moveAxis(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.enabled && (this.touchMove.x || this.touchMove.y)) { x += this.touchMove.x; y += this.touchMove.y; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX * this.sensitivity, dy: this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1) };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
  }

  clear() {
    this.down.clear();
    this.pressedSet.clear();
    this.mouseDX = this.mouseDY = 0;
  }
}
