// Offline "say anything" reply engine. Recognises what the player is talking
// about and answers in character, shaped by the cat's personality, rank and
// feelings toward the player. Also reports how the words change the relationship.
import type { Game } from '../game';
import { Cat, displayName } from '../cats/types';
import { simRng } from '../core/rng';
import { isFamily } from './social';
import { smartReply, enrich } from './chatbrain';

export interface ChatResult { reply: string; opinion: number; romance?: number; mood?: 'happy' | 'angry' | 'sad' | 'neutral' }

type Rule = { re: RegExp; fn: (c: ChatCtx) => ChatResult };

interface ChatCtx {
  g: Game;
  cat: Cat;
  me: Cat;
  text: string;
  op: number;
  pick: (a: string[]) => string;
}

const has = (c: Cat, ...t: string[]) => c.traits.some((x) => t.includes(x));

function tone(c: ChatCtx, warm: string[], cold: string[], neutral: string[]) {
  if (c.op < -20 || has(c.cat, 'suspicious', 'aggressive') && c.op < 20) return c.pick(cold);
  if (c.op > 30 || has(c.cat, 'friendly', 'kind', 'playful')) return c.pick(warm);
  return c.pick(neutral);
}

const RULES: Rule[] = [
  { re: /\b(stupid|dumb|idiot|mouse-?brain|hate you|ugly|fox-?heart|smell|loser|shut up|traitor|coward)\b/i, fn: (c) => ({
    reply: has(c.cat, 'aggressive') ? c.pick(['Say that again and you\'ll be picking my claws out of your pelt!', '*HISS* Watch your tongue!', 'You want a fight? Keep talking.'])
      : has(c.cat, 'shy', 'kind') ? c.pick(['That... that was cruel.', 'Why would you say that to me?', '*flattens ears and looks away*'])
        : c.pick(['Mouse-brain yourself.', 'Charming. Truly.', 'I\'ll remember you said that.']),
    opinion: -8, mood: has(c.cat, 'shy', 'kind') ? 'sad' : 'angry' }) },
  { re: /\b(sorry|apologi[sz]e|forgive me|my fault)\b/i, fn: (c) => ({
    reply: c.op < 0 ? c.pick(['...Fine. I accept your apology.', 'Hmph. At least you can admit it.', 'Alright. Let\'s put it behind us.']) : c.pick(['Sorry? For what? We\'re fine.', 'No need to apologise to me.', 'Don\'t worry about it.']),
    opinion: c.op < 0 ? 5 : 1, mood: 'neutral' }) },
  { re: /\b(i love you|be my mate|marry|crush on you|you're cute|youre cute|love you)\b/i, fn: (c) => {
    const eligible = c.cat.stage === 'warrior' && c.me.stage === 'warrior' && !isFamily(c.cat, c.me);
    if (!eligible) return { reply: c.pick(['*purrs* You\'re sweet. You\'re a good friend.', 'Ha! You\'re funny.', 'That\'s kind of you to say.']), opinion: 2, mood: 'happy' };
    const r = c.g.clan.rel(c.cat, c.me).romance;
    return r > 35 || c.op > 55
      ? { reply: c.pick(['*purrs loudly* I... I feel the same way.', 'My heart skips when you\'re near, you know.', 'Walk with me under the stars tonight?']), opinion: 4, romance: 10, mood: 'happy' }
      : { reply: c.pick(['Oh! I... I don\'t know what to say.', 'That\'s... unexpected. Let me think about it.', 'You\'re a good cat, but I don\'t feel that way.']), opinion: 0, romance: 3 };
  } },
  { re: /\b(friends?|be my friend|like you|trust you|best friend)\b/i, fn: (c) => ({
    reply: c.op > 20 ? c.pick(['Of course we\'re friends!', 'I\'d trust you with my life.', 'You\'re one of my closest friends, you know that.'])
      : c.op < -20 ? c.pick(['Friends? After everything? No.', 'Earn it first.', 'I don\'t think so.'])
        : c.pick(['Friends? ...I\'d like that.', 'Maybe. Let\'s see how the next moon goes.', 'Sure, why not.']),
    opinion: c.op < -20 ? 0 : 5, mood: c.op < -20 ? 'neutral' : 'happy' }) },
  { re: /\b(brave|strong|smart|clever|beautiful|pretty|handsome|amazing|great|awesome|best|good job|well done|nice pelt|fast|kind)\b/i, fn: (c) => ({
    reply: has(c.cat, 'serious') ? c.pick(['Flattery won\'t get you out of patrol duty.', 'Hm. Thank you.', 'Words are cheap. But thank you.'])
      : has(c.cat, 'shy') ? c.pick(['Oh! Th-thank you...', '*ducks head, embarrassed* You really think so?'])
        : c.pick(['*purrs* You\'re too kind!', 'Ha! I know. But thanks for noticing.', 'That means a lot coming from you.']),
    opinion: has(c.cat, 'serious') ? 2 : 4, mood: 'happy' }) },
  { re: /\b(thank|thanks|thank you)\b/i, fn: (c) => ({ reply: c.pick(['Anytime.', 'That\'s what clanmates are for.', 'Don\'t mention it.']), opinion: 2, mood: 'happy' }) },
  { re: /\b(hi|hello|hey|greetings|good morning|good evening|sup|yo)\b/i, fn: (c) => ({
    reply: tone(c, [`Hello, ${c.me.given}! Good to see you.`, 'Hey there! What\'s new?', `${c.me.given}! I was just thinking about you.`], ['What do you want?', '...Hello.', 'Oh. It\'s you.'], ['Hello.', `Greetings, ${c.me.given}.`, 'Mm, hello.']), opinion: 1 }) },
  { re: /\b(how are you|how're you|you ok|are you okay|how do you feel|feeling)\b/i, fn: (c) => {
    const cat = c.cat;
    const reply = cat.sick > 30 ? '*cough* Not well. This sickness has me weak.' : cat.injury > 30 ? 'My leg aches, but I\'ll live.' : cat.hunger < 35 ? 'Hungry. The fresh-kill pile has seen better days.'
      : cat.mate ? `Happy. ${displayName(c.g.clan.get(cat.mate)!)} makes every day brighter.` : c.pick(['I\'m well, thank you.', 'Tired, but content.', 'Good! The sun is warm and prey is running.']);
    return { reply, opinion: 2 };
  } },
  { re: /\b(your name|who are you|what are you called)\b/i, fn: (c) => ({ reply: `I'm ${displayName(c.cat)}${c.cat.role !== 'none' ? `, ${c.cat.role === 'leader' ? 'leader' : c.cat.role === 'deputy' ? 'deputy' : 'medicine cat'} of the clan` : ''}. Did you hit your head, ${c.me.given}?`, opinion: 0 }) },
  { re: /\b(how old|your age|moons old)\b/i, fn: (c) => ({ reply: `I've seen ${Math.floor(c.cat.age)} moons. ${c.cat.age > 80 ? 'My bones feel every one of them.' : c.cat.age < 12 ? 'I\'ll be a warrior soon!' : 'Still plenty of hunting left in these paws.'}`, opinion: 1 }) },
  { re: /\b(deathberr|red berr|poison)/i, fn: (c) => ({ reply: c.pick(['Deathberries! Never, EVER eat them. One mouthful can kill a kit.', 'Stay away from those bright red berries. If you eat one, run to the medicine cat for yarrow.', 'I saw a kit eat deathberries once. We almost lost them.']), opinion: 1 }) },
  { re: /\b(hunt|prey|mouse|mice|vole|rabbit|squirrel|bird|fish|hungry|food|fresh-?kill|eat)\b/i, fn: (c) => {
    const food = c.g.clan.food, n = c.g.clan.home().length;
    return { reply: (food < n * 0.6 ? 'The pile is low — we need every hunter out there. ' : 'Prey is running well. ') + c.pick(['Keep low, keep the wind in your face, and pounce before they bolt.', 'Mice by the roots of the old oaks, rabbits out in the open.', 'Birds watch for movement. Freeze when they look up.', 'Never eat until the kits and elders are fed.']), opinion: 1 };
  } },
  { re: /\b(herb|sick|hurt|injur|wound|heal|medicine|cough|fever)\b/i, fn: (c) => ({ reply: c.pick(['Silverleaf for wounds, sunpetal for fever, bitterroot for sickness. The medicine cat taught me that much.', 'If you\'re hurt, go to the medicine den. Don\'t be a hero.', `${c.g.clan.medicine ? displayName(c.g.clan.medicine) : 'Our medicine cat'} works harder than any of us.`]), opinion: 1 }) },
  { re: /\b(leader|deputy|second|warden|highrock|high rock)\b/i, fn: (c) => {
    const L = c.g.clan.leader, D = c.g.clan.deputy;
    const opL = L ? c.g.clan.opinion(c.cat, L) : 0;
    const lead = L ? (opL > 25 ? `${displayName(L)} is a fine leader. I'd follow them anywhere.` : opL < -20 ? `${displayName(L)}? Between you and me... I'm not sure they're fit to lead.` : `${displayName(L)} leads us. That's all there is to say.`) : 'We have no leader right now. It frightens me.';
    return { reply: lead + (D ? ` And ${displayName(D)} is deputy${has(c.cat, 'ambitious') ? ' — for now.' : '.'}` : ''), opinion: 0 };
  } },
  { re: /\b(clan|shadow|river|wind|thunder|rival|border|enemy|enemies|other clans?)\b/i, fn: (c) => {
    const rivals = c.g.clan.rivals.map((r) => ({ name: c.g.territories.rivals[r.index].name, att: r.attitude }));
    const worst = rivals.sort((a, b) => a.att - b.att)[0];
    return { reply: worst ? `${worst.name}? ${worst.att < -30 ? 'Can\'t be trusted. Keep your claws sharp near their border.' : worst.att > 20 ? 'They\'ve been decent neighbours lately.' : 'Wary as always. Mark the borders and stay on our side.'} Our clan comes first.` : 'Our clan comes first. Always.', opinion: 1 };
  } },
  { re: /\b(fight|battle|attack|claws|badger|fox|dog)\b/i, fn: (c) => ({ reply: has(c.cat, 'brave', 'aggressive') ? c.pick(['Let them come. I\'ll show them what our claws are for.', 'Go for the legs of a badger — they\'re slow to turn.']) : c.pick(['I hope it never comes to that.', 'If you see a fox, run for camp and warn us.', 'Dodge the lunge, then strike from the side.']), opinion: 1 }) },
  { re: /\b(starclan|stars|ancestors|long meadow|dead|died|death)\b/i, fn: (c) => ({ reply: c.pick(['Our ancestors watch us from the stars. I feel them some nights.', 'Everyone we lose walks among the stars now.', 'Sometimes I dream of cats I\'ve never met... I think they\'re trying to tell me something.']), opinion: 2, mood: 'sad' }) },
  { re: /\b(mother|father|mom|mum|dad|family|kits?|brother|sister|litter)\b/i, fn: (c) => {
    const kits = c.cat.kits.map((k) => c.g.clan.get(k)).filter((k) => k && k.alive) as Cat[];
    const par = c.cat.parents.map((p) => c.g.clan.get(p)).filter(Boolean) as Cat[];
    const reply = isFamily(c.cat, c.me) ? 'We\'re family, you and I. That means something.' : kits.length ? `My kits — ${kits.map((k) => k.given).join(', ')} — are my whole world.` : par.length ? `My mother was ${displayName(par[0])}. ${par[0].alive ? 'She\'s still with us, thank StarClan.' : 'She walks with our ancestors now.'}` : 'I came to the clan young. The clan is my family.';
    return { reply, opinion: 2 };
  } },
  { re: /\b(train|mentor|apprentice|lesson|learn|teach)\b/i, fn: (c) => ({ reply: c.cat.apprentice ? `${displayName(c.g.clan.get(c.cat.apprentice)!)} is learning fast. I'm proud of them.` : c.cat.stage === 'apprentice' ? 'My mentor works me from dawn till dusk! But I\'m getting better.' : c.pick(['Listen to your mentor. They were young once too.', 'Practise your hunting crouch every day. Low, lower!']), opinion: 1 }) },
  { re: /\b(weather|rain|snow|cold|hot|sun|storm|wind)\b/i, fn: (c) => ({ reply: `${c.g.weatherLabel()}. ${c.pick(['Makes the prey hide.', 'My fur hates it.', 'Could be worse.', 'Good weather for a nap.'])}`, opinion: 1 }) },
  { re: /\b(joke|funny|laugh|play)\b/i, fn: (c) => ({ reply: has(c.cat, 'playful', 'mischievous') ? c.pick(['Why did the mouse cross the border? It didn\'t — I caught it first! Ha!', 'Race you to the fresh-kill pile! Loser eats the crow-food!', '*pounces on your tail* Got you!']) : c.pick(['I\'m not in a laughing mood.', 'Play? I\'m a warrior, not a kit.', 'Heh. Maybe later.']), opinion: has(c.cat, 'playful', 'mischievous') ? 4 : 0, mood: 'happy' }) },
  { re: /\b(secret|gossip|rumou?r|heard)\b/i, fn: (c) => {
    const others = c.g.clan.home().filter((o) => o !== c.cat && o !== c.me);
    const o = others.length ? simRng.pick(others) : null;
    if (!o || c.op < 10) return { reply: 'I don\'t spread gossip. Especially not to you.', opinion: -1 };
    const op = c.g.clan.opinion(c.cat, o);
    return { reply: op < -20 ? `Between us? I don't trust ${displayName(o)}. Watch them.` : o.mate ? `${displayName(o)} and ${displayName(c.g.clan.get(o.mate)!)} — you should see how they look at each other.` : `I think ${displayName(o)} is sweet on someone. Don't tell!`, opinion: 3 };
  } },
  { re: /\b(bye|goodbye|see you|farewell|later)\b/i, fn: (c) => ({ reply: tone(c, ['Take care out there!', 'May StarClan light your path.', 'See you at the fresh-kill pile!'], ['Finally.', 'Go, then.'], ['Farewell.', 'Until later.']), opinion: 0 }) },
  { re: /\b(what are you doing|whatcha doing|what r u doing|busy|wyd)\b/i, fn: (c) => ({ reply: c.pick([
      c.cat.role === 'medicine' ? 'Sorting herbs. Again. Want to help me tell silverleaf from sunpetal?' : c.cat.stage === 'kit' ? 'Playing! Well, I WAS playing, until you came along. Want to join?' : 'Taking a breather before the next patrol.',
      'Watching the clouds. That one looks like a rabbit, see?',
      'Thinking about fresh-kill, honestly.',
      'Just listening to the forest. It\'s never really quiet, you know.']), opinion: 1 }) },
  { re: /\b(favou?rite|fave|best (food|prey|place|season|thing))\b/i, fn: (c) => ({ reply: /season|time of year/i.test(c.text) ? `${c.pick(['Rose-leaf, when the blossoms fall like snow', 'Greenleaf — fat prey and warm sun', 'Leaf-fall, I love the crunchy leaves', 'Newleaf, when everything wakes up'])}. That's my favourite season.` : /place|spot/i.test(c.text) ? `My favourite place is ${c.pick(['the Sunning Rocks on a warm day', 'the pool by the waterfall', 'the big oak by the border', 'my nest in the den, if I\'m honest'])}.` : /food|prey|eat/i.test(c.text) ? `My favourite prey? A fat ${c.pick(['vole', 'thrush', 'squirrel', 'mouse', 'rabbit'])}. Nothing beats it.` : c.pick([
      `My favourite prey? A fat ${c.pick(['vole', 'thrush', 'squirrel', 'mouse', 'rabbit'])}. Nothing beats it.`,
      `My favourite place is ${c.pick(['the Sunning Rocks on a warm day', 'the pool by the waterfall', 'the big oak by the border', 'my nest in the den, if I\'m honest'])}.`,
      `${c.pick(['Rose-leaf, when the blossoms fall like snow', 'Greenleaf — fat prey and warm sun', 'Leaf-fall, I love the crunchy leaves', 'Newleaf, when everything wakes up'])}. That's my favourite season.`,
      'Favourite thing? Sharing tongues after a long day. Simple pleasures.']), opinion: 2, mood: 'happy' }) },
  { re: /\b(do you like me|like me\??|what do you think of me|am i (your )?friend)\b/i, fn: (c) => ({
    reply: c.op > 50 ? c.pick(['Like you? You\'re one of my favourite cats in the whole forest!', '*purrs* Of course I do, mouse-brain.']) : c.op > 15 ? c.pick(['Yes, I like you. You\'re good company.', 'You\'re alright. More than alright, actually.'])
      : c.op < -20 ? c.pick(['Honestly? Not really.', 'You\'ll have to work harder than that.']) : c.pick(['I don\'t know you that well yet.', 'Ask me again in a moon or two.']),
    opinion: 1 }) },
  { re: /\b(scared|afraid|frightened|nervous|worried|anxious)\b/i, fn: (c) => ({ reply: c.pick(['*presses against you* It\'s alright. You\'re not alone — the whole clan is here.', 'Being scared is fine. Being brave means doing it anyway.', 'Take a deep breath. Smell the forest. You\'re safe right now.', 'I get scared too. Especially during storms.']), opinion: 4, mood: 'neutral' }) },
  { re: /\b(sad|lonely|upset|cry|crying|miss)\b/i, fn: (c) => ({ reply: c.pick(['*sits beside you* Do you want to talk about it? Or I can just stay here.', 'Come here. *gently grooms your ear* It\'ll get better, I promise.', 'Everyone feels like that sometimes. You can always come to me.', 'Want to go watch the sunset from the Highrock? It always helps me.']), opinion: 5, mood: 'sad' }) },
  { re: /\b(happy|glad|excited|yay|great day|wonderful)\b/i, fn: (c) => ({ reply: c.pick(['*tail goes straight up* That makes me happy too!', 'Ha! Your good mood is catching!', 'Days like this are what StarClan made us for.']), opinion: 3, mood: 'happy' }) },
  { re: /\b(bored|boring|nothing to do)\b/i, fn: (c) => ({ reply: c.pick(['Bored? Let\'s play catch with a moss ball!', 'We could race to the Highrock! Or go hunting!', 'There are always ticks to pick off the elders… *grins*', 'Go smell some flowers. Or find a shiny stone! The kits love those.']), opinion: 2 }) },
  { re: /\b(tired|sleepy|sleep|nap|rest|yawn)\b/i, fn: (c) => ({ reply: c.pick(['*yawns* Don\'t make me yawn too!', 'A nap in a sunbeam sounds perfect right now.', c.g.time.isNight ? 'It\'s late. You should be in your nest.' : 'You should rest in your den for a bit.']), opinion: 1 }) },
  { re: /\b(story|tale|tell me about|legend|history)\b/i, fn: (c) => ({ reply: c.pick([
      'Long ago, the clans fought all the time. Then StarClan gave us the warrior code, and the Gatherings, so we could live in peace.',
      'The elders say a great storm once blew down half the forest. The clan sheltered together under the Highrock for three days.',
      'There was once a kit who got lost in the snow. A fox found her first — but then a warrior found the fox. *purrs* Happy ending.',
      'Ask the elders! They tell it better than me. Mostly because they add more badgers every time.']), opinion: 2 }) },
  { re: /\b(water|thirsty|drink|pool|waterfall|stream|river|pond)\b/i, fn: (c) => ({ reply: c.pick(['Thirsty? The camp pool is by the centre of camp. Or try the waterfall — the water is so cold!', 'In the morning there\'s dew on the grass. Every drop counts in a drought.', 'Never drink from a puddle near the Thunderpath. It tastes like monsters.']), opinion: 1 }) },
  { re: /\b(twolegs?|humans?|people|kittypets?|house|monster|thunderpath|road|tinkercat)\b/i, fn: (c) => ({ reply: c.pick(['Twolegs are strange. They walk on two legs and stare at glowing stones in their paws.', 'Kittypets! Soft, round, fed from little bowls… I couldn\'t live like that. Could you?', 'Stay away from the Thunderpath. Monsters don\'t stop for cats.', 'Sometimes Twolegs come with cages and take cats away. Never let them catch you.']), opinion: 1 }) },
  { re: /\b(flowers?|blossoms?|bees?|daisy|poppy|bluebell)\b/i, fn: (c) => ({ reply: c.pick(['I love the smell of bluebells in newleaf.', 'Watch out for bees around the flowers! I got stung on the nose once.', 'The cherry blossoms in rose-leaf are the prettiest thing in the forest.', 'Smelling flowers always calms me down.']), opinion: 2, mood: 'happy' }) },
  { re: /\b(dream|dreams|vision|prophecy|omen)\b/i, fn: (c) => ({ reply: c.cat.role === 'medicine' ? c.pick(['Dreams from StarClan are riddles. Tell me what you saw, and I\'ll try to read it.', 'I dreamed of stars falling into the river last night. I\'m still thinking about what it means.']) : c.pick(['I dreamed I could fly! Over the whole forest!', 'If StarClan sends you a dream, tell the medicine cat right away.', 'I don\'t remember my dreams. Lucky, maybe.']), opinion: 2 }) },
  { re: /\b(gathering|full moon|fourtrees|truce)\b/i, fn: (c) => ({ reply: c.pick(['At the Gathering there\'s a truce — no fighting, by the will of StarClan.', 'I love Gatherings! So much news, and so many new scents.', 'If clouds cover the moon at a Gathering, StarClan is angry.']), opinion: 1 }) },
  { re: /\b(clover|ashshade)\b/i, fn: (c) => ({ reply: c.cat.given === 'Clover' ? c.pick(['That\'s me! *purrs* Did you need something? Are you hurt?', 'Yes? Oh — you just wanted to say my name? You\'re sweet.']) : c.pick(['Clover Ashshade? She\'s the kindest healer in the forest.', 'Clover patched up my paw last moon. She never complains, not once.']), opinion: 2 }) },
  { re: /\b(yes|yeah|yep|sure|ok|okay|alright)\b/i, fn: (c) => ({ reply: c.pick(['Good! Then it\'s settled.', '*purrs* I knew you\'d agree.', 'Great. Let\'s go, then!', 'Mm-hm.']), opinion: 1 }) },
  { re: /\b(no|nope|nah|never)\b/i, fn: (c) => ({ reply: c.pick(['Oh. Alright then.', 'No? Hmph. Suit yourself.', 'Fine, fine. I won\'t push.', '*flicks an ear* Your loss.']), opinion: 0 }) },
  { re: /\b(lol|haha|hehe|lmao|xd|😂|🤣|😹)/i, fn: (c) => ({ reply: c.pick(['*purr-laughs* You\'re ridiculous.', 'Ha! What\'s so funny?', 'Heh. You\'re in a good mood today.']), opinion: 2, mood: 'happy' }) },
  { re: /(❤|💕|💖|😻|🥰)/, fn: (c) => ({ reply: c.op > 30 ? '*purrs and bumps your cheek*' : '*tilts head* …What does that mean?', opinion: 2, mood: 'happy' }) },
  { re: /\b(help|help me|need help|can you help)\b/i, fn: (c) => ({ reply: c.pick(['Of course. What do you need?', 'I\'ll help if I can. Hunting? Herbs? Something worse?', 'Ask the leader for a duty, or the medicine cat if you\'re hurt. I\'ll help however I can.']), opinion: 2 }) },
  { re: /\b(where|which way|how do i get|lost)\b/i, fn: (c) => ({ reply: c.pick(['Check your map (M) — and follow your nose.', 'Camp is the 🏠 on your compass. Head that way and you can\'t go wrong.', 'The waterfall? Follow the stream uphill and listen for the roar.']), opinion: 1 }) },
  { re: /\b(meow|mew|mrrp|purr|prr|nya)\b/i, fn: (c) => ({ reply: c.pick(['*mrrp!*', '*purrs back*', 'Mrow?', '*chirps happily*']), opinion: 2, mood: 'happy' }) },
  { re: /\?\s*$/, fn: (c) => ({ reply: has(c.cat, 'curious') ? c.pick(['Good question! I\'ve wondered that myself.', 'Hmm, I\'d have to think about that. What do you think?']) : has(c.cat, 'serious') ? c.pick(['That\'s not something I can answer.', 'Ask the leader.', 'Focus on your duties.']) : c.pick(['I\'m not sure, honestly.', 'Maybe the elders would know.', 'Who can say? StarClan, maybe.']), opinion: 1 }) },
];

