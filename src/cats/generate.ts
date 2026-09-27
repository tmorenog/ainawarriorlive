// Procedural generation of cats: names, looks, personalities and inheritance.
import { RNG, simRng } from '../core/rng';
import { CLASSIC_PREFIXES, CLASSIC_SUFFIXES, isClassic } from '../lore';
import {
  Appearance, BodyType, Cat, ClanId, EarShape, FurLength, LESSONS, Lesson, Pattern, Personality, Sex, TailShape, Trait,
} from './types';

export const GIVEN_NAMES = [
  'Wren', 'Moss', 'Ember', 'Fern', 'Rowan', 'Sorrel', 'Thistle', 'Juniper', 'Pebble', 'Finch', 'Heather', 'Clover',
  'Aspen', 'Hazel', 'Cinder', 'Marigold', 'Nettle', 'Quill', 'Sage', 'Tansy', 'Umber', 'Vetch', 'Yarrow', 'Alder',
  'Basil', 'Cedar', 'Dune', 'Elm', 'Flint', 'Gorse', 'Iris', 'Kestrel', 'Larch', 'Maple', 'Pinecone', 'Reed',
  'Slate', 'Teasel', 'Willow', 'Lark', 'Robin', 'Sparrow', 'Otter', 'Minnow', 'Pike', 'Shale', 'Dusk', 'Drizzle',
  'Brook', 'Soot', 'Ripple', 'Tumble', 'Pip', 'Burr', 'Chestnut', 'Acorn', 'Barley', 'Fennel', 'Loam', 'Mallow',
  'Ochre', 'Poppy', 'Quartz', 'Bracken', 'Hollyhock', 'Lichen', 'Mica', 'Nutmeg', 'Oriole', 'Plover', 'Rush', 'Sedge',
  'Tinder', 'Vole', 'Wisp', 'Zephyr', 'Beech', 'Catkin', 'Dapple', 'Eddy', 'Frond', 'Gale', 'Hare', 'Ivybud', 'Kindle',
  'Lumen', 'Merle', 'Nimbus', 'Opal', 'Petal', 'Rill', 'Sable', 'Thrush', 'Vale', 'Whin', 'Bramblewood', 'Cress', 'Dew',
];

const EPI_PRE = ['Swift', 'Quiet', 'Bright', 'Long', 'Stone', 'Brook', 'Sun', 'Moon', 'Fallow', 'Thorn', 'Night', 'Ember', 'River', 'Storm', 'Frost', 'Amber', 'Reed', 'Wind', 'Dawn', 'Hollow', 'Mist', 'Oak', 'Bramble', 'Silver', 'Cloud', 'Rain', 'Ash', 'Tall', 'Soft', 'Keen'];
const EPI_SUF = ['foot', 'whisker', 'heart', 'song', 'runner', 'tail', 'claw', 'pelt', 'leap', 'eye', 'stripe', 'shade', 'watcher', 'step', 'gaze', 'fur', 'ear', 'bloom', 'strider', 'breath', 'spark', 'wing', 'fang', 'dash'];

export function makeEpithet(rng: RNG, cat?: Cat): string {
  if (isClassic()) {
    let suf = rng.pick(CLASSIC_SUFFIXES);
    if (cat?.app.pattern === 'tabby' && rng.chance(0.3)) suf = 'stripe';
    if (cat && cat.pers.bravery > 0.7 && rng.chance(0.3)) suf = rng.pick(['heart', 'claw', 'storm', 'fang']);
    if (cat && cat.pers.kindness > 0.7 && rng.chance(0.3)) suf = rng.pick(['heart', 'flower', 'song', 'leaf']);
    if (cat && CLASSIC_PREFIXES.includes(cat.given) && cat.given.toLowerCase() === suf) suf = 'heart';
    return suf;
  }
  let pre = rng.pick(EPI_PRE);
  let suf = rng.pick(EPI_SUF);
  if (cat) {
    // lean the epithet toward the cat's strengths
    if (cat.skills.hunting > 60 && rng.chance(0.4)) suf = rng.pick(['leap', 'claw', 'strider', 'dash']);
    if (cat.pers.kindness > 0.7 && rng.chance(0.4)) suf = rng.pick(['heart', 'song', 'bloom']);
    if (cat.pers.bravery > 0.7 && rng.chance(0.4)) pre = rng.pick(['Storm', 'Thorn', 'Ember', 'Keen']);
    if (cat.app.pattern === 'tabby' || cat.app.pattern === 'mackerel') if (rng.chance(0.3)) suf = 'stripe';
  }
  return pre + suf;
}

