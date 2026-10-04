import test from 'node:test';
import assert from 'node:assert/strict';
import { Op } from '@sharpforge/bytecode';
import { sourceExceptionLayout } from '../packages/cil/src/emit/exception-regions.js';

function source(codeSize, handlers, jumps = []) {
  const code = new Int32Array(codeSize * 3);
  for (let pc = 0; pc < codeSize; pc++) code[pc * 3] = Op.NOP;
  for (const [pc, target] of jumps) { code[pc * 3] = Op.JUMP; code[pc * 3 + 1] = target; }
  return { code, handlers };
}

const outer = { kind: 'finally', start: 0, end: 1, target: 2, handlerEnd: 10 };
const inner = { start: 3, end: 4, target: 5, handlerEnd: 8, slot: 0 };

test('source-PC tree orders nested clauses first without changing sibling priority or input objects', () => {
  const sibling = { start: 3, end: 4, target: 8, handlerEnd: 9, slot: 1 };
  const method = source(12, [outer, inner, sibling], [[1, 10], [4, 9]]);
  const before = structuredClone(method.handlers);
  const layout = sourceExceptionLayout(method);
  assert.deepEqual(layout.handlers.map(handler => handler.target), [5, 8, 2]);
  assert.equal(layout.handlerAt(5).slot, 0);
  assert.equal(layout.handlerAt(8).slot, 1);
  assert.equal(layout.handlerAt(11), undefined);
  assert.deepEqual(method.handlers, before);
  for (let pc = 0; pc <= 12; pc++) {
    const zones = method.handlers.filter(handler => pc >= handler.start && pc <= handler.end ||
      pc >= handler.target && pc < handler.handlerEnd);
    assert.equal(layout.protected(pc), zones.length > 0);
    for (let target = 0; target <= 12; target++) {
      const leaves = zones.some(handler => pc <= handler.end
        ? target < handler.start || target > handler.end
        : target < handler.target || target >= handler.handlerEnd);
      assert.equal(layout.leaves(pc, target), leaves, `${pc} -> ${target}`);
    }
  }
});

test('catch family boundaries are inferred once in target order while clause priority stays stable', () => {
  const first = { start: 0, end: 1, target: 2, slot: 0 };
  const second = { start: 0, end: 1, target: 4, slot: 1 };
  const method = source(7, [second, first], [[1, 6], [3, 6], [5, 6]]);
  const layout = sourceExceptionLayout(method);
  assert.deepEqual(layout.handlers.map(handler => [handler.target, handler.handlerEndPc]), [[4, 6], [2, 4]]);
  assert.equal(layout.leaves(1, 6), true);
  assert.equal(layout.leaves(0, 1), false);
  assert.equal(layout.leaves(6, 0), false);
});

test('malformed ranges, crossing families, ambiguous entries and unsupported filters fail explicitly', () => {
  for (const handlers of [
    [{ ...outer, start: -1 }], [{ ...outer, handlerEnd: 13 }], [{ ...outer, target: 1 }],
    [outer, { ...inner, handlerEnd: 11 }],
    [outer, { ...inner, start: 0, end: 2 }],
    [outer, { ...inner, target: 2 }], [{ ...inner, kind: 'filter' }],
  ]) assert.throws(() => sourceExceptionLayout(source(12, handlers)), { name: 'CilError' });
  const noBoundary = source(4, [{ start: 0, end: 1, target: 2, slot: 0 }]);
  assert.throws(() => sourceExceptionLayout(noBoundary), /explicit boundary or source exit jump/);
  assert.throws(() => sourceExceptionLayout({ code: { length: 3_000_003 }, handlers: [] }), /size limit/);
  assert.throws(() => sourceExceptionLayout({ code: new Int32Array(), handlers: { length: 100001 } }), /size limit/);
});

test('no-handler methods use the shared empty layout; family preflight bounds large inputs', () => {
  const first = sourceExceptionLayout(source(1, []));
  const second = sourceExceptionLayout(source(2, []));
  assert.equal(first, second);
  assert.equal(first.protected(0), false);
  assert.equal(first.leaves(0, 1), false);
  assert(Object.isFrozen(first));
  assert.throws(() => sourceExceptionLayout(source(2, Array(100001).fill(outer))), /size limit/);
});
