// Lore mode: "classic" uses the four forest clans and book-style naming
// (fan tribute to the Warriors novels); "original" uses Mistwood's own lore.
import type { Appearance, Cat, Sex, Trait } from './cats/types';

export type LoreMode = 'classic' | 'original';
export const lore = { mode: 'classic' as LoreMode };
export const isClassic = () => lore.mode === 'classic';

export const CLASSIC_CLANS = ['ThunderClan', 'RiverClan', 'WindClan', 'ShadowClan'];
export const CLASSIC_COLORS: Record<string, string> = { ThunderClan: '#d9823b', RiverClan: '#4f8fb8', WindClan: '#c9b27a', ShadowClan: '#6e5a8a' };
export const CLASSIC_TEMPER: Record<string, 'proud' | 'cautious' | 'hostile' | 'friendly'> = {
  ThunderClan: 'friendly', RiverClan: 'proud', WindClan: 'cautious', ShadowClan: 'hostile',
};

/** Book-style name prefixes for generated cats. */
export const CLASSIC_PREFIXES = [
  'Fire', 'Gray', 'Sand', 'Dust', 'Cloud', 'Bramble', 'Squirrel', 'Leaf', 'Ash', 'Fern', 'Brook', 'Rain', 'Thorn', 'Mouse',
  'Dark', 'Long', 'Swift', 'Frost', 'Speckle', 'Holly', 'Birch', 'Rowan', 'Tawny', 'Ivy', 'Hazel', 'Berry', 'Poppy', 'Honey',
  'Cinder', 'Spider', 'Mole', 'Briar', 'Lion', 'Jay', 'Dove', 'Bumble', 'Blossom', 'Rose', 'Snow', 'Stone', 'Storm', 'Sorrel',
  'Moss', 'Mist', 'Reed', 'Pebble', 'Minnow', 'Otter', 'Heather', 'Crow', 'Owl', 'Night', 'Russet', 'Oak', 'Pine', 'Robin',
  'Wren', 'Finch', 'Sparrow', 'Hawk', 'Ember', 'Flame', 'Amber', 'Ivy', 'Lichen', 'Nettle', 'Toad', 'Beetle', 'Pounce', 'Quail',
  'Rabbit', 'Shrew', 'Sedge', 'Silver', 'Smoke', 'Soot', 'Spotted', 'Sun', 'Tiny', 'Willow', 'Yarrow', 'Bright', 'Dapple', 'Echo',
];
export const CLASSIC_SUFFIXES = [
  'heart', 'pelt', 'tail', 'claw', 'whisker', 'stripe', 'fur', 'leaf', 'fang', 'foot', 'storm', 'wing', 'shade', 'cloud',
  'frost', 'step', 'flight', 'song', 'nose', 'ear', 'face', 'blaze', 'flower', 'breeze', 'splash', 'fern', 'light', 'stream',
  'poppy', 'thorn', 'shine', 'jaw', 'pool', 'dapple', 'belly', 'tuft', 'dawn', 'mist', 'eye',
];

/** Display name under the current lore mode. */
export function loreName(c: Cat): string {
  if (!isClassic()) {
    if (c.stage === 'kit') return `Little ${c.given}`;
    if (c.epithet) return `${c.given} ${c.epithet}`;
    return c.given;
  }
  if (c.clan === 'loner' && !c.epithet) return c.given;
  if (c.stage === 'kit') return `${c.given}kit`;
  if (c.stage === 'apprentice') return `${c.given}paw`;
  if (c.role === 'leader' && c.alive) return `${c.given}star`;
  return `${c.given}${(c.epithet ?? 'heart').toLowerCase()}`;
}

