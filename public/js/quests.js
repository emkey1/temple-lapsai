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
 *   giver     npc id whose dialogue offers it — or null when via is set
 *   via       optional 'library': offered on the Black Library's petition, not by a person
 *   faction   optional faction id the favour answers to, overriding the giver's own
 *   requires  optional { quest } — a chain, only offered once that one is done
 *   opens     optional gate: { dungeonCleared } or { dungeonsCleared: [ids] } — not offered before then
 *   repeatable  true for a standing bounty: it pays, hands over the goods, and reopens
 *   offer     what the giver says when they put it to you
 *   accepted  what they say as you take it
 *   objective one of:
 *               { kind: 'slay',    monster: id,      count: n }
 *               { kind: 'slayAny', monsters: [ids],  count: n }   (a cull: any of a set)
 *               { kind: 'gather',  item: id,         count: n }
 *               { kind: 'reach',   dungeon: id,      floor: n }   (floor is 0-based)
 *               { kind: 'deliver', item: id, dungeon: id, floor: n }  (carried there, handed over on arrival)
 *               { kind: 'altar',   count: n }                     (the rite kept at n distinct altars)
 *               { kind: 'cleared', dungeons: [ids] }              (read off the chronicle)
 *               { kind: 'all',     of: [ ...objectives ] }        (every part, in any order)
 *   turnIn    true if the giver must be spoken to again to close it; false closes
 *             it in the field the moment it is satisfied, and `done` reads as narration
 *   reward    { gold, xp, item }  — any subset
 *   done      what the giver says when it is closed
 *   journal   the line written into the run's own record
 *
 * A `gather` quest CONSUMES its items at turn-in; a `slay` counts kills from
 * the moment it was accepted, which is the only reading that is not a lie
 * when the player has already cleared half a floor. `slayAny` counts the same
 * way, off any of its set. A `deliver` consumes on arrival, not at a counter.
 */

