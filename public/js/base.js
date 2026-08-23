/* Core content data: classes, colors, monsters, items, abilities, dungeons. */

import { COLORS as PALETTE_COLORS } from './contract.js';

/* Palette lives in the content contract so the server validates against the
 * same names the canvas draws. Re-exported here for the modules that had it. */
export { COLORS } from './contract.js';

export const cls = (name) => PALETTE_COLORS[name] || '#9dc97a';

/* ---------------- Classes ---------------- */

export const CLASSES = {
  fighter: {
    id: 'fighter',
    name: 'Fighter',
    glyph: 'F',
    desc: 'Steel sinew of the expedition. High endurance, heavy armor, broad blades.',
    hpDie: 10,
    hpBase: 12,
    powerBase: 6,
    toHitBonus: 2,
    acBonus: 1,
    dmgBonus: 1,
    critBonus: 0.05,
    goldMul: 1.0,
    statAdj: { str: 1, dex: 0, con: 1, int: 0, wis: 0, cha: 0 },
    weapon: 'Broadsword',
  },
  thief: {
    id: 'thief',
    name: 'Thief',
    glyph: 'T',
    desc: 'Shadow of the torchlight. Swift, cunning, and quicker to the loot.',
    hpDie: 8,
    hpBase: 9,
    powerBase: 8,
    toHitBonus: 1,
    acBonus: 2,
    dmgBonus: 1,
    critBonus: 0.05,   /* the other 10% comes from Sharp & Keen, which now grants it */
    goldMul: 1.5,
    statAdj: { str: 0, dex: 2, con: 0, int: 1, wis: 0, cha: 0 },
    weapon: 'Short Sword',
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    glyph: 'M',
    desc: 'Reader of the forbidden pages. Frail of frame, terrible of intent.',
    hpDie: 6,
    hpBase: 10,
    powerBase: 16,
    toHitBonus: 0,
    acBonus: 0,
    dmgBonus: 0,
    critBonus: 0.05,
    goldMul: 1.0,
    powerPerInt: 1,
    /* Was str -1 and con -1, which stacked a damage penalty on top of the
     * lowest hit points and the worst armour in the game. */
    statAdj: { str: 0, dex: 0, con: 0, int: 2, wis: 1, cha: 0 },
    weapon: 'Staff',
  },
  cleric: {
    id: 'cleric',
    name: 'Cleric',
    glyph: 'C',
    desc: 'Voice of the old gods under the hill. Mace in one hand, mercy in no hand.',
    hpDie: 8,
    hpBase: 10,
    powerBase: 12,
    toHitBonus: 1,
    acBonus: 1,
    dmgBonus: 0,
    critBonus: 0.05,
    goldMul: 1.0,
    powerPerChr: 1,
    statAdj: { str: 0, dex: 0, con: 1, int: 0, wis: 2, cha: 1 },
    weapon: 'Mace',
  },
};

