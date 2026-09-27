// Save / load via localStorage. The world itself is regenerated from the seed;
// only the simulation state and world modifications are stored.
import type { Game } from '../game';
import type { Cat } from '../cats/types';
import { lore, LoreMode } from '../lore';

const KEY = 'mistwood-save-v1';

export interface SaveData {
  v: 1;
  savedAt: number;
  seed: number;
  homeName: string;
  lore?: LoreMode;
  totalHours: number;
  weather: { kind: string; snowCover: number };
  clan: {
    cats: Record<string, Cat>;
    leaderId: string | null;
    deputyId: string | null;
    medicineId: string | null;
    food: number;
    journal: any[];
    rivals: any[];
    playerId: string;
    generation: number;
    lineage: string[];
    borderSafety: number;
    usedNames: string[];
  };
  player: { x: number; z: number; yaw: number; prey: any[]; herbs: any; moss: number; thirdPerson: boolean; lastLesson: number };
  mods: any;
  events: any;
  objectives: any[];
}

export function hasSave(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.v === 1 ? d : null;
  } catch { return null; }
}

export function writeSave(g: Game): boolean {
  const c = g.clan;
  const p = g.player;
  // compact: drop dead rival cats and forget stale relations to dead cats
  const cats: Record<string, Cat> = {};
  for (const [id, cat] of Object.entries(c.cats)) {
    if (!cat.alive && cat.clan !== 'home') continue;
    cats[id] = cat;
  }
  const data: SaveData = {
    v: 1,
    savedAt: Date.now(),
    seed: g.seed,
    homeName: g.territories.homeName,
    lore: lore.mode,
    totalHours: g.time.totalHours,
    weather: { kind: g.weather.kind, snowCover: g.weather.snowCover },
    clan: {
      cats,
      leaderId: c.leaderId,
      deputyId: c.deputyId,
      medicineId: c.medicineId,
      food: c.food,
      journal: c.journal.slice(-400),
      rivals: c.rivals,
      playerId: c.playerId,
      generation: c.generation,
      lineage: c.lineage,
      borderSafety: c.borderSafety,
      usedNames: [...c.usedNames],
    },
    player: { x: p.pos.x, z: p.pos.z, yaw: p.yaw, prey: p.prey, herbs: p.herbs, moss: p.moss, thirdPerson: p.thirdPerson, lastLesson: g.training.lastLessonHour },
    mods: g.mods,
    events: g.events.serialize(),
    objectives: g.objectives.serialize(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function deleteSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
