// Playable training: lessons with a mentor (as an apprentice) and teaching
// your own apprentice (as a mentor). Every lesson is an in-world activity.
import type { Game } from '../game';
import type { Objective } from './objectives';
import type { NpcAgent } from '../ai/npc';
import { Cat, LESSONS, LESSON_LABEL, Lesson, displayName } from '../cats/types';
import { simRng } from '../core/rng';
import { dist2 } from '../core/math';
import type { Fighter } from '../player/combat';
import { isClassic } from '../lore';

const QUIZ: { q: string; a: string[]; correct: number }[] = [
  { q: 'A kit wanders toward the border. What do you do?', a: ['Bring them safely back to camp', 'Let them learn the hard way', 'Tell someone later, maybe'], correct: 0 },
  { q: 'You catch a plump vole while hungry on patrol. What now?', a: ['Eat it quickly — nobody will know', 'Carry it back to the fresh-kill pile', 'Hide it under a root for later'], correct: 1 },
  { q: 'A cat from another clan lies hurt on our side of the border.', a: ['Chase them off at once', 'Secretly bring them prey', 'Tell the Warden and let them decide'], correct: 2 },
  { q: 'The Warden orders you to rest while your friends patrol.', a: ['Obey and rest', 'Sneak out to join them', 'Argue loudly in front of the clan'], correct: 0 },
  { q: 'Who eats first when prey is scarce?', a: ['The strongest warriors', 'Kits, queens and elders', 'Whoever caught it'], correct: 1 },
  { q: 'You scent a dog near the Tallfolk dens.', a: ['Go closer to see how big it is', 'Fight it alone to prove yourself', 'Keep clear and warn the clan'], correct: 2 },
  { q: 'Why do we renew the border markers?', a: ['So every clan knows where our land ends', 'To make the whole forest smell like us', 'Only because we are told to'], correct: 0 },
  { q: 'A rival apprentice insults you at the Gathering.', a: ['Fight them right there', 'Keep the truce and walk away', 'Insult them back, louder'], correct: 1 },
];

export class TrainingSystem {
  lastLessonHour = -99;
  lastMentorHour = -99;
  constructor(private game: Game) {}

  canOfferLesson(): boolean {
    const g = this.game;
    const p = g.clan.player;
    const h = g.time.hour;
    return !!p && p.stage === 'apprentice' && p.role !== 'medicineApprentice' && !g.objectives.busy() && g.time.totalHours - this.lastLessonHour > 7 && h > 6.5 && h < 19;
  }

  nextLesson(c: Cat): Lesson {
    const sorted = LESSONS.slice().sort((a, b) => c.training[a] - c.training[b] + simRng.range(-0.3, 0.3));
    return sorted[0];
  }

  offerLesson(mentor: NpcAgent) {
    const g = this.game;
    const p = g.clan.player;
    const lesson = this.nextLesson(p);
    const intro: Record<Lesson, string> = {
      hunting: 'Today you hunt. Crouch low, creep close, then gather your strength and pounce. I\'ll be watching.',
      tracking: 'A warrior hunts with the nose first. Taste the air — find the scent, follow it, and make the catch.',
      fighting: 'Battle training. Show me what you\'ve got — claws sheathed, but don\'t hold back!',
      exploring: 'You need to know every stone of our territory. Follow the trail and lead me to the place I name.',
      territory: 'Border duty. We\'ll renew the scent markers so every clan knows where our land ends.',
      rules: 'Sit. Today we speak of the clan code — the rules that keep us alive.',
    };
    g.ui.dialog({
      speaker: mentor.cat,
      text: `${intro[lesson]}`,
      options: [
        { label: `Begin the ${LESSON_LABEL[lesson].toLowerCase()} lesson`, action: () => this.startLesson(lesson, mentor) },
        { label: 'Not now (disobey your mentor)', action: () => {
          g.clan.adjust(mentor.cat, p, -6, { text: `${p.given} refused to train with me.`, weight: -2 });
          g.clan.infraction('obeyOrders', [mentor.id], 'refused training');
          this.lastLessonHour = g.time.totalHours - 4;
          mentor.activity = 'idle';
        } },
      ],
    });
  }