export const ABILITIES = [
  /* Fighter */
  { cls: 'fighter', level: 1, id: 'cleave', name: 'Cleave', kind: 'passive', description: 'Your blade carries: slaying a foe grants one bonus attack this turn.' },
  { cls: 'fighter', level: 3, id: 'shield-bash', name: 'Shield Bash', kind: 'damage', name2: 'Shield Bash', powerCost: 4, cooldown: 3, range: 1, damage: { sides: 6, bonus: 2, n: 'str' }, description: 'Knock a foe senseless: deal 1d6+STR and it cannot attack next turn.' },
  { cls: 'fighter', level: 6, id: 'second-wind', name: 'Second Wind', kind: 'heal', powerCost: 5, cooldown: 0, heal: '3d6', description: 'Breathe deep and shake off the dark: heal 3d6.' },
  { cls: 'fighter', level: 9, id: 'whirlwind', name: 'Whirlwind', kind: 'damage', powerCost: 8, cooldown: 3, aura: 2, damage: { sides: 6, bonus: 3, dice: 2, n: 'str' }, description: 'A dance of death: deal 2d6+STR to every foe around you.' },

  /* Thief */
  { cls: 'thief', level: 1, id: 'sharp-keen', name: 'Sharp & Keen', kind: 'passive', critBonus: 0.10, findsSecrets: true, description: 'You strike where it tells: +10% to wound critically, and your hands find seams other people walk past.' },
  { cls: 'thief', level: 3, id: 'backstab', name: 'Backstab', kind: 'damage', powerCost: 4, cooldown: 3, range: 1, damage: { sides: 6, bonus: 4, dice: 1 }, description: 'Find the unguarded flank: deal 1d6+4 to a foe and vanish one tile.' },
  { cls: 'thief', level: 6, id: 'shadow-blink', name: 'Shadow Blink', kind: 'teleport', powerCost: 5, cooldown: 4, teleportRng: 6, description: 'Fold into the dark and reappear up to 6 tiles away. Monsters lose your trail.' },
  { cls: 'thief', level: 9, id: 'fatal-flurry', name: 'Fatal Flurry', kind: 'damage', powerCost: 8, cooldown: 3, aura: 2, damage: { sides: 4, bonus: 2, dice: 4 }, description: 'Strike every foe in sight like falling knives: 4d4+2 each.' },

  /* Mage */
  { cls: 'mage', level: 1, id: 'firebolt', name: 'Firebolt', kind: 'damage', powerCost: 3, cooldown: 0, range: 7, damage: { sides: 8, bonus: 0, dice: 1, int: true }, description: 'Lance of flame: 1d8+INT to the nearest foe in sight (range 7).' },
  { cls: 'mage', level: 3, id: 'reveal', name: 'Light & Reveal', kind: 'reveal', powerCost: 2, cooldown: 0, description: 'Reveal all secret doors and traps on this floor until you leave it.' },
  { cls: 'mage', level: 6, id: 'blink', name: 'Blink', kind: 'teleport', powerCost: 4, cooldown: 4, teleportRng: 6, description: 'Rend the veil: teleport to a random spot up to 6 tiles away.' },
  { cls: 'mage', level: 9, id: 'fireball', name: 'Fireball', kind: 'damage', powerCost: 9, cooldown: 3, aura: 3, range: 5, damage: { sides: 6, bonus: 0, dice: 3, int: true }, description: 'Ball of doom: 3d6+INT to the target and everything within a 3-tile blast.' },

  /* Cleric */
  { cls: 'cleric', level: 1, id: 'lay-hands', name: 'Lay on Hands', kind: 'heal', powerCost: 4, cooldown: 0, heal: '2d6', description: 'Old gods answer: heal 2d6.' },
  { cls: 'cleric', level: 3, id: 'detect-evil', name: 'Detect Evil', kind: 'reveal', powerCost: 2, cooldown: 0, detectMonsters: true, description: 'Foes burn on your sight: show every monster on the floor until next turn.' },
  { cls: 'cleric', level: 6, id: 'turn-undead', name: 'Turn Undead', kind: 'turn', powerCost: 6, cooldown: 3, range: 6, damage: { sides: 6, bonus: 0, dice: 2 }, description: 'Drive the unhallowed back: undead & cursed creatures take 2d6 and flee.' },
  { cls: 'cleric', level: 9, id: 'judgment', name: 'Judgment', kind: 'damage', powerCost: 8, cooldown: 3, range: 5, damage: { sides: 6, bonus: 0, dice: 3 }, description: 'Sythe of the temple: 3d6 to every foe in a 5-tile blast.' },
];

export function abilitiesFor(clsId, level) {
  return ABILITIES.filter((a) => a.cls === clsId && level >= a.level);
}

export function getAbility(id) {
  return ABILITIES.find((a) => a.id === id) || null;
}

/* ---------------- Derived stat helpers ---------------- */

