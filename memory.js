'use strict';
/*
 * memory.js — persistent household memory.
 *
 * Learns, per family member, and persists to JSON:
 *   1. Explicit PREFERENCES  — "milk means oat milk (2 cartons)" -> term->canonical
 *   2. Implicit FREQUENCY    — every add records { count, lastAt } per item, per
 *                              member and household -> "usuals" + "staples" + staleness.
 *
 * These feed the brain's context AND the proactive suggestion engine.
 * File-less instances keep everything in memory (used by the simulator).
 */
const fs = require('fs');
const path = require('path');

const key = (s) => String(s).trim().toLowerCase();

class MemoryStore {
  constructor({ file } = {}) {
    this.file = file || null;
    this.data = { members: {}, household: { items: {} } };
    if (this.file) this._load();
  }

  _member(name) { return (this.data.members[name] ||= { prefs: {}, items: {} }); }

  setPreference(member, term, { canonical, quantity = null, notes = null, brand = null } = {}) {
    const p = { term: String(term).trim(), canonical: String(canonical || term).trim(), quantity, notes, brand, updatedAt: Date.now() };
    this._member(member).prefs[key(term)] = p;
    this._save();
    return p;
  }

  // Implicit learning: called on every successful add. `at` allows backdating (tests/seeding).
  recordAdd(member, itemName, at = Date.now()) {
    const k = key(itemName);
    const bump = (bag) => { const r = (bag[k] ||= { n: 0, lastAt: 0 }); r.n += 1; r.lastAt = Math.max(r.lastAt, at); };
    bump(this._member(member).items);
    bump(this.data.household.items);
    this._save();
  }

  getMemberProfile(member) {
    const m = this.data.members[member];
    if (!m) return { prefs: {}, usuals: [] };
    const usuals = Object.entries(m.items).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([k]) => k);
    return { prefs: m.prefs, usuals };
  }

  getMemberItems(member) {
    const m = this.data.members[member];
    return m ? Object.entries(m.items).map(([name, r]) => ({ name, n: r.n, lastAt: r.lastAt })) : [];
  }

  getHouseholdItems() {
    return Object.entries(this.data.household.items).map(([name, r]) => ({ name, n: r.n, lastAt: r.lastAt }));
  }

  getStaples(min = 3) {
    return this.getHouseholdItems().filter((it) => it.n >= min).sort((a, b) => b.n - a.n).map((it) => it.name);
  }

  snapshot() { return JSON.parse(JSON.stringify(this.data)); }

  _load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const members = {};
      for (const [name, m] of Object.entries(d.members || {})) members[name] = { prefs: m.prefs || {}, items: coerce(m.items || m.counts) };
      this.data = { members, household: { items: coerce((d.household || {}).items || (d.household || {}).counts) } };
    } catch { /* first run — keep defaults */ }
  }

  _save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2)); // atomic-ish
    fs.renameSync(tmp, this.file);
  }
}

// Migrate legacy {name: count} -> {name: {n, lastAt}}
function coerce(items) {
  const out = {};
  for (const [k, v] of Object.entries(items || {})) out[k] = typeof v === 'number' ? { n: v, lastAt: 0 } : { n: v.n || 0, lastAt: v.lastAt || 0 };
  return out;
}

module.exports = { MemoryStore };
