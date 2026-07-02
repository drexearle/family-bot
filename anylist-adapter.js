'use strict';
/*
 * anylist-adapter.js — one interface, two implementations.
 *
 * Shared interface (used by conversation.js):
 *   listNames()                    -> [string]        (sync)
 *   getItems(list)                 -> [string]        (sync; active/uncrossed names)
 *   snapshot()                     -> { list: [str] } (sync)
 *   await addItem(list, name)      -> { added, duplicate, undo }
 *   await removeItem(list, name)   -> { removed, undo }
 *   await checkItem(list, name)    -> { checked, undo }   (cross off = "bought")
 *
 * Mutations are async (RealAnyList hits the network); awaiting the sync
 * MockAnyList is harmless. Reads are sync in both (RealAnyList reads the
 * `anylist` library's in-memory cache, which it keeps live over a websocket).
 * Every mutation returns an `undo` (async) so the brain can offer one-word undo.
 */

// ─────────────────────────────── Mock ────────────────────────────────────
class MockAnyList {
  constructor(seed = {}) {
    this.lists = {};
    for (const [name, items] of Object.entries(seed)) this.lists[name] = [...items];
  }
  ensure(list) { return (this.lists[list] ||= []); }
  has(list, name) { return this.ensure(list).some((i) => i.toLowerCase() === name.toLowerCase()); }
  listNames() { return Object.keys(this.lists); }
  getItems(list) { return [...this.ensure(list)]; }
  snapshot() { return JSON.parse(JSON.stringify(this.lists)); }

  async addItem(list, item) {
    const name = typeof item === 'string' ? item : item.name;
    const arr = this.ensure(list);
    if (this.has(list, name)) return { added: false, duplicate: true, undo: null };
    arr.push(name);
    return { added: true, duplicate: false, undo: async () => { const i = arr.findIndex((x) => x.toLowerCase() === name.toLowerCase()); if (i > -1) arr.splice(i, 1); } };
  }
  async removeItem(list, name) {
    const arr = this.ensure(list);
    const i = arr.findIndex((x) => x.toLowerCase() === name.toLowerCase());
    if (i === -1) return { removed: false, undo: null };
    arr.splice(i, 1);
    return { removed: true, undo: async () => arr.push(name) };
  }
  // Mock has no separate "crossed off" state — treat check as remove-from-active.
  async checkItem(list, name) {
    const r = await this.removeItem(list, name);
    return { checked: r.removed, undo: r.undo };
  }
}

// ─────────────────────────────── Real ────────────────────────────────────
// Thin wrapper over the unofficial `anylist` npm package (npm i anylist).
// Credentials via env: ANYLIST_EMAIL, ANYLIST_PASSWORD.
class RealAnyList {
  constructor({ email, password, credentialsFile } = {}) {
    let AnyList;
    try { AnyList = require('anylist'); }
    catch (e) { throw new Error('The "anylist" package is not installed. Run: npm i anylist'); }
    this.any = new AnyList({
      email: email || process.env.ANYLIST_EMAIL,
      password: password || process.env.ANYLIST_PASSWORD,
      credentialsFile: credentialsFile || process.env.ANYLIST_CREDENTIALS_FILE || undefined,
    });
    this._connected = false;
  }

  async connect() {
    if (this._connected) return;
    await this.any.login();
    await this.any.getLists(); // populates this.any.lists and starts live sync
    this._connected = true;
  }

  _list(name) {
    const l = this.any.getListByName(name);
    if (!l) throw new Error(`AnyList list not found: "${name}". Available: ${this.listNames().join(', ')}`);
    return l;
  }

  listNames() { return (this.any.lists || []).map((l) => l.name); }
  getItems(list) { return this._list(list).items.filter((i) => !i.checked).map((i) => i.name); }
  snapshot() { const out = {}; for (const l of this.any.lists || []) out[l.name] = l.items.filter((i) => !i.checked).map((i) => i.name); return out; }

  async addItem(list, item) {
    const name = typeof item === 'string' ? item : item.name;
    const quantity = (item && item.quantity) || undefined;
    const details = (item && item.notes) || undefined; // flavor / brand / note, e.g. "cherry cola"
    const l = this._list(list);
    const existing = l.getItemByName(name);
    if (existing && !existing.checked) return { added: false, duplicate: true, undo: null };
    if (existing && existing.checked) {
      // Reuse a crossed-off item (like the official clients) instead of duplicating.
      existing.checked = false;
      await existing.save();
      return { added: true, duplicate: false, undo: async () => { existing.checked = true; await existing.save(); } };
    }
    const saved = await l.addItem(this.any.createItem({ name, quantity, details }));
    return { added: true, duplicate: false, undo: async () => { await l.removeItem(saved); } };
  }

  async removeItem(list, name) {
    const l = this._list(list);
    const item = l.getItemByName(name);
    if (!item) return { removed: false, undo: null };
    await l.removeItem(item);
    return { removed: true, undo: async () => { await l.addItem(this.any.createItem({ name })); } };
  }

  async checkItem(list, name) {
    const l = this._list(list);
    const item = l.getItemByName(name);
    if (!item || item.checked) return { checked: false, undo: null };
    item.checked = true;
    await item.save();
    return { checked: true, undo: async () => { item.checked = false; await item.save(); } };
  }

  async teardown() { try { this.any.teardown(); } catch { /* ignore */ } }
}

module.exports = { MockAnyList, RealAnyList };
