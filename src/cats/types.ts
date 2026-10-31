import { loreName, lifestyleLabel } from '../lore';

// Core data model for every cat in the simulation (player included).

export type LifeStage = 'kit' | 'apprentice' | 'warrior' | 'elder';
export type Role = 'none' | 'leader' | 'deputy' | 'medicine' | 'medicineApprentice';
export type Sex = 'tom' | 'she';
export type Pattern = 'solid' | 'tabby' | 'mackerel' | 'spotted' | 'ticked' | 'smoke' | 'bicolor' | 'tuxedo' | 'tortie' | 'calico' | 'colorpoint'
  | 'classic' | 'marbled' | 'rosette' | 'van' | 'harlequin' | 'torbie' | 'lynxpoint';
export type FurLength = 'short' | 'medium' | 'long';
export type BodyType = 'slender' | 'average' | 'stocky' | 'large';
export type EarShape = 'pointed' | 'rounded' | 'tufted' | 'folded';
export type TailShape = 'long' | 'short' | 'bushy' | 'kinked';
export type Trait =
  | 'friendly' | 'shy' | 'brave' | 'curious' | 'serious' | 'playful'
  | 'suspicious' | 'aggressive' | 'loyal' | 'ambitious' | 'kind' | 'mischievous' | 'calm' | 'lazy' | 'clumsy';
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
  /** Paw colour override (e.g. Blackfoot's black paws). */
  paws?: string;
  /** White (or any colour) markings: tail tip and belly. */
  tailTip?: string;
  belly?: string;
  /** Face and body markings. */
  blaze?: boolean;
  eyePatch?: boolean;
  locket?: boolean;
  noseColor?: string;
}

export type Accessory = 'none' | 'collar' | 'bellCollar' | 'flowerCrown' | 'feather' | 'leafScarf' | 'shellNecklace' | 'berryCharm' | 'bow' | 'flowerEar' | 'clawNecklace'
  | 'witchHat' | 'pumpkinCollar' | 'batWings' | 'spiderNecklace' | 'candyCharm';
/** Halloween accessories cost clan coins (🪙). */
export const ACCESSORY_PRICE: Partial<Record<Accessory, number>> = { witchHat: 30, pumpkinCollar: 20, batWings: 40, spiderNecklace: 25, candyCharm: 15 };

