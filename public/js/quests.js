/* THE UNDERTAKINGS.
 *
 * The lore was already full of hooks that went nowhere: Ogil is "still owed"
 * by the salvage families, Venn has had thirty years to ask where the carved
 * hands' contents went, and the four families buy godlings "cash, no
 * questions". People wrote those as flavour and they read as promises. This
 * is the machinery that keeps them.
 *
 * CONTENT ONLY — no engine, no DOM, the same rule lore.js follows. A quest is
 * a plain object the engine can read:
 *
 *   id        stable key, stored in the save
 *   name      what the Undertakings list calls it
 *   giver     npc id whose dialogue offers it
 *   requires  optional { quest } — a chain, only offered once that one is done
 *   opens     optional gate: { dungeonCleared } — not offered before then
 *   offer     what the giver says when they put it to you
 *   accepted  what they say as you take it
 *   objective one of:
 *               { kind: 'slay',    monster: id,   count: n }
 *               { kind: 'gather',  item: id,      count: n }
 *               { kind: 'reach',   dungeon: id,   floor: n }   (floor is 0-based)
 *   turnIn    true if the giver must be spoken to again to close it
 *   reward    { gold, xp, item }  — any subset
 *   done      what the giver says when it is closed
 *   journal   the line written into the run's own record
 *
 * A `gather` quest CONSUMES its items at turn-in; a `slay` counts kills from
 * the moment it was accepted, which is the only reading that is not a lie
 * when the player has already cleared half a floor.
 */

export const QUESTS = [
  {
    id: 'idols-for-ogil',
    name: 'What the Families Pay For',
    giver: 'hermit-ogil',
    offer:
      'Ogil turns a squat carved godling over in his hands and does not give it back. ' +
      '“Four families buy these, cash, above scrap, no questions — and I was the man they ' +
      'sent to fetch them, before the hill kept my knees. Bring me three out of the dark ' +
      'and I will see they go to the right door, and that some of the coin comes back to ' +
      'yours. Tell them Ogil is still owed. Watch their faces do nothing at all.”',
    accepted: '“Three. Statuettes, godlings, the little squat ones. Not scrap, mind.”',
    objective: { kind: 'gather', item: 'statuette', count: 3 },
    turnIn: true,
    reward: { gold: 400, xp: 300 },
    done:
      '“There.” Ogil wraps them in sacking with more care than he has shown you. “The coin ' +
      'is yours; the errand was mine. Thirty years and they still answer the name.”',
    journal: 'Ogil sent three carved godlings to the salvage families, and the coin came back.',
  },

  {
    id: 'the-demons-account',
    name: 'The Thing With Its Mouth Open',
    giver: 'hermit-ogil',
    requires: { quest: 'idols-for-ogil' },
    offer:
      'Ogil jerks his chin at the stairs. “You have been down and come back, which is more ' +
      'than most manage twice. Then you know there is a god asleep at the bottom of this ' +
      'place with its mouth open, and that the mouth is the point — it was left open to be ' +
      'fed. I am too old and too fond of my knees. Put it out, and I will see you paid from ' +
      'a purse the order pretends it does not keep.”',
    accepted: '“Four floors down. It has always been at the bottom. Do not go poor.”',
    objective: { kind: 'slay', monster: 'lapsai-demon', count: 1 },
    turnIn: true,
    reward: { gold: 250, xp: 400, item: 'potion-major-heal' },
    done:
      '“Then it is out.” Ogil is quiet for a moment. “Thirty years of us telling each other ' +
      'the mouth was shut. Take the coin, and do not tell me what was in the bronze room.”',
    journal: 'The Demon of Lapsai was put out, and Ogil paid from a purse nobody admits to.',
  },

  {
    id: 'the-route-still-runs',
    name: 'What Is Still Being Moved',
    giver: 'priestess-eilyth',
    offer:
      'Eilyth speaks without turning from the water. “The works are supposed to be dead. ' +
      'Dead things do not keep a channel clear, and something at the head of these reaches ' +
      'has been keeping one clear for longer than I have been down here listening to it dig. ' +
      'Go up the water to the head of the works and put a stop to whatever is doing it.”',
    accepted: '“Upstream. Four floors of it. The word means inward, not up — you will see.”',
    objective: { kind: 'slay', monster: 'umber-hulk', count: 1 },
    turnIn: true,
    reward: { gold: 450, xp: 600 },
    done:
      '“Quiet.” She listens a while longer than is comfortable. “Do you hear it? Neither do ' +
      'I. That is the first time in eleven years. Take the money; I have no use for a channel.”',
    journal: 'The digger at the head of the Upper Reaches was stopped, and the water went quiet.',
  },

  {
    id: 'venns-question',
    name: 'Where the Hands Went',
    giver: 'keeper-venn',
    offer:
      'Venn has the look of a man resuming a sentence. “You have seen the hands — cupped at ' +
      'the shoulder, cupped at the hip, every one of them carrying something in. It is not in ' +
      'these halls. It is not on the floor. I have had thirty years to look and I have not ' +
      'moved the question an inch, because I cannot go past the fourth door and live. You ' +
      'can. Go to the bottom of the serpent\u2019s halls and come back able to tell me.”',
    accepted: '“The bottom. The fourth floor. Whatever it costs you, I have paid more for less.”',
    objective: { kind: 'reach', dungeon: 'serpent', floor: 3 },
    turnIn: true,
    reward: { gold: 300, xp: 500 },
    done:
      '“So that is where it went.” Venn is quiet a long while. “Thirty years, and the answer ' +
      'was four floors down and nobody to carry it back. Take the money. I have as much use ' +
      'for it now as the hands had.”',
    journal: 'Venn learned where the carved hands had emptied themselves, after thirty years.',
  },

  {
    id: 'the-long-account',
    name: 'The Long Account',
    giver: 'hermit-ogil',
    requires: { quest: 'the-demons-account' },
    opens: { dungeonCleared: 'upper' },
    offer:
      'Ogil has been waiting with the air of a man who has rehearsed. “You have been down ' +
      'twice and come back twice, which is twice more than most. There is a serpent under the ' +
      'last hill with a crown of rusted gold, and every account this place has ever kept runs ' +
      'through its coils. Close it. I am too old to and too owed not to ask.”',
    accepted: '“The Great Wyrm. Halls of the Serpent God. Do not go alone and do not go poor.”',
    objective: { kind: 'slay', monster: 'great-wyrm', count: 1 },
    turnIn: true,
    reward: { gold: 900, xp: 1200 },
    done:
      '“Closed, then.” Ogil sits down for the first time you have seen. “The whole long ' +
      'account, and the last of it in my lifetime. Sit. You have earned the fire.”',
    journal: 'The Great Wyrm fell, and the long account of the hill was closed.',
  },
];

export function questById(id) {
  return QUESTS.find((q) => q.id === id) || null;
}

/* Everything a given NPC could ever offer, in the order written. */
export function questsFrom(npcId) {
  return QUESTS.filter((q) => q.giver === npcId);
}

/* A one-line reading of what is still wanted, for the Undertakings list. */
export function objectiveText(q, progress) {
  const o = q.objective || {};
  const got = progress || 0;
  if (o.kind === 'slay') return o.count > 1 ? `slain ${got}/${o.count}` : (got ? 'slain' : 'not yet slain');
  if (o.kind === 'gather') return `${got}/${o.count} carried`;
  if (o.kind === 'reach') return got ? 'reached' : 'not yet reached';
  return '';
}
