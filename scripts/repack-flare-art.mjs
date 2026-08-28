/* Fetches Flare's full-resolution art and cuts it down to what this game
 * actually draws.
 *
 * The sheets shipped here came from Flare's `minicore` mod, whose sprites are
 * authored at about sixteen pixels — fine at the size Flare drew them, mush
 * once this renderer puts a creature on a 46-pixel body and lets the player
 * zoom to 3x. The same creatures exist in the `fantasycore` mod at roughly six
 * times the linear resolution, painted by the same artists, under the same
 * CC-BY-SA licence, in the same definition format.
 *
 * Taking those sheets whole would cost about 170MB, because each one carries
 * ten animations in eight directions and this renderer draws exactly two of
 * them: `stance` for anything standing and `die` for anything that is not.
 * So this cuts out the frames that are used, packs them into a new sheet, and
 * writes a definition pointing at it. The result is a fraction of the weight
 * of the original at none of the loss — the pixels that survive are the
 * artist's own, untouched and unscaled.
 *
 * The renderer sizes a creature from its stance height in source pixels, a
 * number that just grew sixfold. Rather than retune that curve per creature,
 * each rewritten definition carries a `scale=` line: how many source pixels
 * now stand for one of the old ones. The renderer divides by it and every
 * creature keeps the size it has today.
 *
 *   node scripts/repack-flare-art.mjs            # fetch, repack, report
 *   node scripts/repack-flare-art.mjs --dry-run  # report only, write nothing
 *
 * Downloads are cached under .art-cache/ (git-ignored) so a second run is
 * offline and instant.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG, blit, resample } from './png.mjs';
import { HERO_LAYERS, HERO_HEADS, CREATURE_SHEETS } from '../public/js/sprites.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, '.art-cache');
const RAW = 'https://raw.githubusercontent.com/flareteam/flare-game/master/mods';

/* The only animation this renderer ever asks a creature for. Everything else
 * in an upstream sheet — running, swinging, casting, blocking, four flavours
 * of dying — is weight we would ship and never draw. When corpses want
 * drawing, add 'die' here and run this again. */
const KEEP = ['stance'];

/* What the renderer does with a creature, mirrored from drawIsoMonster and
 * drawFrameAt in public/js/main.js. A frame bigger than the largest the
 * screen can ever show is detail nobody will see, paid for in download and in
 * the memory a decoded texture holds — an eight-thousand-pixel wyrm sheet
 * costs a third of a gigabyte resident to draw a lizard three inches tall. So
 * every sheet is scaled to exactly the size it can be seen at, and no more:
 * native at full zoom, oversampled at every zoom below it. */
const ISO_UNIT = 46;      /* one tile tall, for a body */
const ZOOM_MAX = 3;       /* ZOOM_MAX in main.js */
const BOSS = 1.3;         /* the extra a boss is drawn at */
/* The canvas is sized to devicePixelRatio as well as zoom, so a body drawn
 * 46 units tall lands on twice that many pixels on any Retina display. Two
 * is the honest figure to build for: it covers every Mac and phone made this
 * decade, and the displays that report three are asking for more resolution
 * than the upstream art contains in the first place. */
const DPR = 2;

/* No sheet wider or taller than this. Four thousand square is sixty-seven
 * megabytes decoded, which is as much as one creature is worth. */
const MAX_SHEET = 4096;

function drawnHeight(stanceH) {
  const t = Math.min(1.9, Math.max(0.7, 0.5 + 0.55 * stanceH / 40));
  return ISO_UNIT * t;
}

/* One pixel of empty space around every frame, so that when the canvas scales
 * a sprite up it cannot sample its neighbour's shoulder. */
const GUTTER = 1;

/* Where upstream keeps the better version of each sheet we ship. A null means
 * nothing larger exists in any mod — the minicore original stays. */
