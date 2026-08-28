/* THE SPRITE SEAM: where the game's drawing stops being procedural.
 *
 * Everything under public/assets/ is Flare and Kenney art (see
 * assets/CREDITS.md), and this module is the only place that knows how those
 * packs are laid out. The renderer asks for "the skeleton, facing south-west,
 * mid-swing" and gets back an atlas rectangle; it never learns what a Flare
 * animation definition looks like. When the isometric renderer lands it
 * consumes this module, and until then the manifest is tested against the
 * files on disk so the seam cannot rot quietly.
 *
 * The parsers are pure text-to-data and run headless in tests. Only
 * loadImage() touches the browser, and it resolves to null when an asset is
 * missing rather than throwing — a game with no art must still be a game.
 */

/* Flare animation definition: an INI-ish file, one [section] per animation,
 * with rows of  frame=index,direction,x,y,w,h,offset_x,offset_y  naming a
 * rectangle in a packed atlas and where its anchor sits. Eight directions,
 * counted clockwise from west the way Flare counts them. */
export function parseAnimationDef(text) {
  const def = { image: null, scale: 1, animations: {} };
  let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      cur = { duration: 0, type: 'looped', frames: [] };
      def.animations[section[1]] = cur;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key === 'image' && !def.image) {
      def.image = val;
    } else if (key === 'scale' && !cur) {
      /* Not Flare's — ours. A sheet repacked from the high-resolution art
       * says here how many of its pixels stand for one of the pixels the
       * renderer's sizing was tuned against, so the same creature comes out
       * the same size on screen with six times the detail in it. Sheets
       * without the line are the original art and scale by one. */
      def.scale = parseFloat(val) || 1;
    } else if (cur && key === 'duration') {
      cur.duration = parseInt(val, 10) || 0;
    } else if (cur && key === 'type') {
      cur.type = val;
    } else if (cur && key === 'frame') {
      const [idx, dir, x, y, w, h, ox, oy] = val.split(',').map(Number);
      if (!cur.frames[dir]) cur.frames[dir] = [];
      cur.frames[dir][idx] = { x, y, w, h, ox, oy };
    }
  }
  return def;
}

/* Flare tileset definition: rows of  tile=id,x,y,w,h,offset_x,offset_y
 * naming where each tile id lives in the atlas image. */
export function parseTilesetDef(text) {
  const def = { image: null, tiles: {} };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key === 'img' && !def.image) {
      def.image = val;
    } else if (key === 'tile') {
      const [id, x, y, w, h, ox, oy] = val.split(',').map(Number);
      def.tiles[id] = { x, y, w, h, ox, oy };
    }
  }
  return def;
}

/* Which creature sheet stands for which monster. A null is a decision, not a
 * gap: it means "no sheet fits, draw the glyph token" — the manifest test
 * insists every monster appear here so a new bestiary entry cannot slip into
 * the renderer unconsidered. Several monsters share a sheet and differ by
 * tint, the way they already share glyph colours; the stand-ins are marked,
 * and recasting one is a one-line edit here. */
export const CREATURE_SHEETS = {
  'rat': 'antlion_small',          /* stand-in: small skittering thing */
  'giant-rat': 'antlion_small',    /* stand-in */
  'giant-spider': 'antlion',       /* stand-in: legs and mandibles */
  'goblin': 'goblin',
  'kobold': 'goblin',              /* tinted kin */
  'giant-ant': 'fire_ant',
  'centipede': 'ice_ant',          /* stand-in: low segmented crawler */
  'skeleton': 'skeleton_weak',
  'orc': 'goblin_elite',           /* stand-in: bigger green brute */
  'hobgoblin': 'goblin_elite',
  'ghoul': 'zombie',               /* tinted kin */
  'giant-snake': 'wyvern_water',   /* stand-in: coiling serpent */
  'zombie': 'zombie',
  'ghast': 'zombie',               /* tinted kin */
  'wererat': 'stealth',            /* stand-in: man-shaped skulker */
  'giant-leech': 'antlion_small',  /* stand-in */
  'living-statue': 'cursed_grave', /* stand-in: stone that moves */
  'gargoyle': 'wyvern_air',        /* stand-in: winged and grey */
  'mummy': 'zombie',               /* tinted kin */
  'wraith': 'skeleton_mage',       /* stand-in: robed and hollow */
  'spectre': 'skeleton_mage',      /* tinted kin */
  'ogre': 'minotaur',              /* stand-in: shoulders like a doorframe */
  'displacer-beast': 'stealth',    /* stand-in: never quite where it seems */
  'gelatinous-cube': null,         /* nothing in the commons is a cube */
  'minotaur': 'minotaur',
  'otyugh': 'antlion',             /* stand-in: a heap with mandibles */
  'troll': 'minotaur',             /* tinted stand-in */
  'basilisk': 'wyvern',            /* stand-in: too many legs, bad gaze */
  'wyvern': 'wyvern',
  'fire-elemental': null,          /* a tint cannot make anything into fire */
  'ettin': 'minotaur',             /* tinted stand-in */
  'stone-giant': 'minotaur',       /* tinted stand-in */
  'gorgon': 'minotaur',            /* an iron bull, near enough */
  'umber-hulk': 'antlion',         /* mandibled burrower — the best fit here */
  'dracolisk': 'wyvern_fire',
  'great-wyrm': 'wyvern_adult',
  'lapsai-demon': 'cursed_grave',  /* the temple's god, a hungering monument */
};

/* What each calling wears when it walks out of the Muster: the paper-doll
 * layers drawn bottom-up. The real mapping from equipped items to layers is
 * the isometric renderer's to grow; this is the seam's promise that the
 * files it will start from exist. */
export const HERO_LAYERS = {
  fighter: ['default_legs', 'default_chest', 'steel_armor', 'longsword', 'shield'],
  thief: ['default_legs', 'default_chest', 'leather_armor', 'dagger'],
  mage: ['default_legs', 'default_chest', 'mage_skirt', 'mage_vest', 'mage_hood', 'staff'],
  cleric: ['default_legs', 'default_chest', 'chain_cuirass', 'chain_coif', 'rod', 'buckler'],
};

/* The one place the two bodies disagree: the heads on offer. */
export const HERO_HEADS = { male: 'head_short', female: 'head_long' };

/* The tileset atlases the isometric floor will be laid from. */
export const TILESETS = ['tileset_dungeon', 'tileset_cave', 'tileset_grassland'];

export const ASSET_ROOT = 'assets';

export function creatureSheetUrl(name) {
  return name ? `${ASSET_ROOT}/creatures/${name}.png` : null;
}
export function creatureDefUrl(name) {
  return name ? `${ASSET_ROOT}/creatures/defs/${name}.txt` : null;
}
export function heroLayerUrl(sex, layer) {
  return `${ASSET_ROOT}/hero/${sex}/${layer}.png`;
}
export function heroDefUrl(sex, layer) {
  return `${ASSET_ROOT}/hero/defs/${sex}/${layer}.txt`;
}
export function tilesetUrl(name) {
  return `${ASSET_ROOT}/tilesets/${name}.png`;
}
export function tilesetDefUrl(name) {
  return `${ASSET_ROOT}/tilesets/defs/${name}.txt`;
}

/* Loads an image once and remembers it; resolves null on any failure, so a
 * missing or half-downloaded asset degrades to the procedural token instead
 * of taking the render loop down. Browser-only by its nature. */
const imageCache = new Map();
export function loadImage(url) {
  if (!url || typeof Image === 'undefined') return Promise.resolve(null);
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }
  return imageCache.get(url);
}
