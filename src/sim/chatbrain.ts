// A smarter offline conversation brain. Before the simple keyword rules run,
// this tries to actually understand what was said: questions (do/are/can/
// will/why/how/who/where/what), other cats mentioned by name, clan words,
// how-to questions about the game, and follow-ups to the last topic.
// Replies are composed from several parts so they read like real conversation.
import type { Game } from '../game';
import { Cat, displayName, roleLabel } from '../cats/types';
import { simRng, hashString } from '../core/rng';
import { isFamily, relLabel } from './social';
import { loreText } from '../lore';
import type { ChatResult } from './chatbot';

const has = (c: Cat, ...t: string[]) => c.traits.some((x) => t.includes(x));
const pick = <T,>(a: T[]) => simRng.pick(a);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What each cat last talked about, for "why?" / "really?" follow-ups. */
const lastTopic = new Map<string, string>();

// ------------------------------------------------------------------ knowledge
const GLOSSARY: [RegExp, string][] = [
  [/warrior code|the code/, 'The warrior code is the set of rules every clan cat lives by: feed the kits and elders first, never hunt on another clan\'s land, obey your leader, and kits stay in camp until they\'re six moons old.'],
  [/starclan|long meadow/, 'StarClan are the spirits of our warrior ancestors. When a cat dies, they go to hunt in the stars. They send dreams and signs to the medicine cats.'],
  [/dark forest|place of no stars/, 'The Dark Forest is where cats who did terrible things go after they die. No stars, no prey, just shadows. Don\'t even joke about it.'],
  [/gathering/, 'At every full moon, the clans meet in peace at the Gathering. Leaders share news, and there\'s a truce — no fighting, by StarClan\'s will.'],
  [/kittypet|tinkercat/, 'A kittypet lives with Twolegs. They eat from bowls, sleep on soft beds and wear collars with jingly bells. They\'ve never hunted a day in their lives!'],
  [/loner|moonless/, 'A loner is a cat with no clan. They hunt alone and follow no code. Some are friendly, some aren\'t.'],
  [/rogue|dashclaw/, 'Rogues are clanless cats who steal prey and fight dirty. Be careful around them.'],
  [/twoleg|tallfolk|human/, 'Twolegs walk on their back legs, have no fur except on their heads, and stare at glowing stones in their paws all day. They build dens of stone and drive monsters.'],
  [/thunderpath|road/, 'The Thunderpath is a hard black path where monsters roar past. It stinks, and it\'s deadly. Never sit on it.'],
  [/monster|car|van/, 'Monsters are the shiny beasts that run along the Thunderpath. Twolegs ride inside them. Some white ones with flashing lights take cats away!'],
  [/fresh-?kill/, 'Fresh-kill is prey that\'s been caught for the clan. It goes on the pile in camp, and the kits, queens and elders eat first.'],
  [/moon/, 'A moon is how we count time — from one full moon to the next. Kits become apprentices at six moons.'],
  [/apprentice/, 'An apprentice is a young cat in training. They get a mentor, learn to hunt, fight and patrol, and their name ends in -paw.'],
  [/mentor/, 'A mentor is the warrior who trains an apprentice. They teach hunting, fighting, tracking and the code.'],
  [/medicine cat|healer/, 'Medicine cats heal the clan with herbs and talk with StarClan in dreams. They don\'t take mates or fight in battles.'],
  [/deputy|second/, 'The deputy is the leader\'s right paw. They organise patrols, and when the leader dies, the deputy becomes leader.'],
  [/leader|warden/, 'The leader rules the clan and receives nine lives from StarClan. Their name ends in -star.'],
  [/nine lives/, 'When a cat becomes leader, StarClan gives them nine lives. Each time they die, they wake again — until the last.'],
  [/elder/, 'Elders are old cats who\'ve retired from duties. We hunt for them and pick ticks off their pelts, and they tell the best stories.'],
  [/queen|nursery/, 'Queens are she-cats expecting or nursing kits. They live in the nursery with the kits, the warmest den in camp.'],
  [/poultice/, 'A poultice is herbs chewed into a paste and pressed onto a wound. Chew them first, or they won\'t work properly. (Press H to chew herbs.)'],
  [/greencough|whitecough|sickness/, 'Whitecough is a bad cold. Greencough is worse — it can kill elders and kits in leaf-bare. Catmint is the best cure.'],
  [/catmint|silverleaf|sunpetal|bitterroot|herb/, 'Silverleaf soothes wounds, sunpetal eases fever and coughs, and bitterroot fights sickness and poison. Chew them into a poultice before you use them.'],
  [/deathberr|yew/, 'Deathberries are bright red and deadly. Even one can kill a kit. Never, ever eat them.'],
  [/highrock|high rock/, 'The Highrock is where the leader stands to speak to the whole clan. When they call a meeting, everyone gathers beneath it.'],
  [/fourtrees|council stones/, 'Fourtrees is the hollow where the four great oaks stand. It\'s where we hold Gatherings.'],
  [/moonstone|stargazing stone/, 'The Moonstone shines like a star when moonlight touches it. Medicine cats and leaders sleep beside it to share dreams with StarClan.'],
  [/pound|animal control/, 'The pound is a rusty Twoleg den full of cages. Twolegs in white monsters take cats there. If you\'re caught — look for the loose vent.'],
  [/vet/, 'The vet is a Twoleg healer. Kittypets get taken there when they\'re hurt. It smells awful, but they do fix you up.'],
];

