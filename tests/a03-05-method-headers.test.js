import test from 'node:test';
import assert from 'node:assert/strict';
import { writeMethodBody, CilWriter } from '@sharpforge/cil';

const auto = Object.freeze({ headerFormat: 'auto' });
const fat = Object.freeze({ headerFormat: 'fat' });
const invalid = error => error.name === 'CilError' && error.code === 'CILEH0001';

test('automatic tiny headers cover 1 and 63 bytes and stack bounds through eight', () => {
  for (const size of [1, 63]) {
    const code = new Uint8Array(size);
    code[size - 1] = 0x2a;
    for (const bound of [0, 1, 8]) {
      const body = writeMethodBody(code, 0, bound, [], auto);
      assert.equal(body.length, size + 1);
      assert.equal(body[0], (size << 2) | 2);
      assert.deepEqual(body.subarray(1), code);
    }
  }
});

test('64 bytes, stack nine, locals and EH require fat headers with exact bounds', () => {
  for (const [size, local, bound] of [[64, 0, 0], [1, 0, 9], [1, 0x11000001, 0], [1, 0, 65535]]) {
    const body = writeMethodBody(new Uint8Array(size), local, bound, [], auto);
    const reader = new DataView(body.buffer, body.byteOffset, body.byteLength);
    assert.equal(reader.getUint16(0, true), 0x3013);
    assert.equal(reader.getUint16(2, true), bound);
    assert.equal(reader.getUint32(8, true), local);
    assert.equal(body.length, size + 12);
  }
  const handler = { flags: 2, start: 0, end: 1, target: 1, handlerEnd: 2 };
  const body = writeMethodBody(Uint8Array.of(0, 0xdc), 0, 0, [handler], { ...auto, exceptionFormat: 'small' });
  assert.equal(body[0], 0x1b);
  assert.equal(body[16], 1);
  assert.equal(new DataView(body.buffer).getUint16(2, true), 0);
});

test('explicit fat zero and initialization policy differ intentionally from the exact legacy default', () => {
  const code = Uint8Array.of(0x2a);
  assert.equal(Buffer.from(writeMethodBody(code, 0, 0)).toString('hex'), '1330010001000000000000002a');
  assert.equal(Buffer.from(writeMethodBody(code, 0, 0, [], fat)).toString('hex'), '1330000001000000000000002a');
  assert.equal(Buffer.from(writeMethodBody(code, 0, 0, [], { ...fat, initLocals: false })).toString('hex'),
    '0330000001000000000000002a');
  const allocated = new CilWriter().integer(4).op('localloc').op('pop').op('ret').finish();
  assert.equal(writeMethodBody(allocated, 0, 1, [], { ...auto, hasDynamicStackAllocation: true })[0] & 3, 3);
  assert.equal(writeMethodBody(allocated, 0, 1, [], { ...auto, hasDynamicStackAllocation: true, initLocals: false })[0] & 3, 2);
});

test('forced tiny and malformed policies reject lossy encodings; byte ownership and cancellation remain checked', () => {
  const code = Uint8Array.of(0x2a);
  for (const options of [{ headerFormat: 'small' }, { ...auto, initLocals: 0 }, { ...auto, hasDynamicStackAllocation: 1 },
    { initLocals: false }, { hasDynamicStackAllocation: false }]) {
    assert.throws(() => writeMethodBody(code, 0, 0, [], options), invalid);
  }
  for (const [bytes, local, bound] of [[new Uint8Array(64), 0, 0], [code, 0, 9], [code, 0x11000001, 0]]) {
    assert.throws(() => writeMethodBody(bytes, local, bound, [], { headerFormat: 'tiny' }), invalid);
  }
  assert.throws(() => writeMethodBody(code, 0, 1, [], {
    headerFormat: 'tiny', hasDynamicStackAllocation: true,
  }), invalid);
  const input = Buffer.from([9, 0x2a, 8]).subarray(1, 2);
  const body = writeMethodBody(input, 0, 0, [], auto);
  input[0] = 0;
  assert.equal(body[1], 0x2a);
  assert.throws(() => writeMethodBody(code, 0, 0, [], { ...auto, signal: AbortSignal.abort() }),
    error => error.code === 'CILEH0004');
});
