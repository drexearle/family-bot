'use strict';
/*
 * conversation.js — the shared, transport-agnostic conversation handler.
 * Used by the simulator, the SMS server, AND the web console (identical behavior).
 *
 * Adds: conversation history per sender (for coreference like "it"/"that"),
 * per-item list routing (one message can touch several lists), and a
 * `list_lists` reply. STOP/HELP, undo, USUAL, pending clarifications, offered
 * nudges, preference learning, and item location are all still here.
 */
const { interpret, applyPolicy } = require('./brain');
const { MemoryStore } = require('./memory');
const { computeSuggestions } = require('./suggestions');

const STOP_RE = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i;
const START_RE = /^(start|unstop|resume)$/i;
const HELP_RE = /^(help|info)$/i;
const UNDO_RE = /^(undo|nvm|never ?mind)$/i;
const USUAL_RE = /^(?:(?:add|get|grab)\s+)?(?:the\s+|my\s+)?usuals?$/i;
const AFFIRM_RE = /^(yes|yep|yeah|yea|ok|okay|sure|do it|please do)$/i;

const NUDGE_COOLDOWN_MS = 6 * 3600 * 1000;
const OFFER_TTL_MS = 30 * 60 * 1000;
const HISTORY_MAX = 12;

function createConversation({ store, lists, preferences = {}, dial = 'balanced', resolveMember, memory, nudges = true, defaultList: defaultListOpt }) {
  memory = memory || new MemoryStore();
  const pending = {};
  const offered = {};
  const lastNudgeAt = {};
  const lastActions = {};
  const lastItems = {};      // sender -> [names] most recently added (for "add it/those")
  const history = {};        // sender -> [{ role, text }] recent turns (for coreference)
  const optedOut = new Set();

  const push = (s, e) => (lastActions[s] ||= []).push(e);
  const display = (it) => it.name + (it.quantity ? ` (${it.quantity})` : '') + (it.notes ? ` — ${it.notes}` : '');
  const currentLower = () => new Set(lists.flatMap((l) => store.getItems(l)).map((s) => s.toLowerCase()));
  const canonList = (name) => (name ? lists.find((l) => l.toLowerCase() === String(name).toLowerCase()) || null : null);
  // Default list when the user doesn't name one: explicit DEFAULT_LIST -> a "grocery" list -> first list.
  // (Prevents defaulting to whatever list happens to be first, e.g. "Christmas".)
  const defaultList = canonList(defaultListOpt) || lists.find((l) => /grocer/i.test(l)) || lists[0];

  // Group items by their resolved (real) list; unknown/unspecified -> default.
  const groupByList = (items, fallback) => {
    const g = new Map();
    for (const it of items) {
      const l = canonList(it.list) || canonList(fallback) || defaultList;
      (g.get(l) || g.set(l, []).get(l)).push(it);
    }
    return g;
  };

  async function act(sender, c) {
    if (c.intent === 'clear') {
      const list = canonList(c.targetList) || defaultList;
      const undos = [];
      for (const name of store.getItems(list)) { const r = await store.removeItem(list, name); if (r.removed) undos.push(r.undo); }
      if (undos.length) push(sender, { label: `Restored ${undos.length} item(s) to ${list}`, undo: async () => { for (const u of undos) await u(); } });
      return `🧹 Cleared ${undos.length} item(s) from ${list} · reply UNDO`;
    }

    const groups = groupByList(c.items, c.targetList);
    const undos = [];

    if (c.intent === 'remove') {
      const parts = [], readd = [];
      for (const [l, items] of groups) {
        const removed = [];
        for (const it of items) { const r = await store.removeItem(l, it.name); if (r.removed) { removed.push(it.name); undos.push(r.undo); } }
        if (removed.length) { parts.push(`${removed.join(', ')} from ${l}`); readd.push(`${removed.join(', ')} to ${l}`); }
      }
      if (undos.length) push(sender, { label: `Re-added ${readd.join('; ')}`, undo: async () => { for (const u of undos) await u(); } });
      return parts.length ? `🗑️ Removed ${parts.join('; ')} · reply UNDO` : 'Nothing to remove.';
    }

    const addedSegs = [], dupSegs = [], addedNames = [];
    for (const [l, items] of groups) {
      const added = [], dups = [];
      for (const it of items) {
        const r = await store.addItem(l, it);
        if (r.added) { added.push(display(it)); undos.push(r.undo); addedNames.push(it.name); memory.recordAdd(sender, it.name); }
        else if (r.duplicate) dups.push(it.name);
      }
      if (added.length) addedSegs.push(`${added.join(', ')} to ${l}`);
      if (dups.length) dupSegs.push(`${dups.join(', ')} already on ${l}`);
    }
    if (undos.length) push(sender, { label: `Removed ${addedNames.join(', ')}`, undo: async () => { for (const u of undos) await u(); } });
    if (addedNames.length) lastItems[sender] = addedNames;
    let msg = addedSegs.length ? `✅ Added ${addedSegs.join('; ')}` : '';
    if (dupSegs.length) msg += (msg ? ' ' : '') + `(${dupSegs.join('; ')})`;
    return (msg || 'Nothing new to add') + ' · reply UNDO';
  }

  function maybeNudge(sender, replies, debug, now = Date.now()) {
    if (!nudges || now - (lastNudgeAt[sender] || 0) < NUDGE_COOLDOWN_MS) return;
    const { usualsToAdd } = computeSuggestions({ memory, member: sender, currentItemsLower: currentLower(), now });
    const top = usualsToAdd.slice(0, 3);
    if (!top.length) return;
    offered[sender] = { items: top, at: now };
    lastNudgeAt[sender] = now;
    debug.nudged = top;
    replies.push(`🧺 You usually also grab ${top.join(', ')} — reply USUAL to add.`);
  }

  async function addNames(sender, names, intentTag) {
    const reply = await act(sender, { intent: 'add', items: names.map((n) => ({ name: n, list: null })) });
    return { replies: [reply], debug: { intent: intentTag, added: names, sender } };
  }

  function locate(sender, item, engine) {
    if (!item) return { replies: ['Which item are you asking about?'], debug: { engine, intent: 'locate', sender } };
    const q = item.toLowerCase();
    const found = lists.filter((l) => store.getItems(l).some((x) => x.toLowerCase() === q || x.toLowerCase().includes(q)));
    if (found.length) return { replies: [`${item} is on ${found.join(' and ')}.`], debug: { engine, intent: 'locate', found, sender } };
    pending[sender] = { intent: 'add', items: [{ name: item, list: null }] };
    return { replies: [`I don't see ${item} on any list — want me to add it? (reply yes)`], debug: { engine, intent: 'locate', found: [], sender } };
  }

  async function route(sender, text) {
    const t = (text || '').trim();

    if (STOP_RE.test(t)) { optedOut.add(sender); return { replies: ["You're opted out and won't receive more messages. Reply START to resume."], debug: { intent: 'stop', sender } }; }
    if (START_RE.test(t)) { optedOut.delete(sender); return { replies: ["You're opted back in. Text me anytime."], debug: { intent: 'start', sender } }; }
    if (HELP_RE.test(t)) { return { replies: ['Grocery Bot: text items to add (name a list to route, e.g. "milk to Costco"), "milk means oat milk" to teach a preference, "what lists do we have?", "USUAL", or "what\'s on <list>?". Reply STOP to opt out.'], debug: { intent: 'help', sender } }; }
    if (optedOut.has(sender)) return { replies: [], debug: { intent: 'opted-out', sender } };

    if (UNDO_RE.test(t)) {
      const last = (lastActions[sender] || []).pop();
      if (last && last.undo) { await last.undo(); return { replies: [`↩️ ${last.label}`], debug: { intent: 'undo', sender } }; }
      return { replies: ['Nothing to undo.'], debug: { intent: 'undo', sender } };
    }

    if (USUAL_RE.test(t)) {
      const { usualsToAdd } = computeSuggestions({ memory, member: sender, currentItemsLower: currentLower() });
      delete offered[sender];
      if (!usualsToAdd.length) return { replies: ["You don't have any usuals yet — keep using me and I'll learn them."], debug: { intent: 'usual', sender } };
      return addNames(sender, usualsToAdd, 'usual');
    }

    if (pending[sender]) {
      const low = t.toLowerCase();
      const chosen = lists.find((l) => low.includes(l.toLowerCase()));
      if (/^(yes|yep|yeah|yea|ok|okay|sure|do it|confirm|y)\b/.test(low)) { const c = pending[sender]; delete pending[sender]; return { replies: [await act(sender, c)], debug: { intent: c.intent, resolved: true, sender } }; }
      if (/^(no|nope|cancel|n)\b/.test(low)) { delete pending[sender]; return { replies: ['Okay, cancelled.'], debug: { intent: 'cancel', sender } }; }
      if (chosen) { const c = pending[sender]; delete pending[sender]; c.items = c.items.map((it) => ({ ...it, list: chosen })); return { replies: [await act(sender, c)], debug: { intent: c.intent, resolved: true, sender } }; }
    }

    if (offered[sender] && Date.now() - offered[sender].at < OFFER_TTL_MS && AFFIRM_RE.test(t)) {
      const items = offered[sender].items; delete offered[sender];
      return addNames(sender, items, 'usual-accept');
    }

    const ctx = {
      lists, preferences, sender,
      currentItems: store.snapshot(),
      memberProfile: memory.getMemberProfile(sender),
      staples: memory.getStaples(),
      history: (history[sender] || []).slice(-6),
      lastItems: lastItems[sender] || [],
    };
    const c = await interpret(text, ctx);

    if (c.intent === 'list_lists') {
      const summary = lists.map((l) => `${l} (${store.getItems(l).length})`).join(', ');
      return { replies: [`Your lists: ${summary}`], debug: { engine: c._engine, intent: 'list_lists', sender } };
    }
    if (c.intent === 'preference' && Array.isArray(c.preferences) && c.preferences.length) {
      const parts = c.preferences.map((p) => { memory.setPreference(sender, p.term, p); return `${p.term} → ${p.canonical}${p.quantity ? ` (${p.quantity})` : ''}`; });
      const reply = [`Got it — I'll remember for ${sender}: ${parts.join('; ')}`];
      if (c.items && c.items.length) reply.push(await act(sender, c));
      return { replies: reply, debug: { engine: c._engine, intent: 'preference', learned: parts, sender } };
    }
    if (c.intent === 'clear') {
      const list = canonList(c.targetList);
      if (!list) return { replies: ['Which list should I clear? (name the list)'], debug: { engine: c._engine, intent: 'clear', sender } };
      const n = store.getItems(list).length;
      if (!n) return { replies: [`${list} is already empty.`], debug: { engine: c._engine, intent: 'clear', sender } };
      pending[sender] = { intent: 'clear', targetList: list, items: [] };
      return { replies: [`Clear all ${n} item(s) from ${list}? Reply YES (undoable).`], debug: { engine: c._engine, intent: 'clear', confirm: true, sender } };
    }
    if (c.intent === 'locate') return locate(sender, c.items && c.items[0] && c.items[0].name, c._engine);

    const { mode } = applyPolicy(c, dial);
    const debug = { engine: c._engine, intent: c.intent, confidence: c.confidence, mode, sender };

    if (mode === 'ignore') return { replies: [], debug };
    if (mode === 'answer') {
      if (c.targetList && canonList(c.targetList)) return { replies: [`${canonList(c.targetList)}: ${store.getItems(canonList(c.targetList)).join(', ') || '(empty)'}`], debug };
      return { replies: [lists.map((l) => `${l}: ${store.getItems(l).join(', ') || '(empty)'}`).join('\n')], debug };
    }
    if (mode === 'ask') { if (c.items && c.items.length) pending[sender] = c; return { replies: [c.clarifyingQuestion || `Add ${c.items.map(display).join(', ')}? (reply yes)`], debug }; }

    const replies = [await act(sender, c)];
    if (c.intent === 'add') maybeNudge(sender, replies, debug);
    return { replies, debug };
  }

  async function handle(from, text) {
    const sender = resolveMember ? resolveMember(from) : from;
    const res = await route(sender, text);
    if (res.replies && res.replies.length) {
      const h = (history[sender] ||= []);
      h.push({ role: 'user', text: String(text) });
      h.push({ role: 'assistant', text: res.replies.join(' ') });
      if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
    }
    return res;
  }

  return { handle };
}

module.exports = { createConversation };
