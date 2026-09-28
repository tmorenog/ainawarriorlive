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
    return !!p && p.stage === 'apprentice' && !g.objectives.busy() && g.time.totalHours - this.lastLessonHour > 7 && h > 6.5 && h < 19;
  }

  nextLesson(c: Cat): Lesson {
    const sorted = LESSONS.slice().sort((a, b) => c.training[a] - c.training[b] + simRng.range(-0.3, 0.3));
    return sorted[0];
  }

  offerLesson(mentor: NpcAgent) {
    const g = this.game;
    const p = g.clan.player;
    if (p.role === 'medicineApprentice') { this.offerMedLesson(mentor); return; }
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

  /** A good open spot inside the territory for a lesson. */
  private lessonSpot(minR: number, maxR: number): { x: number; z: number } {
    const g = this.game;
    for (let i = 0; i < 40; i++) {
      const a = simRng.range(0, Math.PI * 2), r = simRng.range(minR, maxR);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = g.terrain.sample(x, z);
      if (s.river > 0.05 || s.lake > 0.05 || s.stream > 0.2 || s.h < g.chunks.waterLevel + 0.3) continue;
      if (g.territories.ownerAt(x, z) !== 'home') continue;
      return { x, z };
    }
    return { x: 0, z: 40 };
  }

  startLesson(lesson: Lesson, mentor: NpcAgent) {
    const g = this.game;
    const p = g.player;
    const base: Objective = {
      id: 'lesson', kind: 'lesson', title: `Follow ${mentor.name}`, desc: '', need: 1, giver: mentor.id, order: true,
      data: { lesson, mentor: mentor.id, arrived: false }, reward: { rep: 2, lesson, opinion: 6 }, deadline: g.time.totalHours + 12,
    };
    const lead = (route: { x: number; z: number }[], where: string, onArrive: () => void, onWaypoint?: (i: number) => void) => {
      base.desc = `${mentor.name} is leading you to ${where}. Stay close — they'll wait if you fall behind.`;
      g.npcs.startLead(mentor, route, () => { base.data.arrived = true; onArrive(); }, onWaypoint);
      mentor.say(simRng.pick(['Follow me.', 'This way. Keep up!', 'Come on, stay close.']), 3);
    };
    const arriveText = (title: string, desc: string) => {
      const o = g.objectives.get('lesson');
      if (!o) return;
      o.title = title;
      o.desc = desc;
      g.ui.toast(`${title}: ${desc}`, 'objective');
    };
    switch (lesson) {
      case 'hunting':
      case 'tracking': {
        const spot = this.lessonSpot(45, 95);
        if (lesson === 'tracking') base.data.sniffed = false;
        lead([spot], 'good hunting ground', () => {
          this.watch(mentor);
          mentor.say(lesson === 'hunting' ? 'Here. The prey runs well here. Show me your hunter\'s crouch.' : 'Now — taste the air. What do you smell?', 4);
          arriveText(`Lesson: ${LESSON_LABEL[lesson]}`, lesson === 'hunting'
            ? `Catch any prey while ${mentor.name} watches. Crouch (C), hold Space to gather a pounce, release to leap.`
            : 'Sniff (Q) to find a prey scent trail, follow it and make a catch.');
        });
        break;
      }
      case 'fighting': {
        const th = g.territories.landmarks.find((l) => l.kind === 'trainingHollow')!;
        lead([{ x: th.x, z: th.z }], 'the training hollow', () => {
          arriveText('Lesson: Fighting', `Spar with ${mentor.name}. Swipe (Left click / F), heavy pounce (Right click / R), dodge (Space). Watch for their wind-up!`);
          mentor.activity = 'idle';
          mentor.say('Ready? Defend yourself!', 3);
          setTimeout(() => g.combat.engage(mentor, g.player, true), 1500);
        });
        break;
      }
      case 'exploring': {
        const lms = g.territories.landmarks.filter((l) => l.home && l.kind !== 'borderStone' && l.kind !== 'trainingHollow');
        const undiscovered = lms.filter((l) => !g.discoveries.has('lm:' + l.id));
        const lm = simRng.pick(undiscovered.length ? undiscovered : lms);
        const ll = Math.hypot(lm.x, lm.z) || 1;
        const off = lm.radius + 2.5;
        lead([{ x: lm.x - (lm.x / ll) * off, z: lm.z - (lm.z / ll) * off }], lm.name, () => {
          mentor.say(`This is ${lm.name}. Remember the way — every warrior must know it.`, 5);
          g.objectives.complete('lesson');
        });
        break;
      }
      case 'territory': {
        const stones = g.territories.landmarks.filter((l) => l.kind === 'borderStone');
        stones.sort((a, b) => dist2(a.x, a.z, p.pos.x, p.pos.z) - dist2(b.x, b.z, p.pos.x, p.pos.z));
        const picks = [stones[0], stones[1]].map((st) => ({ x: st.x * 0.96, z: st.z * 0.96 }));
        base.need = 2;
        lead(picks, 'the border', () => { g.objectives.complete('lesson'); }, (i) => {
          const o = g.objectives.get('lesson');
          if (!o) return;
          o.progress = i + 1;
          g.clan.borderSafety = Math.min(100, g.clan.borderSafety + 10);
          g.audio.sniff();
          mentor.say(i === 0 ? 'Smell that? Our scent is fading. Mark it with me.' : 'Good. Now every clan knows where our land ends.', 4);
          g.ui.toast(`You renew the scent marker with ${mentor.name} (${i + 1}/2).`, 'objective');
        });
        break;
      }
      case 'rules':
        base.title = 'Lesson: Clan code';
        this.quiz(mentor, (score) => {
          g.ui.toast(`You answered ${score} of 3 correctly.`, score >= 2 ? 'good' : 'info');
          if (score >= 2) g.objectives.complete('lesson');
          else { mentor.say('We\'ll go over it again another day.', 3); g.objectives.fail('lesson', true); this.lastLessonHour = g.time.totalHours; this.release(mentor); }
        });
        break;
    }
    g.objectives.add(base);
  }

  /** The mentor sits and watches the apprentice work. */
  private watch(a: NpcAgent) {
    a.activity = 'watch';
    a.actTimer = 999;
    a.target = null;
    a.userLessonWatch = true;
  }

  private follow(a: NpcAgent) {
    this.game.npcs.endConvo(a);
    a.patrol = null;
    a.activity = 'follow';
    a.followTarget = 'player';
  }

  release(a: NpcAgent | undefined) {
    if (!a) return;
    if (a.activity === 'follow' || a.activity === 'fight' || a.activity === 'lead' || a.userLessonWatch) {
      a.userLessonWatch = false;
      a.userLead = undefined;
      a.actTimer = 0;
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
    if (o.kind === 'lesson') {
      // the mentor leads; the objective marker points at them until you arrive
      if (!o.data.arrived) {
        o.target = { x: partner.pos.x, z: partner.pos.z };
      } else if (partner.userLessonWatch) {
        partner.heading = Math.atan2(p.z - partner.pos.z, p.x - partner.pos.x);
        if (dist2(p.x, p.z, partner.pos.x, partner.pos.z) > 45 && simRng.chance(0.005)) g.ui.toast(`Stay where ${partner.name} can see you!`, 'info');
      }
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
    if (p.role === 'medicineApprentice') {
      g.objectives.add({
        id: 'assessment', kind: 'herbs', title: 'Medicine cat assessment', need: 3, giver: mentor?.id, data: { medAssess: true },
        desc: `${mentor ? displayName(mentor) : 'Your mentor'} says you are ready. Gather three healing herbs on your own and bring them to the medicine den to earn your full name.`,
        reward: { rep: 5 },
      });
      return;
    }
    g.objectives.add({
      id: 'assessment', kind: 'assessment', title: 'Warrior assessment', need: 2, giver: mentor?.id,
      desc: `${mentor ? displayName(mentor) : 'Your mentor'} says you are ready. Hunt alone and bring two pieces of prey to the fresh-kill pile to earn your warrior name.`,
      reward: { rep: 5 },
    });
  }

  assessmentComplete() {
    const g = this.game;
    const p = g.clan.player;
    const classic = true; void isClassic;
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

  // ------------------------------------------------------------ medicine cat path
  // Medicine lessons count toward the same training record (two skills each).
  static MED_LESSONS: Record<'gather' | 'treat' | 'herblore', [Lesson, Lesson]> = {
    gather: ['hunting', 'tracking'],
    treat: ['fighting', 'exploring'],
    herblore: ['rules', 'territory'],
  };

  offerMedLesson(mentor: NpcAgent) {
    const g = this.game;
    const p = g.clan.player;
    const kinds = Object.keys(TrainingSystem.MED_LESSONS) as ('gather' | 'treat' | 'herblore')[];
    const score = (k: typeof kinds[number]) => TrainingSystem.MED_LESSONS[k].reduce((s, l) => s + p.training[l], 0) + simRng.range(0, 0.5);
    const lesson = kinds.sort((a, b) => score(a) - score(b))[0];
    const intro = {
      gather: 'A medicine cat must know where every herb grows. Find two healing herbs and bring them back to our den. Use your nose — sniff for them.',
      treat: 'Today you treat a clanmate yourself. Find a cat who is hurt or sick and tend to them. I\'ll be watching your paws.',
      herblore: 'Sit. Let\'s see how well you know your herbs.',
    }[lesson];
    g.ui.dialog({
      speaker: mentor.cat,
      text: intro,
      options: [
        { label: 'Begin the lesson', action: () => this.startMedLesson(lesson, mentor) },
        { label: 'Not now (disobey your mentor)', action: () => {
          g.clan.adjust(mentor.cat, p, -6, { text: `${p.given} refused to learn from me.`, weight: -2 });
          g.clan.infraction('obeyOrders', [mentor.id], 'refused a lesson');
          this.lastLessonHour = g.time.totalHours - 4;
          mentor.activity = 'idle';
        } },
      ],
    });
  }

  startMedLesson(lesson: 'gather' | 'treat' | 'herblore', mentor: NpcAgent) {
    const g = this.game;
    const base = { id: 'lesson', giver: mentor.id, order: true, deadline: g.time.totalHours + 12, reward: { rep: 2, opinion: 6 }, data: { medLesson: lesson, mentor: mentor.id } };
    mentor.activity = 'idle';
    if (lesson === 'gather') {
      g.objectives.add({ ...base, kind: 'herbs', title: 'Medicine lesson: gather herbs', desc: 'Find two healing herbs (sniff with Q) and bring them to the medicine den.', need: 2 });
    } else if (lesson === 'treat') {
      let patient = g.clan.home(false).find((c) => (c.injury > 10 || c.sick > 10) && c.id !== mentor.id);
      if (!patient) {
        patient = simRng.pick(g.clan.home(false).filter((c) => c.stage === 'warrior' && c.id !== mentor.id));
        if (patient) {
          patient.injury = Math.max(patient.injury, 30);
          g.npcs.agents.get(patient.id)?.say('Ow! I\'ve got a thorn stuck in my pad.', 4);
        }
      }
      g.objectives.add({ ...base, kind: 'free', title: 'Medicine lesson: treat a clanmate', desc: `Talk to a hurt or sick cat and choose "Treat". ${patient ? displayName(patient) + ' needs help.' : ''}`, need: 1, targetId: patient?.id });
    } else {
      const QS: { q: string; a: string[]; correct: number }[] = [
        { q: 'Which herb do we use for wounds?', a: ['Silverleaf', 'Deathberries', 'Sunpetal'], correct: 0 },
        { q: 'A cat has a fever and a cough. What do you give them?', a: ['Bitterroot', 'Sunpetal', 'Moss'], correct: 1 },
        { q: 'A kit has eaten deathberries! What do you do?', a: ['Let them sleep it off', 'Make them eat yarrow so they retch it up', 'Give them more berries'], correct: 1 },
        { q: 'Which herb fights sickness spreading in camp?', a: ['Bitterroot', 'Silverleaf', 'Fern'], correct: 0 },
        { q: 'What do we press on a bleeding wound?', a: ['Mud', 'Cobweb', 'Feathers'], correct: 1 },
        { q: 'Where do deathberries grow?', a: ['On dark bushes in the forest', 'In the river', 'Only in Twoleg gardens'], correct: 0 },
      ];
      const qs = simRng.shuffle(QS.slice()).slice(0, 3);
      let score = 0, i = 0;
      const ask = () => {
        if (i >= qs.length) {
          g.ui.toast(`You answered ${score} of 3 correctly.`, score >= 2 ? 'good' : 'info');
          if (score >= 2) { g.objectives.add({ ...base, kind: 'free', title: 'Medicine lesson: herb lore', desc: '', need: 1 }); g.objectives.complete('lesson'); }
          else { mentor.say('Study your herbs and we\'ll try again.', 3); this.lastLessonHour = g.time.totalHours; }
          return;
        }
        const q = qs[i++];
        g.ui.dialog({ speaker: mentor.cat, text: q.q, options: q.a.map((a, idx) => ({ label: a, action: () => {
          if (idx === q.correct) { score++; mentor.say('Good.', 1.5); } else mentor.say('No — think again next time.', 2);
          setTimeout(ask, 250);
        } })) });
      };
      ask();
    }
  }

  /** Medicine cats don't hunt to progress: gathering herbs and healing is their training. */
  medProgress(kind: 'gather' | 'treat' | 'herblore') {
    const g = this.game;
    const p = g.clan.player;
    p.skills.healing = Math.min(99, p.skills.healing + 3);
    p.reputation = Math.min(100, p.reputation + 1);
    if (p.role !== 'medicineApprentice' || p.stage !== 'apprentice') return;
    const [a, b] = TrainingSystem.MED_LESSONS[kind];
    const l = p.training[a] <= p.training[b] ? a : b;
    if (p.training[l] >= 3) return;
    p.training[l] += 1;
    const label = { gather: 'Gathering herbs', treat: 'Treating the sick', herblore: 'Herb lore' }[kind];
    g.ui.toast(`Medicine training: ${label} (${LESSONS.reduce((s2, x) => s2 + p.training[x], 0)}/18)`, 'good');
    if (this.readyForWarrior(p) && p.age >= 12) this.offerAssessment();
  }

  medLessonComplete(o: Objective) {
    const g = this.game;
    const p = g.clan.player;
    const lesson = o.data.medLesson as 'gather' | 'treat' | 'herblore';
    this.lastLessonHour = g.time.totalHours;
    for (const l of TrainingSystem.MED_LESSONS[lesson]) p.training[l] = Math.min(3, p.training[l] + 1);
    p.skills.healing = Math.min(99, p.skills.healing + 6);
    const m = g.npcs.agents.get(o.data.mentor);
    m?.say(simRng.pick(['Well done. You have a healer\'s paws.', 'Good. StarClan guides you.', 'You\'re learning quickly.']), 3);
    const label = { gather: 'Gathering herbs', treat: 'Treating the sick', herblore: 'Herb lore' }[lesson];
    g.ui.toast(`Medicine training: ${label} (${LESSONS.reduce((s, l) => s + p.training[l], 0)}/18)`, 'good');
    g.clan.log(`Completed a medicine lesson: ${label.toLowerCase()}.`, 'memory');
    if (this.readyForWarrior(p) && p.age >= 12) this.offerAssessment();
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
