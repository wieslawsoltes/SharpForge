import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BuildEventModel } from '../packages/msbuild/src/binlog/model.js';
import { indexBinlogEvents, queryBinlogEvents } from '../packages/msbuild/src/binlog/query.js';

const context = { nodeId: 1, projectContextId: 1, targetId: 2, taskId: 3 };
const events = [
  { kind: 'BuildStarted', timestamp: 0 },
  { kind: 'ProjectStarted', timestamp: 2, context, name: 'App.csproj' },
  { kind: 'TargetStarted', timestamp: 3, context, name: 'Compile' },
  { kind: 'TaskStarted', timestamp: 4, context, name: 'Csc' },
  { kind: 'BuildWarning', timestamp: 5, context, message: '😀 warning', severity: 'warning', code: 'CS0168' },
  { kind: 'TaskFinished', timestamp: 10, context, succeeded: true },
  { kind: 'TargetFinished', timestamp: 12, context, succeeded: true },
  { kind: 'ProjectFinished', timestamp: 14, context, succeeded: true },
  { kind: 'BuildFinished', timestamp: 15, succeeded: true }
];
test('structured event model preserves project/target/task tree and overlapping wall-clock timings', () => {
  const model = new BuildEventModel();
  for (const event of events) model.accept(event);
  model.finish();
  const project = model.page().nodes[0];
  assert.equal(project.name, 'App.csproj');
  assert.equal(model.page(project.id).nodes[0].name, 'Compile');
  assert.equal(model.timings({ kind: 'task' })[0].durationMs, 6);
  assert.equal(model.summary().durationMs, 15);
  assert.equal(model.summary().warnings, 1);
  assert.throws(() => model.page('build', { limit: 1001 }), /Invalid/);
});
test('binlog spool queries resume by byte cursor with Unicode and bounded search scans', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sf-binlog-query-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'events.ndjson');
  await writeFile(path, events.map(event => JSON.stringify(event)).join('\n') + '\n');
  const first = await queryBinlogEvents(path, { limit: 5 });
  const second = await queryBinlogEvents(path, { after: first.nextCursor, limit: 5 });
  assert.equal(first.events.length + second.events.length, events.length);
  assert.equal(second.events[0].kind, 'TaskFinished');
  const search = await queryBinlogEvents(path, { search: 'warning', maxScanned: 3 });
  assert.equal(search.scanned, 3);
  assert.equal(search.complete, false);
  assert.equal((await indexBinlogEvents(path)).summary().nodes, 4);
});

test('binlog pages stop at their byte budget without losing the first unreturned event', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sf-binlog-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'events.ndjson');
  const records = Array.from({ length: 4 }, (_, index) => ({ kind: 'Message', index, message: 'λ'.repeat(350) }));
  await writeFile(path, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  const first = await queryBinlogEvents(path, { limit: 100, maxBytes: 1024 });
  assert.deepEqual(first.events.map(event => event.index), [0]);
  assert(first.bytes <= 1024);
  const second = await queryBinlogEvents(path, { after: first.nextCursor, maxBytes: 1024 });
  assert.deepEqual(second.events.map(event => event.index), [1]);
  await assert.rejects(queryBinlogEvents(path, { maxScanned: 50001 }), /Invalid/);
  await assert.rejects(queryBinlogEvents(path, { maxBytes: 33554433 }), /Invalid/);
  const model = new BuildEventModel({ maxModelBytes: 1024 });
  assert.throws(() => model.accept({ kind: 'ProjectStarted', context, name: 'App' }), /byte limit/);
  assert.throws(() => new BuildEventModel().accept({ kind: 'ProjectStarted', context, name: 'a'.repeat(8193) }), /string limit/);
});
