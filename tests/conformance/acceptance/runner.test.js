import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeScenario } from '../../../scripts/conformance/acceptance/run.js';
import { readBlockers } from '../../../scripts/conformance/acceptance/blockers.js';
import { readScenario } from '../../../scripts/conformance/acceptance/scenario.js';
import { hash } from '../../../scripts/conformance/repro/common.js';

async function workspace(t) {
  const directory = await mkdtemp(
    join(tmpdir(), 'sharpforge-acceptance-unit-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const load = (name) =>
  readScenario(new URL('./scenarios/' + name + '.json', import.meta.url));

test('runner records each completed step and hashes its retained artifact', async (t) => {
  const output = await workspace(t),
    calls = [];
  const adapter = {
    step: async (step) => {
      calls.push(step.id);
      return { observed: step.id };
    },
    close: async () => calls.push('close'),
  };
  const report = await executeScenario(await load('sample'), {
    adapter,
    output,
    target: 'cli',
    ledger: { blockers: [] },
  });
  assert.equal(report.status, 'passed');
  assert.deepEqual(calls, ['open', 'build', 'close']);
  assert.deepEqual(report.unexecutedSteps, []);
  for (const step of report.steps) {
    assert.equal(step.status, 'passed');
    assert.equal(
      hash(await readFile(join(output, step.artifact.path))),
      step.artifact.sha256,
    );
  }
});

test('failure, cancellation and failed disposal cannot produce a passing scenario', async (t) => {
  for (const failure of ['step', 'cancel', 'close']) {
    const output = await workspace(t);
    let closed = false;
    const controller = new AbortController();
    if (failure === 'cancel') controller.abort();
    const adapter = {
      step: async () => {
        if (failure === 'step') throw new Error('Observed product failure');
        return {};
      },
      close: async () => {
        closed = true;
        if (failure === 'close') throw new Error('Disposal failure');
      },
    };
    const report = await executeScenario(await load('sample'), {
      adapter,
      output,
      target: 'cli',
      ledger: { blockers: [] },
      signal: controller.signal,
    });
    assert.equal(report.status, failure === 'cancel' ? 'cancelled' : 'failed');
    assert.equal(closed, true);
    if (failure !== 'close')
      assert.deepEqual(report.unexecutedSteps, ['build']);
  }
});

test('unavailable product flow reports both dependencies and performs no substitute actions', async (t) => {
  const output = await workspace(t),
    ledger = await readBlockers();
  const adapter = {
    step: async () => assert.fail('Unavailable actions must not run'),
    close: async () => {},
  };
  const report = await executeScenario(await load('git-publish'), {
    adapter,
    output,
    target: 'studio',
    ledger,
  });
  assert.equal(report.status, 'blocked');
  assert.deepEqual(
    report.dependencies.map((row) => row.id),
    ['A25-GIT', 'A26-PUBLISH'],
  );
  assert.equal(report.steps[0].status, 'blocked');
  assert.equal(report.unexecutedSteps.length, 4);
  const unknown = await executeScenario(await load('git-publish'), {
    adapter,
    output,
    target: 'cli',
    ledger: { blockers: [] },
  });
  assert.equal(unknown.status, 'failed');
  assert.match(unknown.error, /Unrecorded blocker/);
});

test('blocker ledger rejects a nonexistent task and duplicate blocker identity', async (t) => {
  const directory = await workspace(t),
    ledger = await readBlockers();
  const path = join(directory, 'blockers.json');
  ledger.blockers[0].taskIds = ['SF-A99-T99'];
  await writeFile(path, JSON.stringify(ledger));
  await assert.rejects(readBlockers(path), /Unknown blocker task/);
  ledger.blockers.push(structuredClone(ledger.blockers[0]));
  await writeFile(path, JSON.stringify(ledger));
  await assert.rejects(readBlockers(path), /Duplicate blocker/);
});
