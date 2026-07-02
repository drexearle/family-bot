'use strict';
/*
 * proactive-demo.js — shows both proactive layers built on memory:
 *   PART 1: in-conversation nudge ("you usually also grab X — reply USUAL")
 *   PART 2: scheduled digest that flags a stale staple + offers usuals
 *
 *   node proactive-demo.js
 */
const fs = require('fs');
const { createConversation } = require('./conversation');
const { MockAnyList } = require('./anylist-adapter');
const { MemoryStore } = require('./memory');
const { TwilioSmsChannel } = require('./channels/twilio-sms');
const { runProactive } = require('./proactive');

const DAY = 864e5;
const now = Date.now();
const FILE = process.env.MEMORY_FILE || '/tmp/family-proactive-demo';
for (const s of ['.p1.json', '.p2.json']) fs.rmSync(FILE + s, { force: true });

// Seed a few weeks of Mom's history (backdated timestamps).
function seed(memory) {
  for (let i = 0; i < 4; i++) { memory.recordAdd('Mom', 'milk', now - (i * 7 + 2) * DAY); memory.recordAdd('Mom', 'eggs', now - (i * 7 + 3) * DAY); }
  for (let i = 0; i < 3; i++) memory.recordAdd('Mom', 'coffee', now - (12 + i * 7) * DAY); // coffee last added 12d ago -> stale
  for (let i = 0; i < 3; i++) memory.recordAdd('Mom', 'bananas', now - (i * 7 + 1) * DAY);
}
// Separate stores so Part 1's adds don't refresh Part 2's staleness clock.
const memoryP1 = new MemoryStore({ file: FILE + '.p1.json' }); seed(memoryP1);
const memoryP2 = new MemoryStore({ file: FILE + '.p2.json' }); seed(memoryP2);

(async () => {
  console.log(`\n================ PART 1: in-conversation nudge ================`);
  const store = new MockAnyList({ Groceries: [], Costco: [] });
  const convo = createConversation({ store, lists: ['Groceries', 'Costco'], memory: memoryP1, dial: 'balanced' });
  for (const t of ['add bread', 'USUAL']) {
    console.log(`\n📩 Mom: "${t}"`);
    const { replies } = await convo.handle('Mom', t);
    replies.forEach((r) => console.log('   ↩️  ' + r));
  }
  console.log(`\n   Groceries now: ${store.getItems('Groceries').join(', ')}`);

  console.log(`\n================ PART 2: scheduled proactive digest ================`);
  console.log(`(empty list, so usuals + the stale staple both surface; sends are dev-logged)`);
  const store2 = new MockAnyList({ Groceries: [], Costco: [] });
  const channel = new TwilioSmsChannel();
  const members = { '+15551230001': 'Mom' };
  const sent = await runProactive({ memory: memoryP2, store: store2, lists: ['Groceries', 'Costco'], members, channel, now });
  console.log(`\n   → messaged: ${sent.map((s) => s.name).join(', ') || 'nobody'}`);
})();