export function abilityMod(v) { return Math.floor((v - 10) / 2); }

/* XP needed to earn the NEXT level (gainXP subtracts as it goes). Tuned so a
 * dungeon's four floors are worth roughly four levels: 150, 450, 900, 1500 …
 * against ~150 XP on floor one rising to ~2900 with the boss on floor four. */
export const XP_FOR_LEVEL = (lvl) => Math.floor(150 * (lvl * (lvl + 1) / 2));

/* ---------------- Monsters ---------------- */

const M = (id, name, glyph, color, tier, hpMax, ac, toHit, dmg, xp, goldMin, goldMax, props = [], flavor = '', speed = 1, aggroRange = 8) => ({
  id, name, glyph, color, tier, hpMax, ac, toHit, damage: parseDmg(dmg), xp, goldMin, goldMax, speed, aggroRange, props: props.slice(), flavor,
});

function parseDmg(s) {
  const m = String(s).match(/(\d+)d(\d+)([+-]?\d+)?/);
  return { dice: m ? +m[1] : 1, sides: m ? +m[2] : 4, bonus: m && m[3] ? +m[3] : 0 };
}

export const MONSTERS = [
  M('rat', 'Sewer Rat', 'r', 'gray', 0, 3, 10, 0, '1d2', 5, 1, 4, [], 'A bristling grey thing with eyes like wet beads.'),
  M('giant-rat', 'Giant Rat', 'R', 'brown', 1, 6, 10, 0, '1d3', 12, 2, 8, [], 'A rat the size of a hound, all teeth and whiskers.'),
  M('giant-spider', 'Giant Spider', 'S', 'magenta', 1, 6, 12, 1, '1d4', 15, 3, 9, ['poison'], 'Web-slick legs and a bite that burns at the veins.'),
  M('goblin', 'Goblin', 'g', 'green', 2, 8, 11, 1, '1d6', 25, 5, 15, ['intelligent'], 'A knuckle-dragging knave with a stolen blade.'),
  M('kobold', 'Kobold', 'k', 'amber', 2, 5, 11, 0, '1d4', 20, 4, 12, ['intelligent'], 'A yelping whelp of the dark, jabbing at your shins.'),
  M('giant-ant', 'Giant Ant', 'A', 'brown', 2, 10, 12, 1, '1d4', 18, 2, 6, ['pack'], 'Carries off the remains of things bigger than you.'),
  M('centipede', 'Giant Centipede', 'c', 'red', 2, 7, 13, 1, '1d3', 16, 2, 8, ['poison'], 'A horrid bracelet of legs that spits venom.'),
  M('skeleton', 'Skeleton', 's', 'white', 3, 10, 10, 2, '1d6', 40, 5, 12, ['undead'], 'Old bones that remember marching orders.'),
  M('orc', 'Orc', 'o', 'green', 3, 13, 9, 2, '1d8', 45, 8, 20, ['intelligent'], 'A green brute with a notched cleaver and a grudge.'),
  M('hobgoblin', 'Hobgoblin', 'H', 'brown', 4, 16, 8, 2, '1d8', 55, 10, 25, ['intelligent'], 'Bigger, uglier, and nastier than its little kin.'),
  M('ghoul', 'Ghoul', 'G', 'gray', 4, 14, 9, 2, '1d6', 60, 6, 18, ['undead', 'pack'], 'Ravenous yeti-pale grave-things that eat warm flesh.'),
  M('giant-snake', 'Giant Snake', 'S', 'green', 4, 18, 8, 2, '1d6', 65, 8, 20, ['poison'], 'A coil of muscle and bad intention.'),
  M('zombie', 'Zombie', 'z', 'darkgray', 4, 20, 9, 1, '1d8', 55, 5, 15, ['undead'], 'A slow shambling ruin of a person, still hungry.'),
  M('ghast', 'Ghast', 'Q', 'brightgreen', 5, 24, 7, 3, '1d8', 90, 10, 24, ['undead', 'poison', 'pack'], 'A ghoul grown old and powerful, stinking of the grave.'),
  M('wererat', 'Wererat', 'W', 'brown', 5, 22, 7, 3, '1d6', 85, 15, 35, ['intelligent'], 'Man-shaped, whiskered, and half-bald with age and greed.'),
  M('giant-leech', 'Giant Leech', 'L', 'red', 5, 18, 8, 2, '1d6', 80, 8, 20, [], 'Drains you drink by drink; do not let it hold you.'),
  M('living-statue', 'Living Statue', 'h', 'gray', 6, 32, 4, 3, '2d6', 130, 15, 40, [], 'The temple guards that never stood guard — until now.'),
  M('gargoyle', 'Gargoyle', 'v', 'gray', 6, 30, 4, 3, '1d8', 125, 15, 35, [], 'A stone demon fixed to chew on intruders.'),
  M('mummy', 'Mummy', 'M', 'amber', 6, 28, 5, 3, '1d8', 135, 20, 45, ['undead', 'cursed'], 'Linen and rage. Its touch leaves a failing of the flesh.'),
  M('wraith', 'Wraith', 'w', 'cyan', 7, 32, 4, 4, '1d8', 160, 20, 45, ['undead'], 'A cold wind that remembers being a person.'),
  M('spectre', 'Spectre', 'P', 'brightblue', 7, 34, 4, 4, '2d6', 180, 24, 50, ['undead'], 'Ectoplasm with a grudge against the living.'),
  M('ogre', 'Ogre', 'O', 'brown', 7, 42, 7, 4, '2d6', 175, 30, 60, [], 'A mountain of bad decisions with a club to match.'),
  M('displacer-beast', 'Displacer Beast', 'D', 'violet', 8, 46, 4, 5, '2d6', 210, 30, 65, [], 'Seems to stand two feet from where it truly is.'),
  M('gelatinous-cube', 'Gelatinous Cube', 'C', 'teal', 8, 50, 8, 3, '2d4', 200, 40, 80, ['trap'], 'A clear slab of jelly that dissolves anything it swallows.'),
  M('minotaur', 'Minotaur', 'B', 'red', 8, 55, 5, 6, '3d6', 240, 50, 100, ['intelligent'], 'Half bull, wholly furious. The maze is its hoarse memory.'),
  M('otyugh', 'Otyugh', 'Y', 'green', 8, 46, 5, 5, '2d6', 230, 40, 90, [], 'A three-legged garbage god that minds the temple drains.'),
  M('troll', 'Troll', 'T', 'green', 9, 66, 6, 6, '2d6', 300, 60, 120, ['regenerate'], 'Flesh knits as you watch. Burn it; burn it twice.'),
  M('basilisk', 'Basilisk', 'b', 'brightgreen', 9, 60, 4, 5, '2d8', 320, 70, 140, ['poison'], 'The gaze is a sentence. Do not look beneath the hood.'),
  M('wyvern', 'Wyvern', 'V', 'green', 9, 70, 4, 6, '2d6', 340, 80, 150, ['flying'], 'A dragon that flunked the final grade, and holds a grudge.'),
  M('fire-elemental', 'Fire Elemental', 'E', 'red', 9, 60, 3, 6, '2d8', 340, 50, 100, [], 'Heat given appetite. It feeds on what you burn.'),
  M('ettin', 'Ettin', 'E', 'brown', 10, 90, 4, 7, '3d6', 420, 90, 170, ['intelligent'], 'Two heads, four fists, one shared hatred of doors.'),
  M('stone-giant', 'Stone Giant', 'N', 'gray', 10, 96, 4, 7, '3d6', 450, 100, 190, [], 'Ancient mountain-bones wrapped in patience.'),
  M('gorgon', 'Gorgon', 'n', 'silver', 11, 100, 3, 7, '3d8', 520, 120, 220, ['ranged'], 'An iron bull whose breath turns flesh to marble.'),
  M('umber-hulk', 'Umber Hulk', 'U', 'brown', 11, 102, 3, 8, '3d6', 540, 130, 240, [], 'A burrowing gut of a beast guided by antennae.'),
  M('dracolisk', 'Dracolisk', 'D', 'green', 11, 108, 3, 8, '3d8', 580, 140, 260, ['poison'], 'Dragon by blood, basilisk by nature. The worst of both.'),
  M('great-wyrm', 'Great Wyrm', 'd', 'red', 12, 140, 2, 9, '4d6', 800, 200, 400, ['flying', 'ranged'], 'The old serpent of the deep sanctum, crowned with rusted gold.'),
  M('lapsai-demon', 'Demon of Lapsai', '@', 'brightred', 13, 170, 1, 10, '4d6', 1200, 300, 600, ['cursed', 'undead'], 'The hungering god of the temple, woken to feed.'),
];

