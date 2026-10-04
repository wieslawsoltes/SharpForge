import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CilWriter, decodeInstructions, readPE } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { compactFixture, integerCases } from './fixtures/a03-compact-instructions/input.js';

const compact = () => new CilWriter(undefined, { compact: true });

test('compact integer helpers choose exact boundary forms and preserve unsigned 32-bit patterns', () => {
  const names = ['ldc.i4', 'ldc.i4', 'ldc.i4.s', 'ldc.i4.m1', 'ldc.i4.0', 'ldc.i4.8',
    'ldc.i4.s', 'ldc.i4.s', 'ldc.i4', 'ldc.i4', 'ldc.i4', 'ldc.i4.m1'];
  integerCases.forEach((value, index) => {
    const instruction = decodeInstructions(compact().integer(value).finish())[0];
    assert.equal(instruction.name, names[index]);
    if (instruction.operand !== undefined) assert.equal(instruction.operand, value | 0);
  });
  for (let value = -1; value <= 8; value++) assert.equal(compact().integer(value).finish().length, 1);
  for (const value of [-2147483649, 4294967296, NaN, Infinity, 1.5, '1', 1n]) {
    assert.throws(() => compact().integer(value), /32-bit integer/);
  }
});

test('compact local helpers select macros and byte forms while preserving explicit op encodings', () => {
  for (const name of ['ldarg', 'ldarga', 'starg', 'ldloc', 'ldloca', 'stloc']) {
    for (const index of [0, 3, 4, 255, 256, 65535]) {
      const macro = index < 4 && ['ldarg', 'ldloc', 'stloc'].includes(name);
      const instruction = decodeInstructions(compact().local(name, index).finish())[0];
      assert.equal(instruction.name, macro ? `${name}.${index}` : index <= 255 ? `${name}.s` : name);
      assert.equal(instruction.operand, macro ? undefined : index);
    }
  }
  assert.deepEqual(compact().op('ldarg', 1).finish(), new CilWriter().op('ldarg', 1).finish());
  for (const index of [-1, 65536, 1.5, NaN]) assert.throws(() => compact().local('ldloc', index), /Local index/);
  assert.throws(() => new CilWriter(undefined, { compact: 1 }), /compact instruction option/);
});

test('compact selection happens before numeric offsets, label fixups and switches are recorded', () => {
  const writer = compact().integer(1), branch = writer.length;
  writer.op('br', 0).integer(42);
  const target = writer.length;
  writer.op('ret').patch32(branch + 1, target - branch - 5);
  assert.equal(decodeInstructions(writer.finish())[1].operand, target);
  const symbolic = compact().integer(0).op('switch', ['done']).integer(42).mark('done').op('ret');
  const decoded = decodeInstructions(symbolic.finish());
  assert.deepEqual(decoded[1].operand, [decoded.at(-1).offset]);
  assert.deepEqual(symbolic.finish(), symbolic.finish());
  assert.deepEqual(new CilWriter().integer(1).local('ldarg', 0).finish(), Uint8Array.of(0x20, 1, 0, 0, 0, 0xfe, 9, 0, 0));
});

test('opt-in compact bodies execute in the direct CIL engine and match pinned native CLR results', () => {
  const native = JSON.parse(readFileSync(new URL('./fixtures/a03-compact-instructions/native.json', import.meta.url), 'utf8'));
  for (const enabled of [false, true]) {
    const bytes = compactFixture(enabled), vm = new CilVirtualMachine(bytes);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.returnValue, 5);
    } finally { vm.stop(); }
    const expected = { Main: 5, Echo: 5, ...Object.fromEntries(integerCases.map((value, index) => [`Literal${index}`, value | 0])) };
    assert.deepEqual(native.cases[enabled ? 'compact' : 'wide'], expected);
    const metadata = readPE(bytes).metadata;
    assert.equal(metadata.streams.has('#SF'), false, 'ordinary CIL fixture does not claim source-VM profile support');
  }
});
