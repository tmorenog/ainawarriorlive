// Save / load via localStorage. The world itself is regenerated from the seed;
// only the simulation state and world modifications are stored.
import type { Game } from '../game';
import { Cat, displayName, roleLabel } from '../cats/types';
import { lore, LoreMode } from '../lore';

// Every cat you start gets its own save slot, so a new life never erases an old one.
const BASE = 'mistwood-save-v1';
const SLOT_KEY = 'mistwood-slot';
const keyFor = (slot: number) => (slot === 0 ? BASE : `${BASE}-${slot}`);
let currentSlot = (() => { try { return Number(localStorage.getItem(SLOT_KEY) ?? 0) || 0; } catch { return 0; } })();
const KEY_NOW = () => keyFor(currentSlot);

export interface SaveSummary { slot: number; name: string; stage: string; clan: string; generation: number; savedAt: number; }

export function listSaves(): SaveSummary[] {
  const out: SaveSummary[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k !== BASE && !k.startsWith(BASE + '-')) continue;
      const slot = k === BASE ? 0 : Number(k.slice(BASE.length + 1));
      if (!Number.isFinite(slot)) continue;
      try {
        const d = JSON.parse(localStorage.getItem(k)!) as SaveData;
        const pc = d.clan.cats[d.clan.playerId];
        out.push({ slot, name: pc ? displayName(pc) : '?', stage: pc ? roleLabel(pc) : '', clan: d.homeName, generation: d.clan.generation, savedAt: d.savedAt });
      } catch { /* skip broken save */ }
    }
  } catch { /* storage unavailable */ }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function setSlot(slot: number) {
  currentSlot = slot;
  try { localStorage.setItem(SLOT_KEY, String(slot)); } catch { /* ignore */ }
}

/** Pick a fresh, unused slot for a brand-new cat. */
export function newSlot() {
  const used = new Set(listSaves().map((s) => s.slot));
  let n = 0;
  while (used.has(n)) n++;
  setSlot(n);
}

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
  return listSaves().length > 0;
}

export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY_NOW());
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
    localStorage.setItem(KEY_NOW(), JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function deleteSave() {
  try { localStorage.removeItem(KEY_NOW()); } catch { /* ignore */ }
}