export function getMonster(id) {
  return MONSTERS.find((m) => m.id === id) || null;
}

export function monstersForFloor(floorIdx, threat) {
  const pool = MONSTERS.map((m) => ({ m, tier: m.tier + threat + Math.floor(floorIdx * 1.35) }))
    .filter((x) => x.tier >= 0 && x.tier <= 16)
    .sort((a, b) => a.tier - b.tier);
  const minT = Math.max(0, floorIdx + threat - 1);
  const candidates = pool.filter((x) => x.tier >= minT && x.tier <= minT + 4);
  const use = candidates.length ? candidates : pool.slice(0, 4);
  return use;
}

/* ---------------- Items ---------------- */

function makeItem(id, name, kind, glyph, color, value, tier, effects, flavor = '') {
  const slot = { weapon: 'weapon', armor: 'body', shield: 'shield', ring: 'ring', amulet: 'amulet', potion: 'consumable', scroll: 'consumable', wand: 'weapon', special: 'special', misc: 'misc' }[kind];
  return { id, name, kind, slot, glyph, color, value, tier, effects: effects || {}, cursed: false, identified: true, flavor, uid: null };
}

export const baseWeapons = [
  makeItem('dagger', 'Dagger', 'weapon', 'd', 'white', 5, 1, { toHit: 0, damage: { dice: 1, sides: 4, bonus: 0 } }, 'Small mercy of sharpened steel.'),
  makeItem('short-sword', 'Short Sword', 'weapon', 's', 'silver', 8, 1, { toHit: 0, damage: { dice: 1, sides: 6, bonus: 0 } }),
  makeItem('mace', 'Mace', 'weapon', 'm', 'gray', 9, 1, { toHit: 0, damage: { dice: 1, sides: 6, bonus: 0 } }, 'For sermon and skull alike.'),
  makeItem('staff', 'Staff', 'weapon', '/', 'brown', 6, 1, { toHit: 0, damage: { dice: 1, sides: 6, bonus: 0 }, power: 2 }, 'Walking stick of a wandering scholar. Humble but humming.'),
  makeItem('broadsword', 'Broadsword', 'weapon', 'b', 'silver', 15, 2, { toHit: 0, damage: { dice: 1, sides: 8, bonus: 0 } }, 'Standard-issue courage.'),
  makeItem('hand-axe', 'Hand Axe', 'weapon', 'a', 'gray', 12, 2, { toHit: 0, damage: { dice: 1, sides: 6, bonus: 0 } }),
  makeItem('war-hammer', 'War Hammer', 'weapon', 'W', 'silver', 20, 3, { toHit: 0, damage: { dice: 1, sides: 8, bonus: 1 } }),
  makeItem('battle-axe', 'Battle Axe', 'weapon', 'A', 'gray', 26, 4, { toHit: 0, damage: { dice: 1, sides: 10, bonus: 0 } }),
  makeItem('two-handed-sword', 'Two-Handed Sword', 'weapon', 'T', 'brightblue', 40, 5, { toHit: 0, damage: { dice: 2, sides: 6, bonus: 0 } }),
  makeItem('wand-of-fire', 'Wand of Fire', 'wand', '~', 'red', 60, 3, { spell: 'firebolt', charges: 12 }, 'Flickering like a live coal.'),
  makeItem('wand-of-healing', 'Wand of Healing', 'wand', '~', 'brightgreen', 70, 3, { spell: 'heal', charges: 8 }, 'Warm as a hearth.'),
  makeItem('wand-of-frost', 'Wand of Frost', 'wand', '~', 'cyan', 80, 4, { spell: 'frost', charges: 10 }, 'Hoar-frost crawls along the haft.'),
];