export const QUESTS = [
  /* THE FIRST ENTRY. The two undertakings that teach the work to somebody who
   * has just walked in: take a job, kill what is between you and the loot, and
   * come back to be paid. They sit first in the list so they are the first
   * thing the hermit offers, and the second waits on the first. */
  {
    id: 'the-first-entry',
    name: 'The First Entry',
    giver: 'hermit-ogil',
    offer:
      'Ogil looks you over once, from the boots up, and finds you new. “You came down. ' +
      'That is more than most who stand where you are standing. Before the four families ' +
      'will hear your name, thin the greeters on this top floor — the rats and the little ' +
      'green things. Three will do. Take what they leave, do not die, and bring yourself ' +
      'back up the stairs to be paid. The work is the same all the way down. Only the ' +
      'names on the ledger change.”',
    accepted: '“Three, then. Mind the water — it is loud, and things hear it.”',
    objective: { kind: 'slayAny', monsters: ['rat', 'giant-rat', 'giant-spider', 'goblin', 'kobold', 'giant-ant', 'centipede'], count: 3 },
    turnIn: true,
    reward: { gold: 60, xp: 90 },
    done:
      '“Three, and you still have your fingers.” Ogil counts the coin out slowly, the way ' +
      'he does everything. “Now you are a name on the book and not a question in the margin. ' +
      'The four families will talk to you now. So will worse.”',
    journal: 'The company made its first entry, and Ogil entered it against a name.',
  },
  {
    id: 'the-first-rite',
    name: 'The Rite Kept',
    giver: 'hermit-ogil',
    requires: { quest: 'the-first-entry' },
    offer:
      'A nod at the cold stones along the wall. “There is an altar on every floor, and no ' +
      'two delvers treat it the same. Set your hands on one and say the words — it will ' +
      'close what sitting down cannot, and it will unmake what has hold of you. It gives ' +
      'once, to each of you, and then it is only stone. Keep the rite; you will want it ' +
      'before the bottom.”',
    accepted: '“Any altar will do. They are all kept by the same absent clergy.”',
    objective: { kind: 'altar', count: 1 },
    turnIn: true,
    reward: { gold: 40, xp: 60 },
    done:
      '“So you know it now, and the next one will not be the last.” Ogil sets the coin down ' +
      'beside the blade. “Every one of those was kept up by somebody who was never paid for ' +
      'it and never stopped. That is the whole of this hill, in one sentence. You will ' +
      'understand it better the deeper you go.”',
    journal: 'The company kept the old altar-rite, and Ogil paid for the lesson.',
  },
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

  {
    id: 'the-assayers-weights',
    name: 'The Assayer\u2019s Weights',
    giver: 'tallyman-ress',
    faction: 'tallymen',
    opens: { dungeonCleared: 'upper' },
    offer:
      'Ress has a column open and a pen waiting. “The west hill is a foundry and the foundry ' +
      'keeps a scale, and the scale has not been read in four hundred years. The table has ' +
      'carried the discrepancy in silence the whole time — an unmade count, which is worse than ' +
      'a wrong one. Go down the Emberworks and close the last weighing. You will know it when ' +
      'you are standing under it; it is the only thing down there that is level.”',
    accepted: '“The Assayer, at the bottom, under the scale. Bring back a number, any number.”',
    objective: { kind: 'slay', monster: 'assayer', count: 1 },
    turnIn: true,
    reward: { gold: 520, xp: 760 },
    done:
      '“Read.” Ress sets the pen down and does not pick it up again for a moment. “Four hundred ' +
      'years of an open column, and the number balances. The table thanks you. It does not do ' +
      'that often, and it does not do it loud.”',
    journal: 'The Assayer\u2019s scale was read at last, and the Table closed four centuries of column.',
  },

  {
    id: 'the-open-column',
    name: 'The Open Column',
    giver: 'ember-clerk',
    faction: 'lore-weavers',
    opens: { dungeonCleared: 'upper' },
    offer:
      'Otway turns the ledger toward you, and the column at the foot of the page has no number ' +
      'in it. “I can read a thing once the archive can name it, and the archive cannot name ' +
      'what is still walking around down here being not-quite-dead. Put down four of the ' +
      'foundry\u2019s dead — the wights, the wraiths, the thing at the bellows — and I can write ' +
      'them off, and the page comes one line closer to closing.”',
    accepted: '“Four. The dead ones, not the dogs. The dogs were never on the books; that is the tragedy of the dogs.”',
    objective: { kind: 'slayAny', monsters: ['forge-wight', 'ash-wraith', 'bellows-fiend'], count: 4 },
    turnIn: true,
    reward: { gold: 320, xp: 430 },
    done:
      '“Four, and named.” Otway writes each one down and does not hurry it. “The archive can hold ' +
      'them now, which is more than the fire ever did. You have shortened a column that has been ' +
      'open since before your town had a name.”',
    journal: 'The company put four of the Emberworks\u2019 restless dead on the Archive\u2019s page.',
  },

  /* --- THE WIDENED LEDGER. Three givers, three factions, and a ladder the
   * content finally climbs. Ogil keeps the spine; Eilyth and Venn get the
   * depth their lore always promised. --- */
  /* Ogil — the statues that stopped waiting. Teaches the multi-count slay and
   * plants the Standing Order before a single bone with orders is met. */
  {
    id: 'the-count-the-building-keeps',
    name: 'What Stands in Doorways',
    giver: 'hermit-ogil',
    offer:
      'Ogil does not look up from the blade. “You will have passed them — the guards in the ' +
      'niches, carved to stand and never once needed to. Eight years back one of them was ' +
      'standing in a doorway that had been empty the day before, and now they are in every ' +
      'doorway on the lower floors, and the building has stopped being patient about the tally. ' +
      'I am not asking you to fix it. I am asking you to bring the count down before it reaches ' +
      'my stairs. The stone ones. Three will make the point.”',
    accepted: '“The carved guards that walk. Not the bones — the bones are only marching. The stone.”',
    objective: { kind: 'slay', monster: 'living-statue', count: 3 },
    turnIn: true,
    reward: { gold: 260, xp: 350 },
    done:
      '“Three fewer doorways watched.” Ogil sets the blade down. “I sat on that stone nine years ' +
      'and it never once looked back. Whatever the building is collecting, let it collect ' +
      'somewhere that is not the way up.”',
    journal: 'Ogil had the walking statues thinned before their count reached the Whetstone stairs.',
  },

  /* Ogil — turnIn: false. Pays the moment the work is done; he hears it in
   * the stone. The first field-closed undertaking in the ledger. */
  {
    id: 'the-stairs-are-swept',
    name: 'Ask Who Sweeps Them',
    giver: 'hermit-ogil',
    turnIn: false,
    offer:
      '“The stairs are swept. Ask yourself who sweeps them, and then go down anyway. Only — the ' +
      'things doing the sweeping have started taking their wage in flesh. Thin the greeters on ' +
      'the top floor. You do not need to climb back to tell me. I will hear the difference in ' +
      'the stone.”',
    accepted: '“No need to report it. When the sweeping stops, I will know.”',
    objective: { kind: 'slay', monster: 'skeleton', count: 4 },
    reward: { gold: 180, xp: 220 },
    done: 'Somewhere above, a hermit sets his blade across his knees and listens to stairs that have stopped sweeping.',
    journal: 'The temple’s swept stairs went quiet, and Ogil’s tally of the lost stayed where it was.',
  },

  /* Eilyth — the tally the tide keeps. */
  {
    id: 'what-the-sea-returns',
    name: 'The Tally the Tide Keeps',
    giver: 'priestess-eilyth',
    offer:
      'Eilyth wrings the water from her sleeve. “Twice a day the sea gives back what it took, and ' +
      'my order has counted every return since before we could write it down. Lately the count ' +
      'comes up short, and a short count is a debt somebody will be made to answer for. The flood ' +
      'carries up more than bones — gemstones, out of the drowned quarter. Bring me three the ' +
      'water gave up, and I will enter them where they belong, and mark your name beside the ones ' +
      'who brought them honestly.”',
    accepted: '“Three, out of the green water. Count them as you carry them. The sea does.”',
    objective: { kind: 'gather', item: 'gem', count: 3 },
    turnIn: true,
    reward: { gold: 320, xp: 380 },
    done:
      '“Counted, and entered, and let go.” She sets each stone on the wet rock a moment before ' +
      'putting it by. “The tally is whole again, and you are on the right side of it. That is a ' +
      'rarer place to stand than you would think, down here.”',
    journal: 'Eilyth entered three sea-returned gems into the tally, and the count came up whole.',
  },

  /* Eilyth — the Drain Toll. Chains off her boss, and sets the wererat crews
   * up as a power you are now on the wrong side of. */
  {
    id: 'the-toll-by-the-yard',
    name: 'A Road With Nothing On It',
    giver: 'priestess-eilyth',
    requires: { quest: 'the-route-still-runs' },
    offer:
      '“You have walked the low channels, so you have met the toll.” Her voice stays level. ' +
      '“Man-shaped, whiskered, charging by the yard for a road that was free before they were. ' +
      'They would rather bill you than kill you, and they would rather neither of us finished — ' +
      'a debt paid off is a road with nothing on it, and that is the one thing they cannot sell. ' +
      'I am not asking you to pay them. Thin the crews working the Chute and let the road be a ' +
      'road again.”',
    accepted: '“Four crews. The whiskered ones who ask for coin. The rats that only glow are no affair of yours.”',
    objective: { kind: 'slay', monster: 'wererat', count: 4 },
    turnIn: true,
    reward: { gold: 480, xp: 550 },
    done:
      '“Then the Chute runs free for a while.” Something almost like a smile. “They will crew it ' +
      'again — they always do — but tonight a delver walks it without paying, and that is the ' +
      'whole of what my order has ever wanted out of this water. Take the coin; it was theirs to ' +
      'begin with.”',
    journal: 'The wererat crews skimming the Chute were thinned, and the toll road ran free.',
  },

  /* Venn — the rent unpaid. */
  {
    id: 'the-rent-unpaid',
    name: 'Soft Gold, Cut Cheap',
    giver: 'keeper-venn',
    offer:
      'Venn turns a page he has plainly read to death. “You will find crowns down there — soft ' +
      'gold, cut cheap and made often. Understand what they were: not regalia. Rent. A crown was ' +
      'what a king handed over to walk these halls and come back up, and rent is meant to be ' +
      'handed over, not left lying in the dark where it never reaches a book. Bring me two the ' +
      'coils are still holding, and I will enter them against four hundred years of arrears. It ' +
      'will not balance the page. Nothing will. But it will be entered, and that is not nothing.”',
    accepted: '“Two. Tarnished, most of them. Do not wear one down there — that is exactly the mistake the rent was invented to prevent.”',
    objective: { kind: 'gather', item: 'crown', count: 2 },
    turnIn: true,
    reward: { gold: 340, xp: 520 },
    done:
      '“Two, entered and witnessed.” Venn writes a moment longer than the entry needs. “Kesh came ' +
      'back up without his, and would not say what he had agreed to. You have brought two back ' +
      'into the light where they can be counted. The page is closer to correct than it has been ' +
      'in my lifetime. Take the coin — it was rent once too, and it has finally been paid to the ' +
      'right desk.”',
    journal: 'Venn entered two tarnished crowns against four centuries of unpaid rent.',
  },

  /* Venn — the rotted hoods. Chains off his reach quest. */
  {
    id: 'the-hoods-rotted',
    name: 'The Gaze Is a Sentence',
    giver: 'keeper-venn',
    requires: { quest: 'venns-question' },
    offer:
      '“You came back from the bottom, so you can read a ledger of the dead as well as I can.” ' +
      'Venn taps the open page. “The commonest cause I have written these eleven years is the ' +
      'gaze. The basilisks were hooded once, by whoever kept them, and the hoods have rotted, ' +
      'and no one has been issued new ones — that is this entire place in one sentence. I cannot ' +
      'restock a hood. You can close an eye. Put down the ones going bare, and my causes of ' +
      'death will read a little less like a single word repeated.”',
    accepted: '“Three, if you can manage it without looking. Do not look beneath where the hood should be. That is the whole of the technique.”',
    objective: { kind: 'slay', monster: 'basilisk', count: 3 },
    turnIn: true,
    reward: { gold: 560, xp: 700 },
    done:
      '“Three fewer sentences handed down in the dark.” Venn writes it in the margin, small and ' +
      'satisfied. “I have recorded a hundred deaths by that gaze and never once been able to do ' +
      'anything about the cause. You have done something about the cause. It is entered. So is ' +
      'your name — in the column that is not the dead one.”',
    journal: 'Venn struck three basilisks off the ledger of deaths still to be written.',
  },

  /* --- THE STANDING BOUNTIES. Repeatable: they never leave the list, so a
   * faction can be climbed from stranger to one of their own. --- */
  {
    id: 'carriers-standing-order',
    name: 'The Standing Order of Salvage',
    giver: 'hermit-ogil',
    repeatable: true,
    offer:
      '“The four families do not stop buying because you brought them some once. Gems, crowns, ' +
      'idols — the hill is full of what they want and their coin does not run out. Bring back ' +
      'what you find and I will see it reaches the right door. Every time. That is the job.”',
    accepted: '“Whatever the hill is holding. You know the door by now.”',
    objective: { kind: 'gather', item: 'gem', count: 2 },
    turnIn: true,
    reward: { gold: 150, xp: 120 },
    done: '“Entered and paid. The door is still open — it is always open. That is the point of it.”',
    journal: 'Another load of salvage went up to the four families, and the coin came back.',
  },
  {
    id: 'what-rides-the-flood',
    name: 'What Rides the Flood',
    giver: 'priestess-eilyth',
    repeatable: true,
    offer:
      '“The sea gives back what it took, and some of what it gives back should not walk.” Eilyth ' +
      'nods at the green water. “The leeches ride the flood up out of the drowned quarter and ' +
      'stay. Thin them when you are down there. It is not a task with an end to it. The tide ' +
      'keeps its word twice a day, and so must we.”',
    accepted: '“Three at a time. They will keep coming. So will you.”',
    objective: { kind: 'slay', monster: 'giant-leech', count: 3 },
    turnIn: true,
    reward: { gold: 160, xp: 140 },
    done: '“Counted and let go. The next flood will bring more — it always does. Come back when it does.”',
    journal: 'The Sisters’ count of what rides the flood was brought a little nearer true.',
  },
  {
    id: 'the-coils-kept',
    name: 'Keeping the Coils',
    giver: 'keeper-venn',
    repeatable: true,
    offer:
      '“Reverence here meant crawling, and the halls wind because of it — but the snakes have ' +
      'stopped being a metaphor and started being an infestation.” Venn makes a small, precise ' +
      'mark. “Keep the fangs down and the procession might one day walk upright again. It is ' +
      'maintenance, not heroism. Maintenance is what outlives people.”',
    accepted: '“Three, each time you pass. Enter it yourself if you like; the column is open.”',
    objective: { kind: 'slay', monster: 'giant-snake', count: 3 },
    turnIn: true,
    reward: { gold: 170, xp: 150 },
    done: '“Entered. The coils are a little more themselves tonight. The page is open to you whenever the fangs grow back.”',
    journal: 'Venn entered another cull in the open column, and the coils were kept a while longer.',
  },

  /* --- THE UNMET POWERS. Four factions had standing tracked and nobody to
   * earn it from. These give them a door. --- */

  /* The Tallymen — an intro cull. The building is collecting for itself and
   * it is bad for traffic. */
  {
    id: 'the-legible-entries',
    name: 'Keeping the Entries Legible',
    giver: 'tallyman-ress',
    offer:
      'Ress does not look up from the book. “The garrison below was posted to see a tithe ' +
      'delivered. The tithe stopped and the posting did not, and now the building collects for ' +
      'itself — bones with marching orders, counting whatever walks. It makes the entries hard ' +
      'to read and the traffic hard to move. Bring the count down. Five of the ones that ' +
      'remember their orders, whatever shape the remembering takes.”',
    accepted: '“Five. The marching kind, not the crawling kind. We will mark the traffic improvement.”',
    objective: { kind: 'slayAny', monsters: ['skeleton', 'zombie', 'ghoul', 'ghast'], count: 5 },
    turnIn: true,
    reward: { gold: 300, xp: 400 },
    done:
      '“Five fewer entries written in a hand we cannot read.” Ress makes a mark and turns the ' +
      'book an inch toward you, which from a tallyman is a handshake. “The traffic will notice ' +
      'before the bones do.”',
    journal: 'The Tallymen had the building’s collectors thinned, for the sake of legible entries.',
  },

  /* The Standing Order, through the Tallymen's other half of the book — the
   * `all` shape: two parts, either order. Cull the collectors AND carry the
   * tithe down to where it was always owed. */
  {
    id: 'the-long-arrears',
    name: 'The Long Arrears',
    giver: 'tallyman-ress',
    faction: 'standing-order',
    requires: { quest: 'the-legible-entries' },
    offer:
      'Ress opens the book to a page that is mostly empty. “The tithe was crowns — soft gold, ' +
      'carried down and handed over at the bottom of the serpent’s halls, every year, until it ' +
      'was not. That entry has been open longer than you have been alive, and it is the one we ' +
      'cannot close. Two things, then, in whatever order you manage them. Carry the arrears ' +
      'down to the last landing and leave them where the tithe was always left. And cull the ' +
      'collectors who have been keeping it for themselves. When the page balances, the order ' +
      'below will know it before we do.”',
    accepted: '“The crowns go to the bottom of the serpent’s halls. The bones go back to being bones. Both, and the book closes.”',
    objective: {
      kind: 'all',
      of: [
        { kind: 'deliver', item: 'crown', dungeon: 'serpent', floor: 3, count: 2 },
        { kind: 'slayAny', monsters: ['skeleton', 'zombie', 'ghoul', 'ghast'], count: 5 },
      ],
    },
    turnIn: true,
    reward: { gold: 700, xp: 900 },
    done:
      'Ress reads the page twice, then writes a single line and closes the book with a sound ' +
      'like a lid on a coffin. “The tithe is delivered and the collectors are collected. Four ' +
      'hundred years of arrears, and the last entry in a steady hand. The order below stands a ' +
      'little easier tonight — and so does the rate.”',
    journal: 'The tithe reached the bottom of the serpent’s halls at last, and the long arrears were closed.',
  },

  /* The Tallymen's standing bounty — the building keeps collecting, so the
   * cull never really ends, and each time the table counts you a little more
   * its own. This is how the friend's rate is earned down. */
  {
    id: 'the-traffic-moves',
    name: 'Keeping the Traffic Moving',
    giver: 'tallyman-ress',
    repeatable: true,
    offer:
      'Ress turns the book to a fresh column. “The building does not stop collecting because you ' +
      'thinned it once. The bones come back to their orders the way water comes back to a drain. ' +
      'Keep the count down and the traffic moves, and a road that moves is a road we can keep a ' +
      'book on. Every time. The table does not forget a steady supplier, whatever it supplies.”',
    accepted: '“Three of the marching kind, as often as you pass. The column is open.”',
    objective: { kind: 'slayAny', monsters: ['skeleton', 'zombie', 'ghoul', 'ghast'], count: 3 },
    turnIn: true,
    reward: { gold: 140, xp: 130 },
    done:
      '“Three fewer, and the stairs read a little easier.” Ress writes it in the open column ' +
      'without looking up. “The rate remembers a friend of the table. Come back when the count ' +
      'climbs again — it will.”',
    journal: 'The Tallymen’s column stayed open, and the building’s collectors were kept down another while.',
  },

  /* The Drain Toll — repeatable freight. Their whole model is a road with
   * traffic on it; carrying their freight is how you get counted a payer. */
  {
    id: 'the-freight-runs',
    name: 'The Freight Runs',
    giver: 'drain-factor',
    repeatable: true,
    offer:
      'The factor taps a sealed crate with one claw. “Stock that needs to move down the Chute ' +
      'and buyers who do not like to climb. An idol, sealed, to the third landing — do not open ' +
      'it, do not drop it in the water, do not ask what a carved god wants at the bottom of a ' +
      'drain. Carry it and the rate on your own passage comes down. There is always another ' +
      'crate. That is the point of a road.”',
    accepted: '“One idol, third landing, sealed. Bring me another when you have done it and we will call you reliable.”',
    objective: { kind: 'deliver', item: 'statuette', dungeon: 'upper', floor: 3, count: 1 },
    turnIn: true,
    reward: { gold: 120, xp: 100 },
    done:
      'The factor slits the seal, checks the carve, and makes a mark. “Delivered and dry. You ' +
      'are written down as paid — most prefer it. Another crate when you are ready; the Chute ' +
      'does not empty.”',
    journal: 'A crate of sealed freight went down the Chute, and the Drain Toll counted the company reliable.',
  },

  /* Eilyth — the altar-rite. The Drowned Sisters keep a rite; the old words
   * answer at altars the flood forgot. */
  {
    id: 'the-old-words',
    name: 'The Rite Is Still Kept',
    giver: 'priestess-eilyth',
    offer:
      'Eilyth is quiet for a moment. “There are altars down here, in the dry rooms the flood ' +
      'never reached, and somebody kept the rite at them long after the last of them stopped ' +
      'being paid to. My order kept a rite too, at the water. Ours is the only one left, and it ' +
      'is thin. Set your hands on the cold altars and say the old words are not dead. Three of ' +
      'them, wherever they still stand. It is not for the sea. It is for whoever kept them.”',
    accepted: '“Three altars, three different rooms. You will know them by the cold. The words know themselves.”',
    objective: { kind: 'altar', count: 3 },
    turnIn: true,
    reward: { gold: 280, xp: 380 },
    done:
      '“Three kept, then.” She closes her eyes as if listening for something very far off. “The ' +
      'rite is not a debt and it is not a toll. It is only a thing somebody decided was worth ' +
      'doing after there was no one left to pay for it. You understand. The coin is beside the ' +
      'point, but take it.”',
    journal: 'The old altar-rite was kept at three cold altars, for whoever had kept it before.',
  },

  /* THE LONG ACCOUNT, CLOSED. The capstone — the Lore-Weavers' whole want,
   * posted on the Black Library's petition rather than spoken by anyone,
   * because they keep no account of you. Clears when the founding chronicle
   * does, and closes itself in the field. */
  {
    id: 'the-long-account-closed',
    name: 'The Long Account, Closed',
    giver: null,
    via: 'library',
    faction: 'lore-weavers',
    turnIn: false,
    offer:
      'A page hangs in the Black Library where no one recalls pinning it, in a hand that has ' +
      'clearly been waiting to be read for a very long time. It lists the three sanctums by ' +
      'name, and under them a single sentence: the Weavers want the Long Account closed so ' +
      'they can go back to writing, and they have wanted it for four hundred years. Bring the ' +
      'Temple, the Reaches and the Coils all to quiet, and something left on the Archive’s ' +
      'shelves will be yours — they keep no account of you, but they pay their debts.',
    accepted: 'The page does not change, but the three names on it now read like a list you have agreed to.',
    objective: { kind: 'cleared', dungeons: ['temple', 'upper', 'serpent'] },
    reward: { xp: 1000, item: 'ring-arcana' },
    done: 'Deep in the Library, a page four hundred years old is finally taken down, and the scratching of pens goes back to something it would rather be writing.',
    journal: 'The three sanctums went quiet, the Long Account closed, and the Lore-Weavers paid a debt they never spoke of.',
  },

  /* THE DROWNED QUARTER'S OWN. Liss, who kept the lamp lit, wants the water let
   * out — which means stopping the thing that shut the sluices. */
  {
    id: 'the-sluices',
    name: 'Open the Sluices',
    giver: 'liss',
    faction: 'drowned-sisters',
    offer:
      'Liss sets the lamp down. “It was not a flood. Somebody shut the sluices when the water ' +
      'came, and the water has been shut in with us ever since. The thing that shut them still ' +
      'tends them, down at the last landing, and it cannot be argued out of a duty it drowned ' +
      'doing. Put it down, and the sluices open, and the lower town comes back up for whoever ' +
      'is left to see it. I would like to see it.”',
    accepted: '“The Tidewright, at the last landing, where the water is deepest. Do not try to relieve it. Only stop it.”',
    objective: { kind: 'slay', monster: 'tidewright' },
    turnIn: true,
    reward: { gold: 600, xp: 900 },
    done:
      'She is quiet a long moment when you tell her. “Then it is done, and the water will go ' +
      'down, in a season, or in a year.” She looks at the lamp. “I will keep this lit until the ' +
      'lower streets are dry enough to walk in. Even if it is only me that walks them.”',
    journal: 'The Tidewright was stopped at the sluices, and the drowned quarter was given back to the water it was shut into.',
  },

  /* --- THE TOWNSFOLK ASK FOR THINGS TOO. The people you walk past in a town
   * were voices and nothing more; the ones with a want now put it to you. --- */

  /* Orrin, the Far Reach's salvager — the four families' trade, down the coast. */
  {
    id: 'what-the-water-keeps',
    name: 'What the Water Keeps',
    giver: 'reach-salvager',
    faction: 'carriers-ubtao',
    offer:
      'Orrin does not stop sorting as he talks. “The sea keeps things a while, and then hands them up, ' +
      'and where it hands them up is the drowned quarter, and I am the only man on this coast who pays ' +
      'for what it gives. Crowns — soft gold, cut cheap — come up green, and I buy them green. Two will ' +
      'do. The families up the hill want them, and I want rid of them. Both of us are easy to please.”',
    accepted: '“Two crowns, out of the water. The water will not mind losing them again. I will.”',
    objective: { kind: 'gather', item: 'crown', count: 2 },
    turnIn: true,
    reward: { gold: 420, xp: 520 },
    done:
      'Orrin weighs each one, nods, and pays without haggling. “Green, but sound. The four families will ' +
      'melt them down and never ask where they were kept. That is the arrangement, and it has outlasted ' +
      'everyone who made it. Take the coin — it is theirs, and they will not miss it.”',
    journal: 'Two crowns the sea had been keeping went up the coast to the four families.',
  },

  /* Essa, the netmender — what comes up in the nets. */
  {
    id: 'what-comes-up-in-the-nets',
    name: 'What Comes Up In The Nets',
    giver: 'reach-netmender',
    faction: 'drowned-sisters',
    offer:
      'Essa knots a net by feel and does not look up. “Things come up in the nets. Brine hounds, mostly, ' +
      'and the drowned things that used to be somebody. They cut the net and they smell of the water and ' +
      'I will not go down after them — nobody sensible would. You go down. Thin them, and my nets last a ' +
      'season longer. Four will do it.”',
    accepted: '“Four, out of the green streets. And if one of them is wearing a face you know, it will not know you.”',
    objective: { kind: 'slayAny', monsters: ['brine-hound', 'drowned-thing'], count: 4 },
    turnIn: true,
    reward: { gold: 380, xp: 480 },
    done:
      '“Four fewer cutting my nets.” Essa still does not look up, which is how she thanks people. “Cheaper ' +
      'than the net I would have lost. Mind the water, and take your coin.”',
    journal: 'Essa the netmender’s nets were kept whole, and what rides the drowned streets was thinned.',
  },

  /* Maren, the ferrier’s widow in the Whetstone — her Aldous. */
  {
    id: 'aldous-still-down-there',
    name: 'Still Down There',
    giver: 'maren',
    faction: 'tallymen',
    offer:
      'Maren does not offer you a seat. “My Aldous went down for the temple, and came back up as a bill ' +
      'for boots and a line in the Tallymen’s book. I paid it. But he is still down there, in the marching ' +
      'kind, and I will not have him on a roster of things to be killed. Put his like out — the bones that ' +
      'walk the low floors. Four, and I will be able to say him at rest.”',
    accepted: '“The marching kind, low down. Do not look too closely at the faces. None of them is his. All of them is somebody’s.”',
    objective: { kind: 'slayAny', monsters: ['skeleton', 'ghoul'], count: 4 },
    turnIn: true,
    reward: { gold: 300, xp: 420 },
    done:
      'Maren sets the boots by the door, where they have always been. “Four, then, and one of them maybe ' +
      'him. I will not ask which.” She counts out the Tallymen’s coin, exact. “At rest. Say it at the ' +
      'counter and they will enter it against his name.”',
    journal: 'The ferrier’s widow had the temple’s marching bones thinned, and called her husband at rest.',
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
  if (o.kind === 'slay') {
    return o.count > 1 ? `slain ${got}/${o.count}` : (got ? 'slain' : 'not yet slain');
  }
  if (o.kind === 'slayAny') return `culled ${got}/${o.count}`;
  if (o.kind === 'gather') return `${got}/${o.count} carried`;
  if (o.kind === 'reach') return got ? 'reached' : 'not yet reached';
  if (o.kind === 'deliver') return got ? 'delivered' : 'not yet delivered';
  if (o.kind === 'altar') return `the rite kept at ${got}/${o.count} altars`;
  if (o.kind === 'cleared') {
    const n = (o.dungeons || []).length;
    return `${got}/${n} sanctums quiet`;
  }
  if (o.kind === 'all') return `${got}/${(o.of || []).length} parts done`;
  return '';
}
