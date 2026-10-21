// Persistent modifications to the deterministic world (fires, fallen trees...).
export interface BurnScar { x: number; z: number; r: number; day: number }
export interface FallenLog { x: number; z: number; rot: number; len: number; day: number }
export interface Rockslide { x: number; z: number; r: number; day: number }

export interface WorldMods {
  burned: BurnScar[];
  logs: FallenLog[];
  rockslides: Rockslide[];
  taken: Record<string, number>; // interactable key -> day taken
  discovered: string[];
}

export function emptyMods(): WorldMods {
  return { burned: [], logs: [], rockslides: [], taken: {}, discovered: [] };
}

export type Season = 'spring' | 'blossom' | 'summer' | 'autumn' | 'winter';
/** Seasons turn every 5 real minutes: budding → cherry blossom → high-sun → leaf-drop → frost. */
export const SEASONS: Season[] = ['spring', 'blossom', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES: Record<Season, string> = {
  spring: 'Budding season',
  blossom: 'Blossom season',
  summer: 'High-sun season',
  autumn: 'Leaf-drop season',
  winter: 'Frost season',
};