const CREATURES = {
  antlion: 'fantasycore/animations/enemies/antlion.txt',
  antlion_small: 'fantasycore/animations/enemies/antlion_small.txt',
  cursed_grave: 'fantasycore/animations/enemies/cursed_grave.txt',
  fire_ant: 'fantasycore/animations/enemies/fire_ant.txt',
  goblin: 'fantasycore/animations/enemies/goblin.txt',
  goblin_elite: 'fantasycore/animations/enemies/goblin_elite.txt',
  ice_ant: 'fantasycore/animations/enemies/ice_ant.txt',
  minotaur: 'fantasycore/animations/enemies/minotaur.txt',
  skeleton: 'fantasycore/animations/enemies/skeleton.txt',
  skeleton_archer: 'fantasycore/animations/enemies/skeleton_archer.txt',
  skeleton_mage: 'fantasycore/animations/enemies/skeleton_mage.txt',
  skeleton_weak: 'fantasycore/animations/enemies/skeleton_weak.txt',
  stealth: null,                 /* minicore has the only copy there is */
  wyvern: 'fantasycore/animations/enemies/wyvern.txt',
  wyvern_adult: 'empyrean_campaign/animations/enemies/wyvern_air_boss.txt',
  wyvern_air: 'fantasycore/animations/enemies/wyvern_air.txt',
  wyvern_fire: 'fantasycore/animations/enemies/wyvern_fire.txt',
  wyvern_water: 'fantasycore/animations/enemies/wyvern_water.txt',
  zombie: 'fantasycore/animations/enemies/zombie.txt',
};

/* The two layers fantasycore calls something else. Ours came from minicore,
 * which had a `steel_armor` and a `leather_armor`; the larger pack has the
 * same idea under the names a smith would use. */
const HERO_RENAME = { steel_armor: 'plate_cuirass', leather_armor: 'leather_chest' };

/* Every layer any calling actually wears, plus both heads. Layers nobody
 * wears are left as they were: a doll is only ever drawn out of this list,
 * and mixing a repacked chest with an untouched hood would put the hood on
 * at a sixth of its size. */
function heroLayers(sex) {
  const worn = new Set(Object.values(HERO_LAYERS).flat());
  worn.add(HERO_HEADS[sex]);
  return [...worn];
}

