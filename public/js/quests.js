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
    giver: 'priestess-eilyth',
    offer:
      'Eilyth does not look up. “There is a god asleep at the bottom of the Temple with its ' +
      'mouth open, and the mouth is the point — it was left open to be fed. I do not need it ' +
      'explained. I need it stopped. Go down and put the Demon of Lapsai out, and I will give ' +
      'you what the order kept back for whoever finally did.”',
    accepted: '“Four floors. It is at the bottom. It has always been at the bottom.”',
    objective: { kind: 'slay', monster: 'demon', count: 1 },
    turnIn: true,
    reward: { gold: 250, xp: 400, item: 'potion-major-heal' },
    done:
      '“Then it is out.” She finally looks up. “Thirty years of us saying the mouth was ' +
      'shut. Take this, and do not tell me what was in the bronze room.”',
    journal: 'The Demon of Lapsai was put out, and Eilyth paid what the order had kept back.',
  },

  {
    id: 'venns-question',
    name: 'Where the Hands Went',
    giver: 'keeper-venn',
    opens: { dungeonCleared: 'temple' },
    offer:
      'Venn has the look of a man resuming a sentence. “You have seen the hands — cupped at ' +
      'the shoulder, cupped at the hip, every one of them carrying something in. It is not in ' +
      'the halls. It is not on the floor. I have had thirty years to look and I have not moved ' +
      'the question an inch. Go where I cannot: the Upper Reaches, all the way to the head of ' +
      'the works, and tell me what is down there.”',
    accepted: '“The head of the works. The fourth floor. Whatever it costs you, I have paid more.”',
    objective: { kind: 'reach', dungeon: 'upper', floor: 3 },
    turnIn: true,
    reward: { gold: 300, xp: 500 },
    done:
      '“So that is where it went.” Venn is quiet a while. “Thirty years, and the answer was ' +
      'four floors of water. Take the money. I have no more use for it than the hands had.”',
    journal: 'Venn learned where the carved hands had emptied themselves, after thirty years.',
  },

  {
    id: 'the-long-account',
    name: 'The Long Account',
    giver: 'hermit-ogil',
    requires: { quest: 'idols-for-ogil' },
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
