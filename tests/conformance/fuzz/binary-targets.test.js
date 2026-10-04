import test from 'node:test';
import assert from 'node:assert/strict';
import { writeZip } from '@sharpforge/archive';
import { BuiltinMap, FORMAT_VERSION, Op, deserializeImage, serializeImage } from '@sharpforge/bytecode';
import { CilError, metadataIndexWidth, metadataSchemas, readPE } from '@sharpforge/cil';
import { SymbolError, readPortablePdb } from '@sharpforge/symbols';
import { target as pe } from '../../../scripts/conformance/fuzz/targets/pe-loader.js';
import { target as bytecode } from '../../../scripts/conformance/fuzz/targets/bytecode-image.js';
import { target as pdb } from '../../../scripts/conformance/fuzz/targets/portable-pdb.js';
import { target as zip } from '../../../scripts/conformance/fuzz/targets/zip-archive.js';
import { binaryFailure, binaryJsonBudget } from '../../../scripts/conformance/fuzz/targets/binary-guards.js';
import { zipFailure } from '../../../scripts/conformance/fuzz/targets/binary-zip-errors.js';

const targets = [pe, bytecode, pdb, zip];
const encoder = new TextEncoder();
const context = overrides => Object.freeze({ maxInputBytes: 65536, maxOutputBytes: 65536, ...overrides });

function serialize(image) {
  return encoder.encode(serializeImage(image));
}

function scalarImage() {
  return deserializeImage(new TextDecoder().decode(bytecode.createSeeds()[0].input));
}

function namedSeed(target, name) {
  const seed = target.createSeeds().find(item => item.name === name);
  assert(seed, `${target.id} seed ${name} exists`);
  return seed.input;
}

function renameZipPath(bytes, before, after) {
  const from = encoder.encode(before);
  const to = encoder.encode(after);
  assert.equal(from.length, to.length);
  const result = bytes.slice();
  let occurrences = 0;
  for (let offset = 0; offset <= result.length - from.length; offset++) {
    if (!from.every((value, index) => result[offset + index] === value)) continue;
    result.set(to, offset);
    occurrences++;
    offset += from.length - 1;
  }
  assert.equal(occurrences, 2, 'local and central path fields are both replaced');
  return result;
}

for (const target of targets) {
  test(`${target.id}: self-authored seeds are deterministic, owned and accepted`, async () => {
    const first = target.createSeeds();
    const second = target.createSeeds();
    assert.deepEqual(first, second);
    assert(first.length > 0);
    assert.equal(new Set(first.map(seed => seed.name)).size, first.length);
    for (let index = 0; index < first.length; index++) {
      const seed = first[index];
      assert(seed.input instanceof Uint8Array);
      assert(seed.input.length <= 65536);
      const before = seed.input.slice();
      assert.equal((await target.run(seed.input, context())).status, 'accepted', seed.name);
      assert.deepEqual(seed.input, before, 'the parser does not mutate corpus bytes');
      seed.input[0] ^= 1;
      assert.deepEqual(second[index].input, before, 'seeds do not share writable buffers');
    }
  });

  test(`${target.id}: input boundary and pre-cancellation are controlled`, async () => {
    const input = target.createSeeds()[0].input;
    assert.equal((await target.run(input, context({ maxInputBytes: input.length }))).status, 'accepted');
    assert.equal((await target.run(input, context({ maxInputBytes: input.length - 1 }))).code, 'FUZZ_INPUT_LIMIT');
    assert.equal((await target.run(new Uint8Array(65537), context({ maxInputBytes: 131072 }))).code, 'FUZZ_INPUT_LIMIT');
    const controller = new AbortController();
    controller.abort();
    assert.equal((await target.run(input, context({ signal: controller.signal }))).code, 'FUZZ_CANCELLED');
  });

  test(`${target.id}: malformed bytes are controlled; harness contract misuse throws`, async () => {
    assert.equal((await target.run(new Uint8Array(), context())).status, 'rejected');
    await assert.rejects(async () => target.run({}, context()), TypeError);
    await assert.rejects(async () => target.run(new Uint8Array(), context({ maxOutputBytes: 0 })), RangeError);
  });
}

