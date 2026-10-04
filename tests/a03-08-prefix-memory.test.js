import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CilOpcodes, CilWriter, decodeInstructionGroups, memoryPrefixDiagnosticCatalog, validateMemoryPrefixes } from '@sharpforge/cil';

const memory = new Set(['ldfld', 'stfld', 'ldobj', 'stobj', 'initblk', 'cpblk']);
const isMemory = name => /^(ldind|stind)\./.test(name) || memory.has(name);
const isArray = name => /^(ldelem|stelem)(\.|$)/.test(name);

function operand(kind) {
  if (kind === 'none') return undefined;
  if (kind === 'switch') return [];
  if (kind === 'i64') return 0n;
  return kind === 'token' ? 0x01000001 : 0;
}

function code(target, prefixes) {
  return new CilWriter().group(target, operand(CilOpcodes[target].operand), prefixes).op('nop').finish();
}

function rejects(bytes, diagnostic, offset, options) {
  assert.throws(() => validateMemoryPrefixes(bytes, options), error => {
    assert.equal(error.name, 'CilError');
    assert.equal(error.code, diagnostic);
    if (offset !== undefined) assert.equal(error.offset, offset);
    assert.match(error.message, /at 0x/);
    return true;
  });
}

test('volatile and unaligned target matrices cover every catalog instruction', () => {
  for (const opcode of Object.values(CilOpcodes)) {
    if (opcode.opCodeType === 'Prefix') continue;
    for (const prefix of [{ name: 'volatile.' }, { name: 'unaligned.', operand: 1 }]) {
      const bytes = code(opcode.name, [prefix]);
      const permitted = isMemory(opcode.name) || prefix.name === 'volatile.' && ['ldsfld', 'stsfld'].includes(opcode.name);
      if (permitted) assert.equal(validateMemoryPrefixes(bytes)[0].name, opcode.name);
      else rejects(bytes, 'CILPM0002', 0);
    }
  }
});

test('no. validates each flag and every combination against the target check set', () => {
  for (const opcode of Object.values(CilOpcodes)) {
    if (opcode.opCodeType === 'Prefix') continue;
    let allowed = isArray(opcode.name) ? 6 : 0;
    if (['castclass', 'unbox'].includes(opcode.name)) allowed = 1;
    if (['ldfld', 'stfld', 'callvirt', 'ldvirtftn'].includes(opcode.name)) allowed = 4;
    if (['ldelema', 'stelem', 'stelem.ref'].includes(opcode.name)) allowed = 7;
    for (let flags = 0; flags <= 7; flags++) {
      const bytes = code(opcode.name, [{ name: 'no.', operand: flags }]);
      const options = { allowUnverifiable: true };
      if (!allowed) rejects(bytes, 'CILPM0002', 0, options);
      else if (flags & ~allowed) rejects(bytes, 'CILPM0003', 0, options);
      else assert.equal(validateMemoryPrefixes(bytes, options)[0].prefixes[0].operand, flags);
    }
  }
  for (const flags of [0, 1, 7]) rejects(code('ldelema', [{ name: 'no.', operand: flags }]), 'CILPM0004', 0);
});

test('duplicate memory prefixes identify the repeated byte and reset at each target', () => {
  for (const prefix of [{ name: 'volatile.' }, { name: 'unaligned.', operand: 4 }, { name: 'no.', operand: 4 }]) {
    const bytes = code('ldfld', [prefix, prefix]);
    const secondOffset = prefix.name === 'volatile.' ? 2 : 3;
    rejects(bytes, 'CILPM0001', secondOffset, { allowUnverifiable: true });
    assert.equal(decodeInstructionGroups(bytes)[0].prefixes.length, 2);
  }
  const prefixes = [{ name: 'volatile.' }, { name: 'unaligned.', operand: 2 }, { name: 'volatile.' }];
  rejects(code('ldind.i4', prefixes), 'CILPM0001', 5);
  const bytes = new CilWriter().group('ldind.i4', undefined, [prefixes[0]])
    .group('ldind.i4', undefined, [prefixes[0]]).finish();
  assert.equal(validateMemoryPrefixes(bytes).length, 2);
});