export function epithetOptions(cat: Cat, n = 3): string[] {
  const rng = new RNG((Math.random() * 1e9) | 0);
  const set = new Set<string>();
  while (set.size < n) set.add(makeEpithet(rng, cat));
  return [...set];
}

export const FUR_COLORS: { name: string; hex: string }[] = [
  { name: 'Ginger', hex: '#d9823b' },
  { name: 'Cream', hex: '#e6cfa2' },
  { name: 'Black', hex: '#2b2725' },
  { name: 'Grey', hex: '#7c7f86' },
  { name: 'Blue-grey', hex: '#8f9aab' },
  { name: 'Brown', hex: '#7a5436' },
  { name: 'Chocolate', hex: '#553827' },
  { name: 'Silver', hex: '#c3c7cd' },
  { name: 'White', hex: '#f1eee7' },
  { name: 'Fawn', hex: '#c9a583' },
  { name: 'Cinnamon', hex: '#9b5c36' },
  { name: 'Golden', hex: '#d4a24a' },
  { name: 'Pale ginger', hex: '#e8a86a' },
  { name: 'Dark ginger', hex: '#b35a22' },
  { name: 'Sandy', hex: '#d8b98a' },
  { name: 'Tawny', hex: '#b07a45' },
  { name: 'Dark grey', hex: '#55585e' },
  { name: 'Smoky', hex: '#9a9da3' },
  { name: 'Lilac', hex: '#b7a9b0' },
  { name: 'Dark brown', hex: '#4a3222' },
  { name: 'Russet', hex: '#8e3f22' },
  { name: 'Pale grey', hex: '#b4b8bf' },
];
export const EYE_COLORS: { name: string; hex: string }[] = [
  { name: 'Amber', hex: '#e2a02c' },
  { name: 'Green', hex: '#78c24c' },
  { name: 'Yellow', hex: '#e9d23c' },
  { name: 'Blue', hex: '#5aa2e6' },
  { name: 'Copper', hex: '#cc6e2c' },
  { name: 'Hazel', hex: '#a39342' },
  { name: 'Ice blue', hex: '#a9d6f2' },
  { name: 'Deep blue', hex: '#2f5fb8' },
  { name: 'Emerald', hex: '#2fa35a' },
  { name: 'Gold', hex: '#f0b63c' },
  { name: 'Orange', hex: '#e8792a' },
  { name: 'Pale green', hex: '#b6d98a' },
];

