import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CilWriter, decodeInstructionGroups, decodeInstructions } from '@sharpforge/cil';

test('three-prefix chains group and round-trip without changing the legacy flat decoder', () => {
  const prefixes = [{ name: 'volatile.' }, { name: 'unaligned.', operand: 1 }, { name: 'volatile.' }];
  const bytes = new CilWriter().group('ldind.i4', undefined, prefixes).op('ret').finish();
  const groups = decodeInstructionGroups(bytes);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].prefixes.map(({ name, operand }) => ({ name, operand })),
    prefixes.map(({ name, operand }) => ({ name, operand })));
  assert.deepEqual([groups[0].offset, groups[0].opcodeOffset, groups[0].size], [0, 7, 8]);
  assert.equal(decodeInstructions(bytes).length, 5);
  const writer = new CilWriter();
  for (const group of groups) writer.group(group.name, group.operand, group.prefixes);
  assert.deepEqual(writer.finish(), bytes);
});

test('all standard prefix operands preserve binary data and reject invalid domains before writing', () => {
  for (const alignment of [1, 2, 4]) {
    const bytes = new CilWriter().group('ldind.i4', undefined, [{ name: 'unaligned.', operand: alignment }]).finish();
    assert.equal(decodeInstructionGroups(bytes)[0].prefixes[0].operand, alignment);
  }
  for (const flags of [0, 1, 2, 4, 7]) {
    const bytes = new CilWriter().group('callvirt', 0x0a000001, [{ name: 'no.', operand: flags }]).finish();
    assert.equal(decodeInstructionGroups(bytes)[0].prefixes[0].operand, flags);
  }
  for (const [name, target, operand] of [['tail.', 'call', 0x0a000001], ['readonly.', 'ldelema', 0x01000001]]) {
    assert.equal(decodeInstructionGroups(new CilWriter().group(target, operand, [{ name }]).finish())[0].prefixes[0].name, name);
  }
  for (const operand of [0x01000001, 0x02000001, 0x1b000001]) {
    const bytes = new CilWriter().group('callvirt', 0x0a000001, [{ name: 'constrained.', operand }]).finish();
    assert.equal(decodeInstructionGroups(bytes)[0].prefixes[0].operand, operand);
  }
  for (const name of [null, Symbol('nop'), { toString() { throw new Error('Must not coerce'); } }]) {
    const writer = new CilWriter();
    assert.throws(() => writer.group(name), error => error.name === 'CilError');
    assert.equal(writer.length, 0);
  }
  for (const prefix of [
    { name: 'unaligned.', operand: 0 }, { name: 'unaligned.', operand: 3 },
    { name: 'no.', operand: 8 }, { name: 'no.', operand: -1 }, { name: 'no.', operand: 1.5 },
    { name: 'volatile.', operand: 1 }, { name: 'constrained.', operand: 0 },
    { name: 'constrained.', operand: 0x06000001 }, { name: 'constrained.', operand: 1n }, { name: 'nop' }, null,
    { name: Symbol('volatile.') }, { name: { toString() { throw new Error('Must not coerce'); } } },
  ]) {
    const writer = new CilWriter().op('nop');
    assert.throws(() => writer.group('nop', undefined, [prefix]), error => error.name === 'CilError');
    assert.deepEqual(writer.finish(), Uint8Array.of(0));
  }
});

test('group boundaries reject dangling prefixes and jumps into a prefix chain or its opcode', () => {
  assert.throws(() => decodeInstructionGroups(new CilWriter().op('nop').op('volatile.').finish()),
    error => error.offset === 1 && /Dangling/.test(error.message));
  for (const atOpcode of [false, true]) {
    const writer = new CilWriter().op('br.s', 'inside').op('volatile.');
    if (!atOpcode) writer.mark('inside');
    writer.op('unaligned.', 1);
    if (atOpcode) writer.mark('inside');
    writer.op('ldind.i4').op('ret');
    assert.doesNotThrow(() => decodeInstructions(writer.finish()));
    assert.throws(() => decodeInstructionGroups(writer.finish()), /instruction-group boundary/);
  }
  const valid = new CilWriter().op('br.s', 'start').mark('start').group('ldind.i4', undefined, [{ name: 'volatile.' }]).finish();
  assert.equal(decodeInstructionGroups(valid)[0].operand, 2);
  assert.throws(() => decodeInstructionGroups(new CilWriter().op('unaligned.', 3).op('ldind.i4').finish()), /Invalid unaligned/);
  assert.throws(() => decodeInstructionGroups(new CilWriter().op('no.', 255).op('nop').finish()), /Invalid no/);
});

test('prefix budgets, malformed bytes, cancellation and result ownership are explicit', () => {
  const prefixes = Array.from({ length: 64 }, () => ({ name: 'volatile.' }));
  const writer = new CilWriter().group('ldind.i4', undefined, prefixes), bytes = writer.finish();
  assert.equal(decodeInstructionGroups(bytes)[0].prefixes.length, 64);
  assert.throws(() => writer.group('nop', undefined, [...prefixes, prefixes[0]]), /chain limit/);
  assert.throws(() => decodeInstructionGroups(bytes, { maxPrefixes: 63 }), /chain limit/);
  assert.throws(() => decodeInstructionGroups(bytes, { maxInstructions: 64 }), /instruction limit/);
  assert.throws(() => decodeInstructionGroups(bytes, { maxPrefixes: 65 }), /grouping limit/);
  assert.throws(() => decodeInstructionGroups(Uint8Array.of(0xfe)), /Truncated/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => decodeInstructionGroups(bytes, { signal: controller.signal }), /cancelled/);
  const grouped = decodeInstructionGroups(bytes);
  grouped[0].prefixes[0].name = 'tail.';
  assert.deepEqual(writer.finish(), bytes);
  assert.equal(decodeInstructionGroups(bytes)[0].prefixes[0].name, 'volatile.');
});

test('native Reflection.Emit prefix-chain bytes decode identically and native execution returns the expected value', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/a03-prefix-groups/native.json', import.meta.url), 'utf8'));
  assert.equal(fixture.result, 42);
  const bytes = new Uint8Array(Buffer.from(fixture.code, 'base64'));
  const groups = decodeInstructionGroups(bytes);
  assert.deepEqual(groups.map(group => group.name), ['ldarga.s', 'ldind.i4', 'ret']);
  assert.deepEqual(groups[1].prefixes.map(prefix => prefix.name), ['volatile.', 'unaligned.', 'volatile.']);
  const writer = new CilWriter();
  for (const group of groups) writer.group(group.name, group.operand, group.prefixes);
  assert.deepEqual(writer.finish(), bytes);
});
