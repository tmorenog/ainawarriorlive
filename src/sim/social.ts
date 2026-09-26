// Relationships, compatibility and procedural dialogue lines.
import { Cat, Relation, Trait, displayName } from '../cats/types';
import { simRng } from '../core/rng';
import { clamp } from '../core/math';

export type RelLabel = 'Stranger' | 'Acquaintance' | 'Friend' | 'Close friend' | 'Rival' | 'Enemy' | 'Mate' | 'Family';

export function relLabel(r: Relation | undefined, family = false, mate = false): RelLabel {
  if (mate) return 'Mate';
  if (!r) return family ? 'Family' : 'Stranger';
  if (r.opinion <= -55) return 'Enemy';
  if (r.opinion <= -22) return 'Rival';
  if (family) return 'Family';
  if (r.familiarity < 12) return 'Stranger';
  if (r.opinion >= 62) return 'Close friend';
  if (r.opinion >= 28) return 'Friend';
  return 'Acquaintance';
}

export const REL_COLOR: Record<RelLabel, string> = {
  Stranger: '#b9b3a6', Acquaintance: '#d8cfb8', Friend: '#9fd67a', 'Close friend': '#5fd36b',
  Rival: '#e8a54a', Enemy: '#e25b4a', Mate: '#f08ab8', Family: '#8fc4ef',
};

const LIKES: [Trait, Trait, number][] = [
  ['playful', 'playful', 0.4], ['playful', 'mischievous', 0.3], ['kind', 'kind', 0.3], ['kind', 'shy', 0.25],
  ['loyal', 'loyal', 0.35], ['serious', 'serious', 0.25], ['brave', 'brave', 0.2], ['curious', 'curious', 0.25],
  ['friendly', 'friendly', 0.3], ['calm', 'calm', 0.2], ['friendly', 'shy', 0.15],
  ['aggressive', 'kind', -0.3], ['aggressive', 'aggressive', -0.2], ['ambitious', 'ambitious', -0.35],
  ['serious', 'mischievous', -0.3], ['suspicious', 'friendly', -0.15], ['lazy', 'ambitious', -0.25],
  ['serious', 'playful', -0.15], ['loyal', 'mischievous', -0.15], ['suspicious', 'curious', -0.1],
];

export function compatibility(a: Cat, b: Cat): number {
  let s = 0;
  for (const ta of a.traits) for (const tb of b.traits) {
    for (const [x, y, v] of LIKES) if ((x === ta && y === tb) || (x === tb && y === ta)) s += v;
  }
  return clamp(s, -1, 1);
}

export function isFamily(a: Cat, b: Cat): boolean {
  if (a.parents.includes(b.id) || b.parents.includes(a.id)) return true;
  if (a.parents.length && a.parents.some((p) => b.parents.includes(p))) return true;
  return false;
}

// ------------------------------------------------------------ dialogue lines

type Ctx = {
  a: Cat; // speaker
  b: Cat; // listener
  weather: string;
  food: number;
  clanSize: number;
  season: string;
  night: boolean;
  recent?: string; // recent notable event text
  gossip?: Cat; // a third cat to gossip about
  gossipOpinion?: number;
  leader?: Cat;
};

function pick<T>(a: T[]): T { return simRng.pick(a); }

function nm(c: Cat) { return displayName(c); }

export type Topic = 'greeting' | 'weather' | 'prey' | 'event' | 'gossip' | 'training' | 'story' | 'kits' | 'worry' | 'ambition' | 'tease' | 'argue' | 'friendly' | 'romance' | 'leader';

