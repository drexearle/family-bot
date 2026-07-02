'use strict';
/*
 * web-console.js — a local web debug console for the family bot.
 * Serves a browser UI + a small JSON API that drives the SAME conversation core
 * (brain + memory + proactive + AnyList adapter). NO Twilio involved.
 *
 *   node web-console.js                              # mock brain + mock AnyList
 *   ANTHROPIC_API_KEY=... node web-console.js        # real Claude brain
 *   USE_REAL_ANYLIST=1 ANYLIST_EMAIL=... ANYLIST_PASSWORD=... node web-console.js   # real AnyList
 *
 * Then open http://localhost:4000
 */
require('./load-env'); // load ./.env into process.env (if present), before reading env
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createConversation } = require('./conversation');
const { MockAnyList, RealAnyList } = require('./anylist-adapter');
const { MemoryStore } = require('./memory');
const { computeSuggestions } = require('./suggestions');

const PORT = process.env.PORT || process.env.WEB_PORT || 4000; // hosts inject PORT
const USE_REAL = !!process.env.USE_REAL_ANYLIST;
const HTML = fs.readFileSync(path.join(__dirname, 'web', 'console.html'), 'utf8');

// Optional HTTP Basic auth — REQUIRED before exposing the console publicly (it can edit your lists).
const AUTH_USER = process.env.AUTH_USER, AUTH_PASS = process.env.AUTH_PASS;
function authed(req) {
  if (!AUTH_USER) return true; // no auth configured (fine for localhost only)
  const m = (req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const [u, p] = Buffer.from(m[1], 'base64').toString().split(':');
  return u === AUTH_USER && p === AUTH_PASS;
}

let store, memory, convo, LISTS;

async function initStore() {
  if (USE_REAL) {
    store = new RealAnyList();
    await store.connect();
    LISTS = store.listNames();
    if (!LISTS.length) throw new Error('No lists found on the AnyList account.');
  } else {
    store = new MockAnyList({ Groceries: [], Costco: [] });
    LISTS = store.listNames();
  }
}

function newSession() {
  memory = new MemoryStore(); // in-memory: a clean learning session per reset
  convo = createConversation({ store, lists: LISTS, memory, dial: process.env.DIAL || 'balanced', resolveMember: (f) => f, defaultList: process.env.DEFAULT_LIST });
}

async function handleReset() {
  if (!USE_REAL) { store = new MockAnyList({ Groceries: [], Costco: [] }); LISTS = store.listNames(); } // never wipe a REAL list
  newSession();
}

function stateFor(sender) {
  const cur = new Set(LISTS.flatMap((l) => store.getItems(l)).map((s) => s.toLowerCase()));
  return {
    engine: process.env.ANTHROPIC_API_KEY ? 'claude' : 'mock',
    anylist: USE_REAL ? 'real' : 'mock',
    dial: process.env.DIAL || 'balanced',
    lists: store.snapshot(),
    memory: memory.snapshot(),
    suggestions: sender ? computeSuggestions({ memory, member: sender, currentItemsLower: cur }) : null,
  };
}

const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  try {
    if (!authed(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="family-bot"' }); return res.end('Authentication required'); }
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(HTML); }
    if (req.method === 'GET' && req.url === '/api/state') return json(res, 200, stateFor());
    if (req.method === 'POST' && req.url === '/api/message') {
      const { from, text } = JSON.parse((await readBody(req)) || '{}');
      if (!from || !text) return json(res, 400, { error: 'from and text required' });
      const { replies, debug } = await convo.handle(from, text);
      return json(res, 200, { replies, debug, ...stateFor(from) });
    }
    if (req.method === 'POST' && req.url === '/api/reset') { await handleReset(); return json(res, 200, { ok: true, ...stateFor() }); }
    res.writeHead(404); res.end('not found');
  } catch (e) { json(res, 500, { error: String((e && e.message) || e) }); }
});

(async () => {
  try {
    await initStore();
    newSession();
    const dflt = process.env.DEFAULT_LIST || LISTS.find((l) => /grocer/i.test(l)) || LISTS[0];
    server.listen(PORT, () => {
      console.log(`web console: http://localhost:${PORT}  (${process.env.ANTHROPIC_API_KEY ? 'claude' : 'mock'} brain, ${USE_REAL ? 'REAL' : 'mock'} AnyList)\n  default list: ${dflt}\n  ${LISTS.length} lists: ${LISTS.join(', ')}`);
      if (!AUTH_USER) console.log('  ⚠️  No AUTH_USER/AUTH_PASS set — console is UNPROTECTED. Fine for localhost; set them before hosting publicly.');
    });
  } catch (e) {
    console.error('Startup failed:', e.message);
    process.exit(1);
  }
})();

process.on('SIGINT', async () => { try { if (store && store.teardown) await store.teardown(); } catch {} process.exit(0); });