export function localReply(g: Game, cat: Cat, text: string): ChatResult {
  const me = g.clan.player;
  const c: ChatCtx = { g, cat, me, text, op: g.clan.opinion(cat, me), pick: (a) => simRng.pick(a) };
  // first try to really understand the words (questions, names, how-to, follow-ups)
  const smart = smartReply(g, cat, text);
  if (smart) return smart;
  for (const r of RULES) if (r.re.test(text)) { const res = r.fn(c); res.reply = enrich(cat, me, res.reply, c.op); return res; }
  // fallback: personality-flavoured musing that echoes the player — plenty of variety
  const short = text.length > 40 ? text.slice(0, 40) + '…' : text;
  const emote = c.pick(['*nods slowly*', '*tilts head*', '*flicks an ear*', '*blinks*', '*twitches whiskers*', '*thinks for a moment*', '*tail curls thoughtfully*', '*hmms*']);
  const follow = c.pick(['What made you think of that?', 'Tell me more.', 'And then what?', 'Do you really think so?', 'Hm. I\'ll remember that.', 'You always surprise me.', 'Is that a Twoleg thing?', 'StarClan only knows.']);
  const reply = has(cat, 'shy') ? c.pick(['Oh... um. I see.', '...I don\'t really know what to say.', `${emote} …okay.`, 'M-maybe? I\'m not sure.'])
    : has(cat, 'serious') ? c.pick([`"${short}"? Hm. Is that all?`, 'Interesting. Now, don\'t you have duties?', `${emote} Noted.`, 'Words are fine. Deeds are better.'])
      : has(cat, 'playful', 'mischievous') ? c.pick([`"${short}" — ha! You say the strangest things.`, 'Heh, you\'re odd. I like it.', `${emote} Bet you can't say that three times fast!`, 'Ooh, mysterious. Race you to explain it!'])
        : has(cat, 'curious') ? c.pick(['Really? Tell me more!', 'I never thought of it like that.', `${emote} ${follow}`, 'Wait, wait — explain from the beginning!'])
          : has(cat, 'clumsy') ? c.pick(['Huh? Sorry, I was busy tripping over my own tail.', `${emote} Right! …What were we talking about?`])
            : has(cat, 'lazy') ? c.pick(['*yawns* Mm-hm. Fascinating.', `${emote} Can we talk about it lying down?`])
              : c.pick(['Mm, I see.', 'Is that so?', 'Hmm. Maybe you\'re right.', 'I\'ll think about that.', `${emote} ${follow}`, `${emote}`, `"${short}"… ${follow}`]);
  return { reply, opinion: 1 };
}

/** Relationship effect of the player's words (used even when the AI writes the reply). */
export function sentiment(text: string): number {
  if (/\b(stupid|dumb|idiot|mouse-?brain|hate you|ugly|shut up|traitor|coward|loser)\b/i.test(text)) return -8;
  if (/\b(sorry|apologi[sz]e|forgive)\b/i.test(text)) return 3;
  if (/\b(thank|love|friend|brave|smart|beautiful|kind|great|awesome|amazing|best)\b/i.test(text)) return 4;
  return 1;
}
