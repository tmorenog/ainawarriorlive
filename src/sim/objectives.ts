// Objectives / duties. Orders from the Warden, Second or a mentor are
// "orders": ignoring them breaks the clan code.
import type { Game } from '../game';
import type { Patrol } from './clan';
import type { Lesson } from '../cats/types';
import { dist2 } from '../core/math';
import { displayName } from '../cats/types';

export type ObjKind = 'hunt' | 'moss' | 'herbs' | 'patrol' | 'lesson' | 'rescue' | 'escort' | 'drive' | 'visit' | 'assessment' | 'markBorder' | 'mentor' | 'free' | 'confined';

export interface Objective {
  id: string;
  kind: ObjKind;
  title: string;
  desc: string;
  giver?: string;
  target?: { x: number; z: number };
  targets?: { x: number; z: number; done?: boolean }[];
  targetId?: string;
  radius?: number;
  progress?: number;
  need: number;
  deadline?: number; // totalHours
  order?: boolean;
  reward?: { rep?: number; lesson?: Lesson; apprenticeLesson?: Lesson; opinion?: number };
  data?: any;
}

export class Objectives {
  list: Objective[] = [];
  constructor(private game: Game) {}

  get primary(): Objective | undefined { return this.list[0]; }
  has(id: string) { return this.list.some((o) => o.id === id); }
  get(id: string) { return this.list.find((o) => o.id === id); }
  busy() { return this.list.some((o) => o.order || o.kind === 'lesson' || o.kind === 'patrol' || o.kind === 'assessment'); }

  add(o: Objective) {
    if (this.has(o.id)) this.list = this.list.filter((x) => x.id !== o.id);
    o.progress = o.progress ?? 0;
    // urgent objectives first
    if (['rescue', 'drive', 'escort', 'lesson', 'assessment'].includes(o.kind)) this.list.unshift(o);
    else this.list.push(o);
    this.game.ui.toast(`New objective: ${o.title}`, 'objective');
    this.game.audio.chime();
  }

  complete(id: string) {
    const o = this.get(id);
    if (!o) return;
    this.list = this.list.filter((x) => x.id !== id);
    const game = this.game;
    const p = game.clan.player;
    if (o.reward?.rep) p.reputation = Math.min(100, p.reputation + o.reward.rep * (o.order ? 2 : 1.5));
    if (o.order && p.infractions > 0) { p.infractions--; game.ui.toast('Your hard work makes up for past mistakes.', 'good'); }
    const giver = game.clan.get(o.giver);
    if (giver) game.clan.adjust(giver, p, o.reward?.opinion ?? 6, o.order ? { text: `${p.given} did as I asked.`, weight: 1 } : undefined);
    game.ui.toast(`✔ ${o.title}`, 'good');
    game.audio.success();
    if (o.data?.medLesson) game.training.medLessonComplete(o);
    else if (o.kind === 'lesson' || o.kind === 'mentor') game.training.lessonComplete(o);
    if (o.kind === 'assessment' || o.data?.medAssess) game.training.assessmentComplete();
    if (o.data?.questOf) game.quests.complete(o);
    if (o.data?.companion) this.releaseCompanion(o, true);
    if (o.id === 'punish-ticks') {
      for (const c of game.clan.home()) if (c.stage === 'elder') game.clan.adjust(c, p, 3);
      game.ui.toast('Mouse bile stinks! But the elders purr with relief.', 'good');
    }
  }

  /** A clanmate who was doing something with you goes back to their own business. */
  private releaseCompanion(o: Objective, success: boolean) {
    const a = this.game.npcs.agents.get(o.data.companion);
    if (!a) return;
    if (a.activity === 'follow') { a.activity = 'idle'; a.actTimer = 0; a.followTarget = null; }
    a.say(success ? ['That was fun! Thanks, I\'m not bored anymore.', 'Best day in moons!', 'We make a good team!'][Math.floor(Math.random() * 3)] : 'Oh well. Maybe another time.', 3);
  }

