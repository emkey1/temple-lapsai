/* THE WORLD LAYER: the mechanism, not the content.
 *
 * The history, factions, story arcs and cast live in lore.js and are registered
 * here on import, so this file stays the small set of queries the engine calls
 * and the writing stays somewhere a writer can work without reading code.
 *
 * The shapes:
 *   WORLD.history   [ { era, title, text } ]          — fantasy history
 *   WORLD.factions  [ { id, name, stance, note } ]     — powers that be
 *   WORLD.npcs      [ NPC ]                            — interactable cast
 *   WORLD.storyArcs [ { id, dungeonId, name, beats } ] — narrative threads ordered per dungeon
 *
 * Beats are fired by the engine at (dungeonId, kind, floorIdx): kinds are
 * 'enter', 'boss', 'finish', 'condition'. A beat is one of:
 *   { type: 'narration', text }                       — shown in log/codex
 *   { type: 'npc-intro', npcId }                      — flags an NPC as introduced
 *   { type: 'overlay', title, text }                  — full-screen narration
 *   { type: 'flag', flag, valueCount }                — engine bookkeeping
 */

import { LORE } from './lore.js';

export const WORLD = {
  history: [],
  factions: [],
  npcs: [],
  storyArcs: [],
  keeper: null,
  region: null,
  road: [],
  flags: {},
};

export function registerWorldContent(content) {
  if (!content || typeof content !== 'object') return;
  if (Array.isArray(content.history)) WORLD.history.push(...content.history);
  if (Array.isArray(content.factions)) WORLD.factions.push(...content.factions);
  if (Array.isArray(content.npcs)) WORLD.npcs.push(...content.npcs);
  if (Array.isArray(content.storyArcs)) WORLD.storyArcs.push(...content.storyArcs);
  if (content.keeper && typeof content.keeper === 'object') WORLD.keeper = content.keeper;
  if (content.region && typeof content.region === 'object') WORLD.region = content.region;
  if (Array.isArray(content.road)) WORLD.road = content.road;
}

/* WHAT THE ORACLE NEEDS TO KNOW ABOUT THIS WORLD.
 *
 * The Library was writing dungeons for a generic 1982 module: the only world
 * context it ever got was a comma-separated list of dungeon NAMES. Seven
 * hundred lines of history, seven factions and three story arcs sat unread,
 * which is why anything it wrote could have come from any game.
 *
 * A briefing, then — built FROM the lore rather than written beside it, so it
 * cannot go stale when the lore grows. Deliberately compact: this rides in
 * every prompt, and a local model's context is not free. One line per era,
 * one clause per faction, and the names already taken so it does not write a
 * second Ogil.
 *
 * `budget` is characters, not tokens, and the trim is by whole entries — a
 * briefing cut mid-sentence teaches a model to write mid-sentence. */
export function loreBriefing(opts = {}) {
  const budget = opts.budget || 1600;
  const line = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const parts = [];

  if (WORLD.history.length) {
    parts.push('HISTORY, oldest first: ' + WORLD.history
      .map((h) => `${line(h.era)} — ${line(h.title)}`).join('; ') + '.');
  }
  if (WORLD.factions.length) {
    parts.push('POWERS: ' + WORLD.factions
      .map((f) => `${line(f.name)} (${line(f.stance)})`).join('; ') + '.');
  }
  if (WORLD.npcs.length) {
    parts.push('PEOPLE already down there: ' + WORLD.npcs
      .map((n) => `${line(n.name)}, ${line(n.title)}`).join('; ') + '.');
  }
  if (opts.dungeons && opts.dungeons.length) {
    parts.push('SANCTUMS already written: ' + opts.dungeons.map(line).join('; ') + '.');
  }

  /* The register matters as much as the facts. Everything in this world is
   * written as bookkeeping that outlived its clerks — debts, tallies,
   * arrears, entries — and a model told the facts without the tone writes
   * high fantasy over the top of them. */
  parts.push('VOICE: this world is an accounting that outlived its clerks. ' +
    'Debts, tithes, arrears, ledgers, entries, tolls. Dry, specific, unmagical language ' +
    'about magical things. Nothing is called ancient or forgotten; somebody is still owed.');

  let out = '';
  for (const p of parts) {
    if (out.length + p.length + 1 > budget) break;
    out += (out ? ' ' : '') + p;
  }
  return out;
}

export function getFaction(id) {
  return WORLD.factions.find((f) => f.id === id) || null;
}

export function getNPC(id) {
  return WORLD.npcs.find((n) => n.id === id) || null;
}

export function arcForDungeon(dungeonId) {
  return WORLD.storyArcs.find((a) => a.dungeonId === dungeonId) || null;
}

export function beatsForDungeon(dungeonId) {
  const arc = arcForDungeon(dungeonId);
  return (arc && arc.beats) || [];
}

/* Every beat matching (kind, floor), in the order written. beatAt returned only
 * the first, so a second beat on the same floor silently never fired. */
export function beatsAt(dungeonId, kind, floorIdx) {
  return beatsForDungeon(dungeonId).filter(
    (b) => (b.kind === kind) && (b.floor === undefined || b.floor === floorIdx),
  );
}

export function beatAt(dungeonId, kind, floorIdx) {
  return beatsAt(dungeonId, kind, floorIdx)[0] || null;
}

/* The Keeper's line for a moment, or null if it has nothing to say there. `n`
 * is only used for the sanctums, which escalate as the hand quickens. */
export function keeperLine(event, n) {
  const k = WORLD.keeper;
  if (!k) return null;
  if (event === 'first-blood') return k.firstBlood || null;
  if (event === 'fall') return k.fall || null;
  if (event === 'closing') return k.closing || null;
  if (event === 'clear') {
    const list = Array.isArray(k.clears) ? k.clears : [];
    return list[(n || 1) - 1] || null;
  }
  return null;
}

export function npcsForDungeon(dungeonId, floorIdx) {
  return WORLD.npcs.filter((n) => n.dungeon === dungeonId && n.floor === floorIdx);
}

export function factionById(id) {
  return WORLD.factions.find((f) => f.id === id) || null;
}

/* Resets the flags a single run accumulates; the lore itself is static. */
export function resetWorldFlags() {
  WORLD.flags = {};
}

export function setFlag(flag, n = 1) {
  WORLD.flags[flag] = (WORLD.flags[flag] || 0) + n;
}

export function getFlag(flag) {
  return WORLD.flags[flag] || 0;
}

/* Registered at import so every consumer sees a populated world. */
registerWorldContent(LORE);