test('both volatile/unaligned orders and each alignment are accepted without altering group positions', () => {
  for (const alignment of [1, 2, 4]) {
    const prefixes = [{ name: 'volatile.' }, { name: 'unaligned.', operand: alignment }];
    for (const order of [prefixes, [...prefixes].reverse()]) {
      const bytes = new CilWriter().op('nop').group('ldind.i4', undefined, order).op('ret').finish();
      const groups = validateMemoryPrefixes(bytes);
      assert.deepEqual(groups, decodeInstructionGroups(bytes));
      assert.deepEqual([groups[1].offset, groups[1].opcodeOffset, groups[1].size], [1, 6, 6]);
    }
  }
});

test('diagnostic details are stable and validation is explicitly limited to memory prefixes', () => {
  assert(Object.isFrozen(memoryPrefixDiagnosticCatalog));
  const bytes = new CilWriter().op('nop').group('ret', undefined, [{ name: 'volatile.' }]).finish();
  assert.throws(() => validateMemoryPrefixes(bytes), error => {
    assert.equal(error.code, 'CILPM0002');
    assert.equal(error.prefix, 'volatile.');
    assert.equal(error.target, 'ret');
    assert.equal(error.offset, 1);
    assert.equal(error.targetOffset, 3);
    return true;
  });
  assert.equal(validateMemoryPrefixes(code('ret', [{ name: 'readonly.' }]))[0].name, 'ret');
  assert.deepEqual(validateMemoryPrefixes(new Uint8Array()), []);
});

test('structural budgets, malformed operands, group boundaries and cancellation retain existing diagnostics', () => {
  const bytes = code('ldind.i4', [{ name: 'unaligned.', operand: 1 }]);
  for (const options of [{ maxInstructions: 1 }, { maxPrefixes: 0 }, { maxPrefixes: 65 }, { allowUnverifiable: 1 }]) {
    assert.throws(() => validateMemoryPrefixes(bytes, options), { name: 'CilError' });
  }
  for (const malformed of [Uint8Array.of(0xfe), Uint8Array.of(0xfe, 0x12, 3, 0x4a), Uint8Array.of(0xfe, 0x19, 8, 0)]) {
    assert.throws(() => validateMemoryPrefixes(malformed), { name: 'CilError' });
  }
  const branch = new CilWriter().op('br.s', 'inside').op('volatile.').mark('inside').op('ldind.i4').finish();
  assert.throws(() => validateMemoryPrefixes(branch), /instruction-group boundary/);
  assert.throws(() => validateMemoryPrefixes(new Uint8Array(), { signal: AbortSignal.abort() }), /cancelled/);
});

test('Buffer/subarray input and returned records have no mutation path to the caller bytes', () => {
  const raw = code('ldind.i4', [{ name: 'volatile.' }]);
  const storage = Buffer.alloc(raw.length + 11, 0xcc);
  storage.set(raw, 7);
  const snapshot = Buffer.from(storage);
  const groups = validateMemoryPrefixes(storage.subarray(7, 7 + raw.length));
  groups[0].prefixes[0].name = 'tail.';
  assert.deepEqual(storage, snapshot);
  assert.equal(validateMemoryPrefixes(raw)[0].prefixes[0].name, 'volatile.');
});

test('strict duplicate checking is deliberately separate from captured CoreCLR execution', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/a03-prefix-groups/native.json', import.meta.url), 'utf8'));
  assert.equal(fixture.result, 42);
  const bytes = new Uint8Array(Buffer.from(fixture.code, 'base64'));
  assert.equal(decodeInstructionGroups(bytes)[1].prefixes.length, 3);
  rejects(bytes, 'CILPM0001', 7);
});

test('eight pinned ILVerify observations agree with accepted and rejected memory-prefix validation', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/a03-prefix-memory/native.json', import.meta.url), 'utf8'));
  const source = readFileSync(new URL('./fixtures/a03-prefix-memory/input.js', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), fixture.sourceSHA256);
  assert.equal(fixture.version, '10.0.5');
  assert.equal(fixture.observations.length, 8);
  assert.equal(fixture.observations.filter(value => value.oracle.accepted).length, 4);
  for (const observation of fixture.observations) {
    const bytes = new Uint8Array(Buffer.from(observation.code, 'base64'));
    if (observation.oracle.accepted) {
      assert.doesNotThrow(() => validateMemoryPrefixes(bytes));
      assert.deepEqual(observation.oracle.errors, []);
    } else {
      rejects(bytes, observation.diagnostic);
      assert(observation.oracle.errors.length > 0);
    }
    if (observation.name === 'NoArray') {
      assert.deepEqual(observation.oracle.errors, ['Unverifiable']);
      assert.doesNotThrow(() => validateMemoryPrefixes(bytes, { allowUnverifiable: true }));
    }
  }
});