test('PE: malformed magic and truncated extents reach the loader error boundary', () => {
  const original = pe.createSeeds()[0].input;
  const badMagic = original.slice();
  badMagic[0] = 0;
  assert.equal(pe.run(badMagic, context()).code, 'PE_VALIDATION');
  assert.equal(pe.run(original.subarray(0, 63), context()).code, 'PE_VALIDATION');
  assert.equal(pe.run(original.subarray(0, original.length - 1), context()).code, 'PE_VALIDATION');
});

test('PE: invalid metadata list ranges reject before loader list expansion', () => {
  const bytes = pe.createSeeds()[0].input;
  const parsed = readPE(bytes);
  const metadata = parsed.metadata;
  const row = 0;
  const column = 5;
  const widths = metadataSchemas[2].map(kind => metadataIndexWidth(kind, metadata.counts, metadata.heapFlags));
  const offset = parsed.metadataOffset + metadata.tableOffset + metadata.rowOffsets[2][row] +
    widths.slice(0, column).reduce((sum, width) => sum + width, 0);
  const changed = bytes.slice();
  const view = new DataView(changed.buffer, changed.byteOffset, changed.byteLength);
  assert.equal(widths[column], 2);
  view.setUint16(offset, 65535, true);
  assert.match(pe.run(changed, context()).code, /^MD\d{4}$/);
});

test('PE: invalid optional debug UTF-8 is a controlled metadata rejection', () => {
  const input = pe.createSeeds()[0].input;
  const debug = readPE(input).metadata.streams.get('#SF');
  assert(debug.length > 0);
  const changed = input.slice();
  changed[debug.byteOffset - input.byteOffset] = 0xff;
  assert.equal(pe.run(changed, context()).code, 'PE_VALIDATION');
});

test('bytecode: serialization errors and verifier diagnostics stay separate', () => {
  assert.equal(bytecode.run(encoder.encode('{'), context()).code, 'BYTECODE_JSON');
  const malformed = encoder.encode(JSON.stringify({ formatVersion: FORMAT_VERSION }));
  assert.equal(bytecode.run(malformed, context()).code, 'BYTECODE_VALIDATION');
  const image = scalarImage();
  image.formatVersion++;
  assert.equal(bytecode.run(serialize(image), context()).code, 'BYTECODE_FORMAT_VERSION');
});

test('bytecode: typed-array expansion and recursive reviver work are bounded before deserialization', () => {
  const wire = JSON.parse(new TextDecoder().decode(bytecode.createSeeds()[0].input));
  wire.methods[0].code.$int32 = { length: 1024 };
  assert.equal(bytecode.run(encoder.encode(JSON.stringify(wire)), context()).code, 'FUZZ_TYPED_ARRAY_SHAPE');
  assert.equal(bytecode.run(bytecode.createSeeds()[0].input, context({ maxOutputBytes: 1 })).code, 'FUZZ_OUTPUT_LIMIT');
  let nested = null;
  for (let depth = 0; depth < 34; depth++) nested = { child: nested };
  assert.equal(binaryJsonBudget(nested).code, 'FUZZ_JSON_LIMIT');
});

test('bytecode: a verified scalar loop reaches the fixed instruction budget', () => {
  const image = scalarImage();
  image.methods[0].code = Int32Array.from([Op.JUMP, 0, 0]);
  const result = bytecode.run(serialize(image), context());
  assert.equal(result.code, 'BYTECODE_RUNTIME_LIMIT_OR_ARITHMETIC');
  assert.equal(result.detail, 'InstructionLimitException');
});

test('bytecode: verified host-call and library profiles are explicit unsupported cases', () => {
  const image = scalarImage();
  image.methods[0].code = Int32Array.from([
    Op.CONST, 0, 0, Op.BUILTIN, BuiltinMap.get('Console.WriteLine').id, 1, Op.RET, 0, 0,
  ]);
  assert.equal(bytecode.run(serialize(image), context()).code, 'BYTECODE_EXECUTION_PROFILE');
  image.outputKind = 'library';
  image.entryPoint = null;
  assert.equal(bytecode.run(serialize(image), context()).code, 'BYTECODE_EXECUTION_PROFILE');
});