  startLesson(lesson: Lesson, mentor: NpcAgent) {
    const g = this.game;
    const p = g.player;
    const base: Objective = {
      id: 'lesson', kind: 'lesson', title: `Lesson: ${LESSON_LABEL[lesson]}`, desc: '', need: 1, giver: mentor.id, order: true,
      data: { lesson, mentor: mentor.id }, reward: { rep: 2, lesson, opinion: 6 }, deadline: g.time.totalHours + 10,
    };
    this.follow(mentor);
    switch (lesson) {
      case 'hunting':
        base.desc = `Catch any prey while ${mentor.name} watches. Crouch (C), hold Space to gather a pounce, release to leap.`;
        break;
      case 'tracking':
        base.desc = 'Sniff (Q) to find a prey scent trail, follow it and make a catch.';
        base.data.sniffed = false;
        break;
      case 'fighting':
        base.desc = `Spar with ${mentor.name}. Swipe (Left click / F), heavy pounce (Right click / R), dodge (Space). Watch for their wind-up!`;
        mentor.activity = 'idle';
        setTimeout(() => g.combat.engage(mentor, g.player, true), 1200);
        mentor.say('Ready? Defend yourself!', 3);
        break;
      case 'exploring': {
        const lms = g.territories.landmarks.filter((l) => l.home && l.kind !== 'borderStone' && l.kind !== 'trainingHollow');
        const undiscovered = lms.filter((l) => !g.discoveries.has('lm:' + l.id));
        const lm = simRng.pick(undiscovered.length ? undiscovered : lms);
        base.desc = `Lead ${mentor.name} to ${lm.name}. Follow the marker on your compass.`;
        base.target = { x: lm.x, z: lm.z };
        base.data.target = { x: lm.x, z: lm.z };
        base.title = `Lesson: Find ${lm.name}`;
        break;
      }
      case 'territory': {
        const stones = g.territories.landmarks.filter((l) => l.kind === 'borderStone');
        stones.sort((a, b) => dist2(a.x, a.z, p.pos.x, p.pos.z) - dist2(b.x, b.z, p.pos.x, p.pos.z));
        const picks = [stones[0], stones[1]];
        base.kind = 'lesson';
        base.targets = picks.map((s) => ({ x: s.x, z: s.z }));
        base.target = { x: picks[0].x, z: picks[0].z };
        base.need = 2;
        base.desc = 'Visit two border markers and renew the scent (walk up to each marker).';
        break;
      }
      case 'rules':
        this.quiz(mentor, (score) => {
          g.ui.toast(`You answered ${score} of 3 correctly.`, score >= 2 ? 'good' : 'info');
          if (score >= 2) g.objectives.complete('lesson');
          else { mentor.say('We\'ll go over it again another day.', 3); g.objectives.fail('lesson', true); this.lastLessonHour = g.time.totalHours; this.release(mentor); }
        });
        break;
    }
    g.objectives.add(base);
  }

  private follow(a: NpcAgent) {
    this.game.npcs.endConvo(a);
    a.patrol = null;
    a.activity = 'follow';
    a.followTarget = 'player';
  }

  release(a: NpcAgent | undefined) {
    if (!a) return;
    if (a.activity === 'follow' || a.activity === 'fight') {
      this.game.combat.disengage(a);
      a.activity = 'idle';
      a.followTarget = null;
      a.userSpar = false;
    }
  }

  private quiz(mentor: NpcAgent, done: (score: number) => void) {
    const g = this.game;
    const qs = simRng.shuffle(QUIZ.slice()).slice(0, 3);
    let score = 0, i = 0;
    const ask = () => {
      if (i >= qs.length) { done(score); return; }
      const q = qs[i++];
      g.ui.dialog({
        speaker: mentor.cat,
        text: q.q,
        options: q.a.map((a, idx) => ({ label: a, action: () => {
          if (idx === q.correct) { score++; mentor.say('Good.', 1.5); } else mentor.say('No... think harder.', 2);
          setTimeout(ask, 250);
        } })),
      });
    };
    ask();
  }

  updateLesson(o: Objective) {
    const g = this.game;
    const p = g.player.pos;
    const lesson: Lesson = o.data?.lesson;
    const teacherId = o.kind === 'lesson' ? o.data.mentor : o.targetId;
    const partner = g.npcs.agents.get(teacherId);
    if (!partner) { g.objectives.fail(o.id, true); return; }
    if (lesson === 'fighting') {
      const fighting = partner.activity === 'fight';
      if (partner.hp < partner.maxHp * 0.3) { this.sparWon(partner); return; }
      if (!fighting && o.data.started) { g.objectives.complete(o.id); this.release(partner); }
      if (fighting) o.data.started = true;
      return;
    }
    if (partner.activity !== 'follow' && partner.activity !== 'fight') this.follow(partner);
    if (lesson === 'exploring' && o.data.target) {
      if (dist2(p.x, p.z, o.data.target.x, o.data.target.z) < 7) {
        if (dist2(partner.pos.x, partner.pos.z, p.x, p.z) < 25) g.objectives.complete(o.id);
        else if (simRng.chance(0.01)) g.ui.toast('Wait for your companion to catch up.', 'info');
      }
    }
    if (lesson === 'territory' && o.targets) {
      o.targets.forEach((t, i) => {
        if (!t.done && dist2(p.x, p.z, t.x, t.z) < 3.5) {
          t.done = true;
          o.progress = (o.progress ?? 0) + 1;
          g.clan.borderSafety = Math.min(100, g.clan.borderSafety + 10);
          g.ui.toast(`You renew the scent marker (${o.progress}/${o.need}).`, 'objective');
          g.audio.sniff();
          const next = o.targets!.find((x) => !x.done);
          if (next) o.target = { x: next.x, z: next.z };
          if (o.progress! >= o.need) g.objectives.complete(o.id);
          void i;
        }
      });
    }
  }

