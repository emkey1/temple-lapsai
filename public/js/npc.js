/* NPCs and dialogue.
 *
 * The cast itself lives in lore.js and is registered through world.js — this
 * module is the dialogue machinery. It used to keep a second, separate list of
 * NPCs, which meant WORLD.npcs was populated by nobody and read by nothing.
 *
 * Replies come from each NPC's own `topics` (keyword-matched) and `fallbacks`.
 * A dialogue ADAPTER can be installed with setAdapter to route conversation
 * through an LLM instead; without one the canned material answers.
 */

import { WORLD, getNPC, npcsForDungeon } from './world.js';

export const NPC_GLYPH = '¶';

export function getNPCTemplate(id) {
  return getNPC(id);
}

/* floorIdx is zero-based, as the engine counts floors. */
export function npcsForDungeonFloor(dungeonId, floorIdx) {
  return npcsForDungeon(dungeonId, floorIdx);
}

export function allNPCs() {
  return WORLD.npcs;
}

/* ---- dialogue ---- */

/* What they say when you walk up. At rank 0 it is their intro; once their
 * order has noticed you it is the line for that rung, so the world knows you
 * without a single new greeting card to keep. */
export function greetingFor(npc, rank) {
  if (!npc) return '';
  const r = Number(rank) || 0;
  if (r >= 1 && Array.isArray(npc.recognise) && npc.recognise[r - 1]) return npc.recognise[r - 1];
  return npc.intro;
}

export class DialogueSystem {
  constructor() {
    this.adapter = null; // future: async (ctx) => text, wired to an LLM
    this.history = {};   // npcId -> [{role:'player'|'npc', text}]
    this.activeId = null;
  }

  setAdapter(fn) { this.adapter = fn; }

  start(npc, rank) {
    this.activeId = npc.id;
    const greeting = greetingFor(npc, rank);
    let hist = this.history[npc.id];
    if (!hist || !hist.length) {
      hist = this.history[npc.id] = [{ role: 'npc', text: greeting }];
    } else if (hist[0] && hist[0].role === 'npc') {
      /* The greeting grows as they come to know you, so the opening line is
       * always where you stand now, not where you stood the first time. */
      hist[0].text = greeting;
    }
    return hist;
  }

  async talk(npc, player, input) {
    const hist = this.history[npc.id] = this.history[npc.id] || [{ role: 'npc', text: npc.intro }];
    hist.push({ role: 'player', text: input });
    let reply;
    if (this.adapter) {
      try {
        reply = await this.adapter({ npc, player, history: hist, input });
      } catch (err) {
        /* The voice failed — a local model out of memory, a key that lapsed, a
         * provider offline. The wall is still there; use it, and do not make
         * the player read about our plumbing. */
        if (typeof console !== 'undefined') console.warn('[lapsai] dialogue oracle failed:', err && err.message);
        reply = this.canned(npc, input);
      }
    } else {
      reply = this.canned(npc, input);
    }
    hist.push({ role: 'npc', text: reply });
    return hist;
  }

  /* First topic whose keys appear in what the player typed. Each NPC carries
   * their own; the old version shared one hard-coded list of three tips across
   * the whole cast, so everyone said the same things in the same words. */
  canned(npc, input) {
    const lower = String(input || '').toLowerCase();
    const topics = npc.topics || [];
    for (const topic of topics) {
      const keys = topic.keys || [];
      if (keys.some((k) => k && lower.includes(String(k).toLowerCase()))) {
        return pick(topic.replies, lower);
      }
    }
    const fallbacks = npc.fallbacks && npc.fallbacks.length
      ? npc.fallbacks
      : ['They look at you, and go back to what they were doing.'];
    return pick(fallbacks, lower);
  }
}

/* Deterministic in what the player typed, so asking the same thing twice gets
 * the same answer and asking a new thing gets a new one. */
function pick(list, seedText) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return '…';
  let h = 0;
  for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

export const dialogue = new DialogueSystem();
