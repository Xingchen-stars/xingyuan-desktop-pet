const test = require('node:test');
const assert = require('node:assert/strict');
const { clampBounds, homeBounds, rememberPosition, restoreBounds } = require('../versions/xingyuan-video-v1/preview/geometry.cjs');
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1536, height: 816 } };
const left = { id: 2, workArea: { x: -1920, y: -100, width: 1920, height: 1040 } };
const displays = [primary, left];
test('default remains primary bottom right, with taskbar excluded', () => {
  assert.deepEqual(homeBounds(260, primary.workArea), { x: 1248, y: 532, width: 260, height: 260 });
});
test('negative-coordinate monitor round trip', () => {
  const bounds = { x: -1500, y: 130, width: 260, height: 260 };
  assert.deepEqual(restoreBounds(rememberPosition(bounds, left), 260, displays, primary), bounds);
});
test('removed monitor falls back visibly onto primary', () => {
  const position = rememberPosition({ x: -1500, y: 130, width: 260, height: 260 }, left);
  assert.deepEqual(restoreBounds(position, 260, [primary], primary), homeBounds(260, primary.workArea));
});
test('changed work area retains relative placement', () => {
  const resized = { ...left, workArea: { x: -1280, y: 0, width: 1280, height: 680 } };
  assert.deepEqual(restoreBounds({ displayId: 2, ratioX: .5, ratioY: 1 }, 260, [primary, resized], primary), { x: -770, y: 420, width: 260, height: 260 });
});
test('out-of-bounds drag is fully recovered', () => {
  assert.deepEqual(clampBounds({ x: -300, y: 3000, width: 260, height: 260 }, primary.workArea), { x: 0, y: 556, width: 260, height: 260 });
});
test('invalid and hostile saved preferences use the default', () => {
  for (const position of [null, [], 'bad', { displayId: 1, ratioX: Infinity, ratioY: 0 }, { displayId: 1, ratioX: -1, ratioY: .4 }, { displayId: 1, ratioX: '0.5', ratioY: .4 }, { displayId: 1, ratioX: .5, ratioY: 2 }]) {
    assert.deepEqual(restoreBounds(position, 260, displays, primary), homeBounds(260, primary.workArea));
  }
});
test('resize to maximum remains within work area', () => {
  const restored = restoreBounds({ displayId: 1, ratioX: 1, ratioY: 1 }, 520, displays, primary);
  assert.deepEqual(restored, { x: 1016, y: 296, width: 520, height: 520 });
});
test('remembering an off-screen position clamps ratios into range', () => {
  assert.deepEqual(rememberPosition({ x: -9999, y: 9999, width: 260, height: 260 }, primary), { displayId: 1, ratioX: 0, ratioY: 1 });
});
