// Client side of free-text conversations. Tries the optional /api/chat Claude
// endpoint (deployed on Vercel with ANTHROPIC_API_KEY); otherwise, or on any
// error, uses the built-in reply engine so talking always works.
import type { Game } from '../game';
import { Cat, displayName, roleLabel } from '../cats/types';
import { relLabel, isFamily } from './social';
import { loreText } from '../lore';

let aiAvailable: boolean | null = null; // null = unknown yet
const histories = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

export function chatHistory(catId: string) {
  let h = histories.get(catId);
  if (!h) { h = []; histories.set(catId, h); }
  return h;
}

function persona(g: Game, c: Cat): string {
  const me = g.clan.player;
  const r = c.relations[me.id];
  const rel = relLabel(r, isFamily(c, me), c.mate === me.id);
  const mem = c.memories.filter((m) => m.about === me.id).slice(-3).map((m) => m.text).join(' ');
  const leader = g.clan.leader;
  return loreText([
    `Your name: ${displayName(c)} (${c.sex === 'tom' ? 'tom' : 'she-cat'}, ${Math.floor(c.age)} moons old), ${roleLabel(c)} of ${g.territories.homeName}.`,
    `Personality: ${c.traits.join(', ')}. Looks: ${c.app.pattern} ${c.app.fur}-furred.`,
    `Health: ${c.sick > 30 ? 'sick' : c.injury > 30 ? 'injured' : 'well'}; hunger: ${c.hunger < 35 ? 'hungry' : 'fed'}.`,
    c.mate ? `Your mate: ${displayName(g.clan.get(c.mate)!)}.` : '',
    `Leader: ${leader ? displayName(leader) : 'none'}. Rival clans: ${g.territories.rivals.map((x) => x.name).join(', ')}.`,
    `It is ${g.time.label().toLowerCase()} in ${g.time.season}; weather: ${g.weatherLabel()}. Recent clan news: ${g.clan.lastRecent || 'nothing special'}.`,
    `You are talking to ${displayName(me)}, a ${me.sex === 'tom' ? 'tom' : 'she-cat'} ${roleLabel(me).toLowerCase()} aged ${Math.floor(me.age)} moons. Your relationship: ${rel} (opinion ${Math.round(r?.opinion ?? 0)} on a -100..100 scale).`,
    mem ? `You remember about them: ${mem}` : '',
  ].filter(Boolean).join('\n'));
}

/** Returns an AI reply, or null to use the built-in engine. */
export async function aiReply(g: Game, c: Cat, text: string): Promise<string | null> {
  if (aiAvailable === false || !g.settings.aiChat) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: persona(g, c), history: chatHistory(c.id), message: text }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 404 || res.status === 503 || res.status === 405) { aiAvailable = false; return null; }
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) { aiAvailable = false; return null; }
    if (!res.ok) return null;
    const data = await res.json();
    aiAvailable = true;
    return typeof data.reply === 'string' && data.reply.trim() ? data.reply.trim() : null;
  } catch {
    return null;
  }
}