export function chooseTopic(ctx: Ctx, opinion: number): Topic {
  const { a, b } = ctx;
  const w: [Topic, number][] = [
    ['weather', 1.2], ['prey', ctx.food < ctx.clanSize * 0.6 ? 2.5 : 0.8], ['friendly', opinion > 25 ? 2 : 0.3],
    ['event', ctx.recent ? 2 : 0], ['gossip', ctx.gossip ? 1.2 + a.pers.mischief : 0],
    ['training', a.stage === 'apprentice' || b.stage === 'apprentice' ? 2 : 0],
    ['story', a.stage === 'elder' ? 3 : 0], ['kits', a.stage === 'kit' || b.stage === 'kit' ? 2.5 : 0],
    ['worry', ctx.food < ctx.clanSize * 0.3 || a.sick > 20 ? 2 : 0.2], ['ambition', a.pers.ambition > 0.65 && a.stage === 'warrior' ? 1.2 : 0],
    ['tease', a.pers.mischief > 0.55 ? 1 : 0.1], ['argue', opinion < -20 ? 3 : opinion < 0 ? 0.6 : 0],
    ['romance', b.mate === a.id || (opinion > 50 && a.stage === 'warrior' && b.stage === 'warrior' && !a.mate && !b.mate) ? 1.2 : 0],
    ['leader', ctx.leader && ctx.leader.id !== a.id ? 0.6 : 0],
  ];
  return simRng.weighted(w);
}

