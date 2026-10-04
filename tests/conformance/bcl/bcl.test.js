import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCorpus, parseObservations, captureBcl, cultures } from '../../../scripts/conformance/oracle/bcl-run.js';
import { pin, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
const directory = new URL('./', import.meta.url);
const nativeResult = (family, culture) => ({ exitCode: 0, signal: null, stderr: '', unhandledException: null,
  stdout: family.cases.map(item => JSON.stringify({ id: item.id, family: family.family, culture,
    status: item.exception ? 'exception' : 'returned', value: item.exception ? null : 'observed fixture output', exception: item.exception })).join('\n') + '\n' });

test('BCL case identities bind source, declared behavior and culture-specific observations', async () => {
  const corpus = await loadCorpus(), family = corpus.find(item => item.family === 'string');
  assert.deepEqual(corpus.map(item => item.family).sort(), ['collections', 'formatting', 'math', 'string', 'time']);
  assert.equal(family.cases.length, 40);
  assert.equal(new Set(corpus.flatMap(item => item.cases.map(row => row.id))).size, corpus.length * 40);
  assert.equal(family.sourceSHA256, sha256(family.sourceBytes));
  assert(family.cases.some(item => item.category === 'negative'));
  const observations = parseObservations(nativeResult(family, 'fr-FR'), family, 'fr-FR');
  assert.equal(observations.length, 40);
  assert.equal(observations[0].value, 'observed fixture output');
  assert.equal(observations.find(row => row.id === 'string-substring-negative').exception, 'System.ArgumentOutOfRangeException');
});

test('BCL output rejects process failures, missing or extra cases, wrong culture and unexpected exceptions', async () => {
  const family = (await loadCorpus())[0], original = nativeResult(family, 'invariant');
  for (const patch of [{ exitCode: 1 }, { signal: 'SIGABRT' }, { stderr: 'native failure' },
    { unhandledException: 'System.Exception' }, { stdout: '' }, { stdout: original.stdout + '{}\n' }]) {
    assert.throws(() => parseObservations({ ...original, ...patch }, family, 'invariant'));
  }
  for (const patch of [{ culture: 'fr-FR' }, { id: 'other' }, { status: 'exception', exception: 'System.Exception', value: null }, { value: 12 }]) {
    const lines = original.stdout.trimEnd().split('\n'); lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), ...patch });
    assert.throws(() => parseObservations({ ...original, stdout: lines.join('\n') + '\n' }, family, 'invariant'), /contract failed/);
  }
  assert.throws(() => parseObservations(original, family, 'en-US'), /Unpinned/);
  assert.equal(parseObservations({ ...original, stdout: original.stdout.replaceAll('\n', '\r\n') }, family, 'invariant').length, 40);
});

test('BCL corpus rejects duplicate IDs and incomplete families before native execution', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-bcl-fixture-'));
  try {
    for (const name of ['Common.cs', 'String.cs', 'string.json', 'Formatting.cs', 'formatting.json',
      'Collections.cs', 'collections.json', 'Math.cs', 'math.json', 'Time.cs', 'time.json']) await cp(new URL(name, directory), path.join(temporary, name));
    const original = JSON.parse(await readFile(path.join(temporary, 'string.json'), 'utf8'));
    for (const mutation of [value => value.cases.pop(), value => { value.cases[1].id = value.cases[0].id; },
      value => { value.source = '../String.cs'; }, value => { value.cases[0].exception = undefined; }]) {
      const catalog = structuredClone(original); mutation(catalog);
      await writeFile(path.join(temporary, 'string.json'), JSON.stringify(catalog));
      await assert.rejects(loadCorpus(temporary));
    }
    await writeFile(path.join(temporary, 'string.json'), JSON.stringify(original));
    await rm(path.join(temporary, 'math.json'));
    await assert.rejects(loadCorpus(temporary), /all five families and 200 cases/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('BCL capture retains both cultures and fake native provenance without qualifying a baseline', async () => {
  const calls = [];
  const report = await captureBcl({ target: pin.platforms.coreclr[0], resolve: async () => ({ actual: { fixture: true }, environment: { fixture: true } }),
    compile: async family => ({ assembly: Buffer.from(family.id), result: { exitCode: 0, diagnostics: [], assemblySHA256: sha256(family.id) }, timings: [1, 2], command: ['fake-compile'] }),
    execute: async (assembly, family, toolchain, options) => {
      const culture = options.env.SHARPFORGE_BCL_CULTURE; calls.push([family.family, culture]);
      return { result: nativeResult(family, culture), timings: [3, 4], command: ['fake-execute'] };
    } });
  assert.equal(report.status, 'captured-not-baseline-qualified');
  assert.equal(calls.length, report.families.length * 2);
  for (const family of report.families) {
    assert.deepEqual(family.captures.map(item => item.culture), cultures);
    assert.notEqual(family.captures[0].inputHash, family.captures[1].inputHash);
    assert.equal(family.captures[0].observations.length, 40);
    assert.match(family.captures[0].result.stdout, /observed fixture output/);
  }
});

test('BCL capture surfaces native compilation/execution errors and records unsupported targets', async () => {
  const resolve = async () => ({ actual: {}, environment: {} });
  const compiled = { assembly: Buffer.from('fixture'), result: { exitCode: 0, diagnostics: [] } };
  const rejected = await captureBcl({ target: pin.platforms.coreclr[0], resolve,
    compile: async () => ({ assembly: null, result: { exitCode: 1, diagnostics: [{ severity: 'error', id: 'CS0001' }] } }) });
  assert.equal(rejected.status, 'failed'); assert.match(rejected.failures[0], /CS0001/);
  const failure = await captureBcl({ target: pin.platforms.coreclr[0], resolve, compile: async () => compiled,
    execute: async () => { const error = new Error('native timeout'); error.result = { stdout: 'partial' }; throw error; } });
  assert.equal(failure.status, 'failed'); assert.deepEqual(failure.nativeFailure, { stdout: 'partial' });
  const unsupported = await captureBcl({ target: 'unsupported-test-target', resolve: async () => { throw new Error('Must not resolve native host'); } });
  assert.equal(unsupported.status, 'unsupported'); assert.equal(unsupported.families.length, 0); assert.equal(unsupported.unsupported.length, 1);
});
