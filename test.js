'use strict';
/*
 * test.js — regression tests. Focus: questions must never be added as items.
 *   node test.js
 */
const { createConversation } = require('./conversation');
const { MockAnyList } = require('./anylist-adapter');

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

(async () => {
  const store = new MockAnyList({ Groceries: [], Costco: [] });
  const convo = createConversation({ store, lists: ['Groceries', 'Costco'], dial: 'balanced', nudges: false });
  const all = () => [...store.getItems('Groceries'), ...store.getItems('Costco')];

  // The reported bug
  let r = await convo.handle('Mom', 'Which list is this on?');
  check('bug: "Which list is this on?" not added', !all().some((x) => /which list/i.test(x)));
  check('   -> intent is not "add"', r.debug.intent !== 'add');

  // Other question forms must never add
  for (const q of ['do we have milk?', 'where are the eggs?', 'how many eggs do we need?', 'what should I get?', 'is bread on the list?']) {
    const before = all().length;
    r = await convo.handle('Dad', q);
    check(`question "${q}" adds nothing & intent!=add`, all().length === before && r.debug.intent !== 'add');
  }

  // Real adds still work
  r = await convo.handle('Mom', 'grab milk and eggs');
  check('real add -> intent add', r.debug.intent === 'add');
  check('   -> milk & eggs on Groceries', store.getItems('Groceries').includes('milk') && store.getItems('Groceries').includes('eggs'));

  // locate finds an existing item
  r = await convo.handle('Dad', 'which list is milk on?');
  check('locate existing item -> intent locate', r.debug.intent === 'locate');
  check('   -> reply names Groceries', /Groceries/.test(r.replies[0]));

  // locate for a missing item offers, does not auto-add
  const before = all().length;
  await convo.handle('Ellie', 'do we have salmon?');
  check('locate missing item does not auto-add', all().length === before);

  // normalization + query intact
  await convo.handle('Mom', 'add tp');
  check('"tp" -> toilet paper', store.getItems('Groceries').includes('toilet paper'));
  r = await convo.handle('Mom', "what's on the list?");
  check('"what\'s on the list?" -> query, no add', r.debug.intent === 'query');

  // Polite/question-shaped ADD commands still add
  const s2 = new MockAnyList({ Groceries: [], Costco: [] });
  const c2 = createConversation({ store: s2, lists: ['Groceries', 'Costco'], dial: 'balanced', nudges: false });
  await c2.handle('Ellie', 'can you add batteries?');
  check('"can you add batteries?" -> adds batteries to default list', s2.getItems('Groceries').includes('batteries'));
  await c2.handle('Dad', "we're out of coffee");
  check('"we\'re out of coffee" -> adds coffee', s2.getItems('Groceries').includes('coffee'));

  // Named target list stripped + routed
  const s3 = new MockAnyList({ Groceries: [], Costco: [] });
  const c3 = createConversation({ store: s3, lists: ['Groceries', 'Costco'], dial: 'balanced', nudges: false });
  await c3.handle('Mom', 'add milk to costco');
  check('"add milk to costco" -> "milk" on Costco (name stripped)', s3.getItems('Costco').includes('milk') && !s3.getItems('Costco').some((x) => /to costco/i.test(x)));

  // Multi-list in one message
  const s4 = new MockAnyList({ Groceries: [], Costco: [] });
  const c4 = createConversation({ store: s4, lists: ['Groceries', 'Costco'], dial: 'balanced', nudges: false });
  await c4.handle('Mom', 'add oat milk to groceries and batteries to costco');
  check('multi-list: oat milk -> Groceries', s4.getItems('Groceries').includes('oat milk'));
  check('multi-list: batteries -> Costco', s4.getItems('Costco').includes('batteries'));

  // list_lists
  const z = await c4.handle('Mom', 'what lists do we have?');
  check('"what lists do we have?" -> list_lists naming both', z.debug.intent === 'list_lists' && /Groceries/.test(z.replies[0]) && /Costco/.test(z.replies[0]));

  // coreference: "add it to costco" after adding something
  const s5 = new MockAnyList({ Groceries: [], Costco: [] });
  const c5 = createConversation({ store: s5, lists: ['Groceries', 'Costco'], dial: 'balanced', nudges: false });
  await c5.handle('Dad', 'add olipop');
  await c5.handle('Dad', 'add it to costco');
  check('coreference "add it to costco" -> olipop on Costco', s5.getItems('Costco').includes('olipop'));

  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES PRESENT'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
