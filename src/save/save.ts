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
    herbStore?: { silverleaf: number; sunpetal: number; bitterroot: number };
    usedNames: string[];
  };
  player: { x: number; z: number; yaw: number; prey: any[]; herbs: any; moss: number; thirdPerson: boolean; lastLesson: number };
  mods: any;
  events: any;
  objectives: any[];
  /** Set once the 'old clanmates back to 30 moons' reset has been applied. */
  agesReset?: boolean;
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

export function readSaveSlot(slot: number): SaveData | null {
  try {
    const raw = localStorage.getItem(keyFor(slot));
    const d = raw ? JSON.parse(raw) : null;
    return d && d.v === 1 ? d : null;
  } catch { return null; }
}

/** Snapshots taken at the start of each moon, so you can go back in time. */
const MOONS = () => `${KEY_NOW()}-moons`;
export function pushMoonSnapshot(g: Game) {
  const d = buildSave(g);
  let list: string[] = [];
  try { list = JSON.parse(localStorage.getItem(MOONS()) ?? '[]'); } catch { list = []; }
  list.push(JSON.stringify(d));
  while (list.length > 3) list.shift();
  // storage is limited: drop the oldest snapshots until it fits
  // never let the snapshots crowd out the real save: keep room for at least one more full save
  while (list.length) {
    try {
      localStorage.setItem(MOONS(), JSON.stringify(list));
      const probe = 'mistwood-space-probe';
      localStorage.setItem(probe, JSON.stringify(d)); localStorage.removeItem(probe);
      return;
    } catch { list.shift(); try { localStorage.removeItem('mistwood-space-probe'); } catch { /* ignore */ } }
  }
  try { localStorage.removeItem(MOONS()); } catch { /* ignore */ }
}
export function moonSnapshots(): SaveData[] {
  try { return (JSON.parse(localStorage.getItem(MOONS()) ?? '[]') as string[]).map((x) => JSON.parse(x) as SaveData); } catch { return []; }
}
export function keepMoonSnapshots(n: number) {
  try {
    const list = JSON.parse(localStorage.getItem(MOONS()) ?? '[]') as string[];
    localStorage.setItem(MOONS(), JSON.stringify(list.slice(0, n)));
  } catch { /* ignore */ }
}

export function writeSave(g: Game): boolean {
  const json = JSON.stringify(buildSave(g));
  // your real save always comes first: if storage is full, make room by dropping the oldest "go back" moons
  for (let tries = 0; tries < 5; tries++) {
    try {
      localStorage.setItem(KEY_NOW(), json);
      return true;
    } catch (e) {
      let list: string[] = [];
      try { list = JSON.parse(localStorage.getItem(MOONS()) ?? '[]'); } catch { list = []; }
      if (!list.length) { console.warn('save failed', e); return false; }
      list.shift();
      try { if (list.length) localStorage.setItem(MOONS(), JSON.stringify(list)); else localStorage.removeItem(MOONS()); } catch { localStorage.removeItem(MOONS()); }
    }
  }
  return false;
}

function buildSave(g: Game): SaveData {
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
      herbStore: c.herbStore,
      usedNames: [...c.usedNames],
    },
    player: { x: p.pos.x, z: p.pos.z, yaw: p.yaw, prey: p.prey, herbs: p.herbs, moss: p.moss, thirdPerson: p.thirdPerson, lastLesson: g.training.lastLessonHour },
    mods: g.mods,
    events: g.events.serialize(),
    objectives: g.objectives.serialize(),
  };
  (data as SaveData).agesReset = true;
  return JSON.parse(JSON.stringify(data)) as SaveData;
}

export function deleteSave() {
  try { localStorage.removeItem(KEY_NOW()); } catch { /* ignore */ }
}
