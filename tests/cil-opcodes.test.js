import test from 'node:test';
import assert from 'node:assert/strict';
import { CilOpcodes, CilWriter, decodeInstructions } from '@sharpforge/cil';

test('malformed opcode names reject with CilError before any writer state changes or name coercion', () => {
  let coerced = false;
  const object = { toString() { coerced = true; return 'nop'; } };
  for (const name of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty', 'unsupported',
    undefined, null, 1, Symbol('nop'), object, Object.create(null)]) {
    const writer = new CilWriter().mark('start').op('nop');
    assert.throws(() => writer.op(name), error => error.name === 'CilError');
    assert.equal(writer.length, 1);
    assert.deepEqual(writer.finish(), Uint8Array.of(0));
    assert.deepEqual([...writer.labels], [['start', 0]]);
    assert.deepEqual(writer.fixups, []);
  }
  assert.equal(coerced, false);
});

const operands = {
  '': [undefined], u8: [0, 255], u16: [0, 65535], i8: [-128, 127], i32: [-2147483648, 2147483647],
  i64: [-9223372036854775808n, 9223372036854775807n], f32: [-Infinity, Infinity, -0, Math.fround(1 / 3)],
  f64: [Number.MIN_VALUE, Number.MAX_VALUE, -0, NaN], token: [1, 0xffffffff], br8: [0], br32: [0], switch: [[]],
};

test('all 219 opcode encodings round-trip their scalar operand boundaries without changing names', () => {
  assert.equal(Object.keys(CilOpcodes).length, 219);
  for (const opcode of Object.values(CilOpcodes)) {
    for (const operand of operands[opcode.operand]) {
      const bytes = new CilWriter().op(opcode.name, operand).op('nop').finish();
      const instruction = decodeInstructions(bytes)[0];
      assert.equal(instruction.name, opcode.name);
      assert.equal(instruction.operandKind, opcode.operand);
      const expected = opcode.operand.startsWith('br') ? instruction.size : operand;
      assert.deepEqual(instruction.operand, expected, opcode.name);
    }
  }
});

test('zero and 1000-entry switch tables preserve all target offsets', () => {
  for (const count of [0, 1000]) {
    const writer = new CilWriter().op('switch', Array(count).fill('target')).mark('target').op('ret');
    const instruction = decodeInstructions(writer.finish())[0];
    assert.equal(instruction.operand.length, count);
    assert(instruction.operand.every(target => target === writer.labels.get('target')));
    assert.equal(instruction.size, 5 + 4 * count);
  }
});

test('signed-byte branch extremes round-trip and int32 displacements outside the method reject', () => {
  const forward = new CilWriter().op('br.s', 'end').zero(127).mark('end').op('ret');
  const backward = new CilWriter().mark('start').zero(126).op('br.s', 'start');
  assert.equal(decodeInstructions(forward.finish())[0].operand, 129);
  assert.equal(decodeInstructions(backward.finish()).at(-1).operand, 0);
  for (const operand of [-2147483648, 2147483647]) {
    const bytes = new CilWriter().op('br', operand).op('ret').finish();
    assert.throws(() => decodeInstructions(bytes), /instruction boundary/);
  }
});

test('every undefined two-byte opcode and truncated operand rejects', () => {
  const values = new Set(Object.values(CilOpcodes).map(opcode => opcode.value));
  for (let low = 0; low < 256; low++) {
    if (!values.has(0xfe00 | low)) assert.throws(() => decodeInstructions(Uint8Array.of(0xfe, low)), /Unsupported CIL opcode/);
  }
  for (const name of ['ldc.i4', 'ldc.i8', 'call', 'ldarg', 'br', 'switch']) {
    const bytes = new CilWriter().op(name, name === 'switch' ? [0] : 0).finish();
    assert.throws(() => decodeInstructions(bytes.subarray(0, bytes.length - 1)), /Truncated|Invalid switch table/);
  }
});
