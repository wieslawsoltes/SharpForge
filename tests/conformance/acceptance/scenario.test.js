import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readScenario,
  within,
} from '../../../scripts/conformance/acceptance/scenario.js';
const scenarios = new URL('./scenarios/', import.meta.url);

test('all delivered product scenarios satisfy the bounded schema', async () => {
  for (const name of [
    'sample',
    'solution-edit-build-debug',
    'designer-roundtrip',
    'git-publish',
  ]) {
    const scenario = await readScenario(new URL(name + '.json', scenarios));
    assert.equal(scenario.id, name);
  }
});

test('scenario rejects duplicate IDs, traversal, unknown actions and unbounded deadlines', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-scenario-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sample = JSON.parse(await readFile(new URL('sample.json', scenarios)));
  const mutations = [
    (value) => (value.steps[1].id = value.steps[0].id),
    (value) => (value.steps[0].entry = '../outside.slnx'),
    (value) => (value.steps[0].startup = '../../outside.csproj'),
    (value) => (value.steps[1].action = 'pretend-build'),
    (value) => (value.timeoutMs = 120001),
    (value) => (value.steps = []),
  ];
  for (const mutate of mutations) {
    const value = structuredClone(sample);
    mutate(value);
    const path = join(directory, 'scenario.json');
    await writeFile(path, JSON.stringify(value));
    await assert.rejects(readScenario(path));
  }
  await writeFile(join(directory, 'large.json'), ' '.repeat(1024 * 1024 + 1));
  await assert.rejects(readScenario(join(directory, 'large.json')), /exceeds/);
});

test('workspace paths reject absolute, backslash, NUL and parent escapes', () => {
  const base = join(tmpdir(), 'acceptance-root');
  for (const path of [
    '../outside',
    '/outside',
    'a\\b',
    'a\0b',
    '.',
    'a/../../b',
  ]) {
    assert.throws(() => within(base, path));
  }
  assert.equal(within(base, 'App/Program.cs'), join(base, 'App/Program.cs'));
});