export const baseArmor = [
  makeItem('padded-armor', 'Padded Armor', 'armor', '[', 'amber', 6, 1, { acBonus: 1 }),
  makeItem('leather-armor', 'Leather Armor', 'armor', '[', 'brown', 10, 1, { acBonus: 2 }),
  makeItem('studded-armor', 'Studded Leather', 'armor', '[', 'brown', 14, 2, { acBonus: 3 }),
  makeItem('chainmail', 'Chainmail', 'armor', '[', 'silver', 25, 3, { acBonus: 4 }),
  makeItem('scale-armor', 'Scale Armor', 'armor', '[', 'green', 32, 4, { acBonus: 5 }),
  makeItem('plate', 'Plate Armor', 'armor', '[', 'brightblue', 50, 5, { acBonus: 6 }),
  makeItem('small-shield', 'Small Shield', 'shield', ')', 'brown', 8, 1, { acBonus: 1 }),
  makeItem('large-shield', 'Large Shield', 'shield', ')', 'silver', 18, 2, { acBonus: 2 }),
  makeItem('tower-shield', 'Tower Shield', 'shield', ')', 'gray', 35, 4, { acBonus: 3, toHit: -1 }),
];

export const baseJewelry = [
  makeItem('ring-protection', 'Ring of Protection', 'ring', '=', 'gold', 60, 2, { acBonus: 1 }, 'A plain band that makes blades go wide.'),
  makeItem('ring-strength', 'Ring of Might', 'ring', '=', 'gold', 70, 2, { statBonus: { str: 1 } }, 'Muscles you never earned.'),
  makeItem('ring-regeneration', 'Ring of Regeneration', 'ring', '=', 'teal', 120, 4, { regen: 1 }, 'Flesh mends by finger-widths.'),
  makeItem('ring-arcana', 'Ring of the Archive', 'ring', '=', 'violet', 110, 4, { power: 3 }, 'Motes of stolen magic drift off it.'),
  makeItem('amulet-ward', 'Amulet of the Deep Ward', 'amulet', '&', 'blue', 90, 3, { resist: 1, undeadResist: 1 }, 'Old sigils against the things below.'),
  makeItem('amulet-seeing', 'Amulet of True Seeing', 'amulet', '&', 'gold', 130, 4, { seeSecrets: true }, 'Powdered dragon-eyes in amber. You distrust every wall.'),
  makeItem('amulet-luck', 'Lucky Coin of Lapsai', 'amulet', '$', 'gold', 150, 5, { luck: 2 }, 'Warm and heavy with someone else’s fortune.'),
];

