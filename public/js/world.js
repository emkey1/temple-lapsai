/* …VISION NOTE… This module is the WORLD-BUILDING HOOK LAYER.
 * The full history, factions, story arcs, NPCs and narrative beats are meant
 * to be written here in a later pass (see the design skeleton below).
 *
 * Shape of the future content, filled minimally now so the engine can hook
 * into it without changes:
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

export function beatAt(dungeonId, kind, floorIdx) {
  const beat = beatsForDungeon(dungeonId).find(
    (b) => (b.kind === kind) && (b.floor === undefined || b.floor === floorIdx),
  );
  return beat || null;
}

export function setFlag(flag, n = 1) {
  WORLD.flags[flag] = (WORLD.flags[flag] || 0) + n;
}

export function getFlag(flag) {
  return WORLD.flags[flag] || 0;
}