  sparLost(by: Fighter) {
    const g = this.game;
    const o = g.objectives.get('lesson') ?? g.objectives.get('mentor');
    const a = g.npcs.agents.get(by.id);
    a?.say(simRng.pick(['Not bad! But keep your guard up.', 'You\'re learning. Again tomorrow.', 'Ha! Watch my shoulders next time.']), 3);
    this.release(a);
    if (o) {
      g.clan.player.skills.fighting += 1;
      g.objectives.complete(o.id);
    }
  }

  sparWon(a: NpcAgent) {
    const g = this.game;
    a.say(simRng.pick(['Enough! Well fought!', 'You got me! Impressive.', 'I yield — good work!']), 3);
    a.cat.health = Math.max(a.cat.health, 40);
    this.release(a);
    g.clan.player.skills.fighting += 3;
    g.clan.adjust(a.cat, g.clan.player, 5);
    const o = g.objectives.get('lesson') ?? g.objectives.get('mentor');
    if (o) g.objectives.complete(o.id);
  }

  lessonComplete(o: Objective) {
    const g = this.game;
    const lesson: Lesson = o.data?.lesson;
    this.lastLessonHour = g.time.totalHours;
    if (o.kind === 'lesson') {
      const p = g.clan.player;
      p.training[lesson] = Math.min(3, p.training[lesson] + 1);
      const sk = { hunting: 'hunting', tracking: 'tracking', fighting: 'fighting', exploring: 'knowledge', territory: 'knowledge', rules: 'knowledge' } as const;
      (p.skills as any)[sk[lesson]] = Math.min(99, (p.skills as any)[sk[lesson]] + 5);
      const m = g.npcs.agents.get(o.data.mentor);
      this.release(m);
      m?.say(simRng.pick(['Well done. You\'re getting there.', 'Good work today.', 'That\'s how a warrior does it.']), 3);
      g.ui.toast(`Training: ${LESSON_LABEL[lesson]} ${p.training[lesson]}/3`, 'good');
      g.clan.log(`Completed a ${LESSON_LABEL[lesson].toLowerCase()} lesson with ${m ? m.name : 'my mentor'}.`, 'memory');
      if (this.readyForWarrior(p) && p.age >= 12) this.offerAssessment();
    } else {
      // mentoring
      const ap = g.npcs.agents.get(o.targetId ?? '');
      if (ap) {
        const c = ap.cat;
        c.training[lesson] = Math.min(3, c.training[lesson] + 1);
        c.skills.hunting += lesson === 'hunting' ? 4 : 1;
        c.skills.fighting += lesson === 'fighting' ? 4 : 1;
        c.skills.tracking += lesson === 'tracking' ? 4 : 0.5;
        g.clan.adjust(c, g.clan.player, 6, { text: `${g.clan.player.given} taught me ${LESSON_LABEL[lesson].toLowerCase()}.`, weight: 2 });
        this.release(ap);
        ap.say(simRng.pick(['Thank you! I learned so much!', 'Can we do that again tomorrow?', 'I think I\'m getting it!']), 3);
        g.ui.toast(`${ap.cat.given}'s training: ${LESSON_LABEL[lesson]} ${c.training[lesson]}/3`, 'good');
        g.clan.player.reputation = Math.min(100, g.clan.player.reputation + 2);
        if (this.readyForWarrior(c) && c.age >= 12) g.ui.toast(`${c.given} is ready for their warrior ceremony. Tell the Warden!`, 'objective');
      }
      this.lastMentorHour = g.time.totalHours;
    }
  }

  readyForWarrior(c: Cat) {
    return LESSONS.every((l) => c.training[l] >= 1) && LESSONS.reduce((s, l) => s + c.training[l], 0) >= 9;
  }

  offerAssessment() {
    const g = this.game;
    const p = g.clan.player;
    if (g.objectives.has('assessment') || p.stage !== 'apprentice') return;
    const mentor = g.clan.get(p.mentor);
    g.objectives.add({
      id: 'assessment', kind: 'assessment', title: 'Warrior assessment', need: 2, giver: mentor?.id,
      desc: `${mentor ? displayName(mentor) : 'Your mentor'} says you are ready. Hunt alone and bring two pieces of prey to the fresh-kill pile to earn your warrior name.`,
      reward: { rep: 5 },
    });
  }

