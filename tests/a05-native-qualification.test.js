import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeQualificationPlan} from '../scripts/a05/native-plan.js';
import {runNativePlan} from '../scripts/a05/native-run.js';

test('A05 native plan keeps SDK policy, unsafe compilation and replay evidence explicit', () => {
  const output = join(tmpdir(), 'native artifacts');
  const plan = nativeQualificationPlan({output, framework: 'net8.0'});
  assert.equal(plan.length, 32, 'every authored protocol has an independently recorded native case');
  assert.equal(new Set(plan.map(item => item.id)).size, plan.length);
  const byId = new Map(plan.map(item => [item.id, item]));
  assert(byId.get('memory').args.includes('--unsafe'));
  assert(byId.get('calli').args.includes('--unsafe'));
  assert(byId.get('first-chance-policy').args.includes('--failfast'));
  assert(byId.get('unhandled-policy').args.includes('--fault'));
  assert(byId.get('synchronization').args.includes('--scheduled'));
  assert(byId.get('async-replay').args.includes('--async'));
  assert(byId.get('source-generic-values').args.includes('tests/fixtures/a05/source-generic-values'));
  assert(byId.get('delegates').args.includes('tests/fixtures/a05/delegates'));
  assert.equal(byId.get('delegates').evidence, join(output, 'delegates', 'evidence'));
  assert.equal(plan.filter(item => item.sdkMajor === 10).length, 3,
    'SDK 8 records 29 eligible cases and three explicit numeric-policy exclusions');
  assert.equal(byId.get('numeric-capture').sdkMajor, 10);
  assert.equal(byId.get('numeric-replay').dependsOn, 'numeric-capture');
  assert.equal(byId.get('numeric-replay').env.SHARPFORGE_NUMERIC_ORACLE_DIR, byId.get('numeric-capture').evidence);
  assert(plan.every(item => item.timeoutMs > 0 && item.timeoutMs <= 900000));
});

test('A05 native aggregation continues independent failures and never counts unavailable evidence as a pass', async () => {
  const output = await mkdtemp(join(tmpdir(), 'sharpforge-a05-plan-'));
  const calls = [];
  const plan = [
    {id: 'failed', args: ['fail.js']},
    {id: 'dependent', args: ['dependent.js'], dependsOn: 'failed'},
    {id: 'sdk-policy', args: ['sdk.js'], sdkMajor: 10, unsupportedReason: 'Pinned policy'},
    {id: 'last', args: ['success.js']}
  ].map(item => ({...item, timeoutMs: 1000}));
  try {
    const summary = await runNativePlan(plan, {output, root: output, environment: {},
      provenance: {dotnetSdk: '8.0.425'}, execute(executable, args) {
        calls.push(args[0]);
        return {status: args[0] === 'fail.js' ? 1 : 0, signal: null, stdout: 'native\r\n', stderr: ''};
      }});
    assert.deepEqual(calls, ['fail.js', 'success.js']);
    assert.deepEqual(summary.cases.map(item => item.status), ['failed', 'blocked', 'unsupported', 'passed']);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.passed, false);
    assert.deepEqual(summary.counts, {failed: 1, blocked: 1, unsupported: 1, passed: 1});
    assert.equal(await readFile(join(output, 'last/stdout.log'), 'utf8'), 'native\n');
    const saved = JSON.parse(await readFile(join(output, 'qualification.json'), 'utf8'));
    assert.equal(saved.finishedAt, summary.finishedAt);
    assert.deepEqual(saved.cases[0].command.arguments, ['fail.js']);
  } finally { await rm(output, {recursive: true, force: true}); }
});

test('A05 native missing SDK blocks every case and retains a complete failed report', async () => {
  const output = await mkdtemp(join(tmpdir(), 'sharpforge-a05-missing-sdk-'));
  try {
    const summary = await runNativePlan([{id: 'fixture', args: ['fixture.js'], timeoutMs: 1000}], {
      output, root: output, environment: {}, provenance: {dotnetSdk: null}, setupError: 'dotnet unavailable',
      execute() { assert.fail('A missing SDK must not start a fixture'); }
    });
    assert.equal(summary.status, 'failed');
    assert.equal(summary.cases[0].status, 'blocked');
    assert.equal(summary.cases[0].reason, 'dotnet unavailable');
  } finally { await rm(output, {recursive: true, force: true}); }
});
