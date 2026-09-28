// Quests from famous cats of the books (classic lore mode).
import type { Game } from '../game';
import type { NpcAgent } from '../ai/npc';
import type { Objective } from './objectives';
import { displayName } from '../cats/types';

interface QuestDef {
  ask: string;                          // what the book cat says
  make: (g: Game, a: NpcAgent) => Partial<Objective> | null;
  end: string;                          // what they say when it's done
  choice?: { text: string; options: { label: string; then: string; opinion: number; rep?: number; leaderOpinion?: number }[] };
}

const lm = (g: Game, kind: string) => g.territories.landmarks.find((l) => l.kind === kind);

export const QUESTS: Record<string, QuestDef> = {
  Bluefur: {
    ask: 'Walk with me to Fourtrees, young one. There is something I must tell you under the Great Oaks.',
    make: (g) => ({ kind: 'visit', title: 'Walk with Bluestar to Fourtrees', desc: 'Travel to Fourtrees, where the four clans meet.', target: { x: g.territories.council.x, z: g.territories.council.z }, radius: 14, need: 1 }),
    end: 'StarClan once told me: "Fire alone can save our clan." I did not understand it then. Now I watch you, and I wonder…',
  },
  Tigerclaw: {
    ask: 'You. Meet me at the Training Hollow. Alone. I have… plans for this clan, and I need cats I can trust.',
    make: (g) => { const t = lm(g, 'trainingHollow'); return t ? { kind: 'visit', title: 'Meet Tigerclaw in secret', desc: 'Go to the Training Hollow. Tigerclaw is waiting.', target: { x: t.x, z: t.z }, radius: 8, need: 1 } : null; },
    end: 'Bluestar grows old and soft. One day this clan will need a stronger leader. When that day comes… will you stand with me?',
    choice: { text: 'What do you say to Tigerclaw?', options: [
      { label: 'I\'ll stand with you, Tigerclaw', then: 'Good. Remember this moment. I never forget my friends.', opinion: 15, rep: -5, leaderOpinion: -8 },
      { label: 'I\'m loyal to Bluestar', then: '*his amber eyes narrow* Then keep your mouth shut, if you know what\'s good for you.', opinion: -15, rep: 5, leaderOpinion: 10 },
    ] },
  },
  Spottedleaf: {
    ask: 'The medicine den is nearly empty, and leaf-bare is coming. Could you find me three herbs?',
    make: () => ({ kind: 'herbs', title: 'Herbs for Spottedleaf (3)', desc: 'Find three healing herbs and bring them to the medicine den.', need: 3 }),
    end: 'Thank you. StarClan sent me a sign last night… a fiery pelt. I think you and the clan will be safe.',
  },
  Graystripe: {
    ask: 'Psst! Come to the pond with me? I want to show you how to catch a fish — RiverClan isn\'t the only clan that can swim! Well… almost swim.',
    make: (g) => { const t = lm(g, 'pond'); return t ? { kind: 'visit', title: 'Go fishing with Graystripe', desc: `Meet Graystripe at ${t.name}.`, target: { x: t.x, z: t.z }, radius: 8, need: 1 } : null; },
    end: '*splash* Okay, so I fell in. Don\'t tell Sandstorm! Best day ever though, right?',
  },
  Sandstorm: {
    ask: 'Think you\'re a better hunter than me? Prove it. Bring two pieces of prey to the pile before sunset.',
    make: () => ({ kind: 'hunt', title: 'Out-hunt Sandstorm (2)', desc: 'Bring two pieces of prey to the fresh-kill pile.', need: 2 }),
    end: 'Hmph. Not bad. Not bad at all… for you. *flicks tail, secretly impressed*',
  },
  Ravenpaw: {
    ask: '*trembling* I-I saw something at the Sunning Rocks. Something terrible. Will you come with me? I can\'t go alone.',
    make: (g) => { const t = lm(g, 'sunRocks'); return t ? { kind: 'visit', title: 'Go with Ravenpaw to the Sunning Rocks', desc: `Ravenpaw is scared. Walk with him to ${t.name}.`, target: { x: t.x, z: t.z }, radius: 8, need: 1 } : null; },
    end: 'It was here. In the battle… Redtail didn\'t die fighting RiverClan. Tigerclaw killed him. I saw it! Please… don\'t tell anyone I told you.',
    choice: { text: 'What will you do with Ravenpaw\'s secret?', options: [
      { label: 'Your secret is safe with me', then: 'Thank you… you\'re a true friend.', opinion: 15 },
      { label: 'We have to tell Bluestar', then: 'M-maybe you\'re right. But what if she doesn\'t believe us?', opinion: 5, rep: 4, leaderOpinion: 6 },
    ] },
  },
  Yellowfang: {
    ask: 'Hmph. My joints ache like thunder. Fetch me two herbs, and maybe I\'ll tell you a story about ShadowClan… and Brokenstar.',
    make: () => ({ kind: 'herbs', title: 'Herbs for Yellowfang (2)', desc: 'Bring two herbs to the medicine den for Yellowfang\'s aching bones.', need: 2 }),
    end: 'Brokenstar… he was my son. No one knows that. He was cruel from the start, and I could not stop him. Keep that to yourself, young one.',
  },
  Longtail: {
    ask: 'The border scent is fading. Mark two border stones with me — and keep your eyes open for ShadowClan.',
    make: (g) => { const s = g.territories.landmarks.filter((l) => l.kind === 'borderStone').slice(0, 2); return s.length ? { kind: 'markBorder', title: 'Mark the border with Longtail (2)', desc: 'Renew the scent on two border stones.', need: 2, targets: s.map((x) => ({ x: x.x, z: x.z })), target: { x: s[0].x, z: s[0].z } } : null; },
    end: 'Good. Our border is strong. No one will cross it tonight.',
  },
  Dustpelt: {
    ask: 'The elders are complaining about their bedding again. Help me bring three clumps of moss?',
    make: () => ({ kind: 'moss', title: 'Moss for the elders with Dustpelt (3)', desc: 'Gather three clumps of moss and bring them to the elders\' den.', need: 3 }),
    end: 'Thanks. Don\'t tell Sandstorm I asked for help, alright?',
  },
  Lionheart: {
    ask: 'A true warrior protects those who cannot protect themselves. Bring prey for the elders and kits — two pieces.',
    make: () => ({ kind: 'hunt', title: 'Feed the clan for Lionheart (2)', desc: 'Bring two pieces of prey to the fresh-kill pile.', need: 2 }),
    end: 'You have the heart of a lion yourself. I\'m proud to call you clanmate.',
  },
  Whitestorm: {
    ask: 'Walk the camp with me. A warrior must know every den — the nursery, the elders\' den, the High Rock.',
    make: (g) => ({ kind: 'visit', title: 'Visit the nursery with Whitestorm', desc: 'Check on the queens and kits in the nursery.', target: { x: g.camp.dens.nursery.x, z: g.camp.dens.nursery.z }, radius: 3.5, need: 1 }),
    end: 'The kits are the future of our clan. Never forget why we fight.',
  },
  Mousefur: {
    ask: 'Some cats talk; some cats hunt. Bring one piece of prey to the pile, and then we\'ll talk.',
    make: () => ({ kind: 'hunt', title: 'Hunt for Mousefur (1)', desc: 'Bring a piece of prey to the fresh-kill pile.', need: 1 }),
    end: 'Hmph. You\'ll do.',
  },
  Halftail: {
    ask: 'Back in my day, apprentices brought the elders the plumpest mouse in the forest. Well? What are you waiting for?',
    make: () => ({ kind: 'hunt', title: 'A plump mouse for Halftail (1)', desc: 'Bring a piece of prey to the fresh-kill pile for the elders.', need: 1 }),
    end: '*munches* Mm! Now THAT is a mouse. Did I ever tell you how I lost half my tail? No? Well, it was a badger the size of a Twoleg monster…',
  },
  Darkstripe: {
    ask: '*low voice* Hey. Tigerclaw wants to know who in camp is loyal to him. Keep your ears open for me… and report back to the Training Hollow.',
    make: (g) => { const t = lm(g, 'trainingHollow'); return t ? { kind: 'visit', title: 'Report to Darkstripe', desc: 'Darkstripe wants you to meet him at the Training Hollow.', target: { x: t.x, z: t.z }, radius: 8, need: 1 } : null; },
    end: 'So? Who have you heard whispering?',
    choice: { text: 'Do you spy for Darkstripe?', options: [
      { label: 'I heard nothing', then: 'Useless. Tigerclaw will hear about this.', opinion: -8, rep: 2 },
      { label: 'I won\'t spy on my clanmates', then: '*hisses* You\'ll regret that.', opinion: -12, rep: 5, leaderOpinion: 5 },
    ] },
  },
};