test('Portable PDB: out-of-range document references retain SymbolError validation', () => {
  const input = namedSeed(pdb, 'stored-source');
  const metadata = readPortablePdb(input).metadata;
  const offset = metadata.tableOffset + metadata.rowOffsets[49][0];
  const changed = input.slice();
  new DataView(changed.buffer, changed.byteOffset, changed.byteLength).setUint16(offset, 2, true);
  assert.equal(pdb.run(changed, context()).code, 'PORTABLE_PDB_VALIDATION');
});

test('Portable PDB: compressed sources respect small decode budgets and unsupported formats stay explicit', () => {
  const input = namedSeed(pdb, 'compressed-source');
  assert.equal(pdb.run(input, context({ maxOutputBytes: 1 })).code, 'PORTABLE_PDB_VALIDATION');
  const unsupported = encoder.encode('Microsoft C/C++ MSF 7.00');
  assert.deepEqual(pdb.run(unsupported, context()), { status: 'unsupported', code: 'SF_SYMBOL_UNSUPPORTED_FORMAT' });
});

test('ZIP: traversal is rejected without filesystem extraction', async () => {
  const input = renameZipPath(namedSeed(zip, 'single-file'), 'note.txt', '../x.txt');
  const result = await zip.run(input, context());
  assert.equal(result.code, 'ZIP_VALIDATION');
  assert.match(result.detail, /traversing archive path/);
});

test('ZIP: duplicate paths and symlink records are rejected as data', async () => {
  const duplicate = renameZipPath(writeZip([
    { path: 'a.txt', text: 'first' }, { path: 'b.txt', text: 'second' },
  ]), 'b.txt', 'a.txt');
  assert.match((await zip.run(duplicate, context())).detail, /Duplicate or case-colliding path/);
  const link = namedSeed(zip, 'single-file').slice();
  const view = new DataView(link.buffer, link.byteOffset, link.byteLength);
  const directory = view.getUint32(link.length - 22 + 16, true);
  view.setUint16(directory + 4, 0x0314, true);
  view.setUint32(directory + 38, 0xa1ff0000, true);
  assert.equal((await zip.run(link, context())).detail, 'Links and special files are not accepted');
});

test('ZIP: stored and deflated payloads enforce actual small output budgets', async () => {
  for (const name of ['single-file', 'small-deflate']) {
    const input = namedSeed(zip, name);
    assert.equal((await zip.run(input, context({ maxOutputBytes: 14 }))).status, 'accepted');
    assert.equal((await zip.run(input, context({ maxOutputBytes: 13 }))).code, 'ZIP_VALIDATION');
  }
});

test('ZIP: bad checksums and malformed compression are controlled validations', async () => {
  const stored = namedSeed(zip, 'single-file').slice();
  stored[30 + 'note.txt'.length] ^= 1;
  assert.match((await zip.run(stored, context())).detail, /CRC\/length mismatch/);
  const compressed = namedSeed(zip, 'small-deflate').slice();
  compressed[30 + 'note.txt'.length] = 7;
  assert.equal((await zip.run(compressed, context())).detail, 'Reserved DEFLATE block');
});

test('binary parser errors preserve unknown exceptions as findings', () => {
  assert.equal(binaryFailure(new CilError('Invalid PE signature'), CilError, 'PE_VALIDATION').status, 'rejected');
  assert.equal(binaryFailure(new SymbolError('Invalid GUID index'), SymbolError, 'PDB_VALIDATION').status, 'rejected');
  const unknown = new TypeError('unexpected implementation defect');
  assert.throws(() => binaryFailure(unknown, CilError, 'PE_VALIDATION'), error => error === unknown);
  assert.throws(() => binaryFailure(unknown, SymbolError, 'PDB_VALIDATION'), error => error === unknown);
  assert.throws(() => zipFailure(unknown), error => error === unknown);
  const archiveUnknown = new Error('unclassified archive invariant');
  assert.throws(() => zipFailure(archiveUnknown), error => error === archiveUnknown);
});
