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
  flags: {},
};

export function registerWorldContent(content) {
  if (!content || typeof content !== 'object') return;
  if (Array.isArray(content.history)) WORLD.history.push(...content.history);
  if (Array.isArray(content.factions)) WORLD.factions.push(...content.factions);
  if (Array.isArray(content.npcs)) WORLD.npcs.push(...content.npcs);
  if (Array.isArray(content.storyArcs)) WORLD.storyArcs.push(...content.storyArcs);
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
