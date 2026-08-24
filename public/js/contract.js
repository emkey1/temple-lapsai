/* THE CONTENT CONTRACT.
 *
 * One vocabulary, imported by both sides: the client renders against it and the
 * server validates the oracle's output against it — and builds the prompt's
 * enum lists from it, so what the model is offered and what the validator will
 * accept cannot drift apart.
 *
 * This file is the reason a generated monster's behaviour reaches the player.
 * Before it existed the server emitted `properties` and the engine read `props`,
 * the prompt offered a colour the validator rejected, and the schema advertised
 * lowercase glyphs that the validator uppercased.
 */

/* Palette. Names are the vocabulary; the hex values are what the canvas draws. */
export const COLORS = {
  green: '#9dc97a',
  amber: '#d8b04a',
  amber2: '#8a7432',
  white: '#e8e8d8',
  gray: '#9aaa88',
  silver: '#c8d0c8',
  /* The red family is reserved for monsters — see MONSTER_TINTS. Nothing the
   * player can pick up is painted in it, so red on the map always means
   * something that wants to kill you. */
  rust: '#8f5a48',
  blood: '#b8362e',
  red: '#e05a4e',
  brightred: '#ff6a5a',
  ember: '#ff8a3a',
  searing: '#ffbfa0',
  yellow: '#e8d85a',
  brightgreen: '#aef08a',
  cyan: '#7ad8d0',
  brightblue: '#8ac8f0',
  blue: '#5a82b8',
  magenta: '#d45ad8',
  pink: '#e88ad0',
  brown: '#a87848',
  darkgray: '#556055',
  violet: '#a08af0',
  gold: '#e0c05a',
  teal: '#58a8a0',
  black: '#000000',
};

/* Monsters are not painted by name — they are tinted by how dangerous they
 * are, coldest to hottest. Before this every glyph on the map was drawn from
 * one shared palette, so a gargoyle and a gemstone were the same grey and the
 * only way to tell loot from a thing with teeth was to walk into it.
 *
 * The ramp carries information a name could not: colour is threat. */
export const MONSTER_TINTS = ['rust', 'blood', 'red', 'brightred', 'ember', 'searing'];

/* The player is a white '@', so nothing that can kill you may be one too —
 * at the top of the ramp the tint is pale enough that the two would sit a
 * shade apart. The Demon wears '&' instead, which no colour in the loot
 * palette can now imitate. */
export const PLAYER_GLYPH = '@';

/* One colour per party slot, worn by the token on the map, the member strip
 * over the sheets, and the name in the top bar — so "which of us is that" is
 * answered the same way everywhere. Slot-keyed rather than stored on the
 * member: stable across saves with nothing to migrate, and distinct from the
 * red family (monsters) and from each other. */
export const PARTY_TINTS = ['#f0f0e0', '#8ac8f0', '#aef08a', '#e8d85a'];

export function partyTint(slot) {
  return PARTY_TINTS[slot % PARTY_TINTS.length];
}

/* Upper tier of each band, by index into MONSTER_TINTS. */
const TINT_CEILINGS = [1, 3, 5, 7, 10];

export function monsterTint(tier, boss = false) {
  const t = Number.isFinite(Number(tier)) ? Number(tier) : 0;
  let band = TINT_CEILINGS.findIndex((c) => t <= c);
  if (band < 0) band = MONSTER_TINTS.length - 1;
  if (boss) band = Math.min(MONSTER_TINTS.length - 1, band + 1);
  return MONSTER_TINTS[band];
}

const TINT_SET = new Set(MONSTER_TINTS);

/* Offered to the oracle for the things it may colour, which is everything
 * except monsters. `black` on black is unreadable, amber2 is an internal
 * shade, and the red family belongs to the bestiary — none are advertised,
 * though all still render. */
export const PALETTE = Object.keys(COLORS)
  .filter((c) => c !== 'black' && c !== 'amber2' && !TINT_SET.has(c));

export const ITEM_KINDS = ['weapon', 'armor', 'shield', 'ring', 'amulet', 'potion', 'wand', 'scroll', 'special', 'misc'];

/* Which equipment slot each kind occupies. 'consumable' and 'misc' are not
 * worn — see Game.useItem, which must terminate on them rather than bounce. */
export const SLOT_FOR_KIND = {
  weapon: 'weapon',
  armor: 'body',
  shield: 'shield',
  ring: 'ring',
  amulet: 'amulet',
  wand: 'weapon',
  scroll: 'consumable',
  potion: 'consumable',
  special: 'special',
  misc: 'misc',
};

export const WEARABLE_SLOTS = ['weapon', 'body', 'shield', 'ring', 'amulet'];

export const EFFECT_SPELLS = ['firebolt', 'fireball', 'frost', 'reveal', 'light', 'heal', 'detectevil', 'purge', 'teleport', 'identify', 'removecurse'];

/* The canonical field name is `props`, because that is what the engine reads.
 * The validator accepts `properties` too, since that is what reads naturally in
 * a schema, and always emits `props`. */
export const MONSTER_PROPS = ['undead', 'poison', 'regenerate', 'ranged', 'flying', 'intelligent', 'cursed', 'pack', 'trap', 'aquatic'];

export const DUNGEON_THEMES = ['temple', 'cavern', 'sewers', 'crystal', 'fire', 'ice', 'jungle', 'tomb', 'halls', 'abyss', 'arcane'];

export const CLASS_IDS = ['fighter', 'thief', 'mage', 'cleric'];

export const ABILITY_KINDS = ['damage', 'heal', 'buff', 'reveal', 'teleport', 'turn', 'passive'];

/* Ranges the validator clamps to, named here so the prompt can quote them. */
export const LIMITS = {
  tier: [0, 15],
  dice: [1, 10],
  sides: [1, 100],
  floors: [2, 6],
  threat: [-4, 12],
  abilityLevel: [1, 20],
};

/* Rendered into the prompt so the model is told exactly what will be accepted. */
export function enumList(values) {
  return values.join('|');
}

export function quotedEnum(values) {
  return values.map((v) => `"${v}"`).join('|');
}