export const basePotions = [
  makeItem('potion-heal', 'Potion of Healing', 'potion', '!', 'red', 15, 1, { heal: '2d4+2' }, 'Bitter and vine-tart. Kills the hurting.'),
  makeItem('potion-major-heal', 'Potion of Superior Healing', 'potion', '!', 'brightred', 45, 3, { heal: '4d6+4' }, 'Thick as syrup; you can feel the mending.'),
  makeItem('potion-power', 'Potion of Arcana', 'potion', '!', 'violet', 35, 2, { power: '4d4+4' }, 'Tastes of the crackling between worlds.'),
  makeItem('potion-strength', 'Potion of Titan’s Grip', 'potion', '!', 'orange', 40, 3, { buffStr: 10 }, 'Spoils of a giant’s cellar. Bulges every vein.'),
  makeItem('potion-remove-curse', 'Draught of Unbinding', 'potion', '!', 'cyan', 80, 4, { removeCurse: true }, 'Cold as a mountain spring; slips curses like wax.'),
];

export const baseScrolls = [
  makeItem('scroll-identify', 'Scroll of Identify', 'scroll', '?', 'gold', 30, 1, { identify: true }),
  makeItem('scroll-remove-curse', 'Scroll of Remove Curse', 'scroll', '?', 'cyan', 70, 3, { removeCurse: true }),
  makeItem('scroll-teleport', 'Scroll of Recall', 'scroll', '?', 'violet', 60, 3, { teleport: true }),
  makeItem('scroll-reveal', 'Scroll of Cartography', 'scroll', '?', 'brightgreen', 40, 2, { map: true }, 'Lines crawl to truth across the whole floor.'),
  makeItem('scroll-flame', 'Scroll of Flame Burst', 'scroll', '?', 'red', 50, 3, { flame: '3d6' }, 'Do not read aloud indoors.'),
  makeItem('scroll-sanctuary', 'Scroll of Sanctuary', 'scroll', '?', 'white', 55, 3, { sanctuary: 12 }, 'For a few quiet steps, the dark forgets you.'),
];