async function cached(rel) {
  const file = path.join(CACHE, rel);
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(`${RAW}/${rel}`);
  if (!res.ok) throw new Error(`${res.status} fetching ${rel}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

/* Flare's animation definition, in the two shapes it comes in: one sheet for
 * everything, or one sheet per animation with the animation named after the
 * path and repeated as a ninth field on every frame line. */
function parseDef(text) {
  const images = {};      /* animation name -> image path; '' is the default */
  const anims = {};
  let scale = 1;
  let cur = null, curName = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      curName = section[1];
      cur = { duration: null, type: null, frames: [] };
      anims[curName] = cur;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key === 'image') {
      const [file, forAnim] = val.split(',').map((s) => s.trim());
      images[forAnim || ''] = file;
    } else if (key === 'scale' && !cur) scale = parseFloat(val) || 1;
    else if (cur && key === 'duration') cur.duration = val;
    else if (cur && key === 'type') cur.type = val;
    else if (cur && key === 'frame') {
      const p = val.split(',').map((s) => s.trim());
      cur.frames.push({
        idx: +p[0], dir: +p[1],
        x: +p[2], y: +p[3], w: +p[4], h: +p[5], ox: +p[6], oy: +p[7],
        image: p[8] || '',
      });
    }
  }
  return { images, anims, scale };
}

function stanceHeight(anims) {
  const st = anims.stance || Object.values(anims)[0];
  return st ? st.frames.reduce((h, f) => Math.max(h, f.h), 0) : 0;
}

/* Shelf packing: tallest frames first, laid in rows across a sheet about as
 * wide as it is tall. Sprite frames are all much the same size, so the rows
 * come out even and the waste is a percent or two — a smarter packer would
 * buy nothing here. */
function pack(frames, gutter) {
  const area = frames.reduce((a, f) => a + (f.w + gutter) * (f.h + gutter), 0);
  const widest = frames.reduce((w, f) => Math.max(w, f.w + gutter), 0);
  const width = Math.max(widest, Math.ceil(Math.sqrt(area * 1.05)));
  const order = [...frames].sort((a, b) => b.h - a.h || b.w - a.w);
  let x = gutter, y = gutter, rowH = 0;
  for (const f of order) {
    if (x + f.w + gutter > width) { x = gutter; y += rowH + gutter; rowH = 0; }
    f.px = x; f.py = y;
    x += f.w + gutter;
    rowH = Math.max(rowH, f.h);
  }
  return { width, height: y + rowH + gutter };
}

async function repackOne(name, defRel, outDir, ourDefPath) {
  const mod = defRel.split('/')[0];
  const def = parseDef((await cached(defRel)).toString('utf8'));

  /* Frames we will keep, deduplicated: upstream reuses a rectangle across
   * directions more often than you would guess. */
  const wanted = [];
  const seen = new Map();
  for (const anim of KEEP) {
    const a = def.anims[anim];
    if (!a) continue;
    for (const f of a.frames) {
      const img = def.images[f.image] ?? def.images[''] ?? def.images[anim];
      const key = `${img}|${f.x},${f.y},${f.w},${f.h}`;
      let rect = seen.get(key);
      if (!rect) { rect = { img, x: f.x, y: f.y, sw: f.w, sh: f.h }; seen.set(key, rect); wanted.push(rect); }
      f.rect = rect;
    }
  }
  if (!wanted.length) throw new Error(`${name}: nothing to keep`);

  /* Our own art is the yardstick: the renderer sizes a body from its stance
   * height, so what that height is today decides how big this creature gets
   * drawn, and therefore how many pixels are worth keeping. */
  const ours = parseDef(readFileSync(ourDefPath, 'utf8'));
  /* Divided by its own scale, so that running this again measures against the
   * art this all started from rather than against last run's output. */
  const oursH = (stanceHeight(ours.anims) / ours.scale) || 1;
  const upstreamH = stanceHeight(def.anims);

  /* Shrink further if the packed sheet would be a texture no browser should
   * be asked to hold: a decoded sheet costs four bytes a pixel, resident, for
   * as long as the creature is in the game. */
  let k = Math.min(1, (drawnHeight(oursH) * ZOOM_MAX * DPR * BOSS) / upstreamH);
  let width, height;
  for (;;) {
    for (const rect of wanted) {
      rect.w = Math.max(1, Math.round(rect.sw * k));
      rect.h = Math.max(1, Math.round(rect.sh * k));
    }
    ({ width, height } = pack(wanted, GUTTER));
    const over = Math.max(width, height) / MAX_SHEET;
    if (over <= 1) break;
    k /= Math.sqrt(over) * 1.01;
  }
  const sheet = { w: width, h: height, data: Buffer.alloc(width * height * 4) };

  /* Source sheets are decoded once each and shared; a split creature like the
   * minotaur draws its two animations from two different files. */
  const sources = new Map();
  for (const rect of wanted) {
    let src = sources.get(rect.img);
    if (!src) {
      src = decodePNG(await cached(`${mod}/${rect.img}`));
      sources.set(rect.img, src);
    }
    if (rect.w === rect.sw && rect.h === rect.sh) {
      blit(src, rect.x, rect.y, rect.sw, rect.sh, sheet, rect.px, rect.py);
    } else {
      /* Each frame is cut out before it is shrunk, never after: scaling the
       * packed sheet whole would smear every sprite into the one beside it. */
      const small = resample(src, rect.x, rect.y, rect.sw, rect.sh, rect.w, rect.h);
      blit(small, 0, 0, rect.w, rect.h, sheet, rect.px, rect.py);
    }
  }

  /* How much bigger this art is than what it replaces, measured on the one
   * number the renderer sizes a body from. The renderer divides by it, so
   * every creature keeps the size on screen it has today. */
  const scale = (upstreamH * k) / oursH;

  const lines = [
    `# Repacked from Flare's ${mod} mod by scripts/repack-flare-art.mjs.`,
    '# Only the animations this renderer draws survive; see that script.',
    '',
    `image=images/creatures/${name}.png`,
    `scale=${scale.toFixed(4)}`,
    '',
  ];
  for (const anim of KEEP) {
    const a = def.anims[anim];
    if (!a) continue;
    lines.push(`[${anim}]`);
    lines.push(`frames=${new Set(a.frames.map((f) => f.idx)).size}`);
    if (a.duration) lines.push(`duration=${a.duration}`);
    if (a.type) lines.push(`type=${a.type}`);
    for (const f of a.frames) {
      const r = f.rect;
      lines.push(`frame=${f.idx},${f.dir},${r.px},${r.py},${r.w},${r.h},` +
        `${Math.round(f.ox * k)},${Math.round(f.oy * k)}`);
    }
    lines.push('');
  }

  const png = encodePNG(sheet);
  return { png, def: lines.join('\n'), width, height, frames: wanted.length, scale };
}

