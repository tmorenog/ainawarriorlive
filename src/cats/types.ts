import { loreName } from '../lore';

// Core data model for every cat in the simulation (player included).

export type LifeStage = 'kit' | 'apprentice' | 'warrior' | 'elder';
export type Role = 'none' | 'leader' | 'deputy' | 'medicine' | 'medicineApprentice';
export type Sex = 'tom' | 'she';
export type Pattern = 'solid' | 'tabby' | 'mackerel' | 'spotted' | 'ticked' | 'smoke' | 'bicolor' | 'tuxedo' | 'tortie' | 'calico' | 'colorpoint';
export type FurLength = 'short' | 'medium' | 'long';
export type BodyType = 'slender' | 'average' | 'stocky' | 'large';
export type EarShape = 'pointed' | 'rounded' | 'tufted' | 'folded';
export type TailShape = 'long' | 'short' | 'bushy' | 'kinked';
export type Trait =
  | 'friendly' | 'shy' | 'brave' | 'curious' | 'serious' | 'playful'
  | 'suspicious' | 'aggressive' | 'loyal' | 'ambitious' | 'kind' | 'mischievous' | 'calm' | 'lazy';
export type Lesson = 'hunting' | 'tracking' | 'fighting' | 'exploring' | 'territory' | 'rules';
export const LESSONS: Lesson[] = ['hunting', 'tracking', 'fighting', 'exploring', 'territory', 'rules'];
export const LESSON_LABEL: Record<Lesson, string> = {
  hunting: 'Hunting',
  tracking: 'Tracking',
  fighting: 'Fighting',
  exploring: 'Exploring',
  territory: 'Border patrol',
  rules: 'Clan code',
};

export interface Appearance {
  base: string;
  second: string;
  white: number;
  pattern: Pattern;
  eye: string;
  fur: FurLength;
  body: BodyType;
  ears: EarShape;
  tail: TailShape;
  size: number;
  /** Optional breed name chosen in the character creator. */
  breed?: string;
  /** Second eye colour (odd eyes). */
  eye2?: string;
  accessory?: Accessory;
  accessories?: Accessory[];
  accessoryColor?: string;
}

export type Accessory = 'none' | 'collar' | 'bellCollar' | 'flowerCrown' | 'feather' | 'leafScarf' | 'shellNecklace' | 'berryCharm' | 'bow' | 'flowerEar' | 'clawNecklace';
export const ACCESSORY_LABEL: Record<Accessory, string> = {
  none: 'None', collar: 'Collar', bellCollar: 'Bell collar', flowerCrown: 'Flower crown', feather: 'Feather behind ear',
  leafScarf: 'Leaf scarf', shellNecklace: 'Shell necklace', berryCharm: 'Berry charm',
  bow: 'Bow', flowerEar: 'Flower behind ear', clawNecklace: 'Claw necklace',
};

export interface Personality {
  sociability: number;
  bravery: number;
  aggression: number;
  ambition: number;
  kindness: number;
  loyalty: number;
  mischief: number;
  curiosity: number;
}

export interface Skills {
  hunting: number;
  fighting: number;
  tracking: number;
  knowledge: number;
  healing: number;
}

export interface Relation {
  opinion: number; // -100..100
  familiarity: number; // 0..100
  romance: number; // 0..100
}

export interface Memory {
  day: number;
  text: string;
  about?: string;
  weight: number; // positive = fond, negative = bitter
}

export type ClanId = 'home' | number | 'loner';

export interface Cat {
  id: string;
  given: string;
  epithet: string | null;
  sex: Sex;
  age: number; // in moons
  stage: LifeStage;
  role: Role;
  clan: ClanId;
  app: Appearance;
  traits: Trait[];
  pers: Personality;
  skills: Skills;
  strength: number; // 0..100
  health: number; // current 0..maxHealth
  maxHealth: number;
  hunger: number; // 0 starving .. 100 full
  injury: number; // 0..100 severity
  sick: number; // 0..100 severity
  alive: boolean;
  deathDay?: number;
  deathCause?: string;
  parents: string[];
  mate: string | null;
  kits: string[];
  mentor: string | null;
  apprentice: string | null;
  formerMentor?: string | null;
  training: Record<Lesson, number>;
  reputation: number; // -100..100 standing with the clan
  relations: Record<string, Relation>;
  memories: Memory[];
  bornDay: number;
  joinedDay: number;
  exiled: boolean;
  expectingUntil: number | null;
  isPlayer: boolean;
  infractions: number;
  /** Moons in a row without breaking the code. */
  goodDays?: number;
  /** Little treasures carried to give as gifts. */
  treasures?: string[];
  /** Day an elder last told a story. */
  lastStory?: number;
  /** Which character from the books this cat is (classic mode). */
  bookId?: string;
  /** The book cat has already given the player their quest. */
  questGiven?: boolean;
  confinedUntil: number | null;
  deeds: number; // notable good deeds (for leadership)
  mentored: number; // number of apprentices trained
  ceremonyDelay?: number; // extra moons before becoming an apprentice (kit punishment)
  kitOffenses?: number;
  medicinePath?: boolean; // promised to the medicine cat as a kit
}

export function displayName(c: Cat): string {
  return loreName(c);
}

export function roleLabel(c: Cat): string {
  if (!c.alive) return 'Walks the Long Meadow';
  if (c.exiled) return 'Exile';
  switch (c.role) {
    case 'leader': return 'Clan Warden (leader)';
    case 'deputy': return 'Second (deputy)';
    case 'medicine': return 'Healer';
    case 'medicineApprentice': return "Healer's apprentice";
  }
  switch (c.stage) {
    case 'kit': return 'Kit';
    case 'apprentice': return 'Apprentice';
    case 'warrior': return c.apprentice ? 'Warrior & mentor' : 'Warrior';
    case 'elder': return 'Elder';
  }
}

export function pronoun(c: Cat, kind: 'subj' | 'obj' | 'poss'): string {
  if (c.sex === 'tom') return kind === 'subj' ? 'he' : kind === 'obj' ? 'him' : 'his';
  return kind === 'subj' ? 'she' : kind === 'obj' ? 'her' : 'her';
}
