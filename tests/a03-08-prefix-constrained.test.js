import test from 'node:test';
import assert from 'node:assert/strict';
import { CilOpcodes, CilWriter, readPE, validateTypePrefixes, typePrefixDiagnosticCatalog } from '@sharpforge/cil';
import { managedFixture } from './managed-fixtures.js';

function metadata() {
  let reference, specification;
  const bytes = managedFixture({ decorate({ md }) {
    reference = md.typeRef('System.Int32');
    specification = md.typeSpec({ kind: 'primitive', name: 'int' });
  } });
  return { reader: readPE(bytes, { inspection: true }).metadata, tokens: [0x02000002, reference, specification] };
}

const prefix = token => ({ name: 'constrained.', operand: token });
const readonly = { name: 'readonly.' };
const errorAt = (code, offset) => error => error.name === 'CilError' && error.code === code && error.offset === offset;
const call = token => new CilWriter().group('callvirt', 0x0a000001, [prefix(token)]).finish();
const address = token => new CilWriter().group('ldelema', token, [readonly]).finish();

test('constrained and readonly accept existing TypeDef, TypeRef and TypeSpec row tokens', () => {
  const { reader, tokens } = metadata();
  assert(Object.isFrozen(typePrefixDiagnosticCatalog));
  for (const token of tokens) {
    assert.equal(validateTypePrefixes(call(token), reader)[0].prefixes[0].operand, token);
    assert.equal(validateTypePrefixes(address(token), reader)[0].operand, token);
  }
});

test('all catalog targets follow the lexical profile and non-array calls remain explicitly unsupported', () => {
  const { reader, tokens } = metadata();
  for (const opcode of Object.values(CilOpcodes)) {
    if (opcode.opCodeType === 'Prefix') continue;
    const operand = opcode.operand === 'none' ? undefined : opcode.operand === 'switch' ? []
      : opcode.operand === 'i64' ? 0n : opcode.operand === 'token' ? tokens[0] : 0;
    for (const item of [prefix(tokens[0]), readonly]) {
      const bytes = new CilWriter().group(opcode.name, operand, [item]).op('nop').finish();
      if (item.name === 'constrained.') {
        if (opcode.name === 'callvirt') assert.doesNotThrow(() => validateTypePrefixes(bytes, reader));
        else assert.throws(() => validateTypePrefixes(bytes, reader), errorAt('CILPC0002', 0));
      } else if (opcode.name === 'ldelema') assert.doesNotThrow(() => validateTypePrefixes(bytes, reader));
      else {
        const code = ['call', 'callvirt'].includes(opcode.name) ? 'CILPC0006' : 'CILPC0003';
        assert.throws(() => validateTypePrefixes(bytes, reader), errorAt(code, 0));
      }
    }
  }
});

test('type row extents reject lazily without decoding type bodies or signatures', () => {
  const { reader } = metadata();
  for (const table of [1, 2, 27]) {
    const token = table * 0x1000000 + reader.counts[table] + 1;
    for (const bytes of [call(token), address(token)]) {
      assert.throws(() => validateTypePrefixes(bytes, reader), error => {
        assert(errorAt('CILPC0004', 0)(error));
        assert.equal(error.token, token);
        return true;
      });
    }
  }
  for (const token of [0, 0x01000000, 0x06000001, 0x70000001]) {
    assert.throws(() => validateTypePrefixes(address(token), reader), errorAt('CILPC0004', 0));
  }
  const row = reader.row;
  let reads = 0;
  reader.row = token => { reads++; return row(token); };
  reader.blob = () => { throw new Error('No TypeSpec/signature expansion'); };
  assert.doesNotThrow(() => validateTypePrefixes(call(0x1b000001), reader));
  assert.equal(reads, 1);
  assert.equal(validateTypePrefixes(new CilWriter().op('ret').finish(), reader).length, 1);
  assert.equal(reads, 1);
});

test('duplicates identify the repeated prefix byte and reset for the next group', () => {
  const { reader, tokens } = metadata();
  const constrained = prefix(tokens[0]);
  const repeated = new CilWriter().group('callvirt', 0x0a000001, [constrained, constrained]).finish();
  assert.throws(() => validateTypePrefixes(repeated, reader), errorAt('CILPC0001', 6));
  const repeatedReadonly = new CilWriter().group('ldelema', tokens[0], [readonly, readonly]).finish();
  assert.throws(() => validateTypePrefixes(repeatedReadonly, reader), errorAt('CILPC0001', 2));
  const separate = new CilWriter().group('ldelema', tokens[0], [readonly]).group('ldelema', tokens[0], [readonly]).finish();
  assert.equal(validateTypePrefixes(separate, reader).length, 2);
});

test('existing grouping handles malformed operands, branches into chains, cancellation and budgets', () => {
  const { reader, tokens } = metadata();
  for (const options of [{ maxInstructions: 1 }, { maxPrefixes: 0 }, { maxPrefixes: 65 }]) {
    assert.throws(() => validateTypePrefixes(call(tokens[0]), reader, options), { name: 'CilError' });
  }
  const branch = new CilWriter().op('br.s', 'inside').op('constrained.', tokens[0])
    .mark('inside').op('callvirt', 0x0a000001).finish();
  assert.throws(() => validateTypePrefixes(branch, reader), /instruction-group boundary/);
  assert.throws(() => validateTypePrefixes(new Uint8Array(), reader, { signal: AbortSignal.abort() }), /cancelled/);
  assert.throws(() => validateTypePrefixes(Uint8Array.of(0xfe, 0x16), reader), /Truncated/);
  assert.throws(() => validateTypePrefixes(new CilWriter().op('constrained.', 0).op('ret').finish(), reader), /TypeDefOrRef/);
  for (const value of [null, {}, { row: 1 }]) {
    assert.throws(() => validateTypePrefixes(new Uint8Array(), value), errorAt('CILPC0005', undefined));
  }
});

test('Buffer subarray ownership, non-type prefixes and explicit unverified pointer stores retain their contracts', () => {
  const { reader, tokens } = metadata();
  const bytes = address(tokens[0]);
  const storage = Buffer.alloc(bytes.length + 8, 0xee);
  storage.set(bytes, 3);
  const snapshot = Buffer.from(storage);
  const groups = validateTypePrefixes(storage.subarray(3, 3 + bytes.length), reader);
  groups[0].prefixes[0].name = 'tail.';
  assert.deepEqual(storage, snapshot);
  const other = new CilWriter().group('ret', undefined, [{ name: 'volatile.' }]).finish();
  assert.doesNotThrow(() => validateTypePrefixes(other, reader));
  const unsafe = new CilWriter().group('ldelema', tokens[0], [readonly]).op('ldc.i4.0').op('stind.i4').finish();
  assert.doesNotThrow(() => validateTypePrefixes(unsafe, reader), 'Readonly propagation and stores require typed dataflow');
});
