import { Season, SEASONS } from '../world/worldState';

/** One in-game day is a "moon" of a cat's life. */
export const MOONS_PER_SEASON = 3;
/** Each season lasts 5 real minutes (in game hours, at normal speed). */
export const SEASON_SECONDS = 300;

export class GameTime {
  totalHours = 7; // start at morning
  daySeconds = 420; // real seconds per full day
  speed = 1;

  get hour() { return ((this.totalHours % 24) + 24) % 24; }
  get day() { return Math.floor(this.totalHours / 24); }
  private get seasonHours() { return (SEASON_SECONDS / this.daySeconds) * 24; }
  get season(): Season { return SEASONS[Math.floor(this.totalHours / this.seasonHours) % SEASONS.length]; }
  get seasonProgress() { return (this.totalHours / this.seasonHours) % 1; }
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
