'use strict';
/*
 * server.js — channel-agnostic webhook server (the live SMS bot).
 * Routes inbound messages through the shared conversation/brain, and replies.
 * Dependency-free HTTP; the AnyList adapter is chosen by USE_REAL_ANYLIST.
 *
 *   node server.js                                    # mock brain + mock AnyList
 *   USE_REAL_ANYLIST=1 ANYLIST_EMAIL=... ANYLIST_PASSWORD=... ANTHROPIC_API_KEY=... node server.js
 *
 * Twilio: point your toll-free number's inbound webhook at POST /sms/twilio.
 * Reserved paths NOT used: /run /events /health /interrupt /keepalive
 */
require('./load-env'); // load ./.env into process.env (if present), before reading env
const http = require('http');
const path = require('path');
const { createConversation } = require('./conversation');
const { MockAnyList, RealAnyList } = require('./anylist-adapter');
const { MemoryStore } = require('./memory');
const { TwilioSmsChannel } = require('./channels/twilio-sms');
const { MEMBERS } = require('./family');

const PORT = process.env.PORT || 3000;
const DIAL = process.env.DIAL || 'balanced';
const USE_REAL = !!process.env.USE_REAL_ANYLIST;

let store, conversation;
const memory = new MemoryStore({ file: process.env.MEMORY_FILE || path.join(__dirname, 'data', 'memory.json') });
const twilio = new TwilioSmsChannel();

async function init() {
  if (USE_REAL) { store = new RealAnyList(); await store.connect(); }
  else store = new MockAnyList({ Groceries: [], Costco: [] });
  conversation = createConversation({
    store,
    lists: store.listNames(),
    preferences: { milk: 'oat milk', 'paper towels': 'Costco in bulk' },
    dial: DIAL,
    resolveMember: (from) => MEMBERS[from] || from,
    memory,
    defaultList: process.env.DEFAULT_LIST,
  });
}

const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('family-bot up'); }
    if (req.method === 'POST' && req.url.startsWith('/sms/twilio')) {
      // NOTE: in production, verify X-Twilio-Signature before trusting the body.
      const body = Object.fromEntries(new URLSearchParams(await readBody(req)));
      const inbound = twilio.parseInbound(body);
      if (!inbound) { res.writeHead(400); return res.end('bad request'); }
      console.log(`\n📩 ${inbound.from}: "${inbound.text}"`);
      const { replies, debug } = await conversation.handle(inbound.from, inbound.text);
      console.log('   🧠 ' + JSON.stringify(debug));
      const replyText = replies.join('\n');
      if (replyText) console.log('   ↩️  ' + replyText.replace(/\n/g, ' / '));
      res.writeHead(200, { 'content-type': 'text/xml' });
      return res.end(twilio.formatReply(replyText));
    }
    res.writeHead(404); res.end('not found');
  } catch (err) { console.error('handler error:', err); res.writeHead(500); res.end('error'); }
});

init()
  .then(() => server.listen(PORT, () => console.log(`family-bot on :${PORT} (dial=${DIAL}, ${process.env.ANTHROPIC_API_KEY ? 'claude' : 'mock'} brain, ${USE_REAL ? 'REAL' : 'mock'} AnyList) → POST /sms/twilio`)))
  .catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });

process.on('SIGINT', async () => { try { if (store && store.teardown) await store.teardown(); } catch {} process.exit(0); });
