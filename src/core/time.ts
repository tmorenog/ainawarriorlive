import { Season, SEASONS } from '../world/worldState';

/** One in-game day is a "moon" of a cat's life. Three moons per season. */
export const MOONS_PER_SEASON = 3;

export class GameTime {
  totalHours = 7; // start at morning
  daySeconds = 420; // real seconds per full day
  speed = 1;

  get hour() { return ((this.totalHours % 24) + 24) % 24; }
  get day() { return Math.floor(this.totalHours / 24); }
  get season(): Season { return SEASONS[Math.floor(this.day / MOONS_PER_SEASON) % 4]; }
  get seasonProgress() { return (this.day % MOONS_PER_SEASON + this.hour / 24) / MOONS_PER_SEASON; }
  get isNight() { const h = this.hour; return h < 5.5 || h > 20.5; }
  get isDusk() { const h = this.hour; return h > 18.5 && h <= 20.5; }
  get isDawn() { const h = this.hour; return h >= 5 && h < 7.5; }
  /** 0 at noon, 1 at midnight */
  get darkness() {
    const h = this.hour;
    if (h >= 7 && h <= 18.5) return 0;
    if (h > 18.5 && h < 21) return (h - 18.5) / 2.5;
    if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
    return 1;
  }

  advance(dtSeconds: number): number {
    const dh = (dtSeconds / this.daySeconds) * 24 * this.speed;
    this.totalHours += dh;
    return dh;
  }

  label(): string {
    const h = this.hour;
    if (h < 5) return 'Night';
    if (h < 7.5) return 'Dawn';
    if (h < 11) return 'Morning';
    if (h < 14) return 'Sun-high';
    if (h < 18) return 'Afternoon';
    if (h < 20.5) return 'Dusk';
    return 'Night';
  }
}
