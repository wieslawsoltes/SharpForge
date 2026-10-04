import test from 'node:test';
import assert from 'node:assert/strict';
import { token } from '@sharpforge/cil';
import {
  emitPortablePdbDelta, readPortablePdbDelta, PortablePdbGenerations, SymbolError, PdbGuids,
  writeCustomDebugInformation,
} from '@sharpforge/symbols';
import { aggregateCounts, updatedToken, baselineFixture, sequencePoint } from './support/pdb-delta.js';

const opaqueKind = '00112233-4455-6677-8899-aabbccddeeff';
function input() {
  return {
    sources: [{ uri: 'Generation.cs', text: 'int value = 42;' }],
    importScopes: [{ parent: 0, definitions: [{ kind: 1, namespace: 'System' }] }],
    methods: [{ token: updatedToken, codeSize: 8, localSignature: 7, points: [sequencePoint(102)],
      scopes: [{ start: 0, end: 8, importScope: 1, locals: [{ slot: 0, name: 'value' }],
        constants: [{ name: 'answer', type: 'int', value: 42 }] }] }],
    stateMachines: [{ moveNext: updatedToken, kickoff: token(6, 3) }],
    custom: [
      { parent: updatedToken, kind: opaqueKind, bytes: new Uint8Array([1, 2, 3]) },
      { parent: token(51, 1), kind: PdbGuids.dynamicLocals,
        bytes: writeCustomDebugInformation(PdbGuids.dynamicLocals, { flags: [true] }) },
      { parent: updatedToken, kind: PdbGuids.asyncSteps,
        bytes: writeCustomDebugInformation(PdbGuids.asyncSteps, {
          awaits: [{ yieldOffset: 0, resumeOffset: 4, resumeMethod: updatedToken }],
        }) },
    ],
  };
}
function envelope(history, overrides = {}) {
  return { baselineId: history.baselineId, previousPdbId: history.pdbId, generation: history.generation + 1,
    typeSystemRowCounts: aggregateCounts, deltaRowCounts: { 0: 1, 6: 1, 17: 1 }, ...overrides };
}
function emit(debug = input(), overrides, options) {
  const history = new PortablePdbGenerations(baselineFixture());
  return emitPortablePdbDelta(debug, envelope(history, overrides), options);
}
function code(operation, expected) {
  assert.throws(operation, (error) => error instanceof SymbolError && error.code === expected);
}

test('delta emission round-trips changed methods, scopes, constants, imports and CDI with local/aggregate handles', () => {
  const debug = input();
  const history = new PortablePdbGenerations(baselineFixture());
  const output = emitPortablePdbDelta(debug, envelope(history), { embedSources: true });
  const parsed = readPortablePdbDelta(output.bytes, { typeSystemRowCounts: output.typeSystemRowCounts });
  assert.equal(parsed.metadata.minimalDelta, true);
  assert.equal(parsed.metadata.counts[49], 1);
  assert.equal(parsed.metadata.externalCounts[6], 1);
  assert.deepEqual(parsed.metadata.rows[31], [[token(49, 2)]]);
  assert.equal(parsed.metadata.rows[50][0][0], 1);
  assert.equal(parsed.methods[0].token, updatedToken);
  assert.deepEqual(parsed.methods[0].points, [{ ...debug.methods[0].points[0], hidden: false }]);
  assert.equal(parsed.scopes[0].methodToken, updatedToken);
  assert.equal(parsed.scopes[0].variables[0].name, 'value');
  assert.equal(parsed.scopes[0].variables[0].dynamicFlags[0], true);
  assert.equal(parsed.scopes[0].constants[0].value, 42);
  assert.deepEqual(parsed.imports[0].definitions, [{ kind: 1, namespace: 'System' }]);
  assert.deepEqual(parsed.custom.find((record) => record.kind === opaqueKind).bytes, new Uint8Array([1, 2, 3]));
  assert.equal(parsed.asyncInfo(updatedToken).steps[0].resumeMethod, updatedToken);
  assert.equal(new TextDecoder().decode(parsed.documents[0].embedded), debug.sources[0].text);
  history.append(output.bytes, output);
  assert.equal(history.getMethodByVersion(updatedToken, 1).points[0].startLine, 2);
  assert.equal(history.getMethodByVersion(updatedToken, 2).points[0].startLine, 102);
});