/** Returns a short exchange [speakerLine, replyLine?] and an opinion delta. */
export function conversation(ctx: Ctx, topic: Topic): { lines: [Cat, string][]; delta: number; romance: number } {
  const { a, b } = ctx;
  const A = nm(a), B = nm(b);
  let lines: [Cat, string][] = [];
  let delta = 1.5;
  let romance = 0;
  switch (topic) {
    case 'greeting':
    case 'weather': {
      const w = ctx.weather;
      lines = [
        [a, pick([
          `${w === 'Rain' || w === 'Heavy rain' ? 'This rain soaks right to the skin.' : w === 'Snow' ? 'The snow makes every pawstep loud.' : w === 'Fog' ? "I can barely see my own tail in this fog." : w === 'Thunderstorm' ? 'Stay close to the dens tonight — that sky is angry.' : w === 'Strong wind' ? "Wind like this carries every scent away." : "Warm sun on my back. I could nap for a whole moon."}`,
          `Smell that? ${ctx.season === 'autumn' ? 'Leaf-drop is here for sure.' : ctx.season === 'winter' ? 'Frost again.' : ctx.season === 'spring' ? 'Everything is budding.' : 'High-sun and fat prey.'}`,
        ])],
        [b, pick(['Mm. Let\'s hope it holds.', 'You always notice these things.', 'I felt it in my whiskers this morning.', 'At least the dens are dry.'])],
      ];
      break;
    }
    case 'prey': {
      const low = ctx.food < ctx.clanSize * 0.6;
      lines = [
        [a, low ? pick(['The fresh-kill pile is almost bare.', 'We need more hunters out today.', 'The elders ate last and still went hungry.']) : pick(['The pile looks good today.', 'I caught a vole by the stream this morning!', 'Prey is running well near the meadow.'])],
        [b, low ? pick(["I'll go out again after I rest my paws.", 'Maybe try the far side of the river.', 'Hunger makes everyone short-tempered.']) : pick(['Good. The kits will grow strong.', 'Save me something fat.', 'Nicely done.'])],
      ];
      break;
    }
    case 'event':
      lines = [
        [a, `Did you hear? ${ctx.recent}`],
        [b, pick(['I heard. The whole camp is talking.', 'I hope the Long Meadow watches over us.', 'Things change so quickly in the forest.', 'We must stay alert.'])],
      ];
      break;
    case 'gossip': {
      const g = ctx.gossip!;
      const op = ctx.gossipOpinion ?? 0;
      const G = nm(g);
      lines = [
        [a, op > 30 ? pick([`${G} helped me without being asked. That cat has a good heart.`, `I think ${G} will make a fine leader one day.`, `${G} is always the first one up for patrol.`])
          : op < -20 ? pick([`${G} has been sneaking out again, I'm sure of it.`, `I don't trust ${G}. Something in the way they look at the border.`, `${G} ate before the elders again.`])
            : pick([`Have you noticed ${G} has been quiet lately?`, `${G} was muttering about the weather again.`, `I wonder what ${G} is up to.`])],
        [b, pick(['Hmm. I\'ll keep my eyes open.', 'You say that about everyone.', 'Really? I hadn\'t noticed.', 'Maybe you\'re right.'])],
      ];
      delta = 2;
      break;
    }
    case 'training':
      lines = a.stage === 'apprentice'
        ? [[a, pick(['My mentor made me stalk a leaf for half the morning!', 'I almost caught a rabbit today — almost.', 'I learned three new border markers!', 'My shoulders ache from battle training.'])], [b, pick(['Keep at it. We all started that way.', 'Ha! I remember that.', 'You\'ll be a warrior before you know it.'])]]
        : [[a, pick(['How is your training going?', 'Show me your hunter\'s crouch — lower!', 'Remember: tail still, paws light.'])], [b, pick(['Getting better every day!', 'Like this?', 'I\'m trying!'])]];
      break;
    case 'story':
      lines = [
        [a, pick([
          'When I was young, the river froze so hard we walked across it to the far pines.',
          'Long ago, a badger took the old nursery. Three warriors drove it out at moon-high.',
          'Our clan was founded by a she-cat who followed the stars to this hollow.',
          'Every cat that dies walks the Long Meadow, where prey never runs short.',
          'I once chased a hare all the way to the Tallfolk fields. Never caught it.',
          'The Council Stones were set by cats older than any clan, so that we might meet in peace.',
        ])],
        [b, pick(['Tell it again!', 'Is that really true?', 'I love that one.', 'Things were different then.'])],
      ];
      delta = 2.5;
      break;
    case 'kits':
      lines = a.stage === 'kit'
        ? [[a, pick(['Can we go outside the camp? Just a little?', 'I\'m going to be the best hunter ever!', 'Watch me pounce!', 'What\'s beyond the border?'])], [b, pick(['Not until you\'re an apprentice, little one.', 'I believe you!', 'Very fierce!', 'Other clans, and danger.'])]]
        : [[a, pick(['The kits are growing so fast.', 'Those kits have more energy than a squirrel in leaf-drop.', 'Someone keep the kits away from the elders\' den.'])], [b, pick(['They\'ll be apprentices soon.', 'I was the same once.', 'Ha, I\'ll try.'])]];
      break;
    case 'worry':
      lines = [
        [a, pick(['I have a bad feeling about this season.', 'If the prey doesn\'t return, the kits won\'t last.', 'My cough won\'t go away.', 'The borders smell wrong lately.'])],
        [b, pick(['We\'ll get through it together.', 'Talk to the healer.', 'Stay strong.', 'I\'ve noticed it too.'])],
      ];
      delta = 2;
      break;
    case 'ambition':
      lines = [
        [a, pick(['One day I\'ll speak from the High Rock.', 'The Second should be someone who acts, not just talks.', 'I\'ve trained harder than anyone this moon.'])],
        [b, pick(['Careful — ambition can burn.', 'Maybe you\'re right.', 'Don\'t let the Warden hear that.'])],
      ];
      delta = b.pers.ambition > 0.6 ? -3 : 0.5;
      break;
    case 'tease':
      lines = [
        [a, pick([`Nice pounce yesterday, ${B}. The mouse is still laughing.`, `${B}, is that moss in your fur or are you growing a garden?`, `Race you to the fresh-kill pile!`])],
        [b, b.pers.mischief > 0.4 || b.traits.includes('playful') ? pick(['Oh, you\'re going to regret that!', 'Ha! Just you wait.']) : pick(['Very funny.', 'Leave me alone.', 'Hmph.'])],
      ];
      delta = b.pers.mischief > 0.4 || b.traits.includes('playful') ? 3 : -2;
      break;
    case 'argue':
      lines = [
        [a, pick([`You took my spot in the den again, ${B}.`, 'Your patrol scared off all the prey!', 'Don\'t tell me how to hunt.', 'You think you\'re better than everyone.'])],
        [b, pick(['Mouse-brain! It was never your spot.', 'Maybe if you were quieter...', 'I\'ll tell you whatever I like.', 'At least I pull my weight.'])],
      ];
      delta = -4 - a.pers.aggression * 3;
      break;
    case 'friendly':
      lines = [
        [a, pick([`I saved you a thrush, ${B}.`, 'Want to share tongues after patrol?', 'I\'m glad we\'re in the same clan.', 'You looked tired. Rest — I\'ll cover your duty.'])],
        [b, pick(['You\'re a true friend.', 'I\'d like that.', 'Thank you.', 'Always.'])],
      ];
      delta = 3.5;
      break;
    case 'romance':
      lines = [
        [a, pick([`Walk with me by the river tonight, ${B}?`, 'The stars are clear. Shall we watch them together?', 'I kept the softest moss for you.'])],
        [b, pick(['I\'d like nothing more.', 'Only if you catch me first!', 'You\'re sweet.'])],
      ];
      delta = 3;
      romance = 6;
      break;
    case 'leader': {
      const L = ctx.leader!;
      const op = a.relations[L.id]?.opinion ?? 0;
      lines = [
        [a, op > 25 ? pick([`${nm(L)} leads us well.`, `I'd follow ${nm(L)} into a badger den.`]) : op < -20 ? pick([`${nm(L)} doesn't listen to anyone.`, `Is ${nm(L)} really fit to lead?`]) : pick([`What do you think of ${nm(L)}'s choices lately?`, `${nm(L)} seems tired.`])],
        [b, pick(['Hmm, I suppose.', 'Keep your voice down.', 'That\'s not for us to decide.', 'I agree.'])],
      ];
      break;
    }
  }
  if (lines.length > 1 && simRng.chance(0.25) && topic !== 'argue') lines.pop();
  void A;
  return { lines, delta, romance };
}

