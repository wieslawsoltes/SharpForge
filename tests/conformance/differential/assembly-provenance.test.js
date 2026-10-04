import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../../scripts/conformance/diff/classify.js';
import { result } from '../../../scripts/conformance/diff/result.js';

const fixture = { inputHash: 'f'.repeat(64), normalisers: [] };
const engines = ['source-vm', 'cil-vm', 'clr-sharpforge', 'clr-roslyn', 'rust-native', 'rust-wasm'];
const observations = () => engines.map(engine => result(engine, {
  stdout: '42\n', artifactHash: engine === 'source-vm' ? null : (engine === 'clr-roslyn' ? 'b' : 'a').repeat(64),
}));
const row = (rows, engine) => rows.find(record => record.engine === engine);
const repeated = rows => [rows, structuredClone(rows), structuredClone(rows)];
const differences = repetitions => classify(fixture, repetitions).differences;
const noRuntime = rows => assert.equal(rows.some(difference => difference.class === 'runtime'), false);

test('stable identical DLL evidence permits direct runtime attribution and native source-VM inference', () => {
  assert.deepEqual(differences(repeated(observations())), []);
  const direct = observations(); row(direct, 'cil-vm').stdout = '43\n';
  assert(differences(repeated(direct)).some(difference => difference.class === 'runtime' && difference.engines.includes('cil-vm')));
  const indirect = observations(); row(indirect, 'source-vm').stdout = '43\n';
  assert(differences(repeated(indirect)).some(difference => difference.class === 'runtime' && difference.engines.includes('source-vm')));
});

test('missing or malformed hashes never establish a runtime comparison, even with equal output', () => {
  for (const engine of ['cil-vm', 'clr-sharpforge', 'rust-native', 'rust-wasm']) {
    for (const hash of [null, undefined, '', 'a'.repeat(63), 'g'.repeat(64), 'A'.repeat(64), 123]) {
      for (const output of ['42\n', 'different\n']) {
        const rows = observations(); Object.assign(row(rows, engine), { artifactHash: hash, stdout: output });
        const found = differences(repeated(rows));
        assert(found.some(difference => difference.class === 'unclassified' && difference.engines.includes(engine)));
        noRuntime(found);
      }
    }
  }
  const rows = observations(); row(rows, 'clr-sharpforge').artifactHash = null; row(rows, 'cil-vm').artifactHash = null;
  row(rows, 'cil-vm').stdout = 'different'; noRuntime(differences(repeated(rows)));
});

test('the last repetition cannot change, omit or invalidate assembly identity behind stable output', () => {
  for (const engine of ['cil-vm', 'clr-sharpforge', 'clr-roslyn', 'rust-native', 'rust-wasm']) {
    for (const hash of [null, undefined, 'c'.repeat(64), 'bad']) {
      const runs = repeated(observations()); row(runs[2], engine).artifactHash = hash;
      const found = differences(runs);
      assert(found.some(difference => difference.class === 'unclassified' && difference.engines.includes(engine)));
      noRuntime(found);
    }
  }
  // Matching peers in each repetition still do not prove repeat-stable assembly bytes.
  const runs = repeated(observations());
  for (const engine of ['cil-vm', 'clr-sharpforge', 'rust-native', 'rust-wasm']) row(runs[2], engine).artifactHash = 'c'.repeat(64);
  assert(differences(runs).some(difference => difference.class === 'unclassified'));
});

test('valid but different DLLs are unclassified even when behavior agrees', () => {
  for (const engine of ['cil-vm', 'rust-native', 'rust-wasm']) {
    const rows = observations(); row(rows, engine).artifactHash = 'c'.repeat(64);
    const found = differences(repeated(rows));
    assert(found.some(difference => difference.class === 'unclassified' && difference.engines.includes(engine)));
    noRuntime(found);
  }
});

test('indirect source-VM attribution requires complete stable native and CIL evidence', () => {
  for (const engine of ['cil-vm', 'clr-sharpforge', 'clr-roslyn']) {
    for (const change of ['missing', 'changing', 'mismatched']) {
      if (engine === 'clr-roslyn' && change === 'mismatched') continue; // Different compilers need not emit the same DLL.
      const runs = repeated(observations()); for (const rows of runs) row(rows, 'source-vm').stdout = 'different';
      if (change === 'missing') for (const rows of runs) delete row(rows, engine).artifactHash;
      else if (change === 'changing') row(runs[2], engine).artifactHash = 'c'.repeat(64);
      else for (const rows of runs) row(rows, engine).artifactHash = 'c'.repeat(64);
      const found = differences(runs); assert(found.some(difference => difference.class === 'unclassified')); noRuntime(found);
    }
  }
});

test('compile-negative and explicitly unavailable engines do not require nonexistent DLLs', () => {
  const negative = observations();
  for (const record of negative) Object.assign(record, { status: 'compile-error', phase: 'compile', stdout: '', exitCode: null, artifactHash: null });
  assert.deepEqual(differences(repeated(negative)), []);
  const supported = observations();
  for (const engine of ['rust-native', 'rust-wasm']) Object.assign(row(supported, engine), { status: 'unsupported', artifactHash: null, reason: 'Unavailable test host' });
  const classified = classify(fixture, repeated(supported));
  assert.deepEqual(classified.differences, []); assert.equal(classified.unsupported.length, 2);
});