/** Breed presets for the character creator (they only change looks). */
export const BREEDS: { name: string; app: Partial<Appearance> }[] = [
  { name: 'Forest cat (mixed)', app: {} },
  { name: 'Maine Coon', app: { body: 'large', fur: 'long', ears: 'tufted', tail: 'bushy', size: 1.08, pattern: 'tabby', base: '#7a5436' } },
  { name: 'Norwegian Forest', app: { body: 'large', fur: 'long', ears: 'tufted', tail: 'bushy', size: 1.05 } },
  { name: 'Siamese', app: { body: 'slender', fur: 'short', ears: 'pointed', tail: 'long', pattern: 'colorpoint', base: '#e6cfa2', eye: '#5aa2e6' } },
  { name: 'Ragdoll', app: { body: 'large', fur: 'long', ears: 'rounded', tail: 'bushy', pattern: 'colorpoint', base: '#f1eee7', eye: '#2f5fb8' } },
  { name: 'Persian', app: { body: 'stocky', fur: 'long', ears: 'rounded', tail: 'bushy', size: 0.98 } },
  { name: 'British Shorthair', app: { body: 'stocky', fur: 'short', ears: 'rounded', tail: 'long', pattern: 'solid', base: '#8f9aab', eye: '#cc6e2c' } },
  { name: 'Russian Blue', app: { body: 'slender', fur: 'short', ears: 'pointed', pattern: 'solid', base: '#8f9aab', eye: '#2fa35a' } },
  { name: 'Scottish Fold', app: { body: 'stocky', ears: 'folded', fur: 'short', eye: '#e2a02c' } },
  { name: 'Bengal', app: { body: 'average', fur: 'short', pattern: 'spotted', base: '#d4a24a', eye: '#78c24c' } },
  { name: 'Egyptian Mau', app: { body: 'slender', fur: 'short', pattern: 'spotted', base: '#c3c7cd', eye: '#b6d98a' } },
  { name: 'Abyssinian', app: { body: 'slender', fur: 'short', pattern: 'ticked', base: '#b07a45', eye: '#a39342' } },
  { name: 'Bombay', app: { body: 'average', fur: 'short', pattern: 'solid', base: '#2b2725', eye: '#cc6e2c', white: 0 } },
  { name: 'Turkish Van', app: { body: 'average', fur: 'medium', pattern: 'bicolor', base: '#d9823b', white: 0.75 } },
  { name: 'Manx', app: { body: 'stocky', tail: 'short', ears: 'rounded' } },
  { name: 'Japanese Bobtail', app: { body: 'slender', tail: 'kinked', pattern: 'calico', base: '#d9823b', white: 0.5 } },
];
export const PATTERNS: Pattern[] = ['solid', 'tabby', 'mackerel', 'spotted', 'ticked', 'smoke', 'bicolor', 'tuxedo', 'tortie', 'calico', 'colorpoint'];
export const PATTERN_LABEL: Record<Pattern, string> = {
  solid: 'Solid', tabby: 'Tabby', mackerel: 'Mackerel tabby', spotted: 'Spotted', ticked: 'Ticked', smoke: 'Smoke',
  bicolor: 'Bicolour (white)', tuxedo: 'Tuxedo', tortie: 'Tortoiseshell', calico: 'Calico', colorpoint: 'Colour-point',
};
const BODIES: BodyType[] = ['slender', 'average', 'stocky', 'large'];
const EARS: EarShape[] = ['pointed', 'rounded', 'tufted', 'folded'];
const TAILS: TailShape[] = ['long', 'short', 'bushy', 'kinked'];
const FURS: FurLength[] = ['short', 'medium', 'long'];

export function darken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  const c = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function secondFor(base: string, pattern: Pattern, rng: RNG): string {
  if (pattern === 'tortie' || pattern === 'calico') return base === '#2b2725' ? '#d9823b' : '#2b2725';
  if (pattern === 'colorpoint') return rng.pick(['#4a3528', '#6a6e7c', '#8a5a3a']);
  if (pattern === 'smoke') return darken(base, 0.55);
  return darken(base, rng.range(0.45, 0.62));
}

export function randomAppearance(rng: RNG): Appearance {
  const pattern = rng.weighted<Pattern>([
    ['solid', 3], ['tabby', 4], ['mackerel', 2], ['spotted', 1.5], ['ticked', 1], ['smoke', 1],
    ['bicolor', 3], ['tuxedo', 1.5], ['tortie', 1.5], ['calico', 1.5], ['colorpoint', 1],
  ]);
  let base = rng.pick(FUR_COLORS).hex;
  if (pattern === 'colorpoint') base = rng.pick(['#e6cfa2', '#f1eee7', '#c9a583']);
  if (pattern === 'tuxedo') base = rng.pick(['#2b2725', '#7c7f86', '#553827']);
  return {
    base,
    second: secondFor(base, pattern, rng),
    white: pattern === 'bicolor' ? rng.range(0.3, 0.75) : pattern === 'calico' ? rng.range(0.35, 0.6) : pattern === 'tuxedo' ? 0.3 : rng.chance(0.25) ? rng.range(0.05, 0.25) : 0,
    pattern,
    eye: pattern === 'colorpoint' ? '#5aa2e6' : rng.pick(EYE_COLORS).hex,
    fur: rng.weighted<FurLength>([['short', 5], ['medium', 3], ['long', 2]]),
    body: rng.weighted<BodyType>([['slender', 2], ['average', 5], ['stocky', 2], ['large', 1.2]]),
    ears: rng.weighted<EarShape>([['pointed', 5], ['rounded', 2], ['tufted', 2], ['folded', 0.6]]),
    tail: rng.weighted<TailShape>([['long', 5], ['short', 1], ['bushy', 2.5], ['kinked', 0.7]]),
    size: rng.range(0.92, 1.08),
  };
}