/** What an NPC says when the player approaches to talk. */
export function greetPlayer(npc: Cat, player: Cat, opinion: number, ctx: { night: boolean; food: number; clanSize: number; weather: string; recent?: string }): string {
  const P = player.given;
  if (npc.stage === 'kit') return pick([`${P}! Play with me!`, 'Are you going hunting? Can I come?', 'I found a beetle! Look!', 'Tell me about the border!']);
  if (opinion < -45) return pick([`What do you want, ${P}?`, 'Keep your distance.', `I've got nothing to say to you.`]);
  if (opinion < -15) return pick([`Oh. It's you.`, 'Make it quick.', `Hmph. ${P}.`]);
  if (npc.stage === 'elder') return pick([`Ah, young ${P}. Sit with an old cat a while.`, 'My bones ache, but my ears still work. What is it?', `${P}! Did you bring any fresh moss?`]);
  if (opinion > 55) return pick([`${P}! I was hoping to see you.`, `There you are! Share tongues with me?`, `Good to see you, friend.`]);
  if (ctx.food < ctx.clanSize * 0.4) return pick(['The pile is low. Have you hunted today?', 'I can hear my belly rumbling from here.']);
  if (npc.traits.includes('shy')) return pick(['Oh! H-hello.', '...Hi.', 'Did you need something?']);
  if (npc.traits.includes('serious')) return pick([`${P}. Is your duty done?`, 'Speak.', 'Stay alert today.']);
  return pick([`Hello, ${P}.`, `Hi ${P}. Fine ${ctx.night ? 'night' : 'day'}, isn't it?`, 'What news?', `Mm? Oh, hello ${P}.`]);
}

export function adviceLine(npc: Cat, hint: { preyNear?: string; eventHint?: string; borderHint?: string }): string {
  const opts: string[] = [];
  if (hint.preyNear) opts.push(`I scented ${hint.preyNear} not far from here. Try downwind, and keep low.`);
  if (hint.eventHint) opts.push(hint.eventHint);
  if (hint.borderHint) opts.push(hint.borderHint);
  opts.push(
    'Crouch low when stalking — prey hears heavy paws long before it sees you.',
    'Keep the wind in your face when hunting. If it carries your scent to them, they\'re gone.',
    'Birds watch for movement. Freeze when they look up.',
    'Rabbits run in zig-zags. Pounce before they bolt.',
    'The healer can use herbs: silverleaf for wounds, sunpetal for fever, bitterroot for sickness.',
    'Bring moss to the elders and nursery — soft bedding keeps them healthy.',
    'Never cross another clan\'s border without reason. They will smell it on you.',
    'Tallfolk dens have dogs. Keep your distance.',
  );
  return pick(opts);
}