  assessmentComplete() {
    const g = this.game;
    const p = g.clan.player;
    const classic = isClassic();
    const opts = g.clan.epithetChoices(p).map((e) => (classic ? p.given + e.toLowerCase() : e));
    g.ui.nameChoice(
      'Your warrior ceremony',
      `The clan gathers beneath the High Rock. ${g.clan.leader ? displayName(g.clan.leader) : 'The Warden'} asks what name the Long Meadow whispers for you. Your name will be "${p.given}${classic ? '' : ' '}___".`,
      opts,
      (name) => {
        let epithet = name;
        if (classic) {
          const low = name.toLowerCase();
          epithet = low.startsWith(p.given.toLowerCase()) ? low.slice(p.given.length) : low;
          if (!epithet) epithet = 'heart';
        }
        g.clan.warriorCeremony(p, epithet);
      },
    );
  }

  // ------------------------------------------------------------ mentoring
  mentorOptions(ap: NpcAgent): { label: string; action: () => void }[] {
    const g = this.game;
    const c = ap.cat;
    const busy = g.objectives.busy();
    const opts: { label: string; action: () => void }[] = [];
    if (busy) return opts;
    for (const l of LESSONS) {
      opts.push({ label: `Teach ${LESSON_LABEL[l].toLowerCase()} (${c.training[l]}/3)`, action: () => this.startMentorLesson(l, ap) });
    }
    return opts;
  }

  startMentorLesson(lesson: Lesson, ap: NpcAgent) {
    const g = this.game;
    const p = g.player;
    const o: Objective = {
      id: 'mentor', kind: 'mentor', title: `Teach ${ap.cat.given}: ${LESSON_LABEL[lesson]}`, desc: '', need: 1, targetId: ap.id,
      data: { lesson }, deadline: g.time.totalHours + 10,
    };
    this.follow(ap);
    switch (lesson) {
      case 'hunting': o.desc = `Make a catch while ${ap.cat.given} watches closely (stay within 20 paces).`; break;
      case 'tracking': o.desc = `Sniff (Q) for prey scent with ${ap.cat.given}, then follow it and catch it.`; o.data.sniffed = false; break;
      case 'fighting':
        o.desc = `Spar with ${ap.cat.given}. Go easy — or don't!`;
        ap.activity = 'idle';
        setTimeout(() => g.combat.engage(ap, g.player, true), 1000);
        break;
      case 'exploring': {
        const lms = g.territories.landmarks.filter((l) => l.home && l.kind !== 'borderStone');
        const lm = simRng.pick(lms);
        o.desc = `Show ${ap.cat.given} the way to ${lm.name}.`;
        o.data.target = { x: lm.x, z: lm.z };
        o.target = { x: lm.x, z: lm.z };
        break;
      }
      case 'territory': {
        const stones = g.territories.landmarks.filter((l) => l.kind === 'borderStone').sort((a, b) => dist2(a.x, a.z, p.pos.x, p.pos.z) - dist2(b.x, b.z, p.pos.x, p.pos.z));
        o.targets = [stones[0], stones[1]].map((s) => ({ x: s.x, z: s.z }));
        o.target = { ...o.targets[0] };
        o.need = 2;
        o.desc = `Renew two border markers with ${ap.cat.given}.`;
        break;
      }
      case 'rules':
        g.ui.dialog({
          speaker: ap.cat,
          text: 'What part of the code matters most, mentor?',
          options: [
            { label: '"Loyalty to the clan above all."', action: () => { ap.cat.pers.loyalty = Math.min(1, ap.cat.pers.loyalty + 0.1); g.objectives.complete('mentor'); } },
            { label: '"Protect the weak — kits, elders, the sick."', action: () => { ap.cat.pers.kindness = Math.min(1, ap.cat.pers.kindness + 0.1); g.objectives.complete('mentor'); } },
            { label: '"Be brave. Never back down."', action: () => { ap.cat.pers.bravery = Math.min(1, ap.cat.pers.bravery + 0.1); ap.cat.pers.aggression = Math.min(1, ap.cat.pers.aggression + 0.05); g.objectives.complete('mentor'); } },
            { label: '"Think for yourself. Rules can bend."', action: () => { ap.cat.pers.mischief = Math.min(1, ap.cat.pers.mischief + 0.1); ap.cat.pers.loyalty = Math.max(0, ap.cat.pers.loyalty - 0.05); g.objectives.complete('mentor'); } },
          ],
        });
        break;
    }
    g.objectives.add(o);
  }
}