/* A hero is a stack of layers drawn into each other, so every one of them
 * must agree about how big a pixel is — one scale for the whole wardrobe, not
 * one per garment. The number is measured across every layer both packs have
 * in common, summed rather than averaged: these frames are ten to twenty
 * pixels tall and a single one rounds by five percent, but a hundred of them
 * together do not. */
async function heroScale() {
  let up = 0, ours = 0;
  for (const layer of heroLayers('male')) {
    if (HERO_RENAME[layer]) continue;     /* different art, not a smaller copy */
    const u = parseDef((await cached(`fantasycore/animations/avatar/male/${layer}.txt`)).toString('utf8'));
    const o = parseDef(readFileSync(path.join(ROOT, 'public', 'assets', 'hero', 'defs', 'male', `${layer}.txt`), 'utf8'));
    up += stanceHeight(u.anims);
    ours += stanceHeight(o.anims) / o.scale;
  }
  return up / ours;
}

/* The fallen are drawn on the last frame of their dying and never on any
 * other — pickFrame is called with hold set — so one frame per direction is
 * the whole of what `die` needs to be. Kept as frame zero, which is what the
 * renderer would land on if that ever stopped being true. */
function trimToLastFrame(anim) {
  const last = new Map();
  for (const f of anim.frames) {
    const prev = last.get(f.dir);
    if (!prev || f.idx > prev.idx) last.set(f.dir, f);
  }
  anim.frames = [...last.values()].map((f) => ({ ...f, idx: 0 }));
}

async function repackHero(sex, layer, scale, dry) {
  const up = HERO_RENAME[layer] || layer;
  const def = parseDef((await cached(`fantasycore/animations/avatar/${sex}/${up}.txt`)).toString('utf8'));
  if (def.anims.die) trimToLastFrame(def.anims.die);

  const wanted = [];
  const seen = new Map();
  for (const anim of ['stance', 'die']) {
    const a = def.anims[anim];
    if (!a) continue;
    for (const f of a.frames) {
      const img = def.images[f.image] ?? def.images[''] ?? def.images[anim];
      const key = `${img}|${f.x},${f.y},${f.w},${f.h}`;
      let rect = seen.get(key);
      if (!rect) { rect = { img, x: f.x, y: f.y, sw: f.w, sh: f.h, w: f.w, h: f.h }; seen.set(key, rect); wanted.push(rect); }
      f.rect = rect;
    }
  }
  const { width, height } = pack(wanted, GUTTER);
  const sheet = { w: width, h: height, data: Buffer.alloc(width * height * 4) };
  const sources = new Map();
  for (const rect of wanted) {
    let src = sources.get(rect.img);
    if (!src) { src = decodePNG(await cached(`fantasycore/${rect.img}`)); sources.set(rect.img, src); }
    blit(src, rect.x, rect.y, rect.sw, rect.sh, sheet, rect.px, rect.py);
  }

  const lines = [
    `# Repacked from Flare's fantasycore mod by scripts/repack-flare-art.mjs.`,
    '# Only the frames this renderer draws survive; see that script.',
    '',
    `image=images/avatar/${sex}/${layer}.png`,
    `scale=${scale.toFixed(4)}`,
    '',
  ];
  for (const anim of ['stance', 'die']) {
    const a = def.anims[anim];
    if (!a) continue;
    lines.push(`[${anim}]`);
    lines.push(`frames=${new Set(a.frames.map((f) => f.idx)).size}`);
    if (a.duration) lines.push(`duration=${a.duration}`);
    if (a.type) lines.push(`type=${a.type}`);
    for (const f of a.frames) {
      lines.push(`frame=${f.idx},${f.dir},${f.rect.px},${f.rect.py},${f.w},${f.h},${f.ox},${f.oy}`);
    }
    lines.push('');
  }
  const png = encodePNG(sheet);
  const imgPath = path.join(ROOT, 'public', 'assets', 'hero', sex, `${layer}.png`);
  const defPath = path.join(ROOT, 'public', 'assets', 'hero', 'defs', sex, `${layer}.txt`);
  const was = statSync(imgPath).size;
  if (!dry) { writeFileSync(imgPath, png); writeFileSync(defPath, lines.join('\n')); }
  return { was, now: png.length, frames: wanted.length, width, height };
}

