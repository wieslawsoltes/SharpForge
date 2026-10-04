import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus, platform } from 'node:os';
import { GitRepository } from '../packages/git/src/repository.js';
import { openNodeRepository } from '../packages/git/src/fs/node.js';
import { repository } from './a25-workflow-fixtures.js';
import { nativeWorkspace, fileTree, commitObject, copyObjects } from './a25-conformance-local-fixtures.js';

const enabled = process.env.SHARPFORGE_GIT_PERF === '1';
const files = 10000;

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

async function timings(repo) {
  const cold = [];
  const warm = [];
  for (let iteration = 0; iteration < 3; iteration++) {
    repo.statCache.clear();
    repo.treeCache.clear();
    repo.worktree.clearScanCache?.();
    repo.graph.cache.clear();
    repo.graph.generations.clear();
    repo.history?.dispose();
    let start = performance.now();
    assert.deepEqual(await repo.status(), []);
    cold.push(performance.now() - start);
    for (let warmed = 0; warmed < 5; warmed++) {
      start = performance.now();
      assert.deepEqual(await repo.status(), []);
      warm.push(performance.now() - start);
    }
  }
  return { cold: { medianMs: percentile(cold, 0.5), p95Ms: percentile(cold, 0.95), samplesMs: cold },
    warm: { medianMs: percentile(warm, 0.5), p95Ms: percentile(warm, 0.95), samplesMs: warm } };
}

/** This gate runs explicitly on the serial qualification schedule, never in parallel with another benchmark. */
test('10k-file status cold and warm latency on actual memory and filesystem backends', {
  skip: !enabled && 'Run once on a quiet machine with SHARPFORGE_GIT_PERF=1 through scripts/limited.js', timeout: 600000
}, async t => {
  const workspace = await nativeWorkspace(t);
  if (!workspace) return;
  await workspace.git(['init', '-q', '-b', 'main']);
  const memory = await repository();
  t.after(() => memory.dispose());
  const contents = {};
  for (let index = 0; index < files; index++) {
    const directory = `dir-${String(Math.floor(index / 100)).padStart(3, '0')}`;
    contents[`${directory}/file-${String(index).padStart(5, '0')}.txt`] = 'tracked status fixture\n';
  }
  const tree = await fileTree(memory, contents);
  const oid = await commitObject(memory, tree.oid, [], 'ten thousand files');
  await memory.refs.update('refs/heads/main', oid, { expected: null });
  await memory.replaceIndex(tree.index);
  for (const [path, text] of Object.entries(contents)) await memory.worktree.write(path, text);
  await copyObjects(memory, workspace.git);
  await workspace.git(['update-ref', 'refs/heads/main', oid]);
  await workspace.git(['read-tree', '--reset', '-u', oid], { timeoutMs: 180000 });
  const opened = await openNodeRepository({ directory: workspace.root });
  const native = new GitRepository(opened);
  await native.init();
  t.after(async () => { native.dispose(); await opened.store.close(); });
  const measurements = [];
  for (const [backend, repo] of [['MemoryWorktree+MemoryObjectDatabase', memory], ['NodeWorktree+FsObjectDatabase', native]]) {
    const measurement = { backend, files, node: process.version, platform: platform(), cpu: cpus()[0]?.model,
      memoryBytes: process.memoryUsage().rss, ...(await timings(repo)) };
    measurements.push(measurement);
    t.diagnostic(JSON.stringify(measurement));
  }
  for (const measurement of measurements) {
    assert.ok(measurement.cold.medianMs <= 500, `${measurement.backend} cold median ${measurement.cold.medianMs.toFixed(2)} ms exceeds 500 ms`);
    assert.ok(measurement.warm.medianMs <= 50, `${measurement.backend} warm median ${measurement.warm.medianMs.toFixed(2)} ms exceeds 50 ms`);
  }
});