/** Text substitutions that turn Mistwood terms into the classic ones. */
const SUBS: [RegExp, string][] = [
  [/Clan Warden \(leader\)/g, 'Leader'],
  [/Second \(deputy\)/g, 'Deputy'],
  [/Healer's apprentice/g, 'Medicine cat apprentice'],
  [/healer apprentice/g, 'medicine cat apprentice'],
  [/Warden's council/g, "Leader's council"],
  [/\bthe Warden\b/g, 'the leader'],
  [/\bThe Warden\b/g, 'The leader'],
  [/\bWarden\b/g, 'Leader'],
  [/\bthe Second\b/g, 'the deputy'],
  [/\bThe Second\b/g, 'The deputy'],
  [/\bSecond\b/g, 'Deputy'],
  [/walks? the Long Meadow/g, 'walks with StarClan'],
  [/Walks the Long Meadow/g, 'Walks with StarClan'],
  [/\bthe Long Meadow\b/g, 'StarClan'],
  [/\bThe Long Meadow\b/g, 'StarClan'],
  [/\bLong Meadow\b/g, 'StarClan'],
  [/Tallfolk/g, 'Twoleg'],
  [/\bthe Council Stones\b/g, 'Fourtrees'],
  [/\bCouncil Stones\b/g, 'Fourtrees'],
  [/the Stargazing Stone/g, 'the Moonstone'],
  [/High Rock/g, 'Highrock'],
  [/\bHealer\b/g, 'Medicine cat'],
  [/\bhealer's\b/g, "medicine cat's"],
  [/\bhealer\b/g, 'medicine cat'],
  [/\bhealers\b/g, 'medicine cats'],
  [/Budding season/g, 'Newleaf'],
  [/High-sun season/g, 'Greenleaf'],
  [/Leaf-drop season/g, 'Leaf-fall'],
  [/Frost season/g, 'Leaf-bare'],
  [/(\w+Clan) Clan\b/g, '$1'],
];

export function loreText(s: string): string {
  if (!isClassic()) return s;
  for (const [re, rep] of SUBS) s = s.replace(re, rep);
  return s;
}

// ------------------------------------------------------------------ book cats
export interface BookCat {
  prefix: string;
  suffix: string;
  sex: Sex;
  age: number;
  role?: 'leader' | 'deputy' | 'medicine';
  stage?: 'apprentice' | 'elder';
  traits: Trait[];
  app: Partial<Appearance>;
}

const tabby = (base: string, second: string): Partial<Appearance> => ({ base, second, pattern: 'tabby' });

export const BOOK_CATS: Record<string, BookCat[]> = {
  ThunderClan: [
    { prefix: 'Blue', suffix: 'fur', sex: 'she', age: 78, role: 'leader', traits: ['calm', 'loyal'], app: { base: '#8f9aab', second: '#6a7384', pattern: 'solid', eye: '#5aa2e6', fur: 'medium', body: 'average' } },
    { prefix: 'Tiger', suffix: 'claw', sex: 'tom', age: 44, role: 'deputy', traits: ['ambitious', 'aggressive'], app: { ...tabby('#553827', '#1f1612'), eye: '#e2a02c', fur: 'short', body: 'large', size: 1.08 } },
    { prefix: 'Spotted', suffix: 'leaf', sex: 'she', age: 30, role: 'medicine', traits: ['kind', 'calm'], app: { base: '#9b5c36', second: '#2b2725', pattern: 'tortie', eye: '#e2a02c', fur: 'medium', body: 'slender' } },
    { prefix: 'White', suffix: 'storm', sex: 'tom', age: 56, traits: ['loyal', 'calm'], app: { base: '#f1eee7', second: '#d8d4cc', pattern: 'solid', eye: '#e9d23c', fur: 'medium', body: 'large' } },
    { prefix: 'Lion', suffix: 'heart', sex: 'tom', age: 52, traits: ['brave', 'kind'], app: { ...tabby('#d4a24a', '#9a6a28'), eye: '#e2a02c', fur: 'long', body: 'large' } },
    { prefix: 'Gray', suffix: 'stripe', sex: 'tom', age: 14, traits: ['friendly', 'playful'], app: { base: '#7c7f86', second: '#3e4046', pattern: 'smoke', eye: '#e9d23c', fur: 'long', body: 'stocky' } },
    { prefix: 'Sand', suffix: 'storm', sex: 'she', age: 14, traits: ['brave', 'serious'], app: { base: '#e6cfa2', second: '#c9a583', pattern: 'solid', eye: '#78c24c', fur: 'short', body: 'slender' } },
    { prefix: 'Dust', suffix: 'pelt', sex: 'tom', age: 15, traits: ['ambitious', 'serious'], app: { ...tabby('#7a5436', '#4a3020'), eye: '#e2a02c', fur: 'short', body: 'average' } },
    { prefix: 'Long', suffix: 'tail', sex: 'tom', age: 24, traits: ['suspicious', 'loyal'], app: { ...tabby('#d8d0c0', '#2b2725'), eye: '#e9d23c', fur: 'short', body: 'slender', tail: 'long' } },
    { prefix: 'Dark', suffix: 'stripe', sex: 'tom', age: 30, traits: ['aggressive', 'ambitious'], app: { ...tabby('#6a6e74', '#26282c'), eye: '#e9d23c', fur: 'medium', body: 'average' } },
    { prefix: 'Mouse', suffix: 'fur', sex: 'she', age: 28, traits: ['serious', 'brave'], app: { base: '#7a5a42', second: '#4a3526', pattern: 'solid', eye: '#e2a02c', fur: 'short', body: 'slender' } },
    { prefix: 'Raven', suffix: 'paw', sex: 'tom', age: 8, stage: 'apprentice', traits: ['shy', 'kind'], app: { base: '#2b2725', second: '#141212', pattern: 'tuxedo', white: 0.2, eye: '#e2a02c', fur: 'short', body: 'slender' } },
    { prefix: 'Yellow', suffix: 'fang', sex: 'she', age: 92, stage: 'elder', traits: ['suspicious', 'brave'], app: { base: '#4a4a4c', second: '#2e2e30', pattern: 'smoke', eye: '#cc6e2c', fur: 'long', body: 'stocky', ears: 'rounded' } },
    { prefix: 'Half', suffix: 'tail', sex: 'tom', age: 96, stage: 'elder', traits: ['calm', 'friendly'], app: { ...tabby('#7a5436', '#3e2a1c'), eye: '#e2a02c', tail: 'short' } },
  ],
  RiverClan: [
    { prefix: 'Crooked', suffix: 'jaw', sex: 'tom', age: 80, role: 'leader', traits: ['loyal', 'calm'], app: { ...tabby('#d4a24a', '#8a6030'), eye: '#e2a02c', fur: 'long', body: 'large' } },
    { prefix: 'Leopard', suffix: 'fur', sex: 'she', age: 40, role: 'deputy', traits: ['ambitious', 'brave'], app: { base: '#d4a24a', second: '#2b2725', pattern: 'spotted', eye: '#78c24c', fur: 'short', body: 'large' } },
    { prefix: 'Mud', suffix: 'fur', sex: 'tom', age: 60, role: 'medicine', traits: ['calm', 'kind'], app: { base: '#7a5a42', second: '#4a3526', pattern: 'solid', eye: '#e2a02c', fur: 'long' } },
    { prefix: 'Oak', suffix: 'heart', sex: 'tom', age: 30, traits: ['brave', 'friendly'], app: { base: '#9b5c36', second: '#6a3a20', pattern: 'solid', eye: '#e2a02c', fur: 'medium', body: 'large' } },
    { prefix: 'Silver', suffix: 'stream', sex: 'she', age: 14, traits: ['playful', 'curious'], app: { ...tabby('#c3c7cd', '#5a5e66'), eye: '#5aa2e6', fur: 'medium', body: 'slender' } },
    { prefix: 'Misty', suffix: 'foot', sex: 'she', age: 18, traits: ['loyal', 'kind'], app: { base: '#8f9aab', second: '#6a7384', pattern: 'solid', eye: '#5aa2e6', fur: 'medium' } },
    { prefix: 'Stone', suffix: 'fur', sex: 'tom', age: 18, traits: ['brave', 'serious'], app: { base: '#7c7f86', second: '#55585e', pattern: 'solid', eye: '#5aa2e6', fur: 'short', body: 'large' } },
    { prefix: 'Black', suffix: 'claw', sex: 'tom', age: 32, traits: ['aggressive', 'suspicious'], app: { base: '#2b2725', second: '#141212', pattern: 'smoke', eye: '#e2a02c' } },
  ],
  WindClan: [
    { prefix: 'Tall', suffix: 'tail', sex: 'tom', age: 76, role: 'leader', traits: ['calm', 'kind'], app: { base: '#2b2725', second: '#f1eee7', pattern: 'bicolor', white: 0.45, eye: '#e2a02c', fur: 'short', body: 'slender', tail: 'long' } },
    { prefix: 'Dead', suffix: 'foot', sex: 'tom', age: 50, role: 'deputy', traits: ['loyal', 'serious'], app: { base: '#2b2725', second: '#141212', pattern: 'solid', eye: '#e2a02c', fur: 'short', body: 'slender' } },
    { prefix: 'Bark', suffix: 'face', sex: 'tom', age: 55, role: 'medicine', traits: ['kind', 'calm'], app: { base: '#7a5436', second: '#4a3020', pattern: 'solid', eye: '#e2a02c', fur: 'short' } },
    { prefix: 'One', suffix: 'whisker', sex: 'tom', age: 24, traits: ['friendly', 'loyal'], app: { ...tabby('#9a8266', '#5a4632'), eye: '#e9d23c', fur: 'short', body: 'slender' } },
    { prefix: 'Mud', suffix: 'claw', sex: 'tom', age: 30, traits: ['ambitious', 'aggressive'], app: { base: '#5a4636', second: '#3a2a20', pattern: 'ticked', eye: '#e2a02c', fur: 'short' } },
    { prefix: 'Ash', suffix: 'foot', sex: 'she', age: 26, traits: ['brave', 'loyal'], app: { base: '#7c7f86', second: '#55585e', pattern: 'solid', eye: '#5aa2e6', fur: 'short', body: 'slender' } },
    { prefix: 'Morning', suffix: 'flower', sex: 'she', age: 40, traits: ['kind', 'calm'], app: { ...tabby('#c9a583', '#8a6a48'), eye: '#e2a02c' } },
    { prefix: 'Web', suffix: 'foot', sex: 'tom', age: 45, traits: ['serious', 'loyal'], app: { ...tabby('#55585e', '#2e3034'), eye: '#e2a02c' } },
  ],
  ShadowClan: [
    { prefix: 'Broken', suffix: 'tail', sex: 'tom', age: 60, role: 'leader', traits: ['aggressive', 'ambitious'], app: { ...tabby('#553827', '#1f1612'), eye: '#e2a02c', fur: 'long', body: 'large', tail: 'kinked' } },
    { prefix: 'Black', suffix: 'foot', sex: 'tom', age: 40, role: 'deputy', traits: ['aggressive', 'loyal'], app: { base: '#f1eee7', second: '#2b2725', pattern: 'bicolor', white: 0.7, eye: '#e2a02c', fur: 'short', body: 'large' } },
    { prefix: 'Running', suffix: 'nose', sex: 'tom', age: 58, role: 'medicine', traits: ['kind', 'shy'], app: { base: '#7c7f86', second: '#f1eee7', pattern: 'bicolor', white: 0.4, eye: '#e9d23c' } },
    { prefix: 'Russet', suffix: 'fur', sex: 'she', age: 34, traits: ['brave', 'suspicious'], app: { base: '#9b5c36', second: '#6a3a20', pattern: 'solid', eye: '#78c24c', fur: 'short' } },
    { prefix: 'Clay', suffix: 'face', sex: 'tom', age: 36, traits: ['aggressive', 'mischievous'], app: { base: '#7a5436', second: '#4a3020', pattern: 'solid', eye: '#e2a02c', body: 'stocky' } },
    { prefix: 'Night', suffix: 'pelt', sex: 'tom', age: 70, traits: ['serious', 'calm'], app: { base: '#2b2725', second: '#141212', pattern: 'solid', eye: '#e2a02c' } },
    { prefix: 'Little', suffix: 'cloud', sex: 'tom', age: 10, stage: 'apprentice', traits: ['curious', 'kind'], app: { ...tabby('#c9a583', '#8a6a48'), eye: '#5aa2e6', body: 'slender', size: 0.92 } },
    { prefix: 'Tangle', suffix: 'burr', sex: 'she', age: 50, traits: ['suspicious', 'serious'], app: { ...tabby('#553827', '#2b2725'), eye: '#e2a02c', fur: 'long' } },
  ],
};

export function clanTitle(name: string): string {
  return /Clan$/.test(name) ? name : `${name} Clan`;
}
