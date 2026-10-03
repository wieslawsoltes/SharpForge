import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  compareCaptures,
  compareReproductions,
  reproductionInputs,
} from '../../../scripts/conformance/acceptance/reproduce.js';
import { hash } from '../../../scripts/conformance/repro/common.js';

// Unit records exercise comparison policy, never count as actual release qualification.
function capture(operator) {
  const commit = 'a'.repeat(40);
  return {
    schemaVersion: 1,
    kind: 'clean-clone-release',
    status: 'passed',
    commit,
    harnessCommit: commit,
    runId: randomUUID(),
    operator,
    sourceTreeSha256: 'b'.repeat(64),
    build: {
      commit,
      epoch: 1234,
      toolchain: { node: 'v24.21.0', npm: '11.19.0' },
      outputs: [{ path: 'dist/index.html', bytes: 1, sha256: hash('a') }],
      golden: {
        schemaVersion: 1,
        algorithm: 'sha256',
        mode: 'unit',
        examples: [{ input: 'example.cs', source: hash('source') }],
        bundles: [{ path: 'dist/index.html', sha256: hash('a') }],
      },
    },
  };
}

test('reproduction inputs require exact source and credential-free clone transport', () => {
  const options = {
    repository: 'https://github.com/wieslawsoltes/SharpForge.git',
    commit: 'a'.repeat(40),
    operator: 'agent-a',
  };
  assert.equal(reproductionInputs(options).commit, options.commit);
  for (const patch of [
    { commit: 'HEAD' },
    { operator: '' },
    { repository: 'https://token@example.com/repo' },
    { repository: 'http://example.com/repo' },
    { repository: '--upload-pack=evil' },
  ]) {
    assert.throws(() => reproductionInputs({ ...options, ...patch }));
  }
});

test('comparison rejects reuse, incomplete captures and different source/toolchain', () => {
  const first = capture('first'),
    second = capture('second');
  assert.equal(compareCaptures(first, second).passed, true);
  for (const mutate of [
    (value) => (value.operator = first.operator),
    (value) => (value.runId = first.runId),
    (value) => (value.status = 'failed'),
    (value) => (value.build.outputs = []),
    (value) => value.build.epoch++,
    (value) => (value.sourceTreeSha256 = 'c'.repeat(64)),
    (value) => (value.build.toolchain.npm = 'other'),
    (value) => (value.build.outputs[0].path = '../escape'),
  ]) {
    const value = structuredClone(second);
    mutate(value);
    assert.throws(() => compareCaptures(first, value));
  }
  second.build.outputs[0].sha256 = hash('b');
  assert.equal(compareCaptures(first, second).passed, false);
});

test('comparison rehashes retained files instead of trusting report claims', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-reproduce-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = [];
  for (const operator of ['first', 'second']) {
    const path = join(directory, operator);
    await mkdir(join(path, 'outputs/dist'), { recursive: true });
    await writeFile(
      join(path, 'outputs/dist/index.html'),
      operator === 'first' ? 'a' : 'b',
    );
    await writeFile(
      join(path, 'report.json'),
      JSON.stringify(capture(operator)),
    );
    paths.push(join(path, 'report.json'));
  }
  const report = await compareReproductions({
    first: paths[0],
    second: paths[1],
    output: join(directory, 'comparison'),
  });
  assert.equal(report.status, 'failed');
  assert.match(report.error, /Retained output differs/);
  await assert.rejects(
    compareReproductions({
      first: paths[0],
      second: paths[1],
      output: join(directory, 'comparison'),
    }),
    /EEXIST/,
  );
});
