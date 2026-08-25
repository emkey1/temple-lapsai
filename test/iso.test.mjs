/* The projection, checked as arithmetic. If these hold, the renderer and
 * the mouse agree about where every tile is, which is the only promise the
 * module makes. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ISO, isoToScreen, screenToIso, diamondPath, paintOrder, makeViewTest } from '../public/js/iso.js';

test('the origin projects to the origin', () => {
  assert.deepEqual(isoToScreen(0, 0), { sx: 0, sy: 0 });
});

test('east lies lower-right, south lies lower-left — the Flare compass', () => {
  const e = isoToScreen(1, 0), s = isoToScreen(0, 1);
  assert.ok(e.sx > 0 && e.sy > 0, 'world east did not head lower-right');
  assert.ok(s.sx < 0 && s.sy > 0, 'world south did not head lower-left');
  assert.equal(e.sy, s.sy, 'the two neighbours fell on different rows');
});

test('every tile round-trips through its own centre', () => {
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const { sx, sy } = isoToScreen(x, y);
      assert.deepEqual(screenToIso(sx, sy), { x, y }, `tile ${x},${y} lost itself`);
    }
  }
});

test('a nudge inside the diamond still names the same tile', () => {
  const { sx, sy } = isoToScreen(5, 7);
  for (const [dx, dy] of [[6, 0], [-6, 0], [0, 3], [-4, -2]]) {
    assert.deepEqual(screenToIso(sx + dx, sy + dy), { x: 5, y: 7 });
  }
});

test('a step past the edge names the neighbour', () => {
  const { sx, sy } = isoToScreen(5, 7);
  const east = screenToIso(sx + ISO.TW / 2 + 2, sy + ISO.TH / 2 + 1);
  assert.deepEqual(east, { x: 6, y: 7 });
});

test('the diamond has four corners around its centre', () => {
  const pts = diamondPath(100, 50);
  assert.equal(pts.length, 4);
  assert.deepEqual(pts[0], [100, 50 - ISO.TH / 2]);
  assert.deepEqual(pts[1], [100 + ISO.TW / 2, 50]);
});

test('painter order walks back to front', () => {
  const tiles = [{ x: 4, y: 4 }, { x: 0, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }];
  const sorted = [...tiles].sort(paintOrder);
  assert.deepEqual(sorted.map((t) => t.x + t.y), [0, 3, 3, 8]);
  assert.ok(sorted[1].x < sorted[2].x, 'the tie did not break on x');
});

test('the view test keeps what is near and culls what is far', () => {
  const inView = makeViewTest(-200, -200, 200, 200);
  assert.ok(inView(0, 0));
  assert.ok(!inView(40, 0), 'a tile half a map away survived the cull');
});
