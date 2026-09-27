// Vercel serverless function: lets clan cats reply to the player's free text
// using Claude. Optional — the game falls back to its built-in reply engine
// whenever this endpoint is missing, unconfigured or fails.
import Anthropic from '@anthropic-ai/sdk';

declare const process: { env: Record<string, string | undefined> };

const client = new Anthropic();

const SYSTEM = `You are voicing a cat in a cozy forest clan life game (a fan tribute to warrior-cat stories).
Stay fully in character as the cat described below. You are a cat: you know nothing of humans' world except "Twolegs", their "Thunderpaths" and "monsters".
Reply with ONE short spoken line (at most 2 sentences, under 40 words), optionally with a brief action in *asterisks*.
Let the cat's personality, rank, age and feelings toward the player shape the reply. Keep it kid-friendly: no gore, no graphic injuries.
Never mention being an AI, a model, or a game. Never use lists or markdown other than *actions*.`;

interface Body {
  persona: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  message: string;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'not configured' }); return; }
  let body: Body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: 'bad json' }); return;
  }
  const message = String(body?.message ?? '').slice(0, 240).trim();
  const persona = String(body?.persona ?? '').slice(0, 2000);
  if (!message) { res.status(400).json({ error: 'empty' }); return; }
  // keep an alternating, user-first history of the last few lines
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-8)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 300) }));
  while (history.length && history[0].role !== 'user') history.shift();
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history) {
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) continue;
    messages.push(m);
  }
  if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
  messages.push({ role: 'user', content: message });

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: `${SYSTEM}\n\n${persona}`,
      messages,
    });
    if (response.stop_reason === 'refusal') { res.status(200).json({ reply: null }); return; }
    const reply = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
      .slice(0, 400);
    res.status(200).json({ reply: reply || null });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) res.status(429).json({ error: 'rate limited' });
    else if (err instanceof Anthropic.APIError) res.status(502).json({ error: `api ${err.status}` });
    else res.status(500).json({ error: 'failed' });
  }
}
