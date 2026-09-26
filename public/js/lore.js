/* THE LORE — "The Long Account".
 *
 * Content only, no logic: world.js registers this on import and the engine
 * reads it through the queries there. Everything in this file is player-facing
 * prose, so it can be edited by anyone who can count commas.
 *
 * THE SPINE, so an edit does not accidentally unpick it: there is no ancient
 * evil under the hill. There is an appetite, an arrangement, and four hundred
 * years of unpaid interest. The city of Marn fed the thing beneath it on a
 * schedule and called the schedule religion. The three dungeons are one system
 * — the temple is the mouth, the drains are the delivery, the Coils are where
 * the contract is kept — and delvers are the instrument of payment the account
 * is currently drawing on. The scribes at the threshold raise the dead because
 * a payment that walks back down is worth more than one that stops.
 *
 * The vocabulary is commercial, not mythic: account, ledger, arrears, rate,
 * remit, tally, in kind. Nobody says prophecy. Nobody is chosen.
 *
 * SHAPES (see world.js):
 *   history   { era, title, text }
 *   factions  { id, name, stance, note }
 *   storyArcs { id, dungeonId, name, beats: [ beat ] }
 *   npcs      { id, name, title, dungeon, floor, color, intro,
 *               knowledge, topics: [ { keys, replies } ], fallbacks }
 *
 * A beat fires at (dungeonId, kind, floorIdx). kind is enter | boss | finish |
 * condition; type is narration (message log) | overlay (full card) | flag.
 * `floor` is ZERO-BASED. Beats fire once per character.
 *
 * DIALOGUE: topics are matched by substring against what the player types, and
 * the FIRST match wins — so a topic carrying a short common key ('god', 'door')
 * must sit BELOW the specific topics it would otherwise swallow.
 */

