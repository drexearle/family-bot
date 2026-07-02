'use strict';
/*
 * memory-demo.js — shows the bot LEARNING per-member preferences and persisting
 * them to disk, then ENRICHING later messages from that memory.
 *
 *   node memory-demo.js
 * Then inspect / prove persistence:
 *   cat /tmp/family-memory-demo.json
 */
const { createConversation } = require('./conversation');
const { MockAnyList } = require('./anylist-adapter');
const { MemoryStore } = require('./memory');

const FILE = process.env.MEMORY_FILE || '/tmp/family-memory-demo.json';
const store = new MockAnyList({ Groceries: [], Costco: [] });
const memory = new MemoryStore({ file: FILE });
const convo = createConversation({ store, lists: ['Groceries', 'Costco'], memory, dial: 'balanced' });

const script = [
  ['Mom',   'milk means oat milk, 2 cartons'],        // teach a preference
  ['Mom',   'add milk'],                               // enriched -> oat milk (2 cartons)
  ['Dad',   'add milk'],                               // Dad has no pref -> plain milk (per-member!)
  ['Ellie', 'paper towels means Bounty paper towels'], // teach
  ['Ellie', 'grab paper towels and eggs'],             // paper towels -> Bounty paper towels
  ['Mom',   "what's on the list?"],
];

(async () => {
  console.log(`\n🧠 Memory demo — learning + persistence (file: ${FILE})`);
  for (const [who, text] of script) {
    console.log(`\n📩 ${who}: "${text}"`);
    const { replies, debug } = await convo.handle(who, text);
    console.log('   🧠 ' + JSON.stringify(debug));
    replies.forEach((r) => console.log('   ↩️  ' + r));
  }
  console.log('\n💾 Learned memory persisted to disk:');
  console.log(JSON.stringify(memory.snapshot(), null, 2));
})();
