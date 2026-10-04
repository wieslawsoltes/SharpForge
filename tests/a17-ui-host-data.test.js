import test from 'node:test';
import assert from 'node:assert/strict';
import {assertUIHostData} from '../apps/studio/workers/ui-data.js';

test('worker and browser share a bounded data-only host result contract', () => {
  const value = {id: 'element', pixels: new Uint8Array([255, 0, 0, 255]), bounds: {width: 1, height: 1}, ok: true};
  assert.equal(assertUIHostData(value), value);
  assert.throws(() => assertUIHostData({callback() {}}), /unsupported/);
  assert.throws(() => assertUIHostData({number: Infinity}), /finite/);
  assert.throws(() => assertUIHostData(new Date()), /projection/);
  assert.throws(() => assertUIHostData(Object.defineProperty({}, 'getter', {get() { throw new Error('executed'); }})), /member/);
  const cycle = {};
  cycle.next = cycle;
  assert.throws(() => assertUIHostData(cycle), /cycle/);
  let deep = null;
  for (let index = 0; index < 34; index++) deep = {next: deep};
  assert.throws(() => assertUIHostData(deep), /nesting/);
});