export function inheritAppearance(a: Appearance, b: Appearance, rng: RNG): Appearance {
  const from = <K extends keyof Appearance>(k: K): Appearance[K] => (rng.chance(0.5) ? a[k] : b[k]);
  const mutate = rng.chance(0.15);
  const r = randomAppearance(rng);
  const pattern = mutate ? r.pattern : from('pattern');
  const base = rng.chance(0.1) ? r.base : from('base');
  return {
    base,
    second: secondFor(base, pattern, rng),
    white: pattern === 'bicolor' || pattern === 'calico' ? Math.max(0.3, (a.white + b.white) / 2 + rng.range(-0.15, 0.15)) : rng.chance(0.3) ? (a.white + b.white) / 2 : 0,
    pattern,
    eye: rng.chance(0.1) ? r.eye : from('eye'),
    fur: rng.chance(0.1) ? r.fur : from('fur'),
    body: from('body'),
    ears: rng.chance(0.1) ? r.ears : from('ears'),
    tail: rng.chance(0.1) ? r.tail : from('tail'),
    size: Math.min(1.12, Math.max(0.88, (a.size + b.size) / 2 + rng.range(-0.04, 0.04))),
  };
}

const TRAITS: Trait[] = ['friendly', 'shy', 'brave', 'curious', 'serious', 'playful', 'suspicious', 'aggressive', 'loyal', 'ambitious', 'kind', 'mischievous', 'calm', 'lazy'];
const CONFLICTS: [Trait, Trait][] = [
  ['friendly', 'suspicious'], ['shy', 'brave'], ['serious', 'playful'], ['aggressive', 'kind'], ['calm', 'aggressive'], ['lazy', 'ambitious'], ['shy', 'friendly'],
];

export function randomTraits(rng: RNG, inherit?: Trait[]): Trait[] {
  const out: Trait[] = [];
  let guard = 0;
  while (out.length < 2 && guard++ < 50) {
    const t = inherit && inherit.length && rng.chance(0.35) ? rng.pick(inherit) : rng.pick(TRAITS);
    if (out.includes(t)) continue;
    if (out.some((o) => CONFLICTS.some(([a, b]) => (a === o && b === t) || (b === o && a === t)))) continue;
    out.push(t);
  }
  return out;
}

export function personalityFrom(traits: Trait[], rng: RNG): Personality {
  const p: Personality = {
    sociability: rng.range(0.3, 0.6), bravery: rng.range(0.3, 0.6), aggression: rng.range(0.15, 0.45), ambition: rng.range(0.2, 0.5),
    kindness: rng.range(0.35, 0.65), loyalty: rng.range(0.45, 0.7), mischief: rng.range(0.1, 0.4), curiosity: rng.range(0.3, 0.6),
  };
  const bump = (k: keyof Personality, v: number) => (p[k] = Math.max(0, Math.min(1, p[k] + v)));
  for (const t of traits) {
    switch (t) {
      case 'friendly': bump('sociability', 0.35); bump('kindness', 0.15); break;
      case 'shy': bump('sociability', -0.3); bump('bravery', -0.2); break;
      case 'brave': bump('bravery', 0.4); break;
      case 'curious': bump('curiosity', 0.4); break;
      case 'serious': bump('mischief', -0.25); bump('loyalty', 0.1); break;
      case 'playful': bump('mischief', 0.25); bump('sociability', 0.15); break;
      case 'suspicious': bump('sociability', -0.15); bump('kindness', -0.15); break;
      case 'aggressive': bump('aggression', 0.45); bump('kindness', -0.2); break;
      case 'loyal': bump('loyalty', 0.4); break;
      case 'ambitious': bump('ambition', 0.45); break;
      case 'kind': bump('kindness', 0.4); bump('aggression', -0.15); break;
      case 'mischievous': bump('mischief', 0.45); break;
      case 'calm': bump('aggression', -0.2); bump('bravery', 0.1); break;
      case 'lazy': bump('ambition', -0.25); break;
    }
  }
  return p;
}