test('delta output is deterministic and method ordering does not change aggregate identities', () => {
  assert.deepEqual(emit().bytes, emit().bytes);
  const debug = input();
  debug.custom = [];
  debug.stateMachines = [];
  debug.methods = [3, 1].map((row) => ({ token: token(6, row), codeSize: 1, points: [sequencePoint(10 + row)] }));
  const output = emit(debug, { deltaRowCounts: { 0: 1, 6: 2, 17: 0 } });
  const parsed = readPortablePdbDelta(output.bytes, { typeSystemRowCounts: aggregateCounts });
  assert.deepEqual(parsed.methods.map((method) => method.token), [token(6, 1), token(6, 3)]);
  assert.deepEqual(parsed.metadata.rows[31], [[token(49, 1)], [token(49, 3)]]);
  debug.methods[0].points[0].startLine = 900;
  assert.equal(parsed.methods[1].points[0].startLine, 13);
});

test('writer rejects silent omission and coercion of invalid method and point inputs', () => {
  const mutations = [
    (debug) => { debug.methods = []; },
    (debug) => { debug.methods.push(debug.methods[0]); },
    (debug) => { debug.methods[0].token = token(6, 4); },
    (debug) => { debug.methods[0].points[0].offset = 8; },
    (debug) => { debug.methods[0].points[0].document = 2; },
    (debug) => { debug.methods[0].points[0].startColumn = 1.5; },
    (debug) => { debug.methods[0].points[0].hidden = 'true'; },
    (debug) => { debug.methods[0].points = []; },
    (debug) => { debug.methods[0].document = 2; },
    (debug) => { debug.methods[0].codeSize = 0; debug.methods[0].points = []; debug.methods[0].localSignature = 0; },
    (debug) => { debug.custom[0].bytes = [1, 2, 3]; },
    (debug) => { debug.methods[0].scopes = [null]; },
  ];
  for (const change of mutations) {
    const debug = input();
    change(debug);
    code(() => emit(debug), 'PDB_DELTA_INPUT');
  }
});

test('unchanged method references, malformed CDI, invalid scopes and incorrect delta counts fail explicitly', () => {
  for (const field of ['custom', 'stateMachines']) {
    const debug = input();
    debug[field][0][field === 'custom' ? 'parent' : 'moveNext'] = token(6, 1);
    code(() => emit(debug), 'PDB_DELTA_METHOD');
  }
  code(() => emit(undefined, { deltaRowCounts: undefined }), 'PDB_DELTA_COUNTS');
  code(() => emit(undefined, { deltaRowCounts: { 6: 2 } }), 'PDB_DELTA_COUNTS');
  code(() => emit(undefined, { deltaRowCounts: { 6: 1, 17: 8 } }), 'PDB_DELTA_COUNTS');
  const badCustom = input();
  badCustom.custom[2].bytes = new Uint8Array([0]);
  assert.throws(() => emit(badCustom), SymbolError);
  const badScope = input();
  badScope.methods[0].scopes[0].end = 9;
  assert.throws(() => emit(badScope), /Root local scope|outside method body/);
});

test('writer rejects malformed state-machine records and token coercion before bit operations', () => {
  for (const value of [null, undefined, false, 1, 'record', []]) {
    const debug = input();
    debug.stateMachines = [value];
    code(() => emit(debug), 'PDB_DELTA_INPUT');
  }
  const invalid = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, String(updatedToken), BigInt(updatedToken),
    token(6, 0), token(6, 4), token(4, 2), 0x100000000 + updatedToken];
  for (const value of invalid) {
    for (const field of ['method', 'moveNext', 'kickoff']) {
      const debug = input();
      if (field === 'method') debug.methods[0].token = value;
      else debug.stateMachines[0][field] = value;
      code(() => emit(debug), 'PDB_DELTA_INPUT');
    }
  }
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, String(updatedToken), BigInt(updatedToken),
    token(6, 0), 0x100000000 + token(51, 1)]) {
    const debug = input();
    debug.custom[1].parent = value;
    code(() => emit(debug), 'PDB_DELTA_INPUT');
  }
});

test('writer cancellation and budgets reject before returning any delta', () => {
  const cancelled = new AbortController();
  cancelled.abort();
  code(() => emit(undefined, undefined, { signal: cancelled.signal }), 'PDB_DELTA_CANCELLED');
  for (const options of [{ maxRecords: 1 }, { maxPoints: 0 }, { maxBytes: 1 }]) {
    code(() => emit(undefined, undefined, options), 'PDB_DELTA_BUDGET');
  }
  code(() => emit(undefined, undefined, { maxRecords: -1 }), 'PDB_DELTA_INPUT');
  code(() => emit(undefined, undefined, null), 'PDB_DELTA_INPUT');
  code(() => emit(undefined, { generation: 0 }), 'PDB_GENERATION_MISMATCH');
});
