import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeInstructions, readPE } from '@sharpforge/cil';
import { emitPortablePdb, readPortablePdb, PdbGuids, SymbolError } from '@sharpforge/symbols';

const directory = new URL('./fixtures/portable-pdb-async-writer/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = new Uint8Array(readFileSync(new URL('AsyncWriter.dll', directory)));
const pe = readPE(assembly, { inspection: true });
const records = () =>
  fixture.records.map(({ moveNext, kickoff, steps }) => ({
    moveNext,
    kickoff,
    ...(steps ? { catchHandlerOffset: steps.catchHandlerOffset, awaits: structuredClone(steps.awaits) } : {}),
  }));
const taskRecord = () => records().find((record) => record.awaits?.length === 2);
const emit = (stateMachines, custom = []) => emitPortablePdb(assembly, { stateMachines, custom }).bytes;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function rejectStep(update, pattern) {
  const record = taskRecord();
  Object.assign(record.awaits[0], update);
  assert.throws(() => emit([record]), pattern);
}

test('fixture hashes identify the native reference, source and exact emitted PE', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.match(fixture.reference.sdk, /^10\./);
  assert.match(fixture.reference.compilerVersion, /^\d+\.\d+/);
  assert.match(fixture.reference.compilerSha256, /^[a-f0-9]{64}$/);
  assert.equal(fixture.reference.mode, 'Debug');
  assert.equal(hash(assembly), fixture.reference.assemblySha256);
  const source = readFileSync(new URL('../packages/symbols/interop/AsyncWriter/Program.cs', import.meta.url), 'utf8');
  assert.equal(hash(source.replaceAll('\r\n', '\n')), fixture.reference.sourceSha256);
  assert.equal(hash(emit(records())), fixture.reference.generatedPdbSha256);
});

test('explicit async steps and iterator links match native SRM tables and exact CDI bytes', () => {
  const input = records();
  const snapshot = structuredClone(input);
  const symbols = readPortablePdb(emit(input));
  assert.deepEqual(input, snapshot);
  assert.deepEqual(
    symbols.stateMachines,
    input.map(({ moveNext, kickoff }) => ({ moveNext, kickoff })),
  );
  for (const expected of fixture.records) {
    const custom = symbols.custom.find(
      (record) => record.parent === expected.moveNext && record.kind === PdbGuids.asyncSteps,
    );
    if (!expected.steps) {
      assert.equal(custom, undefined);
      continue;
    }
    assert.equal(custom.catchHandlerOffset, expected.steps.catchHandlerOffset);
    assert.deepEqual(custom.awaits, expected.steps.awaits);
    assert.equal(Buffer.from(custom.bytes).toString('hex'), expected.steps.bytes);
  }
  assert(fixture.records.some((record) => record.steps?.catchHandlerOffset >= 0));
  assert(fixture.records.some((record) => record.steps?.catchHandlerOffset === -1));
});

test('empty await lists produce valid stepping records while pair-only input remains table-only', () => {
  const record = taskRecord();
  record.awaits = [];
  const symbols = readPortablePdb(emit([record]));
  assert.deepEqual(symbols.asyncInfo(record.moveNext).steps, []);
  assert.equal(symbols.custom.length, 1);
  assert.equal(symbols.custom[0].bytes.length, 4);
  assert.equal(readPortablePdb(emit([{ moveNext: record.moveNext, kickoff: record.kickoff }])).custom.length, 0);
});

test('stepping offsets must point to instructions, not operands, negative offsets or the body end', () => {
  const record = taskRecord();
  const body = pe.methodBody(record.moveNext);
  const instructions = decodeInstructions(body.code);
  const operand =
    instructions.find((instruction, index) => instructions[index + 1]?.offset > instruction.offset + 1).offset + 1;
  for (const yieldOffset of [-1, 1.5, NaN, operand, body.code.length, 0xffffffff]) {
    rejectStep({ yieldOffset }, /yield offset is not an IL instruction boundary/);
  }
  for (const resumeOffset of [-1, operand, body.code.length]) {
    rejectStep({ resumeOffset }, /resume offset is not an IL instruction boundary/);
  }
});

