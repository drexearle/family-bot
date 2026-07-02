'use strict';
/*
 * suggestions.js — the proactive engine. Pure function over memory + current list.
 *
 * Returns:
 *   usualsToAdd  — items this member buys often (>= usualMinCount) that are NOT
 *                  currently on any list. Powers "add the usual?".
 *   staleStaples — household staples (>= stapleMinCount) not on the list and not
 *                  added in >= staleDays. Powers "haven't seen X in a while".
 */
const DAY = 864e5;

function computeSuggestions({ memory, member, currentItemsLower, now = Date.now(), opts = {} }) {
  const { usualMinCount = 2, maxUsuals = 4, staleDays = 10, stapleMinCount = 3 } = opts;

  const usualsToAdd = memory.getMemberItems(member)
    .filter((it) => it.n >= usualMinCount && !currentItemsLower.has(it.name))
    .sort((a, b) => b.n - a.n)
    .slice(0, maxUsuals)
    .map((it) => it.name);

  const staleStaples = memory.getHouseholdItems()
    .filter((it) => it.n >= stapleMinCount && !currentItemsLower.has(it.name) && now - it.lastAt >= staleDays * DAY)
    .map((it) => ({ name: it.name, days: Math.round((now - it.lastAt) / DAY) }))
    .sort((a, b) => b.days - a.days);

  return { usualsToAdd, staleStaples };
}

module.exports = { computeSuggestions };
