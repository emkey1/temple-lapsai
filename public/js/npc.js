/* NPC + dialogue HOOK layer.
 * A small cast can be seeded here; the engine lets the player talk to NPCs on
 * their tile ('T'). Responses come from a canned fallback until a dialogue
 * ADAPTER (LLM-backed) is wired in via setDialogueAdapter, which should map to
 * a future /api/talk endpoint (see expander.js / server hook).
 */

export const NPC_GLYPH = '¶';

export const NPCS = [
  {
    id: 'hermit-ogil',
    name: 'Ogil the Whetstone',
    title: 'a hermit with one good eye',
    dungeon: 'temple', floor: 1,
    color: 'amber',
    intro: '“Sharp edges keep softer men alive down here. I know this temple blade by blade. Ask, and I shall whet your wits as well.”',
    knowledge: ['temple', 'secret', 'treasure', 'door'],
  },
  {
    id: 'priestess-eilyth',
    name: 'Eilyth, Drowned Sister',
    title: 'a priestess of the old sea-god',
    dungeon: 'upper', floor: 1,
    color: 'cyan',
    intro: '“The tide carries ruin into the warrens and carries our prayers out. Whom do you serve, down-soaked stranger? Perhaps I keep a blessing for you.”',
    knowledge: ['sewers', 'water', 'rat', 'potion', 'bless'],
  },
  {
    id: 'keeper-venn',
    name: 'Keeper Venn',
    title: 'the last keeper of the serpent halls',
    dungeon: 'serpent', floor: 1,
    color: 'green',
    intro: '“The Coils remember every pilgrim who ever crawled them, and they counted you the moment you stepped inside. Be cleverer than the last hundred.”',
    knowledge: ['serpent', 'basilisk', 'coil', 'stairs'],
  },
];

export function getNPCTemplate(id) {
  return NPCS.find((n) => n.id === id) || null;
}

export function npcsForDungeonFloor(dungeonId, floor) {
  return NPCS.filter((n) => n.dungeon === dungeonId && n.floor === floor);
}

/* ---- dialogue ---- */

export class DialogueSystem {
  constructor() {
    this.adapter = null; // future: async (ctx) => text, wired to an LLM
    this.history = {};   // npcId -> [{role:'player'|'npc', text}]
    this.activeId = null;
  }

  setAdapter(fn) { this.adapter = fn; }

  start(npc) {
    this.activeId = npc.id;
    if (!this.history[npc.id]) this.history[npc.id] = [{ role: 'npc', text: npc.intro }];
    return this.history[npc.id];
  }

  async talk(npc, player, input) {
    const hist = this.history[npc.id] = this.history[npc.id] || [{ role: 'npc', text: npc.intro }];
    hist.push({ role: 'player', text: input });
    let reply;
    if (this.adapter) {
      try {
        reply = await this.adapter({ npc, player, history: hist, input });
      } catch (err) {
        reply = `The ${npc.title} falls silent, their words lost to the dark. (${err.message || 'oracle unreachable'})`;
      }
    } else {
      reply = this.canned(npc, input);
    }
    hist.push({ role: 'npc', text: reply });
    return hist;
  }

  canned(npc, input) {
    const lower = String(input || '').toLowerCase();
    const tips = [
      ['descend', ['The stairs are hungry and honest. Walk softly and carry a lit torch, even if you think you see fine.']],
      ['secret', ['Half the wealth of the deep is behind walls that were never doors. Tap the stones and listen for hollowness.']],
      ['treasure|gold', ['Gold keeps its promises poorly, but the scribes are always out of paper. Bring me nothing; bring yourself back.']],
    ];
    for (const [keys, replies] of tips) {
      if (keys.split('|').some((k) => lower.includes(k))) {
        return `${npc.name}: ${replies[Math.floor(Math.random() * replies.length)]}`;
      }
    }
    const fallbacks = [
      `${npc.name} squints off into the dark. "There is little to say that the labyrinth does not say louder. Keep your wits about you."`,
      `${npc.name} scratches a mark on the wall. "That is a better question than most. When the world grows thin, ask the Library to stitch new depths."`,
      `${npc.name} offers a worn smile. "I have told the honest truth and a few pretty lies. Which would you like to believe today?"`,
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

export const dialogue = new DialogueSystem();