test('resume tokens must identify an existing MethodDef with an IL body', () => {
  for (const resumeMethod of [0, 0x02000001, 0x06000000, 0x06ffffff, 0x106000001, 0x06000001 + 0.5]) {
    rejectStep({ resumeMethod }, /Invalid async stepping MethodDef/);
  }
  const row = pe.metadata.rows[6].findIndex((method) => method[0] === 0) + 1;
  assert(row > 0);
  rejectStep({ resumeMethod: 0x06000000 | row }, /no IL body/);
  const record = taskRecord();
  record.kickoff += 0x100000000;
  assert.throws(() => emit([record]), /Invalid async stepping MethodDef/);
});

test('catch offsets must be real catch entries and cannot point into the body', () => {
  for (const catchHandlerOffset of [-2, null, NaN, 0, 0xffffffff]) {
    const record = taskRecord();
    record.catchHandlerOffset = catchHandlerOffset;
    assert.throws(() => emit([record]), /Async catch handler offset/);
  }
});

test('malformed and over-budget await lists fail explicitly before emitting symbols', () => {
  for (const awaits of [null, {}, 'invalid', [null], new Array(1_000_001)]) {
    const record = taskRecord();
    record.awaits = awaits;
    assert.throws(() => emit([record]), SymbolError);
  }
});

test('duplicate stepping CDI and duplicate state-machine pairs keep existing diagnostics', () => {
  const record = taskRecord();
  assert.throws(
    () => emit([record], [{ parent: record.moveNext, kind: PdbGuids.asyncSteps, awaits: [] }]),
    /Duplicate custom debug/,
  );
  assert.throws(() => emit([record, record]), /Duplicate state machine/);
});

test('many awaits preserve ordered records and separate resume methods', () => {
  const record = taskRecord();
  const other = records().find((candidate) => candidate.moveNext !== record.moveNext && candidate.awaits);
  const offset = decodeInstructions(pe.methodBody(other.moveNext).code)[0].offset;
  record.awaits = Array.from({ length: 1000 }, (_, index) => ({
    ...record.awaits[index % record.awaits.length],
    ...(index % 2 ? { resumeMethod: other.moveNext, resumeOffset: offset } : {}),
  }));
  assert.deepEqual(readPortablePdb(emit([record])).asyncInfo(record.moveNext).steps, record.awaits);
});

test('aggregate async budgets reject expansion across records and distinct bodies', () => {
  const input = records();
  const bounded = (asyncLimits) => emitPortablePdb(assembly, { stateMachines: input }, { asyncLimits });
  assert.throws(() => bounded({ maxStateMachines: 2 }), /state-machine record limit/);
  assert.throws(() => bounded({ maxAwaits: 2 }), /Aggregate async await limit/);
  const bodies = input.filter((record) => record.awaits).map((record) => pe.methodBody(record.moveNext));
  assert.throws(
    () => bounded({ maxBodyBytes: Math.max(...bodies.map((body) => body.code.length)) }),
    /body byte limit/,
  );
  const instructions = bodies.map((body) => decodeInstructions(body.code).length);
  assert.throws(() => bounded({ maxInstructions: Math.max(...instructions) }), /IL instruction limit/);
  assert.doesNotThrow(() =>
    bounded({
      maxStateMachines: input.length,
      maxAwaits: 3,
      maxBodyBytes: bodies.reduce((sum, body) => sum + body.code.length, 0),
      maxInstructions: instructions.reduce((sum, count) => sum + count, 0),
    }),
  );
});

test('default state budget and body preflight run before record mapping or IL decoding', () => {
  assert.throws(() => emitPortablePdb(assembly, { stateMachines: new Array(10_001) }), /state-machine record limit/);
  const record = taskRecord();
  const body = pe.methodBody(record.moveNext);
  const malformed = new Uint8Array(assembly);
  malformed[body.fileOffset + body.headerSize] = 0xff;
  assert.throws(
    () => emitPortablePdb(malformed, { stateMachines: [record] }, { asyncLimits: { maxBodyBytes: 1 } }),
    /Aggregate async body byte limit/,
  );
  for (const asyncLimits of [
    null,
    { maxAwaits: -1 },
    { maxBodyBytes: 64 * 1024 * 1024 + 1 },
    { maxInstructions: 1.5 },
  ]) {
    assert.throws(
      () => emitPortablePdb(assembly, { stateMachines: [record] }, { asyncLimits }),
      /Invalid async stepping/,
    );
  }
});