const dry = process.argv.includes('--dry-run');
const outImg = path.join(ROOT, 'public', 'assets', 'creatures');
const outDef = path.join(outImg, 'defs');

let before = 0, after = 0;
const skipped = [];
for (const [name, rel] of Object.entries(CREATURES)) {
  const imgPath = path.join(outImg, `${name}.png`);
  const defPath = path.join(outDef, `${name}.txt`);
  const wasImg = statSync(imgPath).size;
  if (!rel) {
    skipped.push(name);
    before += wasImg; after += wasImg;
    continue;
  }
  const r = await repackOne(name, rel, outImg, defPath);
  before += wasImg;
  after += r.png.length;
  const pct = ((r.png.length / wasImg) * 100).toFixed(0);
  process.stdout.write(
    `${name.padEnd(16)} ${String(r.frames).padStart(3)} frames  ` +
    `${String(r.width).padStart(4)}x${String(r.height).padEnd(4)}  ` +
    `${(wasImg / 1024).toFixed(0).padStart(5)}K -> ${(r.png.length / 1024).toFixed(0).padStart(5)}K (${pct}%)  ` +
    `scale ${r.scale.toFixed(2)}x\n`);
  if (!dry) { writeFileSync(imgPath, r.png); writeFileSync(defPath, r.def); }
}
if (skipped.length) console.log(`\nleft alone (no larger art upstream): ${skipped.join(', ')}`);
console.log(`creature art ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB`);

console.log('');
const hs = await heroScale();
/* The same reasoning as a creature's, in the other branch of drawFrameAt: a
 * hero layer is drawn at unit/28 of its own pixels. What comes out is the
 * same for every layer, which is the point — the wardrobe scales as one. */
const heroK = Math.min(1, ((ISO_UNIT / 28) * ZOOM_MAX * DPR) / hs);
let hBefore = 0, hAfter = 0;
for (const sex of ['male', 'female']) {
  for (const layer of heroLayers(sex)) {
    const r = await repackHero(sex, layer, hs / heroK, dry);
    hBefore += r.was; hAfter += r.now;
    process.stdout.write(
      `${(sex[0] + '/' + layer).padEnd(22)} ${String(r.frames).padStart(3)} frames  ` +
      `${String(r.width).padStart(4)}x${String(r.height).padEnd(4)}  ` +
      `${(r.was / 1024).toFixed(0).padStart(4)}K -> ${(r.now / 1024).toFixed(0).padStart(4)}K\n`);
  }
}
console.log(`\nhero art ${(hBefore / 1048576).toFixed(1)}MB -> ${(hAfter / 1048576).toFixed(1)}MB  (one scale for the whole wardrobe: ${hs.toFixed(2)}x)`);
console.log(`\nall of it ${((before + hBefore) / 1048576).toFixed(1)}MB -> ${((after + hAfter) / 1048576).toFixed(1)}MB${dry ? '  (dry run, nothing written)' : ''}`);