export const baseTreasure = [
  makeItem('gold-pile', 'Pile of Gold', 'special', 'o', 'gold', 10, 0, {}, 'Coins in a small heap.'),
  makeItem('gem', 'Gemstone', 'special', 'X', 'cyan', 40, 1, {}, 'A teardrop of mineral light.'),
  makeItem('statuette', 'Idol of Ubtao', 'special', 'I', 'amber', 80, 3, {}, 'A squat carved godling, worth more to the right eyes.'),
  makeItem('crown', 'Tarnished Crown', 'special', 'C', 'gold', 150, 4, {}, 'Someone wore this when the temple still had kings.'),
];

export const ALL_ITEMS = [...baseWeapons, ...baseArmor, ...baseJewelry, ...basePotions, ...baseScrolls, ...baseTreasure];

export function getItemTemplate(id) {
  return ALL_ITEMS.find((i) => i.id === id) || null;
}

export function scaleDice(d, factor) {
  return { dice: Math.max(1, Math.round(d.dice * factor)), sides: Math.max(2, d.sides), bonus: d.bonus || 0 };
}

export function randomTreasureValue(rng, floorIdx, tier) {
  const base = 5 + rng.int(3, 10) * (floorIdx + 1) + tier * 4;
  return base;
}

/* ---------------- Dungeons ---------------- */

export const DUNGEONS = [
  {
    id: 'temple',
    name: 'The Temple of Lapsai',
    title: 'the old sanctum',
    flavor: 'Beneath a broken lintel the old temple yawns. Rank air breathes up from stairs worn smooth by a thousand years of offerings. Somewhere down there, in a bronze sanctuary, a thing that was once a god sleeps with its mouth open. You go down to meet it, because the march of destiny is poorly lit and somebody has to carry the torch.',
    floors: 4,
    theme: 'temple',
    threat: 0,
    monsterWeights: ['rat', 'giant-rat', 'giant-spider', 'goblin', 'kobold', 'orc', 'skeleton', 'ghoul', 'mummy', 'living-statue', 'gargoyle', 'otyugh', 'lapsai-demon'],
    bossId: 'lapsai-demon',
  },
  {
    id: 'upper',
    name: 'The Upper Reaches',
    title: 'the drowned warrens',
    flavor: 'Below the forge-quarter of the old city, the storm-drains knit themselves into a drowned warren. Green water and older smells. The rats here glow faintly, the better to be seen by whatever eats them. The tide comes in twice a day, and something rides it.',
    floors: 4,
    theme: 'sewers',
    threat: 2,
    monsterWeights: ['giant-rat', 'giant-spider', 'giant-ant', 'centipede', 'wererat', 'giant-snake', 'giant-leech', 'ghast', 'otyugh', 'gorgon'],
    bossId: 'umber-hulk',
  },
  {
    id: 'serpent',
    name: 'Halls of the Serpent God',
    title: 'the coils of stone',
    flavor: 'The Serpent God was worshipped with fangs. Its halls wind like a swallowed spiral, and every chamber is a contraction. Worshippers learned to crawl. Their petrified remains still wear the geometry of reverence.',
    floors: 4,
    theme: 'cavern',
    threat: 4,
    monsterWeights: ['giant-snake', 'basilisk', 'wyvern', 'minotaur', 'troll', 'umber-hulk', 'dracolisk', 'gorgon', 'great-wyrm'],
    bossId: 'great-wyrm',
  },
];