let idCounter = 0;
export function newId(): string {
  idCounter++;
  return `c${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(simRng.next() * 1296).toString(36)}`;
}

export function stageForAge(age: number): Cat['stage'] {
  if (age < 6) return 'kit';
  if (age < 13) return 'apprentice';
  if (age < 80) return 'warrior';
  return 'elder';
}

export interface CreateOpts {
  age?: number;
  sex?: Sex;
  clan?: ClanId;
  given?: string;
  app?: Appearance;
  parents?: Cat[];
  day?: number;
  usedNames?: Set<string>;
  rng?: RNG;
}

export function createCat(opts: CreateOpts = {}): Cat {
  const rng = opts.rng ?? simRng;
  const age = opts.age ?? rng.range(14, 60);
  const sex: Sex = opts.sex ?? (rng.chance(0.5) ? 'tom' : 'she');
  const pool = isClassic() ? CLASSIC_PREFIXES : GIVEN_NAMES;
  let given = opts.given ?? rng.pick(pool);
  if (!opts.given && opts.usedNames) {
    let guard = 0;
    while (opts.usedNames.has(given) && guard++ < 60) given = rng.pick(pool);
    opts.usedNames.add(given);
  }
  const parents = opts.parents ?? [];
  const app = opts.app ?? (parents.length === 2 ? inheritAppearance(parents[0].app, parents[1].app, rng) : randomAppearance(rng));
  const traits = randomTraits(rng, parents.flatMap((p) => p.traits));
  const pers = personalityFrom(traits, rng);
  const stage = stageForAge(age);
  const maturity = Math.min(1, age / 30);
  const bodyStr = { slender: -8, average: 0, stocky: 8, large: 14 }[app.body];
  const skill = (base: number) => Math.round(Math.min(95, Math.max(2, base * maturity + rng.range(-10, 10))));
  const training = {} as Record<Lesson, number>;
  for (const l of LESSONS) training[l] = stage === 'kit' ? 0 : stage === 'apprentice' ? Math.floor(rng.range(0, 2)) : 3;
  const cat: Cat = {
    id: newId(),
    given,
    epithet: stage === 'warrior' || stage === 'elder' ? makeEpithet(rng) : null,
    sex,
    age,
    stage,
    role: 'none',
    clan: opts.clan ?? 'home',
    app,
    traits,
    pers,
    skills: {
      hunting: skill(rng.range(35, 75)),
      fighting: skill(rng.range(30, 75) + pers.aggression * 10),
      tracking: skill(rng.range(30, 70)),
      knowledge: skill(rng.range(25, 70)),
      healing: skill(rng.range(5, 30)),
    },
    strength: Math.round(Math.min(95, Math.max(10, 50 * Math.min(1, age / 14) + bodyStr + rng.range(-10, 10)))),
    health: 100,
    maxHealth: 100,
    hunger: rng.range(60, 90),
    injury: 0,
    sick: 0,
    alive: true,
    parents: parents.map((p) => p.id),
    mate: null,
    kits: [],
    mentor: null,
    apprentice: null,
    training,
    reputation: Math.round(rng.range(5, 30) * maturity),
    relations: {},
    memories: [],
    bornDay: (opts.day ?? 0) - Math.floor(age),
    joinedDay: opts.day ?? 0,
    exiled: false,
    expectingUntil: null,
    isPlayer: false,
    infractions: 0,
    confinedUntil: null,
    deeds: 0,
    mentored: 0,
  };
  return cat;
}
