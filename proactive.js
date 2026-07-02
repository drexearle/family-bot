'use strict';
/*
 * proactive.js — unprompted check-ins. Run it on a schedule (cron, or this
 * platform's live mode). For each family member it builds a digest from the
 * memory-backed suggestion engine and sends it via the channel.
 *
 *   node proactive.js            # dev: logs the outbound messages (no creds needed)
 *   (production) set TWILIO_* env + run on a weekly cron
 */
const { computeSuggestions } = require('./suggestions');

function buildDigest({ memory, member, currentItemsLower, now = Date.now(), opts }) {
  const { usualsToAdd, staleStaples } = computeSuggestions({ memory, member, currentItemsLower, now, opts });
  const lines = [];
  if (usualsToAdd.length) lines.push(`🧺 Your usuals not on the list: ${usualsToAdd.join(', ')}. Reply USUAL to add.`);
  if (staleStaples.length) lines.push(`⏰ Haven't seen ${staleStaples.map((s) => `${s.name} (${s.days}d)`).join(', ')} in a while — need any?`);
  if (!lines.length) return null;
  return `Grocery Bot check-in:\n${lines.join('\n')}\nReply STOP to opt out.`;
}

async function runProactive({ memory, store, lists, members, channel, now = Date.now(), opts }) {
  const currentItemsLower = new Set(lists.flatMap((l) => store.getItems(l)).map((s) => s.toLowerCase()));
  const sent = [];
  for (const [number, name] of Object.entries(members)) {
    const msg = buildDigest({ memory, member: name, currentItemsLower, now, opts });
    if (msg) { await channel.send(number, msg); sent.push({ name, number }); }
  }
  return sent;
}

module.exports = { runProactive, buildDigest };

// CLI: run a one-off proactive pass using the persisted memory + current list state.
if (require.main === module) {
  const path = require('path');
  const { MemoryStore } = require('./memory');
  const { MockAnyList } = require('./anylist-adapter');
  const { TwilioSmsChannel } = require('./channels/twilio-sms');
  const { MEMBERS } = require('./family');

  const memory = new MemoryStore({ file: process.env.MEMORY_FILE || path.join(__dirname, 'data', 'memory.json') });
  const store = new MockAnyList({ Groceries: [], Costco: [] }); // TODO: point at real current list state
  const channel = new TwilioSmsChannel();

  runProactive({ memory, store, lists: ['Groceries', 'Costco'], members: MEMBERS, channel })
    .then((sent) => console.log(`\nProactive pass done. Messaged: ${sent.map((s) => s.name).join(', ') || 'nobody (no suggestions)'}`))
    .catch((e) => { console.error(e); process.exit(1); });
}