export function getDungeon(id) {
  return DUNGEONS.find((d) => d.id === id) || null;
}

/* ---------------- Theme palettes (map rendering) ---------------- */

export const THEMES = {
  temple: { floor: '#23261c', floorEdge: '#3a3f2c', wall: '#7a6a45', wallHi: '#8f7c50', door: '#5a4a30', secret: '#443a26', accent: '#8a7432', vignette: '#9dc97a' },
  sewers: { floor: '#1c2620', floorEdge: '#2e3a30', wall: '#5a6350', wallHi: '#6d7860', door: '#46503e', secret: '#38403a', accent: '#58a8a0', vignette: '#7ad8d0' },
  cavern: { floor: '#232023', floorEdge: '#382d34', wall: '#7a5a63', wallHi: '#8c6a74', door: '#5e4550', secret: '#44323c', accent: '#a87848', vignette: '#e88ad0' },
  crystal: { floor: '#1a2230', floorEdge: '#27344a', wall: '#46708a', wallHi: '#5a8ca8', door: '#34505e', secret: '#2a4050', accent: '#8ac8f0', vignette: '#8ac8f0' },
  fire: { floor: '#2a1a14', floorEdge: '#40221a', wall: '#8a3a26', wallHi: '#a84a30', door: '#662c1e', secret: '#55241a', accent: '#e08a4a', vignette: '#ff6a5a' },
  ice: { floor: '#182230', floorEdge: '#223650', wall: '#5a86b8', wallHi: '#6f9cc8', door: '#466a92', secret: '#3a5878', accent: '#7ad8d0', vignette: '#8ac8f0' },
  tomb: { floor: '#1c1a18', floorEdge: '#2e2a24', wall: '#5a5448', wallHi: '#6d6557', door: '#463f34', secret: '#383228', accent: '#9dc97a', vignette: '#aef08a' },
  abyss: { floor: '#14141c', floorEdge: '#23232e', wall: '#3a3a5a', wallHi: '#4a4a70', door: '#2c2c46', secret: '#252538', accent: '#a08af0', vignette: '#a08af0' },
  halls: { floor: '#23201a', floorEdge: '#37321f', wall: '#6d6a3a', wallHi: '#7f7c46', door: '#52502c', secret: '#413f24', accent: '#e0c05a', vignette: '#e0c05a' },
  jungle: { floor: '#14241a', floorEdge: '#1f3726', wall: '#3f6d3a', wallHi: '#4f8046', door: '#31562e', secret: '#2a4628', accent: '#aef08a', vignette: '#aef08a' },
  arcane: { floor: '#181426', floorEdge: '#251c3a', wall: '#5a4a8a', wallHi: '#6d5ca6', door: '#443a68', secret: '#372e54', accent: '#d45ad8', vignette: '#d45ad8' },
};

export function getTheme(name) {
  return THEMES[name] || THEMES.temple;
}
