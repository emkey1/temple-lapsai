/* The sprite seam, held against the actual files. The manifest in sprites.js
 * promises that certain PNGs and definition files exist and agree with each
 * other; nothing else in the engine checks, because the browser fails these
 * things silently — a missing sheet is just an invisible monster. So the
 * promises are all cashed here, headless, against public/assets/ on disk. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAnimationDef, parseTilesetDef,
  CREATURE_SHEETS, HERO_LAYERS, HERO_HEADS, TILESETS, ASSET_ROOT,
  creatureSheetUrl, creatureDefUrl, heroLayerUrl, heroDefUrl,
  tilesetUrl, tilesetDefUrl,
} from '../public/js/sprites.js';
import { MONSTERS, CLASSES } from '../public/js/base.js';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const onDisk = (url) => path.join(PUB, url);
const exists = (url) => fs.existsSync(onDisk(url));

/* A PNG confesses its size in its first header chunk; that is enough to know
 * whether a definition's rectangles fit inside it, without decoding a pixel. */
function pngSize(url) {
  const buf = fs.readFileSync(onDisk(url));
  assert.equal(buf.readUInt32BE(12), 0x49484452, url + ' is not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ---- the parsers ---- */

test('an animation definition parses into directions and frames', () => {
  const def = parseAnimationDef(fs.readFileSync(onDisk(creatureDefUrl('skeleton_weak')), 'utf8'));
  assert.ok(def.image, 'no image line');
  assert.ok(def.animations.stance, 'no [stance] section');
  const stance = def.animations.stance;
  assert.equal(stance.frames.length, 8, 'a Flare creature faces eight ways');
  for (const dir of stance.frames) {
    assert.ok(dir.length >= 1, 'a direction with no frames');
    for (const f of dir) {
      assert.ok(f.w > 0 && f.h > 0, 'a frame with no size');
    }
  }
  assert.ok(stance.duration > 0, 'a stance that does not tick');
});

test('a tileset definition parses into atlas rectangles', () => {
  const def = parseTilesetDef(fs.readFileSync(onDisk(tilesetDefUrl('tileset_dungeon')), 'utf8'));
  assert.ok(def.image, 'no img line');
  const ids = Object.keys(def.tiles);
  assert.ok(ids.length > 20, 'a dungeon of fewer than twenty tiles');
  for (const id of ids) {
    const t = def.tiles[id];
    assert.ok(t.w > 0 && t.h > 0, 'tile ' + id + ' has no size');
  }
});

test('the parsers shrug at garbage rather than throwing', () => {
  assert.deepEqual(parseAnimationDef('').animations, {});
  assert.deepEqual(parseTilesetDef(null).tiles, {});
  assert.deepEqual(parseAnimationDef('no sections\njust noise').animations, {});
});

/* ---- the manifest against the disk ---- */

test('every monster in the bestiary has a considered entry, sheet or null', () => {
  for (const m of MONSTERS) {
    assert.ok(m.id in CREATURE_SHEETS,
      m.id + ' is not in CREATURE_SHEETS — decide its sheet, or record the null');
  }
});

test('every named creature sheet exists, with its animation definition', () => {
  for (const [monster, sheet] of Object.entries(CREATURE_SHEETS)) {
    if (!sheet) continue;
    assert.ok(exists(creatureSheetUrl(sheet)), monster + ' names a missing sheet: ' + sheet);
    assert.ok(exists(creatureDefUrl(sheet)), monster + ' names a sheet with no definition: ' + sheet);
  }
});

test('every creature definition stays inside its own atlas', () => {
  const sheets = new Set(Object.values(CREATURE_SHEETS).filter(Boolean));
  for (const sheet of sheets) {
    const { w, h } = pngSize(creatureSheetUrl(sheet));
    const def = parseAnimationDef(fs.readFileSync(onDisk(creatureDefUrl(sheet)), 'utf8'));
    for (const [name, anim] of Object.entries(def.animations)) {
      for (const dir of anim.frames) {
        for (const f of dir || []) {
          assert.ok(f.x + f.w <= w && f.y + f.h <= h,
            sheet + ' [' + name + '] has a frame outside the image');
        }
      }
    }
  }
});

test('every calling can be dressed, in either body, with definitions to match', () => {
  assert.deepEqual(Object.keys(HERO_LAYERS).sort(), Object.keys(CLASSES).sort(),
    'HERO_LAYERS and CLASSES disagree about the callings');
  for (const [cls, layers] of Object.entries(HERO_LAYERS)) {
    for (const layer of layers) {
      for (const sex of ['male', 'female']) {
        assert.ok(exists(heroLayerUrl(sex, layer)), cls + ' names a missing layer: ' + sex + '/' + layer);
        assert.ok(exists(heroDefUrl(sex, layer)), cls + ' layer has no definition: ' + sex + '/' + layer);
      }
    }
  }
  for (const [sex, head] of Object.entries(HERO_HEADS)) {
    assert.ok(exists(heroLayerUrl(sex, head)), sex + ' has no head: ' + head);
    assert.ok(exists(heroDefUrl(sex, head)), sex + ' head has no definition: ' + head);
  }
});

test('every tileset exists, has a definition, and the tiles fit the atlas', () => {
  for (const name of TILESETS) {
    assert.ok(exists(tilesetUrl(name)), 'missing tileset: ' + name);
    assert.ok(exists(tilesetDefUrl(name)), 'tileset with no definition: ' + name);
    const { w, h } = pngSize(tilesetUrl(name));
    const def = parseTilesetDef(fs.readFileSync(onDisk(tilesetDefUrl(name)), 'utf8'));
    for (const [id, t] of Object.entries(def.tiles)) {
      assert.ok(t.x + t.w <= w && t.y + t.h <= h,
        name + ' tile ' + id + ' falls outside the image');
    }
  }
});

/* ---- the paperwork ---- */

test('CREDITS.md accounts for every pack directory, and the licences are named', () => {
  const credits = fs.readFileSync(onDisk(ASSET_ROOT + '/CREDITS.md'), 'utf8');
  const dirs = fs.readdirSync(onDisk(ASSET_ROOT), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const dir of dirs) {
    assert.ok(credits.includes(dir + '/'), 'assets/' + dir + '/ is not credited in CREDITS.md');
  }
  assert.ok(credits.includes('CC-BY-SA 3.0'), 'the share-alike licence is not named');
  assert.ok(credits.includes('CC0'), 'the public-domain dedication is not named');
  assert.ok(exists(ASSET_ROOT + '/FLARE-CREDITS.txt'), 'the Flare artist roll is missing');
  assert.ok(exists(ASSET_ROOT + '/props/kenney/LICENSE.txt'), 'the Kenney licence file is missing');
});

test('the portrait pools are stocked', () => {
  const pd = fs.readdirSync(onDisk(ASSET_ROOT + '/portraits/pd')).filter((f) => f.endsWith('.png'));
  const flare = fs.readdirSync(onDisk(ASSET_ROOT + '/portraits/flare')).filter((f) => f.endsWith('.png'));
  assert.ok(pd.length >= 60, 'the public-domain portrait pool has thinned: ' + pd.length);
  assert.ok(flare.length >= 30, 'the Flare portrait pool has thinned: ' + flare.length);
});

/* ---- the faces ---- */

import { FLARE_PORTRAITS, PD_PORTRAITS, memberPortrait, npcPortrait } from '../public/js/portraits.js';

test('every listed face exists on disk', () => {
  for (const sex of ['male', 'female']) {
    for (const f of FLARE_PORTRAITS[sex]) {
      assert.ok(exists('assets/portraits/flare/' + f), 'a missing Flare face: ' + f);
    }
  }
  for (const f of PD_PORTRAITS) {
    assert.ok(exists('assets/portraits/pd/' + f), 'a missing painted face: ' + f);
  }
  assert.ok(FLARE_PORTRAITS.male.length >= 15 && FLARE_PORTRAITS.female.length >= 10, 'the pools thinned');
});

test('a name keeps its face for ever', () => {
  assert.equal(memberPortrait('Sethra', 'female'), memberPortrait('Sethra', 'female'));
  assert.notEqual(memberPortrait('Sethra', 'female'), memberPortrait('Sethra', 'male'), 'sex pools should differ');
  assert.equal(npcPortrait('lector'), npcPortrait('lector'));
  assert.ok(memberPortrait('Brant', 'male').startsWith('assets/portraits/flare/'));
  assert.ok(npcPortrait('provisioner').startsWith('assets/portraits/pd/'));
});