export const ACCESSORY_LABEL: Record<Accessory, string> = {
  none: 'None', collar: 'Collar', bellCollar: 'Bell collar', flowerCrown: 'Flower crown', feather: 'Feather behind ear',
  leafScarf: 'Leaf scarf', shellNecklace: 'Shell necklace', berryCharm: 'Berry charm',
  bow: 'Bow', flowerEar: 'Flower behind ear', clawNecklace: 'Claw necklace',
  witchHat: '🎃 Witch hat', pumpkinCollar: '🎃 Pumpkin collar', batWings: '🦇 Bat wings', spiderNecklace: '🕷 Spider necklace', candyCharm: '🍬 Candy-corn charm',
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

/** How a cat lives: in a clan, or as a kittypet, loner or rogue. */
export type Lifestyle = 'clan' | 'kittypet' | 'loner' | 'rogue';

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
  /** Clan meetings missed (every third is a broken rule). */
  meetingStrikes?: number;
  /** 100 = not thirsty, 0 = parched (player only). */
  thirst?: number;
  /** A forbidden mate from another clan. */
  secretMate?: string;
  /** A kit (or young cat) with a crush on another young cat. */
  crush?: string;
  /** This cat already asked you to be mates because of an old crush. */
  crushAsked?: boolean;
  /** A kit allowed outside camp until this game hour (and who said yes). */
  outsideUntil?: number;
  outsideBy?: string;
  /** Day her last litter was born (for the rest between litters). */
  lastLitterDay?: number;
  /** How many kits are coming (decided when labour starts). */
  litterSize?: number;
  /** In labour right now. */
  labour?: boolean;
  /** Day this she-cat moves into the nursery after becoming a mate. */
  nurseryDay?: number;
  /** Real seconds played with this cat (for story moments). */
  playSeconds?: number;
  storyAt?: number;
  storyTiger?: boolean;
  /** How much each kind of wild animal trusts you (50+ = friends). */
  animalFriends?: Record<string, number>;
  /** Herb poultices chewed and ready to press onto a wound. */
  poultices?: Record<string, number>;
  /** Flowers carried to smell or give away. */
  flowers?: string[];
  /** Kittypet, loner or rogue instead of a clan cat (one-word names). */
  lifestyle?: Lifestyle;
  /** Locked in the Twoleg pound (animal control). */
  caged?: boolean;
  cagedDay?: number;
  /** Last game hour a kittypet was at home. */
  homeSeen?: number;
  /** Clan coins earned by helping the clan (spent on special accessories). */
  coins?: number;
  /** Special accessories bought with clan coins. */
  unlocked?: string[];
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
  if (c.lifestyle && c.lifestyle !== 'clan') return lifestyleLabel(c.lifestyle);
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

/** How round a cat's belly looks: she-cats with a mate are a little rounder, expecting queens more so. */
export function bellyFor(c: Cat): number {
  if (c.sex !== 'she' || c.stage === 'kit' || c.stage === 'apprentice') return 0;
  if (c.expectingUntil !== null || c.labour) return Math.round((0.6 + 0.6 * expectingProgress(c)) * 50) / 50;
  return c.mate ? 0.5 : 0;
}

/** Expecting queens move slower and fight weaker. */
export function isExpecting(c: Cat): boolean { return c.sex === 'she' && (c.expectingUntil !== null || !!c.labour); }

/** The game clock in days (set every frame by the game) so cats can tell how far along a queen is. */
let clockDays = 0;
export function setClockDays(d: number) { clockDays = d; }

/** 0 = just started expecting, 1 = the kits are about to come. */
export function expectingProgress(c: Cat): number {
  if (c.labour) return 1;
  if (c.expectingUntil === null) return 0;
  return Math.min(1, Math.max(0, 1 - (c.expectingUntil - clockDays) / 2));
}

/** How strong an expecting queen still is: a little weaker at first, much weaker near the birth. */
export function queenPowerK(c: Cat): number { return isExpecting(c) ? 0.7 - 0.2 * expectingProgress(c) : 1; }
/** How fast an expecting queen still moves. */
export function queenSpeedK(c: Cat): number { return isExpecting(c) ? 0.7 - 0.4 * expectingProgress(c) : 1; }

/** Tired, grumpy things an expecting queen says — more complaints the closer she gets. */
export function queenComplaint(c: Cat, pick: <T>(a: T[]) => T, mate?: Cat | null): string {
  const p = expectingProgress(c);
  const lines = [
    'Kits kicking again… I just want to be a clan cat again!',
    '*sighs* I\'m SO tired. I could sleep for a whole moon.',
    'I used to be the fastest cat in the clan. Now I waddle like a badger!',
    'My paws ache, my back aches… everything aches!',
    'I can\'t even reach my own tail to groom it anymore.',
    'Ugh, I\'m slow as a slug. I miss hunting so much.',
    'Kits kicking again! Stop that, little ones — let me rest!',
    'I just want to run through the forest again…',
    'Can someone bring me a mouse? I\'m too tired to walk to the fresh-kill pile.',
    'I\'m hungry ALL the time. And tired. And hungry.',
    'I hope I have my kits soon!',
  ];
  if (mate && mate.alive && mate.sex === 'tom') lines.push(`${displayName(mate)}, you will be a great father to our kits!`, `${displayName(mate)}, you will be a great father to our kits!`);
  if (p > 0.5) lines.push(
    'I feel as heavy as a boulder. These kits need to come out already!',
    'Kits kicking again… I just want to be a clan cat again!',
    'I can barely get up from my nest. Don\'t make me move!',
    '*groans* Any day now… StarClan, please make it soon.',
    'I hope I have my kits soon!',
  );
  if (p > 0.8 || c.labour) lines.push('Oh… I think the kits are coming!', 'Oh… I think the kits are coming!', '*gasps* Oh — I think the kits are coming!');
  return pick(lines);
}

/** A queen: a she-cat expecting, or nursing young kits she gave birth to herself (not her mate's). */
export function isQueen(c: Cat, get: (id: string) => Cat | undefined): boolean {
  if (c.sex !== 'she') return false;
  if (c.expectingUntil !== null || c.labour) return true;
  return c.kits.some((k) => { const kc = get(k); return !!kc && kc.alive && kc.age < 6 && (kc.parents?.[0] ?? c.id) === c.id; });
}
