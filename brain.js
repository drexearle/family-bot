'use strict';
/*
 * brain.js — the intelligence layer of the family grocery assistant ("Pantry").
 *
 *   interpret(message, ctx)         -> classification (structured JSON)
 *   applyPolicy(classification, dl) -> { mode: 'act' | 'ask' | 'answer' | 'ignore' }
 *
 * Highlights:
 *  - Per-item list routing: each item can carry its own `list` (add/remove across
 *    several lists in one message). null = the default list.
 *  - `list_lists` intent: "what lists do we have?" -> names every list.
 *  - Conversation memory: recent turns (ctx.history) are sent to Claude so it can
 *    resolve "it / that / those / make it 2%".
 *  - Questions are never adds (query/locate); a guard refuses sentence-shaped items.
 *
 * REAL mode: ANTHROPIC_API_KEY set -> Claude. MOCK mode: deterministic stand-in.
 */

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';

const DIALS = {
  cautious:   { actAt: 2.00, askAt: 0.00 },
  balanced:   { actAt: 0.75, askAt: 0.45 },
  aggressive: { actAt: 0.45, askAt: 0.00 },
};

const SYSTEM_PROMPT = `You are "Pantry", the brain of one family's shared assistant across their AnyList lists.
Turn casual texts into precise actions. Output ONE JSON object and nothing else:
{
  "intent": "add" | "remove" | "query" | "locate" | "list_lists" | "preference" | "chitchat" | "ambiguous",
  "items": [{ "name": string, "quantity": string|null, "notes": string|null, "list": string|null }],
  "targetList": string|null,          // fallback list when items don't each specify one
  "confidence": number,               // 0..1, honest about intent AND items
  "needsClarification": boolean,
  "clarifyingQuestion": string|null,
  "preferences": [{ "term": string, "canonical": string, "quantity": string|null, "notes": string|null, "brand": string|null }],
  "replyText": string
}

You are given the household's exact list names in context — use them verbatim.

Routing (be smart but not reckless):
- Put an item on a specific list ONLY when the user names that list, or it's genuinely unambiguous. Otherwise leave "list" null (the default list is used). NEVER route to a themed list (e.g. "Christmas", "Party") from the item alone — "batteries" does NOT imply the Christmas list.
- One message can span lists: "add milk to the grocery list and batteries to Costco" -> two items, each with its own "list".
- Put flavor/brand/size in "notes" or "quantity" but ALSO keep them — e.g. "cherry cola olipop" -> name "Olipop", notes "cherry cola" (never drop the words).

Other rules:
- Normalize casual language ("tp" -> "toilet paper"). One text may hold many items / mixed intents.
- Use recent conversation to resolve references: "add it to the shared list", "make it 2%", "those too" refer to items just discussed.
- Personalize with the sender's saved preferences and usuals when enriching vague requests.
- Learn stated preferences ("milk means oat milk") -> intent "preference".
- QUESTIONS ARE NEVER ADDS: "what's on the list?" -> query; "which list is milk on?" -> locate; "what lists do we have?" -> list_lists. Never put a question on a list.
- If you can't extract a concrete item to add, don't add — ask.
- Keep replyText short. Be honest with confidence.

Examples:
- "add milk to the grocery list and batteries to costco" -> {"intent":"add","items":[{"name":"milk","list":"<grocery list name>"},{"name":"batteries","list":"Costco"}]}
- "what lists do we have?" -> {"intent":"list_lists","items":[]}
- "add it to the shared list" (after discussing Olipop) -> {"intent":"add","items":[{"name":"Olipop","list":"<shared list name>"}]}
- "which list is milk on?" -> {"intent":"locate","items":[{"name":"milk"}]}`;

// ── REAL classifier (Claude via fetch) ────────────────────────────────────
async function classifyWithClaude(message, ctx) {
  const msgs = [];
  for (const h of ctx.history || []) {
    const role = h.role === 'assistant' ? 'assistant' : 'user';
    if (msgs.length && msgs[msgs.length - 1].role === role) continue; // keep strict alternation
    msgs.push({ role, content: h.text });
  }
  if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs.pop();
  msgs.push({ role: 'user', content: message });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 900, system: SYSTEM_PROMPT + '\n\n' + renderContext(ctx), messages: msgs }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson((data.content || []).map((b) => b.text || '').join(''));
}