  fail(id: string, silent = false) {
    const o = this.get(id);
    if (!o) return;
    this.list = this.list.filter((x) => x.id !== id);
    if (o.kind === 'lesson' && o.data?.mentor) this.game.training.release(this.game.npcs.agents.get(o.data.mentor));
    if (o.data?.companion) this.releaseCompanion(o, false);
    if (silent) return;
    const game = this.game;
    game.ui.toast(`✘ ${o.title} — failed`, 'danger');
    if (o.order) {
      const w = o.giver ? [o.giver] : [];
      game.clan.infraction('obeyOrders', w, o.title);
      const giver = game.clan.get(o.giver);
      if (giver) game.clan.adjust(giver, game.clan.player, -8, { text: `${game.clan.player.given} ignored my orders.`, weight: -3 });
    }
  }

  abandon(id: string) {
    const o = this.get(id);
    if (!o) return;
    if (o.order) this.fail(id);
    else this.list = this.list.filter((x) => x.id !== id);
  }

  /** Move an objective to the front (shown in HUD). */
  focus(id: string) {
    const o = this.get(id);
    if (!o) return;
    this.list = [o, ...this.list.filter((x) => x !== o)];
  }

  // ------------------------------------------------------------ hooks
  onCatch(kind: string) {
    for (const o of [...this.list]) {
      if (o.kind === 'lesson' && o.data?.arrived !== false && (o.data?.lesson === 'hunting' || (o.data?.lesson === 'tracking' && o.data?.sniffed))) this.bump(o);
      if (o.kind === 'mentor' && (o.data?.lesson === 'hunting' || (o.data?.lesson === 'tracking' && o.data?.sniffed))) {
        const ap = this.game.npcs.agents.get(o.targetId ?? '');
        if (ap && dist2(ap.pos.x, ap.pos.z, this.game.player.pos.x, this.game.player.pos.z) < 20) this.bump(o);
        else this.game.ui.toast('Your apprentice was too far away to learn anything.', 'info');
      }
    }
    void kind;
  }
  onDeliverPrey(n: number) {
    for (const o of [...this.list]) if (o.kind === 'hunt' || o.kind === 'assessment') this.bump(o, n);
  }
  onMoss(n: number) {
    for (const o of [...this.list]) if (o.kind === 'moss') this.bump(o, n);
  }
  onHerbs(n: number) {
    for (const o of [...this.list]) if (o.kind === 'herbs') this.bump(o, n);
  }
  onSniff(labels: string[]) {
    for (const o of this.list) if ((o.kind === 'lesson' || o.kind === 'mentor') && o.data?.lesson === 'tracking' && labels.length) {
      if (!o.data.sniffed) this.game.ui.toast('Good — now follow the scent and catch it.', 'info');
      o.data.sniffed = true;
    }
  }
  onDiscover(landmarkId: string) {
    for (const o of [...this.list]) if (o.kind === 'visit' && o.data?.landmark === landmarkId) this.bump(o);
  }
  onMarkBorder(idx: number) {
    for (const o of [...this.list]) {
      if (o.kind !== 'markBorder' || !o.targets) continue;
      const t = o.targets[idx];
      if (t && !t.done) { t.done = true; this.bump(o); }
    }
  }
  patrolFinished(p: Patrol) {
    const o = this.get('patrol:' + p.id);
    if (!o) return;
    const d = dist2(this.game.player.pos.x, this.game.player.pos.z, 0, 0);
    if (o.data?.joined && d < 40) this.complete(o.id);
    else this.fail(o.id);
  }
  joinPatrol(p: Patrol) {
    const leader = this.game.clan.get(p.leaderId);
    const org = this.game.clan.deputy ?? this.game.clan.leader;
    this.add({
      id: 'patrol:' + p.id,
      kind: 'patrol',
      title: p.kind === 'hunt' ? 'Join the hunting patrol' : 'Join the border patrol',
      desc: `${org ? displayName(org) : 'The Second'} assigned you to ${leader ? displayName(leader) + "'s" : 'a'} ${p.kind === 'hunt' ? 'hunting' : 'border'} patrol. Meet them at the camp entrance and stay with them.`,
      target: { x: 0, z: 22 },
      giver: org?.id,
      order: true,
      need: 1,
      data: { patrolId: p.id, joined: false },
      reward: { rep: 4, lesson: p.kind === 'border' ? 'territory' : undefined },
      deadline: this.game.time.totalHours + 8,
    });
  }