export const LORE = {
  history: [
    {
      era: 'Before the Account',
      title: 'The Hill and the Hole',
      text: 'Marn was a good city on a bad hill. It had a forge-quarter, a harbour, and storm-drains cut well enough that a man could walk them upright. It also had a hole, and no clerk troubled to write down who found it or what finding it cost him. What did get written down, early and in a plain hand, was the habit of the thing: when something went into the hole the hill stayed where it was, and when nothing went in, it did not. Marn was a practical city. They called it the landlord, and their grandchildren called it a god, which is the usual sequence.'
    },
    {
      era: 'The Bronze Age of Lapsai',
      title: 'A Thousand Years of Paying On Time',
      text: 'The arrangement got vestments, a building, and a calendar. Masons cut a bronze sanctuary over the hole so the mouth could be fed without anyone having to look at it, and they hung the door to open outward with the bar on the near side. Guard-statues were carved facing inward and gargoyles were fixed at the low doors. A garrison was raised under orders to see the tithe delivered, which is not the same as orders to keep anyone out. Kings were crowned in soft gold, cheap and made often, one after another, and each of them signed. The payments landed on time, the hill did not move, and Marn called all of this piety.'
    },
    {
      era: 'The Short Century',
      title: 'The Arithmetic Runs Out',
      text: 'The century that ended Marn was short because the sum was simple: the payments grew and the city did not. First the condemned went down, then the debtors, then the volunteers — priests who had the schedule memorised and no argument left against it. The forge-quarter emptied first, being nearest the Chute. The Carriers of Ubtao stood up in council, said the only honest thing anyone said that century — stop paying and leave — lost the vote, and left anyway with their gods under their arms. By the end the Tally-House was running Marn, because the Tally-House was the last office that still knew what was owed.'
    },
    {
      era: 'The Drowning',
      title: 'The Route Goes Under',
      text: 'There was no war. There was a bad decade, a shortfall, a fire in the forge-quarter, and a sluice-crew that was not replaced. When the Chute jammed, the standing remedy was to cut the flood sluices and wash it through; someone signed the work-order, the crew cut them in one night, and the sea came up the works and never went back out. The lower drains went under and stayed under, and the receiving became tidal — a rite performed twice a day in cold water by women who called themselves Drowned Sisters and were, on the surviving paperwork, receiving clerks. Whatever the drowned end of the arrangement had been called before went under with the ledgers; the Sisters say the old sea-god and leave it there. Somewhere in this stretch something began chewing upward out of the Coils into the warrens, and it left the hole open behind it, and the hole is open still.'
    },
    {
      era: 'The Long Account',
      title: 'The Crown Goes Down',
      text: 'Kesh was king of Marn for eleven years, and he was not the first king to walk down into the Coils with the crown on. He was the last to come back up without it, and he lived two more years and would not say what he had agreed to. What wears it now was already in the deep sanctum when he got there — the Serpent God’s last hatching, grown up inside its dead parent — and it was the only thing in the room with a free hand. Since that afternoon the Long Account has been kept down among the coils and administered upward — a table at the threshold, a count taken twice daily in cold water, and a keeper alone in the dark with a ledger that has not been correct in four hundred years and nobody coming up the hall to tell him why. The Black Library shut its doors that same year and has not written a line since. Marn is four hundred years gone; the schedule is not, and it is kept out of whatever walks in.'
    }
  ],
  factions: [
    {
      id: 'tallymen',
      name: 'The Tallymen of the Whetstone',
      stance: 'Cordial. Creditors usually are.',
      note: 'The table at the bottom of the swept stairs, and the near half of a book you will never be shown. They want the entries legible and the traffic steady, and they will haul you back from the threshold as often as you can pay for it — half your gold, every time, because half is the standing rate and rates are not negotiated. They will not explain the arrangement to you; a delver who understood it would be a worse delver. Their kindness at the door is real, and so is a lender’s.'
    },
    {
      id: 'lore-weavers',
      name: 'The Lore-Weavers of the Black Library',
      stance: 'Watching. They keep no account of you, which is the kindest thing anyone down there does.',
      note: 'The other half of the same order, split in the year the crown went down. They want the Long Account closed so they can go back to writing, and they have wanted it for four hundred years — long enough to learn patience, and long enough to learn thieving. The motes drifting off a Ring of the Archive are scrapings from pages they were forbidden to copy. They will not help you and they will not lie to you; they will sit with the doors shut and let a freelancer with a torch do what they will not.'
    },
    {
      id: 'drowned-sisters',
      name: 'The Drowned Sisters',
      stance: 'Hospitable. They will bless you and they will count you, in that order.',
      note: 'Eilyth’s order, standing in cold water twice a day to receive what the flood brings and to write down how much of it there was. They want the rite kept and the count honest, and they will bless anyone who asks, share salt and clean water, and warn you off the deep channels for nothing. It has never once occurred to any of them that the blessing and the tally are the same document. You are a guest. You are also an entry.'
    },
    {
      id: 'keepers-coils',
      name: 'The Keepers of the Coils',
      stance: 'Curious. He is glad you came and he will write down how you died.',
      note: 'An office of six, kept by one man for thirty years. He wants the procession restored and the books made correct, in that order, and he will teach the halls to anybody who asks — honestly, at length, and with the survey open. He has filed four times with the office at the threshold and had no reply, and he has decided the route is broken rather than that nobody is there.'
    },
    {
      id: 'carriers-ubtao',
      name: 'The Carriers of Ubtao',
      stance: 'Commercial. The only power down there that pays up front.',
      note: 'Four families of salvage and smuggling, descended from the ones who stood up in council, said stop paying and leave, lost the vote, and went anyway with their gods under their arms. They want everything portable out of the hill and are not embarrassed about it: cash for every idol, no questions asked, gear fronted to anyone who looks likely to come back. They will write a man off after three years and leave you standing the instant the tide turns, having told you plainly that they would. You are a supplier, and suppliers are replaced.'
    },
    {
      id: 'drain-toll',
      name: 'The Drain Toll',
      stance: 'Hostile, but negotiable. They charge by the yard.',
      note: 'Wererat crews who have been skimming the Chute where it crosses the warrens for a hundred years and would like the next hundred to go the same way. A debt with traffic on it is a toll road: they will guide you, gouge you, take payment in kind when your purse is light, and sell your route to the next crew before you have finished walking it. They are the only ones down here who would rather bill you than kill you, and the only ones who would rather you did not finish. A debt that gets paid off is a road with nothing on it. Freight that gets where it is going is freight they cannot charge twice.'
    },
    {
      id: 'standing-order',
      name: 'The Standing Order',
      stance: 'Indifferent. You are an entry in the file.',
      note: 'The garrison. Bones that remember marching orders, statues standing in doorways that were empty yesterday, gargoyles fixed at the low doors and still chewing. Their orders were to see the tithe delivered, and eight years ago the arrears crossed a line nobody wrote down, and the building began collecting for itself. They want nothing; wanting takes a person, and there has not been one here in four hundred years. You are not an intruder to them. You are delivery.'
    }
  ],
  storyArcs: [
    {
      id: 'arc-temple',
      dungeonId: 'temple',
      name: 'The Ruin Is Staffed',
      beats: [
        {
          kind: 'enter',
          floor: 0,
          type: 'overlay',
          title: 'THE WHETSTONE',
          text: 'The stairs are swept. There is a table at the bottom of them and a ledger open on the table, and nothing here is ancient — it is only poor.'
        },
        {
          kind: 'enter',
          floor: 0,
          type: 'flag',
          flag: 'whetstone-marks',
          valueCount: 418
        },
        {
          kind: 'enter',
          floor: 1,
          type: 'overlay',
          title: 'THE ALMONRY',
          text: 'A slot in the wall for the tithe and a slot in the floor for what would not pay. The weighing-stones are worn hollow in the middle. Nothing on this floor was ever built to store anything — everything on it was built to weigh a thing once and put it down the chute.'
        },
        {
          kind: 'enter',
          floor: 2,
          type: 'overlay',
          title: 'THE PREPARATION ROOMS',
          text: 'Kitchens, presses, linen by the bale. Every niche is empty, and every one of them faces the stair.'
        },
        {
          kind: 'condition',
          floor: 2,
          type: 'narration',
          text: 'You are worth more than you were on the stairs. Somewhere above you, a figure in a ledger is amended in a neat hand.'
        },
        {
          kind: 'enter',
          floor: 3,
          type: 'overlay',
          title: 'THE BRONZE SANCTUARY',
          text: 'The door is bronze and it opens outward. The bar is on this side, and the hinges were set by men who wanted it that way. A thousand years of masons agreed about which way the danger ran. Below the bar the metal is bellied toward you in a long shallow field, all of it at the height of a shoulder. Nothing has knocked from your side in four hundred years.'
        },
        {
          kind: 'boss',
          floor: 3,
          type: 'narration',
          text: 'It was never asleep. It was short, and it has been short for a hundred years.'
        },
        {
          kind: 'finish',
          floor: 3,
          type: 'overlay',
          title: 'THE ARREARS',
          text: 'The mouth is shut. Nothing rejoices. Below you the drains go on running, the same as they ran this morning and the same as they will run tonight, carrying what they carry to wherever they carry it. Somebody up the pipe has been going hungry on a schedule for a century, and it was not the thing on this floor. Tonight a one-eyed man on the flat stone above will cross out a single mark and not count the ones beside it.'
        },
        {
          kind: 'finish',
          floor: 3,
          type: 'flag',
          flag: 'mouth-silenced',
          valueCount: 1
        }
      ]
    },
    {
      id: 'arc-upper',
      dungeonId: 'upper',
      name: 'The Route Still Runs',
      beats: [
        {
          kind: 'enter',
          floor: 0,
          type: 'overlay',
          title: 'UPSTREAM',
          text: 'The works are named from the sea inward: the Far Reach at the outfall, the Upper Reaches at the head. Upper means upstream; it never meant up.'
        },
        {
          kind: 'enter',
          floor: 1,
          type: 'overlay',
          title: 'LOWER MARN',
          text: 'Doorways at chest height. Streets with roofs. There is a work-order still legible on a sluice-house wall, and it is signed, and the flood came from inside the city in one night.'
        },
        {
          kind: 'enter',
          floor: 2,
          type: 'overlay',
          title: 'THE SORTING HOUSE',
          text: 'A hundred years of other people’s gear, sorted by kind and stacked by size. Boots with boots, blades with blades, and none of it dropped here by accident.'
        },
        {
          kind: 'enter',
          floor: 2,
          type: 'flag',
          flag: 'sorting-house-found',
          valueCount: 1
        },
        {
          kind: 'condition',
          floor: 2,
          type: 'narration',
          text: 'The crews have stopped following you and started quoting you. That is a promotion of a kind.'
        },
        {
          kind: 'enter',
          floor: 3,
          type: 'overlay',
          title: 'THE BREACH',
          text: 'The hole is in the floor. Everything on this level was cut to keep water out, and this came the other way — up, through good stone, from underneath. The tunnel behind it is round, and warm, and wide enough to walk in upright, and it is plugged to the roof with the thing that cut it. Four hundred years of digging and the last twenty feet were never opened. It goes down.'
        },
        {
          kind: 'boss',
          floor: 3,
          type: 'narration',
          text: 'It was not guarding anything. It was the working head of a dig, and the dig was not finished.'
        },
        {
          kind: 'finish',
          floor: 3,
          type: 'overlay',
          title: 'THE LAST TWENTY FEET',
          text: 'You did not defeat the dig. You finished it — the last twenty feet of somebody else’s excavation, driven in the opposite direction, with a sword. The spoil goes down the way the water goes down and the way everything down here goes. Whatever cut it has had four centuries at the far end of it. Walk down and hand it the answer.'
        },
        {
          kind: 'finish',
          floor: 3,
          type: 'flag',
          flag: 'route-cut',
          valueCount: 1
        }
      ]
    },
    {
      id: 'arc-serpent',
      dungeonId: 'serpent',
      name: 'The Long Account',
      beats: [
        {
          kind: 'enter',
          floor: 0,
          type: 'overlay',
          title: 'THE PROCESSION',
          text: 'They are not crouching — look at the hands, cupped at the shoulder and cupped at the hip. Every one of them was carrying something in, and the stone caught them still carrying it.'
        },
        {
          kind: 'enter',
          floor: 1,
          type: 'overlay',
          title: 'THE CURRENT PAGE',
          text: 'Tally-marks, tide tables, and names with causes written beside them in a steady hand. A hundred of them, and a ruled line under the last one, waiting.'
        },
        {
          kind: 'enter',
          floor: 1,
          type: 'flag',
          flag: 'names-on-the-page',
          valueCount: 100
        },
        {
          kind: 'condition',
          floor: 1,
          type: 'narration',
          text: 'Your line in the book has run past its ruling and continued in the margin. Nobody down here writes in the margin for the short-lived.'
        },
        {
          kind: 'enter',
          floor: 2,
          type: 'overlay',
          title: 'THE CROWNS',
          text: 'Soft gold, cheap and made often, made to be handed over. Count them: more kings came down this hall than ever went back up it.'
        },
        {
          kind: 'enter',
          floor: 3,
          type: 'overlay',
          title: 'THE COILS',
          text: 'Count the chambers you came through. Every one of them narrowed. The walls here were never cut — they are ribbed, and the ribbing runs one way, and the way it runs is the way you are going. You have been inside the god since the door. It has been dead a long while, and it is still digesting.'
        },
        {
          kind: 'boss',
          floor: 3,
          type: 'narration',
          text: 'Not a beast on a hoard. A clerk in borrowed regalia, face down on four hundred years of paper.'
        },
        {
          kind: 'finish',
          floor: 3,
          type: 'overlay',
          title: 'THE COUNTING-HOUSE',
          text: 'The crown comes off easily. It was made to. Under it the floor is paper — four centuries of ruled columns, a dozen hands and then one hand, and your name among the last of them, entered on the hour you first walked in. Every purse the scribes ever halved at the threshold was halved against this account, and the debt it went to pay was never yours. The temple was not a tomb and the drains were not a ruin; it was a counting-house, you were the payment, and the desk at the door will go on remitting to an office that is not there any more.'
        },
        {
          kind: 'finish',
          floor: 3,
          type: 'flag',
          flag: 'account-unheld',
          valueCount: 1
        }
      ]
    },
    {
      id: 'arc-emberworks',
      dungeonId: 'emberworks',
      name: 'The Shift That Never Changed',
      beats: [
        {
          kind: 'enter',
          floor: 0,
          type: 'overlay',
          title: 'THE YARD',
          text: 'Ore heaped in graded piles, each with its chalk line and its tally. The piles have not been added to in a long time and they have not been taken from either. Whoever kept the count kept it exactly, right up to the last bar, and then put the chalk down where it still lies.'
        },
        {
          kind: 'enter',
          floor: 1,
          type: 'overlay',
          title: 'THE FLUE',
          text: 'The draught here pulls the same way it pulled when the hill was first cut, and it is warm, and it is steady. Something below is still drawing breath through this chimney. It has been drawing it for four hundred years and it has not needed to.'
        },
        {
          kind: 'enter',
          floor: 2,
          type: 'overlay',
          title: 'THE POUR',
          text: 'Channels of cooled metal run the length of the floor, each one ending in a mold and each mold full. They poured the last batch and they did not take it out and nobody came to. The metal has the sheen of something that set in a hurry.'
        },
        {
          kind: 'enter',
          floor: 3,
          type: 'overlay',
          title: 'THE ASSAY',
          text: 'A scale the height of two men, its pans level, and both pans empty. The beam does not move. Whatever this room used to weigh, it has not had anything put in a pan since the order came down to stop, and the order never came.'
        },
        {
          kind: 'boss',
          floor: 3,
          type: 'narration',
          text: 'It was the one who kept the weights. It is still keeping them.'
        },
        {
          kind: 'finish',
          floor: 3,
          type: 'overlay',
          title: 'THE BANKED FIRE',
          text: 'The bellows stops. It is the first silence the west hill has known in four hundred years, and the quiet is so complete that you can hear the scale settle, both pans level, both pans empty. Whatever the foundry was owed, it has been weighed and found to balance. Up the flue, the last of the heat goes out of the hill and does not come back, and above you the snow on the west slope begins, at last, to melt.'
        },
        {
          kind: 'finish',
          floor: 3,
          type: 'flag',
          flag: 'forge-banked',
          valueCount: 1
        }
      ]
    }
  ],
  /* THE KEEPER OF THE ACCOUNT. The one voice that is not a place and not a
   * person: whatever keeps the book the whole hill is written in. It speaks at
   * the moments the per-dungeon arcs cannot — the first blood, the first loss,
   * each sanctum shut — and it is the through line the arcs only hint at (the
   * neat hand in the temple's margin). Heard, never met; said once, never
   * twice. */
  keeper: {
    firstBlood: 'Somewhere up the line, something that had not been interested in anything for a long time becomes interested. A mark goes down beside a name, in a small neat hand. It is a small mark. They are all small at first.',
    fall: 'A companion is entered in the loss column, in the same hand, and the hand does not pause over it. It is the long column. It was always going to be the long column.',
    clears: [
      'One sanctum quiet, and the count above does not go down. It goes through. Whatever keeps the book has waited a long time for somebody to move a number, and you have moved one.',
      'Two. The hand is quicker now, and it has stopped pretending this is only bookkeeping. You are not an entry it is making any more. You are the sum it is carrying, and it does not care for where the sum is going.'
    ],
    closing: 'Three sanctums quiet, and the book is not full — it is finished, which is a different thing and a worse one for whoever kept it. Above you a lid is set down on something that has stood open for four hundred years. You have closed an account that outlived every clerk who ever touched it.'
  },
  /* THE REGION. What the world looks like from above: the hill and its stairs,
   * the town at the foot, and the names the stories keep promising. Coordinates
   * are percentages on the region map; a place with none is scattered by id. */
  region: {
    name: 'The Hill and the Reach',
    places: {
      'the-whetstone': { name: 'The Whetstone', x: 50, y: 70, note: 'the flat stone outside the lintel, and the town that grew up around it' },
      'far-reach': { name: 'The Far Reach', x: 85, y: 76, note: 'salt on the wind, a harbour of sorts, and a town that files the sea under losses' },
      temple: { name: 'The Temple of Lapsai', x: 34, y: 50, note: 'the swept stairs down, under the hill' },
      upper: { name: 'The Upper Works', x: 66, y: 42, note: 'the warrens, and the toll road they call the Chute' },
      serpent: { name: 'The Coils', x: 46, y: 24, note: 'the serpent halls beneath the last hill' },
      deep: { name: 'The Lower Ledger', x: 54, y: 9, note: 'the stair that does not stop' },
      drowned: { name: 'The Drowned Quarter', x: 14, y: 80, note: 'the lower town the sea gave back, and kept some of' },
      emberworks: { name: 'The Emberworks', x: 24, y: 44, note: 'the west hill, hollow and warm, where the fires were banked and never put out' }
    },
    landmarks: [
      { name: 'The Hill', x: 43, y: 36 },
      { name: 'The Chute', x: 76, y: 32 },
      { name: 'The Far Reach', x: 85, y: 76 },
      { name: 'The Drowned Quarter', x: 14, y: 80 },
      { name: 'The Cinder Flats', x: 18, y: 37 }
    ]
  },
  /* THE ROAD BETWEEN TOWNS. Short, and only now and then eventful. */
  road: [
    { text: 'The road runs quiet, and the company makes good time.' },
    { text: 'A toll-man takes a few coins for a bridge that is not a bridge.', gold: -15 },
    { text: 'A pedlar trades you a draught for the story of where you have been.', item: 'potion-heal' },
    { text: 'Something follows for a mile, and then does not. Nobody looks back twice.', hp: -3 },
    { text: 'A cart going the other way shares its fire, and its salt fish.', hp: 4 },
    { text: 'A scrap of a song, from a cart passing the other way, sticks for the rest of the walk.' },
    { text: 'A milestone cut with a name that has been struck out and cut again. Whoever is owed this road is owed it still.' },
    { text: 'A wayside grave with the toll of the last mile chalked on the stone. Nobody has collected it in years.', gold: 12 },
    { text: 'A dog with no collar walks a mile with the company, then turns off at a track that leads nowhere you can see.', hp: 3 },
    { text: 'Rain all afternoon, the kind that gets under the collar and stays there.', hp: -2 },
    { text: 'A half-buried chart in the verge, its inks still wet from the rain. You dry it and keep it.', item: 'scroll-identify' },
    { text: 'A stone marker for the high crossing, its distances planed down to blanks. The road is longer than it was.' },
    { text: 'A pedlar going the other way pays you a coin for the direction of the next town, and does not say why he is in a hurry.', gold: 8 }
  ],
  npcs: [
    {
      id: 'hermit-ogil', faction: 'carriers-ubtao',
      name: 'Ogil the Whetstone',
      title: 'a hermit with one good eye',
      dungeon: 'temple',
      floor: 0,
      color: 'amber',
      intro: '“Sharp edges keep softer men alive down here. I know this temple blade by blade. Ask, and I shall whet your wits as well.”',
      /* What he says instead, once the order behind him has noticed you. One
       * line per rung of the standing ladder; rank 0 keeps the intro. */
      recognise: [
        '“The blade, again.” Ogil does not look up. “Word came up the stairs ahead of you. You are a name the four families have heard now, which is more than most get.”',
        '“Sit, if you want.” A shift on the stone. “There is a place by the fire. It is not yours yet, but it is closer than it was.”',
        '“You,” he says, and means it as a greeting. “The families ask after you by name now. I do not tell them much. I am not paid to.”',
        'Ogil is already making room on the stone before you reach him. “There. Sit. You are the four families’ own now, and they will not hear a word against you in my hearing.”'
      ],
      knowledge: [
        'temple',
        'whetstone',
        'secret',
        'door',
        'statue',
        'treasure',
        'idol',
        'stairs',
        'bronze',
        'sanctuary',
        'scribe',
        'lapsai',
        'drains',
        'marks'
      ],
      topics: [
        {
          keys: ['eye', 'bronze', 'sanctuary', 'grille', 'lost your'],
          replies: [
            'I went to look through the grille of the bronze sanctuary and came back with one eye. That is the version I tell, and it is a useful version, because it keeps men out.',
            'The door down there is bronze. It opens outward and the bar is on this side. A thousand years of masons agreed about which way the danger ran, and not one of them was worried about you.'
          ]
        },
        {
          keys: ['drain', 'otyugh', 'sewer', 'warren', 'green water', 'forge'],
          replies: [
            'There are drains under this floor, and something three-legged that minds them. It is well fed and I have never worked out on what.',
            'Below the forge-quarter the whole works fills twice a day. Green water, older smells. That is somebody else’s country. Mine is four floors and a flat stone.'
          ]
        },
        {
          keys: ['serpent', 'coil', 'wyrm', 'halls of'],
          replies: [
            'The coils of stone. I have heard that name off men on their way down. I have never once heard it off a man on his way up. That is the whole of the map I can give you.'
          ]
        },
        {
          keys: ['secret', 'hidden', 'door', 'wall', 'hollow', 'seam'],
          replies: [
            'Half the wealth of the deep is behind walls that were never doors. Tap the stones and listen for hollowness.',
            'This place was cut in some rooms and poured in others. The poured stone rings wrong under a knuckle, and the poured stone is where they hid things. Take your time. Nothing here is in a hurry but you.'
          ]
        },
        {
          keys: ['statue', 'guard', 'niche', 'stood'],
          replies: [
            'Carved as guards and never needed as guards, a thousand years running. Eight years ago one of them was standing in a doorway that had been empty the day before. Look where the faces point. Not at the stair you came down.',
            'Men like me came down with empty sacks and went up with full ones, year after year, and something in the building added it up and stopped being patient. If you want somebody to blame for the statues, I am sitting on the stone.'
          ]
        },
        {
          keys: ['lapsai', 'demon', 'god', 'boss', 'sleeps', 'hungry'],
          replies: [
            'Four floors down, in a bronze box, with its mouth open. They tell it as a sleeping god. Nothing that has slept a hundred years breathes on a count like that.',
            'It is not woken. It is short. There is a difference, and you will learn it the same way I did, only faster.'
          ]
        },
        {
          keys: ['treasure', 'gold', 'sell', 'idol', 'coin', 'worth'],
          replies: [
            'Gold keeps its promises poorly, but the scribes are always out of paper. Bring me nothing; bring yourself back.',
            'The squat carved godlings — do not sell those to a scrap man for the weight. There are four families who buy them, cash, no questions, above scrap. I used to be the man they sent to fetch them. Tell them Ogil is still owed and watch their faces do nothing at all.'
          ]
        },
        {
          keys: ['descend', 'stairs', 'down', 'deeper', 'below'],
          replies: [
            'The stairs are hungry and honest. Walk softly and carry a lit torch, even if you think you see fine.',
            'The stairs are swept. Ask yourself who sweeps them, and then go down anyway, because that is what you came here to do.'
          ]
        },
        {
          keys: ['whetstone', 'table', 'scribe', 'threshold', 'ledger'],
          replies: [
            'The Whetstone is the flat stone outside the lintel. The garrison sharpened on it before they went down, and the smiths on this side of the hill stamped their blades for it — a man’s address, on his sword. I sat on it nine years. Then two men in grey carried a table down past me and set it at the bottom of the stairs, and I came in out of the weather after it.',
            'Two men in grey sit at that table with a book open. If you die down there they haul you back out of the threshold and take half the gold on you — not the gear, they have no use for gear. Not a price. A rate. I have never seen them argue it and I have never seen them count wrong.'
          ]
        },
        {
          keys: ['mark', 'count', 'how many', 'scratch', 'died', 'dead men'],
          replies: [
            'I cut a mark in the stone when a delver walks past me, and I cross it out when they come back up. Four hundred and eighteen are not crossed out. I do not say that number aloud, and now I have, so we will both pretend I did not.'
          ]
        },
        {
          keys: ['alive', 'alone', 'anyone else', 'living', 'who else', 'company'],
          replies: [
            'Below the third floor there is nothing that talks. Bones with orders, statues, linen by the bale, and whatever crawled up the drains to feed on it. Eleven years I have watched the living stay where the air still moves, and I would bet the eye I have left on it.'
          ]
        },
        {
          keys: ['ogil', 'who are you', 'your name', 'yourself', 'hermit', 'about you'],
          replies: [
            'Ogil. The Whetstone is the stone, not the man — I took the name off it the way a man takes his name off his trade.',
            'Four families sent me down eleven years ago to bring their marked stock back up. Three years in they wrote me off. I have a tent, a claim for back wages, and nobody left to serve it on. Men call that a hermit. I call it waiting.'
          ]
        },
        {
          keys: ['temple', 'this place', 'where am i', 'what is this'],
          replies: [
            'The Temple of Lapsai. It is not haunted and it is not ancient. It is poor. Swept stairs, a table at the bottom of them, a ledger open on the table, and a building with a job it never finished.'
          ]
        },
        {
          keys: ['help', 'advice', 'what should i', 'survive', 'tip'],
          replies: [
            'Sharpen before you go and not after. Carry two lights. Never fight in black water — it doubles every step you take and every step is heard.',
            'I sharpen what comes in. I do not sharpen what comes out; there is less of it, and it does not ask.'
          ]
        },
        {
          keys: ['hello', 'hail', 'greet', 'good day', 'hi there'],
          replies: [
            'You still have both eyes. Say what you want while that is true.',
            'Sit if you like. Everyone sits here on the way down. Fewer on the way back, and they do not sit long.'
          ]
        }
      ],
      fallbacks: [
        'Ogil scratches a mark on the wall. “That is a better question than most. When the world grows thin, ask the Library to stitch new depths.”',
        'Ogil squints off into the dark with the eye he has left. “There is little to say that the labyrinth does not say louder. Keep your wits about you.”',
        'Ogil runs a thumb down the blade in his lap and does not look up. “Ask me something with an edge on it.”',
        'Ogil offers a worn smile. “I have told the honest truth and a few pretty lies. Which would you like to believe today?”'
      ]
    },
    {
      id: 'priestess-eilyth', faction: 'drowned-sisters',
      name: 'Eilyth, Drowned Sister',
      title: 'a priestess of the old sea-god',
      dungeon: 'upper',
      floor: 0,
      color: 'cyan',
      intro: '“The tide carries ruin into the warrens and carries our prayers out. Whom do you serve, down-soaked stranger? Perhaps I keep a blessing for you.”',
      recognise: [
        '“You came back up,” Eilyth says, as if checking a figure twice. “The Sisters note who does.”',
        '“The count is better for you being in it.” She says it plainly, the way she says everything. “Sit where the water does not reach.”',
        '“I have written your name in the margin,” she says, “which for my order is not a small thing. The margin is where the survivors go.”',
        'Eilyth makes the sign she makes for her own. “You are counted among us now. That is not a debt and it is not a blessing — it is the same document, all the same.”'
      ],
      knowledge: [
        'water',
        'tide',
        'bless',
        'sisters',
        'return',
        'outfall',
        'sluice',
        'marn',
        'rat',
        'wererat',
        'breach',
        'upstream'
      ],
      topics: [
        {
          keys: ['serpent', 'coil', 'deeper', 'below', 'halls', 'bottom'],
          replies: [
            'Below? This is below. Silt under this floor and rock under the silt — barring one hole three levels down that I do not think about, and would thank you not to raise. When men say deeper they mean the far channels, and the far channels are only these ones with more water standing in them.'
          ]
        },
        {
          keys: ['tide', 'water', 'wade', 'channel', 'swim', 'current'],
          replies: [
            'Twice a day it comes up the works from open sea, and twice a day it goes back thinner than it came. Do not stand in it while it turns.',
            'The high channel is safe. The low ones silt, and then one day they do not, and a channel that has changed its mind will hold you under while you are still deciding what happened.'
          ]
        },
        {
          keys: ['bless', 'pray', 'prayer', 'holy', 'sea-god', 'god'],
          replies: [
            'My god is drowned and still listening. That is more than most can say of theirs.',
            'Kneel or do not; the water has no opinion. I will say the words over you and mark you received. It costs me nothing, and it has been known to cost the sea a little.'
          ]
        },
        {
          keys: ['return', 'drowned', 'rides', 'outfall', 'comes in', 'what rides'],
          replies: [
            'We call it the Return. The sea gives back what it took, twice a day, on time, and some of what it gives back walks. Do not raise a light at it and do not run. It is only coming home.',
            'Something rides the flood and has ridden it since before my order could write. I leave bread and salt at the outfall on the ebb. It is gone by the flood. I have never once had to leave less. The Far Reach gives blades back as well. Stamped, most of them, with the district that made them, which has been under water since before my order could write. Nobody up here knows whose they were on the way down.'
          ]
        },
        {
          keys: ['sister', 'order', 'rite', 'veil', 'count'],
          replies: [
            'There were nine of us when I took the veil and there is one now, and the rite has not changed a word. Stand at the flood. Take in what the sea gives. Count it. Let it go down. That is the whole of it, and it takes four hours.',
            'Sister is a courtesy. Drowned is a rank. You do not earn the second by dying. You earn it by standing in cold water until you stop minding the cold.'
          ]
        },
        {
          keys: ['upper reach', 'upstream', 'why is it called', 'named from', 'the name'],
          replies: [
            'Landward is the head, seaward is the mouth. Delvers come down very pleased with themselves for having descended into somewhere called Upper, and I let them keep it, because the tide explains it better than I do and charges less.'
          ]
        },
        {
          keys: ['sluice', 'flood', 'marn', 'city', 'lower', 'street'],
          replies: [
            'Lower Marn is beneath us — a quarter of a city with a drain built on top of it. Do not go into the houses. They are still houses, and things live in them, and those two facts are not related.',
            'It did not drown in a storm. There is a work-order still legible on a sluice-house wall and it is signed. Somebody cut the flood sluices in one night to wash a blockage through, and the sea came up the works and thought better of leaving.'
          ]
        },
        {
          keys: ['rat', 'glow', 'wererat', 'toll', 'whisker', 'man-shaped'],
          replies: [
            'The rats here glow faintly, which is a kindness to whatever eats them.',
            'The man-shaped ones are worse and better. They will not kill you if you can pay, and they charge by the yard, and they will sell your route to the next crew before you have finished walking it.'
          ]
        },
        {
          keys: ['hulk', 'tunnel', 'breach', 'dig', 'hole', 'burrow'],
          replies: [
            'There is a hole in the floor three levels below this one that has no business being there. It was made from underneath. Water does not dig upward, and neither does anything I pray to. Whatever opened it did not come in on my tide.'
          ]
        },
        {
          keys: ['temple', 'above', 'lapsai', 'lintel', 'upstairs'],
          replies: [
            'Above us there is a temple with its lintel broken, and I have not been up since I took the veil. They say a god sleeps in it with its mouth open. Ours does not sleep. Ours drowned and stayed at its post.'
          ]
        },
        {
          keys: ['gear', 'loot', 'treasure', 'gold', 'sorted', 'boots'],
          replies: [
            'Two levels below this one there is a room stacked with other people’s kit, sorted by kind. Boots with boots. Blades with blades. Take what you can carry, and do not say a word over it, because whoever sorted it is still sorting.'
          ]
        },
        {
          keys: ['eilyth', 'who are you', 'your name', 'yourself', 'about you'],
          replies: [
            'Eilyth. Drowned Sister, of the order that receives. I was a rope-hand’s daughter in the camp on the lintel and I came down at fourteen because the water was warmer than the tent. Now I am the only thing in these works that says the words on time. Do not pity it. It is a post, and posts are rare.'
          ]
        },
        {
          keys: ['this place', 'where am i', 'warren', 'works', 'what is this'],
          replies: [
            'The Upper Reaches. Storm-drains once, cut well enough that a man could walk them upright. Now a warren with green water standing in the bottom of it, and the smell is older than the water.'
          ]
        },
        {
          keys: ['help', 'advice', 'what should i', 'survive', 'tip'],
          replies: [
            'Come at the ebb and leave before the turn. Keep salt in a dry pocket. If something greets you by name in the dark it is being polite, and you should not answer politely.',
            'The tide is not sorrow. The tide is somebody keeping their word longer than anyone deserved. Learn its hours and it will carry you. Guess at them and it will carry you too.'
          ]
        },
        {
          keys: ['hello', 'hail', 'greet', 'good day', 'hi there'],
          replies: [
            'You are wet to the knee already. Good. The water has counted you, and it does not have to do that twice.',
            'Come in off the channel. Whatever you are here to ask, ask it before the turn — I am no use to anyone at the flood.'
          ]
        }
      ],
      fallbacks: [
        'Eilyth listens to the water a moment, and then to you. “The sea is a poor conversationalist and a very good witness. Ask me what it has seen.”',
        'Eilyth wrings out a sleeve. “Ask me at the ebb. I am better company when the water is not doing the talking.”',
        'Eilyth marks something on the wet stone with her thumb. “That will keep. Most things down here keep.”'
      ]
    },
    {
      id: 'keeper-venn', faction: 'keepers-coils',
      name: 'Keeper Venn',
      title: 'the last keeper of the serpent halls',
      dungeon: 'serpent',
      floor: 0,
      color: 'green',
      intro: '“The Coils remember every pilgrim who ever crawled them, and they counted you the moment you stepped inside. Be cleverer than the last hundred.”',
      recognise: [
        '“You are entered,” Venn says, turning a page. “I have begun a column for you. It is short. It will not stay short.”',
        '“The survey includes you now.” Venn does not look up, which is how he looks up. “An open file is a kind of compliment, in this office.”',
        '“Ah. The column.” A rare pause. “I have had occasion to write something good in it. I do not often get occasion.”',
        'Venn sets the pen down entire, which he does for nobody. “You are one of the office’s own now. I am permitted to tell you that, which I was not, before.”'
      ],
      knowledge: [
        'serpent',
        'coils',
        'basilisk',
        'ledger',
        'pilgrim',
        'crown',
        'kesh',
        'wyrm',
        'passages',
        'survey',
        'keeper'
      ],
      topics: [
        {
          keys: ['venn', 'keeper', 'who are you', 'your name', 'yourself', 'pension', 'alone', 'about you'],
          replies: [
            'Keeper Venn. The Keepers of the Coils are an office of six. I am the six.',
            'My term ended a long while ago and no relief has come, so I keep the post. A post kept badly is worse than a post abandoned. There is a pension attached to it. I fully intend to draw it.'
          ]
        },
        {
          keys: ['serpent', 'coil', 'fang', 'spiral', 'god'],
          replies: [
            'The Serpent was worshipped with fangs. Its halls wind because reverence here meant crawling.',
            'The Coils are not named for their shape. They are the shape. Count the chambers as you pass through them, and note which way each one narrows.'
          ]
        },
        {
          keys: ['basilisk', 'gaze', 'stone', 'petrif', 'hood'],
          replies: [
            'The gaze is a sentence. Do not look beneath the hood.',
            'They were hooded, most of them, by whoever kept them. The hoods have rotted and nobody has been issued new ones. That is the condition of this entire place in one sentence.'
          ]
        },
        {
          keys: ['ledger', 'count', 'book', 'hundred', 'names', 'entry', 'page'],
          replies: [
            'One hundred names on the current page, over eleven years, each with a cause written beside it. You will be the hundred-and-first. I would rather write a long entry than a short one.',
            'The books have not balanced in four hundred years. A page went astray, or a keeper died mid-entry. It is a clerical matter and I will find it. I have found smaller.'
          ]
        },
        {
          keys: ['pilgrim', 'crawl', 'procession', 'statue', 'hands', 'carried'],
          replies: [
            'You have seen the hands. Now tell me where what was in them went, because it is not in the halls, it is not on the floor, and I have had thirty years to look. That is the whole of the question and I have not moved it an inch.'
          ]
        },
        {
          keys: ['crown', 'king', 'kesh', 'rusted'],
          replies: [
            'Kesh was king eleven years and walked down these halls in the twelfth with the crown on his head. He came back up without it, lived two more years, and would not say what he had agreed to. He was not the first king to come down. He was the last one to go back up.',
            'You will find crowns. Soft gold, cut cheap and made often — a crown here was rent, and rent is meant to be handed over. Count them if you like. It is not a flattering number.'
          ]
        },
        {
          keys: ['tunnel', 'hulk', 'dig', 'passage', 'burrow', 'chewed', 'corridor'],
          replies: [
            'Learn the difference or you will die in a corridor that was never surveyed. A cut passage has a lip at the floor and tool marks that agree with one another. A chewed one is round, and warm, and agrees with nothing.',
            'The chewed passages go where the digger wished to go. That is never where you wish to go. I have written four entries on that point and each of them is a name.'
          ]
        },
        {
          keys: ['wyrm', 'great', 'sanctum', 'dragon', 'boss', 'deep'],
          replies: [
            'In the deep sanctum, past the last narrowing. I have not been in the room. The keeper before the keeper before me filed on it and wrote three words — floored in paper — and I am not permitted to amend another man’s survey on a rumour. Do not go down there expecting a hoard. There is no hoard. There is filing.',
            'Address it properly, if you can manage it. I have never managed it. I get as far as the last narrowing and I find that I have brought the wrong papers.'
          ]
        },
        {
          keys: ['temple', 'lapsai', 'above', 'threshold', 'upper', 'warren', 'drain'],
          replies: [
            'The halls above us are somebody else’s ledger. I have written to the office at the threshold four times in thirty years, by the proper route, and had no reply.',
            'I do not believe it is contempt. I believe the route is broken and nobody has been sent to tell me. That happens. Offices are quiet by nature.'
          ]
        },
        {
          keys: ['tithe', 'debt', 'remit', 'arrears', 'payment', 'owed'],
          replies: [
            'Counted, yes — not by me. I only copy it down and send it on. I have kept my half correctly for thirty years without once being told what the other half is for. That is normal. Most offices work that way.'
          ]
        },
        {
          keys: ['death', 'die', 'dead', 'kill'],
          replies: [
            'Causes I have written this decade, in order of frequency: gaze, fall, the chewed passage at the ninth narrowing, blood loss, and one entry that reads simply ‘arithmetic’. I have never been able to improve on that last one and I would prefer not to use it twice.'
          ]
        },
        {
          keys: ['treasure', 'loot', 'carry', 'worth', 'valuable'],
          replies: [
            'Everything portable down here was carried in by somebody who meant it. Take it if you like; I am not the office that objects. Only leave what is on the deep sanctum floor. Those are working documents.'
          ]
        },
        {
          keys: ['this place', 'where am i', 'halls', 'what is this'],
          replies: [
            'The Halls of the Serpent God. Halls, once. They have been eaten back into caves since, which the survey does not reflect, and I have not been given the authority to amend a survey.'
          ]
        },
        {
          keys: ['help', 'advice', 'what should i', 'survive', 'tip'],
          replies: [
            'Be cleverer than the last hundred. In practice: slow at every narrowing, no steel drawn at anything hooded, and tell me your name before you go down so that I can spell it correctly.',
            'Sleep on this side of the third contraction. Everything past it is warm, and warm here means recent.'
          ]
        },
        {
          keys: ['hello', 'hail', 'greet', 'good day', 'hi there'],
          replies: [
            'You are the first thing to come down this hall in some while that answered when spoken to. Sit. I will note the hour.',
            'Welcome, in the proper sense — I have written you in. Now say what you came to say while the lamp is good.'
          ]
        }
      ],
      fallbacks: [
        'Venn consults a ledger that has not been correct for four hundred years. “Not in the index. I shall start a page for it.”',
        'Venn writes something down, underlines it, and looks at the underline for a while. “Noted. Ask again when I have the file.”',
        'Venn sets his pen down with great care. “I do not know, and I am not permitted to guess. The two are different and the difference is my whole profession.”'
      ]
    },

    /* THE GREY MAN AT THE TABLE. The Tallymen were always the mechanism the
     * resurrection ran on and never a face you could talk to — the table at
     * the bottom of the swept stairs, the near half of a book you will never
     * be shown. Now they keep their ledger where the player can reach it. */
    {
      id: 'tallyman-ress', faction: 'tallymen',
      name: 'Ress, at the Table',
      title: 'a tallyman of the Whetstone',
      dungeon: 'temple',
      floor: 0,
      color: 'gray',
      intro: '“Name and company, for the book. We haul back what the hill keeps, at the standing rate, and we do not count wrong. State your business.”',
      recognise: [
        '“Name and company,” Ress says, by reflex. Then: “— already in the book. Good. The rate notices who it is applying to.”',
        'Ress makes a mark and turns the book an inch toward you. “The table remembers a steady account. That is as warm as this table gets.”',
        '“A friend of the table.” Ress says it the way he says the rate: flatly, and meaning it. “The friend’s rate applies.”',
        '“You are one of ours now,” Ress says, “and the book says so in a hand that does not lie. Half is for strangers; you will find your rate has more give than that.”'
      ],
      knowledge: ['rate', 'half', 'gold', 'book', 'entry', 'ledger', 'threshold', 'haul', 'tally', 'statue', 'order', 'tithe', 'traffic', 'death'],
      topics: [
        {
          keys: ['rate', 'half', 'gold', 'price', 'cost', 'pay'],
          replies: [
            'Half of what is on the body, every time, and not the gear — gear is no use to us. It is not a price. A price is argued. A rate is kept.',
            'You will not find it written down and you will not find it waived. Half, at the threshold, when we carry you back over it. Men have offered to die cheaper elsewhere. The hill does not honour it.'
          ]
        },
        {
          keys: ['book', 'entry', 'ledger', 'count', 'tally', 'write'],
          replies: [
            'Every name that goes down and every name that comes back up, in the same hand, on the same line. The book is the near half of an older one. We do not show the other half and we do not lose this one.',
            'Legible entries and steady traffic. That is the whole of what the table wants. A name we cannot read is a debt we cannot close, and we close everything.'
          ]
        },
        {
          keys: ['statue', 'order', 'bone', 'skeleton', 'ghoul', 'collecting', 'door'],
          replies: [
            'The garrison below was posted to see a tithe delivered. The tithe stopped and the posting did not, and eight years back the arrears crossed some line nobody wrote down. Now the building collects for itself, and it makes the entries hard to read.',
            'Bones that remember marching orders do not care what they collect, only that the count goes up. We would like the count to go down. It is bad for traffic.'
          ]
        },
        {
          keys: ['tithe', 'arrears', 'owed', 'deliver', 'crown', 'rent'],
          replies: [
            'The tithe was crowns — soft gold, carried down and handed over at the bottom of the serpent’s halls. It has not been carried in some years. We keep the near half of that book too, and an uncarried tithe is an entry we cannot close.'
          ]
        },
        {
          keys: ['threshold', 'haul', 'die', 'death', 'back', 'raise', 'resurrect'],
          replies: [
            'Die below and we bring you back over the threshold and take the rate off what you were carrying. You wake at the camp on the lintel with your gear and half your coin and a line in the book that reads the same as everyone’s.',
            'It is not resurrection. It is retrieval. The god does not enter into it; the rate does.'
          ]
        },
        {
          keys: ['ogil', 'hermit', 'whetstone', 'eye'],
          replies: [
            'The hermit from the stone? He watched us carry this table down nine years ago and came in out of the weather after it. He has a claim he cannot serve and we have a book he is not in. We get along.'
          ]
        },
        {
          keys: ['who are you', 'your name', 'ress', 'yourself', 'grey', 'gray', 'two men'],
          replies: [
            'Ress. There were two of us at this table when it was carried down, and there are two of us still, in shifts you are not awake to see. The table does not empty.',
            'A tallyman. The order is older than the stairs it sits at the bottom of. We keep the book, we haul the dead, we take the rate. It is steady work.'
          ]
        },
        {
          keys: ['this place', 'where am i', 'temple', 'what is this'],
          replies: [
            'The bottom of the swept stairs — the Temple of Lapsai below and the camp on the lintel above. You are at the first line of the book. Most names do not get a second.'
          ]
        },
        {
          keys: ['hello', 'hail', 'greet', 'good day'],
          replies: [
            'Name and company, for the book.',
            'You are already written in — everyone is, the moment they pass the lintel. Now say what you want.'
          ]
        },
        {
          keys: ['help', 'advice', 'what should i'],
          replies: [
            'Keep your entries small and your name easy to spell. Spend your gold before the hill takes half of it. And do not make us carry you up twice in one week — it is allowed, and it is noticed.'
          ]
        }
      ],
      fallbacks: [
        'Ress turns a page, runs a finger down a column, and looks up. “Not in this half of the book.”',
        '“The rate is the rate,” Ress says, and returns to the ledger. “Everything else is traffic.”',
        'Ress makes a small mark and does not explain it. “Asked and entered. Next.”'
      ]
    },

    /* THE FACTOR OF THE CHUTE. The Drain Toll were "hostile, but negotiable"
     * and there was never anyone to negotiate with — only wererats who tried
     * to kill you. A factor you can talk to is the whole point of them. */
    {
      id: 'drain-factor', faction: 'drain-toll',
      name: 'The Factor of the Chute',
      title: 'a wererat who would rather bill you',
      dungeon: 'upper',
      floor: 1,
      color: 'rust',
      intro: '“Easy with the steel. You are on a toll road, not a battlefield. The Chute is crewed, the yardage is fair, and there is a rate for freight both ways. Talk first; it is cheaper.”',
      recognise: [
        '“A customer,” the factor says, approving. “The road keeps a list, and you have just been added to it. That is the whole of the ceremony.”',
        '“Back again. Good.” The factor tallies something. “Freight that returns is freight worth keeping. Your yardage is improving.”',
        '“You,” the factor says, with something almost like warmth on a whiskered face. “The crews know your stride now. That never happens to a stranger.”',
        'The factor waves a paw before you speak. “Your toll is waived. You are written down as ours, and ours do not pay to walk their own road. Do not make me regret the ink.”'
      ],
      knowledge: ['toll', 'yard', 'rate', 'freight', 'chute', 'route', 'crew', 'pay', 'debt', 'passage', 'rat', 'traffic'],
      topics: [
        {
          keys: ['toll', 'yard', 'rate', 'price', 'pay', 'charge'],
          replies: [
            'By the yard, and the yard is fair. You are not paying for the road — the road was here before us. You are paying for the road to stay clear of the things we keep off it.',
            'A debt with traffic on it is a toll road, and this one has had traffic for a hundred years. We would like the next hundred the same.'
          ]
        },
        {
          keys: ['freight', 'carry', 'deliver', 'package', 'idol', 'statuette', 'run'],
          replies: [
            'Freight pays better than flesh, both ways. We have stock that needs to move down the Chute and buyers who do not like to climb. Carry it and the rate on your own passage comes down.',
            'An idol, sealed, to the third landing. Do not open it, do not drop it in the water, and do not ask what a carved god wants at the bottom of a drain. It is freight. Freight does not get asked about.'
          ]
        },
        {
          keys: ['route', 'sell', 'crew', 'next crew', 'map'],
          replies: [
            'Every route through here is written down, and what is written down is sold. Yours will be too, once you have finished walking it. That is not a threat. It is the business.',
            'The next crew buys the route you are walking now. You are not the road. You are the traffic, and traffic is what a toll road is for.'
          ]
        },
        {
          keys: ['eilyth', 'sister', 'priestess', 'drowned', 'water', 'tide'],
          replies: [
            'The sister at the flood counts what the sea gives back. We count what moves past her. Two ledgers, same water, no love lost. She would have the road free. A free road is a road with nothing on it, and that is a road we cannot sell.'
          ]
        },
        {
          keys: ['rat', 'glow', 'wererat', 'whisker', 'man-shaped', 'vermin'],
          replies: [
            'The glowing ones are not ours. Ours are man-shaped and man-spoken and we keep our books better than most offices up top. Do not confuse the help with the vermin.'
          ]
        },
        {
          keys: ['who are you', 'your name', 'factor', 'yourself'],
          replies: [
            'Factor. The crews dig, the crews guard, and I keep the count and set the yardage. It is an honest post on a dishonest road, which is the only kind worth having.'
          ]
        },
        {
          keys: ['this place', 'where am i', 'chute', 'what is this'],
          replies: [
            'The Chute, where the works cross the warrens. A hundred years of crews skimming the same current. You are standing in the toll booth, so to speak.'
          ]
        },
        {
          keys: ['hello', 'hail', 'greet'],
          replies: [
            'Steel down and coin out, or steel down and no coin — the road is the same either way. Talk.',
            'A live customer. Good. The dead ones are so much less flexible about the yardage.'
          ]
        },
        {
          keys: ['help', 'advice', 'what should i', 'survive', 'tip'],
          replies: [
            'Help is a service and services are billed — but the first one is free. Keep your coin where the water cannot reach it, and never take a chewed passage over a cut one.',
            'Pay the yardage and the road stays clear of worse than us. That is the whole of the arrangement, and the only help on this road that has ever been worth the coin.'
          ]
        }
      ],
      fallbacks: [
        'The factor strokes a whisker and recalculates. “That is not on the rate card. I can put it on the rate card.”',
        '“Everything down here is for sale,” the factor says, “including that question. The first one is free.”',
        'The factor makes a note. “You will be written down either way. Most people prefer to be written down as paid.”'
      ]
    },

    /* THE LAST LIGHT OF THE LOWER TOWN. The Drowned Quarter had no one in it to
     * speak to; it has its holdout now — a woman who kept the lamp lit when the
     * sea took the lower streets, and wants the water let out. */
    {
      id: 'liss', faction: 'drowned-sisters',
      name: 'Liss', title: 'the last light of the lower town',
      dungeon: 'drowned', floor: 0, color: 'cyan',
      intro: 'You came down into it, then. Most do not. I kept the lamp lit when the water came, and the water stayed, and the streets are still down there under it, and so, in a manner, am I.',
      recognise: [
        '“You came down and came back up,” Liss says, checking it twice. “The Sisters note who does. So do I.”',
        '“Sit — the dry chair, if you can find it.” She sets the lamp between you. “The count is better for you being in it.”',
        '“Your name is in the margin now,” she says, “and the margin is where the survivors go. That is one more light than I had yesterday.”',
        'Liss makes the sign the Sisters make for their own. “You are counted among us. It is not a debt and it is not a blessing; it is the same document, all the same.”'
      ],
      knowledge: ['water', 'tide', 'flood', 'sluice', 'tidewright', 'lower town', 'lamp', 'sea'],
      topics: [
        {
          keys: ['tidewright', 'wright', 'keeper'],
          replies: [
            'It kept the sluices. It was posted to, and it went on doing it when the posting ended and everyone it kept them for had drowned. It does not know the difference, and that is the whole of the trouble.'
          ]
        },
        {
          keys: ['sluice', 'sluices'],
          replies: [
            'The sluices held the tide out, once, in the dry years. Somebody shut them when the water came, and the water stayed shut in with us. Open them, and the lower town comes back.'
          ]
        },
        {
          keys: ['water', 'tide', 'flood', 'green'],
          replies: [
            'It came up through the lower streets in a night and never went back. The upper town called it a flood and rebuilt on the rise. It was not a flood. It was the sluices, shut.'
          ]
        },
        {
          keys: ['lower town', 'town', 'drowned quarter', 'street', 'door'],
          replies: [
            'Shut doors, lamps lit, people at home — under the green, where the streets always ran. Do not go knocking. Nobody has answered in a long time, and the knocking is heard.'
          ]
        },
        {
          keys: ['lamp', 'light'],
          replies: [
            'I kept it lit the first night, and then the next, and I have not stopped. Somebody in the lower town should be able to see one light above the water. It is the last thing I have that is any use.'
          ]
        },
        {
          keys: ['far reach', 'harbour', 'salvage'],
          replies: [
            'The Far Reach is up the coast and does not like to talk about us. We were the harbour once. Now we are a thing they file under losses, and sell the salvage of.'
          ]
        },
        {
          keys: ['who are you', 'your name', 'liss', 'yourself'],
          replies: [
            'Liss. I kept the lamp. There were four of us holding the upper rooms at the start; then two; then the water and I, and the water does not talk.'
          ]
        },
        {
          keys: ['this place', 'where am i'],
          replies: [
            'The Drowned Quarter — the lower town of the Far Reach, under the water it was shut into. The streets run where they always ran. The doors are shut and the lamps are lit and the people are at home.'
          ]
        },
        {
          keys: ['hello', 'hail', 'greet'],
          replies: [
            'You are the first to come down and knock on the RIGHT door in a while. Sit, if you can find a dry chair.',
            'Hello yourself. If you are up from the Far Reach, tell them the light is still on. They will not care. Tell them anyway.'
          ]
        },
        {
          keys: ['help', 'advice', 'what should i'],
          replies: [
            'Open the sluices and the quarter comes back. Or leave it drowned and go. There is no third thing worth doing.'
          ]
        }
      ],
      fallbacks: [
        'Liss looks at the water the way people look at a wound. “It is still in there. All of it.”',
        'She trims the lamp and says nothing for a while. “Ask me about the town, or the water, or the thing that shut it. Not about the rest.”',
        '“The light is the whole of it,” Liss says. “Everything else is under the water, where it belongs.”'
      ]
    },

    /* THE CLERK OF THE FLUE. The Emberworks’ resident: a lore-weaver who came
     * down to record the foundry’s last number and found the count would not
     * close, so the shift — and the clerk — never did either. */
    {
      id: 'ember-clerk', faction: 'lore-weavers',
      name: 'Otway the Weigher', title: 'a lore-weaver who stayed for the last entry',
      dungeon: 'emberworks', floor: 0, color: 'amber',
      intro: '“You are warm, so you are alive, so you are new.” Otway does not look up from the ledger. “I came to read the scale and write down its last number, and the number will not come, and I will not leave without it. Sit. You are the first thing down here that is not made of ash.”',
      recognise: [
        '“You are the one who went down and came back,” Otway says, and actually sets the pen down. “That is data. Almost nothing down here comes back. I have it written.”',
        '“Again.” A nod at the ledger. “The column is filling. You are in it in your own hand now — I let the living sign for themselves.”',
        '“Sit.” Otway clears a stool of ash with one sleeve. “The archive has you listed, and the archive does not list many who still breathe.”',
        '“You need not tell me how far down you went,” Otway says. “I measured it off you coming up the stairs. The archive knows. The archive always knows.”'
      ],
      knowledge: ['scale', 'weight', 'weigh', 'assay', 'forge', 'fire', 'ash', 'ledger', 'count', 'assayer', 'foundry', 'order', 'shift'],
      topics: [
        {
          keys: ['scale', 'weight', 'weigh', 'balance', 'number'],
          replies: [
            'It has been level for four hundred years, both pans empty, and it will not read. A scale that will not read is not broken. It is waiting for the thing it was built to weigh, and it will not be fooled by anything lighter.'
          ]
        },
        {
          keys: ['assayer', 'the assayer', 'keeper', 'who kept'],
          replies: [
            'It kept the weights. It was the one post down here that could be trusted with a number, so they left it holding every number, and then they left, and it stayed to balance them. Do not hate it. It is only thorough.'
          ]
        },
        {
          keys: ['fire', 'forge', 'foundry', 'bellows', 'flue', 'hot', 'warm'],
          replies: [
            'The fire was banked, not put out. There is a difference, and the difference is why the hill is warm and why I have not slept in some time. Bank it true and the hill goes cold. That is the whole of the work down here.'
          ]
        },
        {
          keys: ['ledger', 'book', 'count', 'column', 'entry', 'write'],
          replies: [
            'I am the last entry that will not close. The archive sent me to write the final number, and I cannot write a number that will not come. So I wait, and I read, and the column stays open, and I go on being warm.'
          ]
        },
        {
          keys: ['archive', 'lore-weavers', 'weaver', 'who are you', 'your name', 'otway', 'yourself'],
          replies: [
            'Otway. Weigher, of the Archive. The Archive reads over the shoulder of anyone who lifts anything; I am simply the part of it that came in person, and got warm, and could not get back out.'
          ]
        },
        {
          keys: ['order', 'shift', 'stop', 'damp', 'why'],
          replies: [
            'The order to damp the fire never came. That is all of it. Nobody decided to keep working — nobody decided to stop, and so nobody did, and four hundred years went by in one unbroken shift.'
          ]
        },
        {
          keys: ['this place', 'where am i', 'emberworks', 'works', 'hill'],
          replies: [
            'The Emberworks. The west hill, hollow, kept warm by a fire nobody put out. Half foundry, half furnace, all of it still running on a schedule set by people who were paid off long ago.'
          ]
        },
        {
          keys: ['hello', 'hail', 'greet'],
          replies: [
            'Warm. Good. Everything else down here is ash or iron. State your depth and your business; I record both.',
            'A live one. The dead ones are no good for the count; they will not answer a question and they will not hold still.'
          ]
        },
        {
          keys: ['help', 'advice', 'what should i', 'survive', 'tip'],
          replies: [
            'The wraiths hate the light, the golems hate the wet, and the scale answers only to a number. Bring both, and bring a full pack — the works do not sell anything back.'
          ]
        }
      ],
      fallbacks: [
        'Otway makes a note of the question instead of answering it. “Noted. The archive will have it either way.”',
        '“That is not a number,” Otway says, “nor a depth, nor a business. Try again.”',
        'Otway turns a page he has turned a hundred times. “Ask me about the fire, or the weights, or the thing that keeps them. Those I can read to you.”'
      ]
    }
  ],
};
