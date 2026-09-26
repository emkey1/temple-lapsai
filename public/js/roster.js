/* THE LEDGER: who the expedition has sent down, and where their records live.
 *
 * The game kept exactly one save under one key, so rolling a new adventurer
 * quietly wrote over the last one. This is the same storage with a name for
 * each record and an index over the top of them.
 *
 * Every function here takes the store rather than reaching for localStorage,
 * so the whole of it runs headless in a test — the storage bugs this replaces
 * were all in code that could only be exercised by hand, in a browser, once.
 */

export const LEDGER_KEY = 'lapsai-ledger';
export const SLOT_PREFIX = 'lapsai-save:';

/* THE CLOSED ACCOUNTS. The ledger above is who you can still play; this is
 * the memory of the runs that are over — the founding chronicle settled, or a
 * company written off. Kept apart from the live roster so erasing a live
 * record never erases the account of it, and capped so the list cannot grow
 * for ever in a browser that is polite about storage. */
export const ACCOUNTS_KEY = 'lapsai-accounts';
const ACCOUNTS_CAP = 50;

/* The single slot the game used to keep. Read once, adopted, and cleared. */
export const LEGACY_SLOT = 'lapsai-save';

export function slotKey(id) {
  return SLOT_PREFIX + id;
}

/* Time and randomness are arguments so a test can make an id it can predict. */
export function newCharId(now, rand) {
  const t = Number(now) || 0;
  const r = Math.floor((Number(rand) || 0) * 1e6);
  return 'c' + t.toString(36) + '-' + r.toString(36);
}

function readJSON(store, key) {
  try {
    const raw = store.getItem(key);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJSON(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;   /* private mode, a full quota, an indifferent browser */
  }
}

export function readLedger(store) {
  const l = readJSON(store, LEDGER_KEY);
  if (!l || !Array.isArray(l.chars)) return { v: 1, last: null, chars: [] };
  return { v: 1, last: l.last || null, chars: l.chars.filter((c) => c && c.id) };
}

export function writeLedger(store, ledger) {
  return writeJSON(store, LEDGER_KEY, { v: 1, last: ledger.last || null, chars: ledger.chars || [] });
}

/* What the ledger shows about someone without opening their record. */
export function summarise(player, dungeonName) {
  if (!player) return null;
  return {
    name: player.name || 'Nameless',
    cls: player.cls || 'fighter',
    level: player.level || 1,
    hp: player.hp,
    maxhp: player.maxhp,
    gold: player.gold || 0,
    where: dungeonName || player.dungeonId || '',
    floor: (player.floorIdx || 0) + 1,
  };
}

/* Writes the record and the index entry together, so the two cannot disagree
 * about who exists. The entry keeps whatever `fallen` it already carried —
 * dying is recorded by markFallen, not by saving. */
export function rememberCharacter(store, id, save, summary, savedAt) {
  if (!id) return null;
  writeJSON(store, slotKey(id), save);
  const ledger = readLedger(store);
  const was = ledger.chars.find((c) => c.id === id);
  const entry = { ...(was || {}), ...summary, id, savedAt: savedAt || 0 };
  ledger.chars = [entry, ...ledger.chars.filter((c) => c.id !== id)];
  ledger.last = id;
  writeLedger(store, ledger);
  return entry;
}

export function readCharacter(store, id) {
  return id ? readJSON(store, slotKey(id)) : null;
}

/* Both halves, or the index grows names for records that are not there. */
export function forgetCharacter(store, id) {
  try { store.removeItem(slotKey(id)); } catch { /* nothing to do about it */ }
  const ledger = readLedger(store);
  ledger.chars = ledger.chars.filter((c) => c.id !== id);
  if (ledger.last === id) ledger.last = ledger.chars.length ? ledger.chars[0].id : null;
  writeLedger(store, ledger);
  return ledger;
}

/* Death is recorded on the index rather than in the record, because the record
 * is deliberately NOT written on the killing blow — writing it there is what
 * used to let a reload resume alive at zero hit points. So the save says alive
 * and the ledger says fallen, and the ledger is the one that decides whether
 * you may simply walk back in. */
export function markFallen(store, id, fallen = true) {
  const ledger = readLedger(store);
  const entry = ledger.chars.find((c) => c.id === id);
  if (!entry) return ledger;
  entry.fallen = fallen === true;
  writeLedger(store, ledger);
  return ledger;
}

/* Who CONTINUE should open: the last one played, as long as their record is
 * still there, and otherwise the most recently saved one that is. */
export function pickLast(store) {
  const ledger = readLedger(store);
  const exists = (id) => id && readJSON(store, slotKey(id)) !== null;
  if (exists(ledger.last)) return ledger.last;
  const alive = ledger.chars.filter((c) => exists(c.id)).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return alive.length ? alive[0].id : null;
}

/* Entries whose record has gone missing — a cleared slot, a quota failure —
 * are not offered, because a row that cannot be opened is worse than no row. */
export function playable(store) {
  const ledger = readLedger(store);
  return ledger.chars
    .filter((c) => readJSON(store, slotKey(c.id)) !== null)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/* The one save the game used to keep becomes the first name in the ledger.
 * Returns its id, or null if there was nothing to adopt. */
export function adoptLegacySave(store, id, summary, now) {
  const old = readJSON(store, LEGACY_SLOT);
  if (!old || !old.state) return null;
  /* Either shape: a lone `player`, which is what the old single slot held, or
   * a party, in case one was ever written there. */
  const who = old.state.party && Array.isArray(old.state.party.members)
    ? old.state.party.members[old.state.party.active || 0]
    : old.state.player;
  if (!who) return null;
  const entry = summary || summarise(who);
  rememberCharacter(store, id, old, entry, (old.saved) || now || 0);
  try { store.removeItem(LEGACY_SLOT); } catch { /* leave it, it is harmless */ }
  return id;
}

/* ---- the closed accounts ---- */

export function readAccounts(store) {
  const list = readJSON(store, ACCOUNTS_KEY);
  return Array.isArray(list) ? list.filter((e) => e && e.name) : [];
}

export function writeAccounts(store, list) {
  return writeJSON(store, ACCOUNTS_KEY, (list || []).slice(0, ACCOUNTS_CAP));
}

/* Lay a finished run in the book. Newest first, so the hall reads the way a
 * ledger does — the last entry at the top. */
export function recordAccount(store, entry) {
  if (!entry || !entry.name) return null;
  const e = { ...entry, when: entry.when || 0 };
  writeAccounts(store, [e, ...readAccounts(store)]);
  return e;
}