const HOWTO: [RegExp, string][] = [
  [/hunt|catch (prey|a mouse|mice|food)/, 'Crouch low (press C), creep closer slowly, keep the wind in your face, then hold Space to pounce. Bring your catch to the fresh-kill pile!'],
  [/fish/, 'Stand at the edge of a stream, keep still, and swipe (F) when a fish swims close. RiverClan cats are best at it.'],
  [/find (prey|food)/, 'Sniff the air (Q) — it shows scents nearby. Mice hide by tree roots, rabbits are out in the open, birds are in bushes.'],
  [/find herbs|get herbs|herbs/, 'Sniff (Q) to find herbs, or take some from the herb store in the medicine den. Silverleaf grows by water.'],
  [/heal|poultice|treat/, 'Pick herbs, press H to chew them into a poultice, then press it on yourself or talk to a hurt cat to treat them.'],
  [/drink|water|thirst/, 'Drink at a stream, a pond, the camp pool or the waterfall. In the morning there\'s dew on the grass. Puddles work when it rains.'],
  [/(become|be) a warrior|warrior name|get my name/, 'Finish your lessons with your mentor, then ask them "Am I ready for my warrior name?" They\'ll give you your assessment.'],
  [/(become|be) (a )?medicine/, 'Talk to the medicine cat and ask to become their apprentice. Then learn herbs and healing from them.'],
  [/(become|be) (a )?(leader|deputy)/, 'Be a good warrior, keep the code, help the clan and train an apprentice. The leader picks the deputy, and the deputy becomes leader.'],
  [/mate|find love|fall in love/, 'Spend time with a warrior you like — share tongues, share fresh-kill, give them flowers. If they like you back, you can ask them to be your mate.'],
  [/(make|get) friends|be friends/, 'Talk to cats every day, share tongues, bring them prey and flowers, and help them when they\'re sick. Friendship grows slowly.'],
  [/badger|fox|raccoon|animal friend/, 'Walk up to the animal and talk to it softly, or offer it prey. If it trusts you enough, it won\'t attack you anymore.'],
  [/escape|get out|pound|vent|cage/, 'In the pound, wiggle your latch when the Twoleg is busy with their phone, free the other cats, then pry the loose vent cover and squeeze out!'],
  [/join (the|a|your) clan/, 'Talk to a clan cat in their territory and ask to join. They might say yes — especially if they like you.'],
  [/swim/, 'Just walk into the water and paddle! But don\'t stay too long — you tire fast, and floods are dangerous.'],
  [/climb/, 'Jump with Space. Most cats can\'t climb trees in this forest, but you can leap onto rocks and logs.'],
  [/sleep|rest/, 'Go to your den and press E on your nest. Sleeping heals you and passes the night.'],
  [/pose|sit|lie down|play dead/, 'Press Y to open the poses menu: sit, loaf, lie on your side, play dead, unleash your claws, lash your tail…'],
  [/fight|attack/, 'Press F to swipe, R for a heavy strike, Space to dodge. If you\'re losing, press X to yield.'],
  [/look|appearance|fur|colou?r|wardrobe/, 'Open your Journal (J) and go to the Wardrobe. You can change your whole look there without starting over.'],
];

