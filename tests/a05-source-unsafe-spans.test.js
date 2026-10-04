import test from 'node:test';
import assert from 'node:assert/strict';
import {Op, Binary} from '@sharpforge/bytecode';
import {CilWriter, decodeInstructions} from '../packages/cil/src/opcodes.js';
import {emitSourceUnsafeMemory, decodeSourceUnsafeMemory} from '../packages/cil/src/source-unsafe-memory.js';

function roundTrip(instruction, input, compact = false) {
  const writer = new CilWriter(undefined, {compact});
  const constants = ['int'];
  const method = {locals: [{type: 'int&', pinned: true}]};
  const context = {image: {constants}, method, resolveType: () => 0x01000001,
    metadata: {typeName: () => 'System.Int32'}, intern: value => constants.indexOf(value)};
  assert(emitSourceUnsafeMemory(writer, context, {...instruction, input}));
  const span = decodeInstructions(writer.finish());
  return {decoded: decodeSourceUnsafeMemory(span, context), span, context};
}

for (const compact of [false, true]) {
  test(`unsafe source pin release decodes the actual integer encoding, compact=${compact}`, () => {
    const pin = roundTrip({op: Op.PIN, a: 0, b: 0}, ['int&'], compact);
    assert.deepEqual(pin.decoded, [Op.PIN, 0, 0]);
    const release = roundTrip({op: Op.UNPIN, a: 0, b: 0}, [], compact);
    assert.deepEqual(release.decoded, [Op.UNPIN, 0, 0]);
    release.context.method.locals[0].pinned = false;
    assert.equal(decodeSourceUnsafeMemory(release.span, release.context), null);
  });

  test(`unsafe comparisons and null pointer conversions decode their exact spans, compact=${compact}`, () => {
    for (const operator of ['==', '!=', '<', '>', '<=', '>=']) {
      assert.deepEqual(roundTrip({op: Op.BINARY, a: Binary[operator], b: 0}, ['int*', 'int*'], compact).decoded,
        [Op.BINARY, Binary[operator], 0], operator);
    }
    assert.deepEqual(roundTrip({op: Op.PTRCONVERT, a: 0, b: 0}, ['null'], compact).decoded, [Op.PTRCONVERT, 0, 0]);
    assert.deepEqual(roundTrip({op: Op.STACKALLOC_RAW, a: 0, b: 0}, ['int'], compact).decoded, [Op.STACKALLOC_RAW, 0, 0]);
  });
}