  private bump(o: Objective, n = 1) {
    o.progress = (o.progress ?? 0) + n;
    if (o.progress >= o.need) this.complete(o.id);
    else this.game.ui.toast(`${o.title}: ${o.progress}/${o.need}`, 'objective');
  }

  // ------------------------------------------------------------ per-frame
  update() {
    const game = this.game;
    const p = game.player.pos;
    const now = game.time.totalHours;
    for (const o of [...this.list]) {
      if (o.deadline !== undefined && now > o.deadline) {
        // orders get one extension before they count as disobeying
        if (o.order && !o.data?.extended) {
          o.data = { ...(o.data ?? {}), extended: true };
          o.deadline = now + 24;
          const giver = game.clan.get(o.giver);
          game.ui.toast(`${giver ? displayName(giver) : 'Your clanmates'} gives you more time: "${o.title}" — no rush, just get it done.`, 'objective');
        } else {
          this.fail(o.id, !o.order);
          continue;
        }
      }
      if (o.data?.follow) {
        const fa = game.npcs.agents.get(o.data.follow);
        if (fa) o.target = { x: fa.pos.x, z: fa.pos.z };
      }
      switch (o.kind) {
        case 'visit':
          if (o.target && dist2(p.x, p.z, o.target.x, o.target.z) < (o.radius ?? 6)) this.bump(o);
          break;
        case 'patrol': {
          const pat = game.clan.patrols.find((x) => x.id === o.data.patrolId);
          if (!pat) { this.fail(o.id, true); break; }
          const leader = game.npcs.agents.get(pat.leaderId);
          if (leader) o.target = { x: leader.pos.x, z: leader.pos.z };
          if (leader && dist2(p.x, p.z, leader.pos.x, leader.pos.z) < 12) o.data.joined = true;
          break;
        }
        case 'rescue': {
          const a = game.npcs.agents.get(o.targetId ?? '');
          if (!a) { this.fail(o.id, true); break; }
          o.target = a.activity === 'follow' ? { x: 0, z: 5 } : { x: a.pos.x, z: a.pos.z };
          break;
        }
        case 'drive': {
          const c = game.creatures.get(o.targetId ?? '');
          if (!c) { this.fail(o.id, true); break; }
          o.target = { x: c.pos.x, z: c.pos.z };
          break;
        }
        case 'escort': {
          const safe = game.npcs.evacuate;
          if (!safe) { this.fail(o.id, true); break; }
          o.target = safe;
          const followers = [...game.npcs.agents.values()].filter((a) => a.activity === 'follow' && a.followTarget === 'player');
          if (dist2(p.x, p.z, safe.x, safe.z) < 12 && followers.length) {
            for (const f of followers) {
              f.activity = 'flee';
              f.followTarget = null;
              f.setTarget(safe.x, safe.z);
              game.clan.adjust(f.cat, game.clan.player, 25, { text: `${game.clan.player.given} led me out of the fire.`, weight: 8 });
            }
            this.bump(o, followers.length);
          }
          break;
        }
        case 'lesson':
        case 'mentor':
          game.training.updateLesson(o);
          break;
        case 'markBorder':
          (o.targets ?? []).forEach((t, i) => {
            if (!t.done && dist2(p.x, p.z, t.x, t.z) < 3.5) {
              game.clan.borderSafety = Math.min(100, game.clan.borderSafety + 10);
              game.audio.sniff();
              this.onMarkBorder(i);
              const next = o.targets!.find((x) => !x.done);
              if (next) o.target = { x: next.x, z: next.z };
            }
          });
          break;
      }
    }
  }

  serialize() { return this.list.filter((o) => ['hunt', 'moss', 'herbs', 'assessment', 'visit', 'free', 'confined', 'markBorder'].includes(o.kind)); }
  load(list: Objective[]) { this.list = list ?? []; }
}