/** How a cat feels about a thing: stable per cat, nudged by personality. */
function feelingAbout(cat: Cat, thing: string): number {
  const base: Record<string, number> = {
    mice: 0.8, mouse: 0.8, prey: 0.9, rabbits: 0.7, birds: 0.6, squirrels: 0.6, fish: 0.1, frogs: -0.3,
    rain: -0.5, snow: 0.1, sun: 0.8, sunshine: 0.9, storms: -0.7, thunder: -0.8, wind: -0.1, leaf: 0.5,
    dogs: -0.9, foxes: -0.8, badgers: -0.9, twolegs: -0.6, monsters: -0.9, kittypets: -0.2, rogues: -0.7, loners: -0.1,
    water: -0.4, swimming: -0.5, flowers: 0.6, bees: -0.6, moss: 0.4, catmint: 0.9, herbs: 0.4,
    hunting: 0.8, fighting: 0.1, patrols: 0.3, gatherings: 0.7, kits: 0.6, elders: 0.5, stories: 0.7, sleeping: 0.7, napping: 0.8,
    shadowclan: -0.4, riverclan: -0.1, windclan: -0.1, thunderclan: 0.2, starclan: 0.9,
  };
  let v = base[thing] ?? ((hashString(cat.id + thing) % 200) / 100 - 1) * 0.8;
  if (has(cat, 'brave', 'aggressive') && /(fight|badger|fox|dog|storm|thunder)/.test(thing)) v += 0.6;
  if (has(cat, 'shy') && /(gathering|fight|twoleg|monster)/.test(thing)) v -= 0.4;
  if (has(cat, 'playful') && /(play|moss|kits|snow)/.test(thing)) v += 0.5;
  if (has(cat, 'lazy') && /(sleep|nap|sun)/.test(thing)) v += 0.4;
  if (has(cat, 'lazy') && /(patrol|hunt|train)/.test(thing)) v -= 0.5;
  if (cat.clan === 1 && thing === 'fish') v = 0.9; // a RiverClan-style rival loves fish
  return Math.max(-1, Math.min(1, v));
}

function findCat(g: Game, text: string, speaker: Cat): Cat | null {
  const low = text.toLowerCase();
  let best: Cat | null = null;
  for (const c of Object.values(g.clan.cats)) {
    if (c.id === speaker.id || c.isPlayer) continue;
    const dn = displayName(c).toLowerCase();
    const re = new RegExp(`\\b(${dn.replace(/[^a-z ]/g, '')}|${c.given.toLowerCase()})\\b`);
    if (re.test(low)) { if (!best || (c.alive && !best.alive)) best = c; }
  }
  return best;
}

function describeCat(g: Game, speaker: Cat, o: Cat): string {
  const clan = g.clan;
  const op = clan.opinion(speaker, o);
  const name = displayName(o);
  if (!o.alive) return `${name}? ${pick(['They walk with StarClan now.', 'They died… I still miss them.', 'They hunt in the stars now.'])} ${op > 20 ? 'They were a good cat.' : ''}`;
  if (o.exiled) return `${name} was driven out of the clan. ${op > 20 ? 'I still think about them.' : 'Good riddance.'}`;
  const rank = loreText(roleLabel(o)).toLowerCase();
  const traits = o.traits.slice(0, 2).join(' and ');
  const him = o.sex === 'tom' ? 'him' : 'her', he = o.sex === 'tom' ? 'he' : 'she';
  const feel = op > 45 ? pick([`I'd trust ${him} with my life.`, 'One of my closest friends.', `I love ${him} dearly.`])
    : op > 15 ? pick([`I like ${him}.`, `${cap(he)}'s good company.`, `${cap(he)}'s a decent cat.`]) : op < -25 ? pick([`Between us? I can't stand ${him}.`, `I don't trust ${him} one bit.`, 'We don\'t get along.']) : pick(['We don\'t talk much.', `I don't know ${him} that well.`, `${cap(he)}'s alright, I suppose.`]);
  const fam = speaker.mate === o.id ? 'That\'s my mate! ' : isFamily(speaker, o) ? 'We\'re family. ' : '';
  return `${fam}${name} is a ${rank}, ${Math.floor(o.age)} moons old — ${traits}. ${feel}`;
}