export class Quests {
  constructor(private game: Game) {}

  available(a: NpcAgent): boolean {
    const c = a.cat;
    const g = this.game;
    return !!c.bookId && !c.questGiven && !!QUESTS[c.bookId] && !g.clan.player.exiled && !g.objectives.list.some((o) => o.data?.questOf);
  }

  offer(a: NpcAgent, done: () => void) {
    const g = this.game;
    const q = QUESTS[a.cat.bookId!];
    g.ui.dialog({ speaker: a.cat, text: q.ask, options: [
      { label: 'I\'ll do it ★', action: () => {
        const o = q.make(g, a);
        if (!o) { g.ui.dialog({ speaker: a.cat, text: 'Hmm… another time.', options: [{ label: 'Goodbye', action: done }], onClose: done }); return; }
        a.cat.questGiven = true;
        g.objectives.add({ id: `quest-${a.cat.bookId}`, giver: a.cat.id, reward: { rep: 5, opinion: 10 }, ...o, data: { ...(o.data ?? {}), questOf: a.cat.id } } as Objective);
        g.objectives.focus(`quest-${a.cat.bookId}`);
        done();
      } },
      { label: 'Not right now', action: done },
    ], onClose: done });
  }

  /** Called when a quest objective is completed. */
  complete(o: Objective) {
    const g = this.game;
    const c = g.clan.get(o.data.questOf);
    if (!c || !c.bookId) return;
    const q = QUESTS[c.bookId];
    const pc = g.clan.player;
    g.clan.remember(pc, `I helped ${displayName(c)}.`, 4, c.id);
    const after = () => {
      if (!q.choice) return;
      g.ui.choice(q.choice.text, '', q.choice.options.map((opt) => ({ label: opt.label, action: () => {
        g.clan.adjust(c, pc, opt.opinion);
        if (opt.rep) pc.reputation = Math.max(-100, Math.min(100, pc.reputation + opt.rep));
        const leader = g.clan.leader;
        if (opt.leaderOpinion && leader && !leader.isPlayer) g.clan.adjust(leader, pc, opt.leaderOpinion);
        g.ui.dialog({ speaker: c, text: opt.then, options: [{ label: 'Goodbye', action: () => {} }] });
      } })));
    };
    setTimeout(() => g.ui.dialog({ speaker: c, text: q.end, options: [{ label: q.choice ? 'Continue' : '…', action: after }], onClose: () => {} }), 400);
  }
}
