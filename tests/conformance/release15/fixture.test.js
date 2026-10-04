import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadManifest,
  validateManifest,
  requirements,
} from '../../../scripts/conformance/release15/manifest.js';
import { summarize, applyBrowserOutcomes } from '../../../scripts/conformance/release15/run.js';
import { reproduceArchive } from '../../../scripts/conformance/release15/archive.js';

async function data() {
  const { scenario, ledger } = await loadManifest();
  const snapshot = JSON.parse(
    await readFile(
      new URL('../../../planning/backlog.snapshot.json', import.meta.url),
    ),
  );
  return {
    scenario,
    ledger,
    known: new Set(snapshot.issues.map((row) => row.id)),
  };
}

test('release15 records every obligation and separates executable components from blockers', async () => {
  const { scenario, ledger, known } = await data();
  const blockers = validateManifest(scenario, ledger, known);
  assert.equal(
    new Set(scenario.checks.map((row) => row.requirement)).size,
    requirements.length,
  );
  assert(scenario.checks.some((row) => row.adapter === 't12-cli'));
  assert(scenario.checks.some((row) => row.adapter === 't12-studio'));
  for (const id of [
    'REMOTE-GIT',
    'DOCUMENT-SESSIONS',
    'FAIR-SESSION-IO',
    'APP-EXPORT',
    'PROVIDER-AUTH',
  ]) {
    assert(blockers.has(id));
    assert(scenario.checks.some((row) => row.blocker === id));
  }
  assert(blockers.has('MULTI-APP'));
  const sessions = scenario.checks.find((row) => row.id === 'two-apps-two-instances');
  assert.equal(sessions.requirement, 'session-isolation');
  assert.equal(sessions.adapter, 'browser');
  assert.deepEqual(sessions.actions, ['sessions']);
  assert.equal(sessions.blocker, undefined);
});

test('unknown blockers, missing obligations, duplicate checks and invented adapters fail closed', async () => {
  const { scenario, ledger, known } = await data();
  for (const mutate of [
    (value) => (value.checks.find((row) => row.blocker).blocker = 'UNRECORDED'),
    (value) =>
      (value.checks = value.checks.filter(
        (row) => row.requirement !== 'session-isolation',
      )),
    (value) => value.checks.push(structuredClone(value.checks[0])),
    (value) => (value.checks[0].adapter = 'mock-provider'),
    (value) =>
      (value.checks.find((row) => row.adapter === 'browser').actions = [
        'arbitrary-script',
      ]),
  ]) {
    const value = structuredClone(scenario);
    mutate(value);
    assert.throws(() => validateManifest(value, ledger, known));
  }
  const invalid = structuredClone(ledger);
  invalid.blockers[0].taskIds = ['SF-A99-T99'];
  assert.throws(
    () => validateManifest(scenario, invalid, known),
    /unknown task-linked/,
  );
});

test('component success cannot hide blocked, cancelled or failed release obligations', () => {
  assert.equal(summarize([]), 'blocked');
  assert.equal(
    summarize([{ status: 'passed' }, { status: 'blocked' }]),
    'blocked',
  );
  assert.equal(
    summarize([{ status: 'passed' }, { status: 'cancelled' }]),
    'failed',
  );
  assert.equal(
    summarize([{ status: 'blocked' }, { status: 'failed' }]),
    'failed',
  );
  assert.equal(
    summarize([{ status: 'passed' }, { status: 'running' }]),
    'blocked',
  );
});

test('a browser blocker preserves independent step and phase evidence without overriding failure', () => {
  const blocker = { id: 'MULTI-APP', reason: 'Observed duplicate-instance editor lock' };
  const blockers = new Map([[blocker.id, blocker]]);
  const phases = [{ name: 'debugger', status: 'passed' }, { name: 'hot-reload', status: 'blocked' }];
  const outcomes = new Map([['sessions', { blocker: blocker.id, checks: phases }]]);
  const report = { status: 'passed', steps: [
    { id: 'documents', status: 'passed' }, { id: 'sessions', status: 'passed' },
  ] };
  applyBrowserOutcomes(report, outcomes, blockers);
  assert.equal(report.status, 'blocked');
  assert.equal(report.steps[0].status, 'passed');
  assert.equal(report.steps[1].status, 'blocked');
  assert.deepEqual(report.steps[1].phases, phases);
  report.status = 'failed';
  applyBrowserOutcomes(report, outcomes, blockers);
  assert.equal(report.status, 'failed');
  assert.throws(() => applyBrowserOutcomes(report, new Map([['sessions', {blocker:'INVENTED'}]]), blockers),
    /Unrecorded release15 blocker/);
});

test('exact source archive capture rejects missing pins and changed bytes before building', async (t) => {
  await assert.rejects(
    reproduceArchive({ sha256: 'bad', commit: 'HEAD' }),
    /Exact source archive/,
  );
  const directory = await mkdtemp(join(tmpdir(), 'release15-archive-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = join(directory, 'source.zip');
  await writeFile(archive, 'changed archive bytes');
  await assert.rejects(
    reproduceArchive({
      archive,
      sha256: 'a'.repeat(64),
      commit: 'b'.repeat(40),
    }),
    /SHA-256 mismatch/,
  );
});