function whereIs(g: Game, o: Cat): string {
  const a = g.npcs.agents.get(o.id);
  if (!o.alive) return `${displayName(o)} is gone. Only StarClan can find them now.`;
  if (o.caged) return `${displayName(o)} was taken by Twolegs to the pound! We have to get them out.`;
  if (!a) return `I haven't seen ${displayName(o)} for a while. Maybe out on patrol.`;
  const p = g.player.pos;
  const dx = a.pos.x - p.x, dz = a.pos.z - p.z;
  const d = Math.round(Math.hypot(dx, dz));
  const den = g.camp.denAt(a.pos.x, a.pos.z);
  const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  const dir = dirs[Math.round(((Math.atan2(dz, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  return den ? `${displayName(o)} is in the ${loreText(den.label)}${d > 4 ? `, about ${d} tail-lengths ${dir} of here` : ' right now'}.` : `Last I saw, ${displayName(o)} was about ${d} tail-lengths ${dir} of here.`;
}

// ------------------------------------------------------------------ main
export function smartReply(g: Game, cat: Cat, text: string): ChatResult | null {
  const me = g.clan.player;
  const op = g.clan.opinion(cat, me);
  const raw = text.trim();
  const low = raw.toLowerCase().replace(/[’']/g, "'");
  const q = /\?\s*$/.test(raw) || /^(do|does|did|are|is|can|could|will|would|have|has|why|how|what|who|where|when|which|should)\b/.test(low);
  const warm = op > 25 || has(cat, 'friendly', 'kind');
  const prefix = () => pick(warm ? ['', '*purrs* ', '*tail flicks happily* ', ''] : op < -20 ? ['*narrows eyes* ', '', '*sighs* '] : ['', '*thinks* ', '*tilts head* ', '']);
  const follow = () => simRng.chance(0.45) ? ' ' + pick(['What about you?', 'Why do you ask?', 'Do you agree?', 'What do you think?', 'Have you ever wondered that too?', 'Anything else on your mind?']) : '';
  const done = (reply: string, opinion = 1, topic?: string, mood?: ChatResult['mood']): ChatResult => { if (topic) lastTopic.set(cat.id, topic); return { reply: loreText(reply).trim(), opinion, mood }; };

  // follow-ups to what we were just talking about
  const lt = lastTopic.get(cat.id);
  if (lt && /^(why|why\?|how come|really\??|are you sure|for real|what do you mean|explain)\b/.test(low) && low.length < 22) {
    const why: Record<string, string> = {
      likes: 'Because some things just feel right in your paws and some don\'t. That\'s how StarClan made us.',
      cat: 'You get to know a cat by watching how they treat the kits and the elders. That tells you everything.',
      code: 'Because without the code, the clans would tear each other apart. It keeps us alive.',
      howto: 'Because that\'s how it\'s always been done — and it works! Trust me, I learned the hard way.',
      self: 'I just am. Every cat is born with their own heart.',
      twolegs: 'Nobody knows why Twolegs do anything. Not even StarClan, I bet.',
    };
    return done(prefix() + (why[lt] ?? pick(['Because! …Alright, I don\'t really know.', 'Some things you just know in your whiskers.', 'Ask the elders. They know everything — or pretend to.'])), 1);
  }

  // the cat's own name
  if (new RegExp(`\\b(${displayName(cat).toLowerCase()}|${cat.given.toLowerCase()})\\b`).test(low) && !/\b(i am|i'm|my name)\b/.test(low)) {
    return done(prefix() + pick([`That's me! What about me?`, `${displayName(cat)}? You're looking at ${cat.sex === 'tom' ? 'him' : 'her'}.`, `Me? *puffs out chest* What do you want to know?`]), 1, 'self');
  }
  // talking about another cat by name
  const other = findCat(g, raw, cat);
  if (other) {
    if (/\bwhere\b/.test(low)) return done(whereIs(g, other), 1, 'cat');
    if (/\b(think|feel|like|opinion|about|who is|who's|tell me)\b/.test(low) || q) return done(prefix() + describeCat(g, cat, other) + follow(), 1, 'cat');
  }

  // "what is / what's / what does X mean" — clan words
  if (/\b(what('s| is| are| does)|tell me about|explain|meaning of|who are)\b/.test(low)) {
    for (const [re, ans] of GLOSSARY) if (re.test(low)) return done(prefix() + ans + follow(), 2, 'code');
  }

  // how-to questions about living in the forest (and the game)
  if (/\b(how (do|can|should) (i|you|we)|how to|how does one|teach me|show me how|what should i do|tips?)\b/.test(low)) {
    for (const [re, ans] of HOWTO) if (re.test(low)) return done(prefix() + (has(cat, 'serious') ? '' : pick(['Easy! ', 'Here\'s how. ', 'Listen closely. ', ''])) + ans, 2, 'howto');
    if (/what should i do/.test(low)) {
      const tips = [g.clan.food < g.clan.home().length * 0.6 ? 'The fresh-kill pile is low — go hunting!' : 'Go explore! There are treasures and flowers hidden all over the forest.',
        me.thirst !== undefined && me.thirst < 40 ? 'You look thirsty. Find some water first.' : 'Visit the elders — they love company and stories.',
        me.stage === 'apprentice' ? 'Ask your mentor for a lesson.' : 'Check your duties in the Journal (J).'];
      return done(pick(tips), 2, 'howto');
    }
  }

  // "do you like X / do you love X / do you hate X"
  let m = low.match(/\bdo you (like|love|hate|enjoy|prefer) ([a-z' -]{2,30}?)(\?|$| or | at all| very)/);
  if (m) {
    const thing = m[2].replace(/^(the|a|an) /, '').trim();
    if (/^me\b|^you\b/.test(thing)) {
      return done(op > 45 ? 'Like you? You\'re one of my favourite cats in the whole forest!' : op > 15 ? 'Yes, I like you. You\'re good company.' : op < -20 ? 'Honestly? Not really.' : 'I don\'t know you that well yet. Give me time.', 2, 'self', op > 15 ? 'happy' : undefined);
    }
    const f = feelingAbout(cat, thing.replace(/s$/, '') === thing ? thing : thing);
    const ans = f > 0.5 ? pick([`Do I like ${thing}? I LOVE ${thing}!`, `${cap(thing)}? Oh yes. One of my favourite things.`, `Who doesn't like ${thing}?`])
      : f > 0.1 ? pick([`${cap(thing)}? They're alright.`, `I like ${thing} well enough.`, `Mm, ${thing} is nice sometimes.`])
        : f > -0.4 ? pick([`${cap(thing)}? Not really my thing.`, `I don't mind ${thing}, but I don't love it either.`])
          : pick([`${cap(thing)}? Ugh, no. Never.`, `I can't stand ${thing}.`, `${cap(thing)}? *shudders* Don't even.`]);
    const why = f > 0.5 ? pick([' It makes my whiskers tingle.', ' It reminds me of when I was a kit.', '']) : f < -0.4 ? pick([' Just thinking about it makes my fur bristle.', ' Bad memories.', '']) : '';
    return done(prefix() + ans + why + follow(), 2, 'likes');
  }

  // "are you X"
  m = low.match(/\bare you (ok|okay|alright|fine|hungry|thirsty|tired|sleepy|sick|hurt|happy|sad|angry|mad|scared|afraid|brave|lonely|bored|a warrior|an apprentice|a kit|the leader|single|in love|my friend|mad at me|angry at me|scared of)\b/);
  if (m) {
    const w = m[1];
    const yes = (b: boolean, y: string, n: string) => b ? y : n;
    const ans = /ok|okay|alright|fine/.test(w) ? (cat.sick > 30 ? 'Not really… *cough* I feel awful.' : cat.injury > 30 ? 'My wounds ache, but I\'ll manage.' : 'I\'m fine, thank you for asking.')
      : /hungry/.test(w) ? yes(cat.hunger < 40, 'Starving! My belly\'s been growling since dawn.', 'No, I ate earlier. Thank you, though.')
        : /thirsty/.test(w) ? 'A little. I\'ll drink at the pool soon.'
          : /tired|sleepy/.test(w) ? yes(g.time.isNight || has(cat, 'lazy'), '*yawns* So tired. I could sleep for a moon.', 'Not yet. Plenty of energy left in these paws!')
            : /sick|hurt/.test(w) ? yes(cat.sick > 30 || cat.injury > 30, `Yes… ${cat.sick > cat.injury ? 'this sickness won\'t let go' : 'my wounds still sting'}. Could you bring me herbs?`, 'No, I\'m healthy as a hare!')
              : /happy/.test(w) ? yes(op > 0 && cat.hunger > 30, 'Yes! The clan is safe, the pile is full, and the sun is warm.', 'Not really. It\'s been a hard moon.')
                : /sad|lonely/.test(w) ? yes(cat.memories.slice(-3).some((x) => x.weight < -3), 'A little. Some things happened I can\'t stop thinking about.', 'No, not today. Thank you for caring.')
                  : /angry|mad/.test(w) ? (/me/.test(w) ? yes(op < -10, 'Yes. You know what you did.', 'At you? No! Why would I be?') : yes(has(cat, 'aggressive'), 'I\'m always a little angry. Keeps me sharp.', 'No, I\'m calm.'))
                    : /scared|afraid/.test(w) ? yes(cat.pers.bravery < 0.4, 'Sometimes. Storms, mostly. And dogs. And the dark.', 'Scared? Me? Hardly.')
                      : /brave/.test(w) ? yes(cat.pers.bravery > 0.55, 'I\'d face a badger for my clan.', 'I try to be. It\'s not easy.')
                        : /bored/.test(w) ? 'A little! Want to do something fun?'
                          : /warrior/.test(w) ? yes(cat.stage === 'warrior', 'Yes — and proud of it.', `Not yet! I'm ${cat.stage === 'kit' ? 'only a kit' : 'still training'}.`)
                            : /apprentice/.test(w) ? yes(cat.stage === 'apprentice', 'Yes, I\'m still training.', 'No, not anymore.')
                              : /kit/.test(w) ? yes(cat.stage === 'kit', 'Yes! I\'m going to be the best warrior ever!', 'A kit? Ha! Not for many moons.')
                                : /leader/.test(w) ? yes(cat.role === 'leader', 'I am. StarClan gave me nine lives.', `No — ${g.clan.leader ? displayName(g.clan.leader) : 'nobody'} leads us.`)
                                  : /single|in love/.test(w) ? (cat.mate ? `I have a mate: ${displayName(g.clan.get(cat.mate)!)}.` : g.clan.rel(cat, me).romance > 30 ? '*looks at you shyly* …Maybe there\'s someone.' : 'No mate for me. Not yet.')
                                    : /my friend/.test(w) ? yes(op > 15, 'Of course I am!', op < -20 ? 'No.' : 'I\'d like to be.')
                                      : 'Hmm. Maybe!';
    return done(prefix() + ans, 2, 'self');
  }

  // "can you / could you / will you / would you / do you want to X"
  m = low.match(/\b(can|could|will|would) you (please )?([a-z' -]{2,40})|\bdo you want to ([a-z' -]{2,40})|\bwanna ([a-z' -]{2,40})/);
  if (m) {
    const act = (m[3] ?? m[4] ?? m[5] ?? '').trim();
    const willing = op > 10 || has(cat, 'friendly', 'kind', 'playful');
    let ans: string;
    if (/hunt/.test(act)) ans = willing ? 'Hunt together? Yes! You flush them out, I\'ll pounce.' : 'I hunt alone, thanks.';
    else if (/fight|teach|train/.test(act)) ans = cat.skills.fighting > 50 ? 'I could. Watch my paws closely — dodge, then strike from the side.' : 'I\'m not the best teacher, but I\'ll try.';
    else if (/play|race|moss/.test(act)) ans = has(cat, 'serious') && cat.stage === 'warrior' ? 'Play? I have duties.' : 'Yes! Race you to the Highrock!';
    else if (/help/.test(act)) ans = willing ? 'Of course. What do you need?' : 'Help yourself.';
    else if (/swim/.test(act)) ans = feelingAbout(cat, 'swimming') > 0 ? 'I love swimming!' : 'Swim? Get my fur wet? No thank you.';
    else if (/climb/.test(act)) ans = 'Climb? I\'d rather keep my paws on the ground.';
    else if (/be my mate|marry|love me/.test(act)) ans = g.clan.rel(cat, me).romance > 35 ? '*purrs softly* Yes… I think I would.' : 'That\'s… a big thing to ask. Let me think about it.';
    else if (/be my friend/.test(act)) ans = op > -20 ? 'I\'d like that.' : 'You\'ll have to earn that.';
    else if (/(tell|say).*(story|joke)/.test(act)) ans = has(cat, 'playful', 'mischievous') ? 'Why did the mouse never win at hide-and-seek? Because it always squeaked! Ha!' : 'Long ago, the clans fought every day. Then StarClan gave us the code, and the Gatherings, so we could live in peace.';
    else if (/(come|follow)/.test(act)) ans = willing ? 'Lead the way!' : 'I\'m busy right now.';
    else if (/sleep|nap|rest/.test(act)) ans = '*yawns* Don\'t tempt me.';
    else if (/(keep|a) secret/.test(act)) ans = op > 20 ? 'My lips are sealed. Tell me.' : 'Depends on the secret.';
    else ans = willing ? pick([`${cap(act)}? Sure, why not!`, `I can try to ${act}.`, `If it helps you, I'll ${act}.`]) : pick([`${cap(act)}? No.`, 'Not right now.', `Why would I ${act}?`]);
    return done(prefix() + ans, willing ? 2 : 0, 'howto', willing ? 'happy' : undefined);
  }

  // about the cat themselves
  if (/\b(tell me about (yourself|you)|about you|who are you really|describe yourself|what are you like)\b/.test(low)) {
    const mateTxt = cat.mate ? ` My mate is ${displayName(g.clan.get(cat.mate)!)}.` : '';
    const kits = cat.kits.map((k) => g.clan.get(k)).filter((k) => k && k.alive) as Cat[];
    const self = `I'm ${displayName(cat)}, ${loreText(roleLabel(cat)).toLowerCase()} — ${Math.floor(cat.age)} moons old. I'm ${cat.traits.slice(0, 2).join(' and ')}, or so the others say.${mateTxt}${kits.length ? ` My kits are ${kits.map((k) => displayName(k)).join(' and ')}.` : ''} I love ${pick(['the smell of the forest after rain', 'a warm patch of sun', 'a fat vole', 'listening to the elders\' stories', 'sharing tongues at dusk'])}.`;
    return done(prefix() + self + follow(), 2, 'self');
  }

  // why-questions
  if (/^why\b/.test(low)) {
    if (/sky|stars/.test(low)) return done('The stars are StarClan, watching us. Every warrior who ever lived is up there.', 1, 'code');
    if (/rain|snow|storm/.test(low)) return done('StarClan send the weather. Rain for the herbs, snow to make us strong. Storms… maybe they\'re angry.', 1, 'code');
    if (/twoleg/.test(low)) return done('Nobody knows why Twolegs do anything. They have food everywhere and still look miserable.', 1, 'twolegs');
    if (/code|rule/.test(low)) return done(GLOSSARY[0][1], 1, 'code');
    return done(prefix() + pick(['Because that\'s the way StarClan made it.', 'I\'ve wondered that too. I don\'t think anyone knows.', 'Good question. Ask the medicine cat — they talk to StarClan.', 'Because… hmm. Let me think about it and tell you tomorrow.']), 1, 'code');
  }

  // what time / season / weather
  if (/\bwhat (time|season|day|moon)\b/.test(low)) return done(`It's ${g.time.label().toLowerCase()}, in ${loreText(g.time.season === 'spring' ? 'Budding season' : g.time.season === 'blossom' ? 'Blossom season' : g.time.season === 'summer' ? 'High-sun season' : g.time.season === 'autumn' ? 'Leaf-drop season' : 'Frost season')}. The weather is ${g.weatherLabel().toLowerCase()}.`, 1);

  return null;
}

/** Sometimes add a little extra life to a reply: a reaction and a question back. */
export function enrich(cat: Cat, me: Cat, reply: string, op: number): string {
  if (reply.length > 120 || simRng.chance(0.55)) return reply;
  const extra = op > 25
    ? pick([` By the way, ${me.given}, I'm glad you came to talk.`, ' You always know how to cheer me up.', ' We should hunt together soon!'])
    : op < -20 ? pick([' Anything else?', ' Now, if you don\'t mind…']) : pick([' Anyway.', ' What brings you here?', ' Strange times, aren\'t they?', '']);
  return reply + extra;
}

void relLabel;
