import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {source, expected} from '../examples/runtime/managed-references.mjs';
import {qualifyNativeSourceRoutes} from '../scripts/a05/native-source-routes.js';
import {nativeQualificationPlan} from '../scripts/a05/native-plan.js';

const fixture = new URL('./fixtures/a05/byref-calls/', import.meta.url);
const bytes = readFileSync(new URL('Program.cs', fixture));
const sources = [{name: 'Program.cs', bytes}];
const observation = {exitCode: 0, signal: null, output: expected};

test('native byref input and expected trace are byte-identical to the existing three-route example', () => {
  assert.equal(bytes.toString('utf8'), source);
  assert.equal(readFileSync(new URL('expected.txt', fixture), 'utf8'), expected);
  for (const framework of ['net8.0', 'net10.0']) {
    const item = nativeQualificationPlan({output: 'artifacts', framework}).find(row => row.id === 'byref-calls');
    assert(item.args.includes('tests/fixtures/a05/byref-calls'));
    assert(item.args.includes('--source-routes'));
    assert.equal(item.sdkMajor, undefined, 'Both selected SDKs execute this case');
  }
});

for (const nativeIntBits of [32, 64]) test(`native-output adapter checks all compiler routes with observed ABI${nativeIntBits}`, () => {
  // This unit test supplies an authored observation; only the native runner
  // obtains a real native process result, which must never be inferred here.
  const report = qualifyNativeSourceRoutes(sources, observation, nativeIntBits);
  assert.equal(report.nativeIntBits, nativeIntBits);
  assert.equal(report.sourceSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.match(report.assemblySha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.routes.map(row => row.engine), ['source', 'reloaded-source', 'compiled-cil']);
  for (const row of report.routes) {
    assert.equal(row.output, observation.output);
    assert.equal(row.exitCode, 0);
    assert(row.instructions > 0);
  }
});

test('native-output adapter fails divergence and rejects unknown ABI or unsuccessful native execution', () => {
  assert.throws(() => qualifyNativeSourceRoutes(sources, {...observation, output: 'incorrect\n'}, 64), /source\/native stdout/);
  assert.throws(() => qualifyNativeSourceRoutes(sources, observation, 16), /pointer width/);
  assert.throws(() => qualifyNativeSourceRoutes(sources, {...observation, exitCode: 1}, 64), /native execution/);
  assert.throws(() => qualifyNativeSourceRoutes(sources, {...observation, signal: 'SIGABRT'}, 64), /native exit/);
  assert.throws(() => qualifyNativeSourceRoutes([...sources, ...sources], observation, 64), /one exact C#/);
});
