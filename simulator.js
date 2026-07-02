'use strict';
/*
 * simulator.js — runs a scripted family conversation through the SAME shared
 * conversation handler the live server uses (conversation.js), so what you see
 * here is exactly what the SMS bot will do. No Mac, no Twilio, no credentials.
 *
 *   node simulator.js                 # balanced (approved default)
 *   DIAL=cautious node simulator.js
 *   DIAL=aggressive node simulator.js
 */
const { createConversation } = require('./conversation');
const { MockAnyList } = require('./anylist-adapter');

const DIAL = process.env.DIAL || 'balanced';
const store = new MockAnyList({ Groceries: [], Costco: [] });
const conversation = createConversation({
  store,
  lists: ['Groceries', 'Costco'],
  preferences: { milk: 'oat milk', 'paper towels': 'Costco in bulk' },
  dial: DIAL,
});

const script = [
  ['Mom',   'grab oat milk, eggs, and tp'],
  ['Dad',   "we're out of coffee"],
  ['Ellie', 'add batteries to costco'],          // per-item list routing
  ['Mom',   'add eggs'],                          // de-dupe
  ['Dad',   'actually scratch the coffee'],
  ['Mom',   "what's on groceries?"],
  ['Ellie', 'what lists do we have?'],            // list the lists
  ['Ellie', 'thx!!'],
  ['Dad',   'undo'],
];

(async () => {
  console.log(`\n🛒 Family Grocery Bot — simulator (dial: ${DIAL}${process.env.ANTHROPIC_API_KEY ? '' : ', mock brain'})`);
  for (const [sender, text] of script) {
    console.log(`\n${'─'.repeat(66)}\n📩 ${sender}: "${text}"`);
    const { replies, debug } = await conversation.handle(sender, text);
    console.log('   🧠 ' + JSON.stringify(debug));
    if (replies.length) replies.forEach((r) => console.log('   ↩️  ' + r));
    else console.log('   🤫 (no reply)');
  }
  console.log(`\n${'═'.repeat(66)}\n📋 Final lists:`);
  for (const [l, items] of Object.entries(store.snapshot())) console.log(`   ${l}: ${items.join(', ') || '(empty)'}`);
  console.log();
})();