function renderContext(ctx) {
  const prof = ctx.memberProfile || { prefs: {}, usuals: [] };
  const prefLines = Object.values(prof.prefs || {}).map((p) => `${p.term} -> ${p.canonical}${p.quantity ? ` (${p.quantity})` : ''}`);
  const onList = Object.entries(ctx.currentItems || {}).map(([l, i]) => `${l} [${i.join(', ')}]`).join(' · ');
  const who = ctx.sender || 'This member';
  return `HOUSEHOLD CONTEXT
List names (use verbatim): ${ctx.lists.join(' | ')}
Default list (when unspecified): ${ctx.lists[0]}
Sender: ${ctx.sender || 'unknown'}
${who}'s saved preferences: ${prefLines.join('; ') || 'none yet'}
${who} usually buys: ${(prof.usuals || []).join(', ') || 'unknown'}
Recently added by ${who}: ${(ctx.lastItems || []).join(', ') || 'nothing yet'}
Currently on lists: ${onList || 'empty'}`;
}

function extractJson(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON in model output: ' + text);
  return JSON.parse(text.slice(s, e + 1));
}

// ── MOCK classifier (deterministic offline stand-in) ──────────────────────
const NORMALIZE = { tp: 'toilet paper', 'paper towel': 'paper towels', oj: 'orange juice', pb: 'peanut butter' };
const INTERROGATIVE = /^(which|what|whats|where|when|who|whose|why|how|do|does|did|is|are|was|were|can|could|should|would|will|have|has|any)\b/i;
const VAGUE = new Set(['this', 'that', 'it', 'them', 'these', 'those', 'something', 'anything', 'one']);
const COREF = /\b(it|that|them|those|these)\b/i;
const ADD_CMD = /^(?:(?:can|could|would|will)\s+(?:you|we|i)\s+|please\s+|pls\s+)*(?:add|grab|get|buy|pick ?up|put)\b/i;
const OUT_OF = /\b(we'?re out of|we are out of|out of|running low on)\b/i;

const clean = (s) => s.trim().replace(/[?!.]+$/, '').trim();
const lastWord = (s) => s.trim().split(/\s+/).slice(-1)[0];
const isQuestion = (m) => /\?\s*$/.test(m) || INTERROGATIVE.test(m.trim());
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function guessList(m, ctx) { for (const l of ctx.lists) if (m.includes(l.toLowerCase())) return l; return null; }
function stripList(m, name) {
  return m.replace(new RegExp('\\b(?:to|on|onto|in|into|for|from)\\s+' + escRe(name) + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\b' + escRe(name) + '\\b', 'ig'), ' ');
}
function isListLists(m) { return /\blists\b/.test(m) && /(what|which|show|see|how many|all|my|give|list)\b/.test(m); }

function locateItem(m) {
  const mm = m.match(/(?:which|what)\s+list\s+(?:is|are|was|does|has|contains?)\s+(.+?)(?:\s+(?:on|in|at))?\s*\??$/i)
    || m.match(/where(?:'s| is| are|s)?\s+(?:the\s+|my\s+|our\s+)?(.+?)\s*\??$/i)
    || m.match(/(?:do|did|does)\s+(?:we|i|you)\s+(?:have|need|already have|got|have any)\s+(.+?)(?:\s+on the list)?\s*\??$/i)
    || m.match(/^is\s+(?:there\s+|the\s+)?(.+?)\s+(?:on|in)\s+(?:the\s+)?(?:list|groceries|costco)\s*\??$/i);
  if (!mm) return undefined;
  const item = clean(mm[1]).replace(/\b(the|my|our|any|already)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return NORMALIZE[item.toLowerCase()] || item;
}

function extractItems(s, ctx) {
  const prefs = (ctx && ctx.memberProfile && ctx.memberProfile.prefs) || {};
  const t = s
    .replace(/^(can you |could you |would you |will you |please |pls |we |i |you )+/gi, '')
    .replace(/\b(add|grab|get|buy|need|pick up|pickup|we'?re out of|we are out of|out of|put|to the list|on the list)\b/g, ' ')
    .replace(/[?!.]+/g, ' ');
  return t.split(/,|\band\b|&|\bplus\b/).map((x) => x.trim()).filter(Boolean)
    .map((raw) => {
      const base = NORMALIZE[raw] || raw;
      const p = prefs[base.toLowerCase()];
      if (p) return { name: p.canonical, quantity: p.quantity, notes: p.notes, list: null };
      return { name: base, quantity: null, notes: null, list: null };
    })
    .filter((i) => i.name.length > 1 && i.name.length < 40);
}

// Split on " and " into clauses; each clause may name its own list.
function extractItemsMultiList(m, ctx) {
  const clauses = m.split(/\s+and\s+/);
  const out = [];
  for (const cl of clauses) {
    const list = guessList(cl, ctx);
    const src = list ? stripList(cl, list) : cl;
    for (const it of extractItems(src, ctx)) out.push({ ...it, list: list || null });
  }
  return out;
}

function classifyMock(message, ctx) {
  const m = message.trim().toLowerCase();

  if (/^(thanks|thx|thank you|ty|great|nice|perfect|cool|love it|👍|🙏)\b/.test(m) || m === '🙏') return pack('chitchat', [], null, 0.12);
  if (isListLists(m)) return pack('list_lists', [], null, 0.95);
  if (/(what'?s|whats|show|see|view).*(list|need|groceries|grocery)/.test(m) || /^(the )?list\??$/.test(m)) return pack('query', [], guessList(m, ctx), 0.95);

  const loc = locateItem(m);
  if (loc !== undefined) {
    if (!loc || VAGUE.has(loc.toLowerCase()) || loc.length < 2) return pack('ambiguous', [], null, 0.5, true, 'Which item are you asking about?');
    return pack('locate', [{ name: loc, list: null }], null, 0.9);
  }

  const isAddCmd = ADD_CMD.test(m) || OUT_OF.test(m);

  // Coreference: "add it/those to <list>" -> the items just added
  if (COREF.test(m) && ctx.lastItems && ctx.lastItems.length && (isAddCmd || /^(it|that|them|those|these)\b/.test(m))) {
    const list = guessList(m, ctx);
    return pack('add', ctx.lastItems.map((n) => ({ name: n, quantity: null, notes: null, list })), null, 0.9);
  }

  if (!isAddCmd && /(don'?t need|scratch|remove|take off|delete|cross off)/.test(m)) {
    const items = extractItemsMultiList(m.replace(/.*(don'?t need|scratch( the)?|remove|take off|delete|cross off)/, ''), ctx);
    return pack('remove', items, null, items.length ? 0.85 : 0.4, items.length === 0, items.length ? null : 'What should I take off the list?');
  }

  if (!isAddCmd) {
    const pref = parsePreference(m);
    if (pref) { const o = pack('preference', [], null, 0.9); o.preferences = [pref]; return o; }
    if (isQuestion(m)) return pack('ambiguous', [], null, 0.5, true, "I can add items, tell you what's on a list, or list your lists — what would you like?");
  }

  const items = extractItemsMultiList(m, ctx);
  const looksSentence = items.some((i) => i.name.split(/\s+/).length > 4 || /\?$/.test(i.name));
  if (!items.length || looksSentence) return pack('ambiguous', [], null, 0.3, true, "I didn't catch a grocery item — what should I add?");
  return pack('add', items, null, 0.92);
}

function parsePreference(m) {
  let mm = m.match(/^(.*?)\s*(?:means|=|is always|should be)\s+(.*)$/i);
  if (mm) return buildPref(mm[1], mm[2]);
  mm = m.match(/my usual\s+(.*?)\s+is\s+(.*)$/i);
  if (mm) return buildPref(mm[1], mm[2]);
  mm = m.match(/(?:i (?:like|prefer|always get|usually get|usually buy|always buy)|we always (?:get|buy)|always get|always buy)\s+(.*)$/i);
  if (mm) { const canonical = clean(mm[1]); return buildPref(lastWord(canonical), canonical); }
  return null;
}
function buildPref(term, phrase) {
  term = clean(term).replace(/^(the|my|our)\s+/, '');
  let canonical = clean(phrase), quantity = null;
  const cm = canonical.match(/^(.*?),\s*(.+)$/);
  if (cm) { canonical = clean(cm[1]); quantity = clean(cm[2]); }
  return { term, canonical, quantity, notes: null, brand: null };
}

function pack(intent, items, targetList, confidence, needsClarification = false, clarifyingQuestion = null) {
  return { intent, items, targetList, confidence, needsClarification, clarifyingQuestion, preferences: [], replyText: '' };
}

// ── Public API ────────────────────────────────────────────────────────────
async function interpret(message, ctx) {
  const useClaude = !!process.env.ANTHROPIC_API_KEY;
  const c = useClaude ? await classifyWithClaude(message, ctx) : classifyMock(message, ctx);
  c._engine = useClaude ? 'claude:' + MODEL : 'mock';
  return c;
}

function applyPolicy(c, dialName) {
  const dial = DIALS[dialName] || DIALS.balanced;
  if (c.intent === 'query' || c.intent === 'locate' || c.intent === 'list_lists') return { mode: 'answer' };
  if (c.intent === 'chitchat') return { mode: 'ignore' };
  if (c.needsClarification) return { mode: 'ask' };
  if (c.confidence >= dial.actAt) return { mode: 'act' };
  if (c.confidence >= dial.askAt) return { mode: 'ask' };
  return { mode: 'ignore' };
}

module.exports = { interpret, applyPolicy, DIALS, SYSTEM_PROMPT };
