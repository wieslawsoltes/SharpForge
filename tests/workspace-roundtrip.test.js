import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeWorkspaceFile} from '@sharpforge/archive';
import {ProjectSystem, exportWorkspaceZip, importWorkspaceZip} from '@sharpforge/project-system';
import {MSBuildClient} from '@sharpforge/msbuild';
import {startMSBuildHost} from '@sharpforge/msbuild/node';
import {loadWorkspaceCorpus, materializeCorpus, diskManifest, byteDigest} from './support/workspace-corpus.js';

const corpus = await loadWorkspaceCorpus();

function assertRecords(item, records) {
  const actual = new Map(records.map(record => [record.path, encodeWorkspaceFile(record)]));
  assert.deepEqual([...actual.keys()].sort(), item.files.map(file => file.path).sort(), item.id + ': file paths');
  for (const file of item.files) {
    const bytes = actual.get(file.path);
    assert.equal(bytes.length, file.size, `${item.id}/${file.path}: length`);
    assert.equal(byteDigest(bytes), file.sha256, `${item.id}/${file.path}: bytes`);
  }
}

function assertMembership(item, records) {
  if (!item.settings.entry) return;
  const project = new ProjectSystem(records);
  project.load(item.settings.entry);
  for (const [path, expected] of Object.entries(item.memberships)) {
    assert.ok(project.projects.has(path), item.id + ': project missing ' + path);
    assert.deepEqual(project.projects.get(path).compile.map(file => file.path).sort(), [...expected].sort(), path);
  }
}

for (const item of corpus) {
  test(`workspace corpus ${item.id}: ZIP re-export retains bytes, membership and empty directories`, () => {
    const first = exportWorkspaceZip(item);
    const reopened = importWorkspaceZip(first);
    assertRecords(item, reopened.records);
    assertMembership(item, reopened.records);
    assert.deepEqual(reopened.folders.sort(), [...item.folders].sort(), item.id + ': empty directories');
    const second = importWorkspaceZip(exportWorkspaceZip(reopened));
    assertRecords(item, second.records);
    assert.deepEqual(second.folders.sort(), [...item.folders].sort());
    assert.equal(second.settings.entry, item.settings.entry);
    assert.equal(second.settings.startup, item.settings.startup);
  });

  test(`workspace corpus ${item.id}: native HTTP bytes match the ZIP import`, async context => {
    const root = await mkdtemp(join(tmpdir(), 'sharpforge-corpus-'));
    context.after(() => rm(root, {recursive: true, force: true}));
    await materializeCorpus(item, root);
    const original = await diskManifest(root);
    const host = await startMSBuildHost({root, port: 0, trusted: false});
    context.after(() => host.close());
    const client = new MSBuildClient({
      token: host.token,
      fetch: (path, options) => fetch(new URL(path, host.origin), options),
    });
    const snapshot = await client.workspace();
    assert.deepEqual(snapshot.files.map(file => file.path).sort(), item.files.map(file => file.path).sort());
    for (const folder of item.folders) assert.ok(snapshot.folders.includes(folder), folder);
    const records = await Promise.all(snapshot.files.map(async file => ({path: file.path, bytes: await client.binary(file.path)})));
    assertRecords(item, records);
    assertRecords(item, importWorkspaceZip(exportWorkspaceZip({...item, records})).records);

    const path = 'roundtrip-payload.bin';
    const bytes = Uint8Array.of(0, 255, 128, 13, 10, 0);
    const created = await client.mutate([{kind: 'create', path, base64: Buffer.from(bytes).toString('base64')}]);
    assert.deepEqual(new Uint8Array(await readFile(join(root, path))), bytes);
    const inspected = await client.inspectItem(path);
    const moved = await client.mutate([{kind: 'move', path, destination: 'roundtrip-renamed.bin', expectedHash: inspected.hash}]);
    const removed = await client.mutate([{
      kind: 'delete', path: 'roundtrip-renamed.bin', expectedHash: (await client.inspectItem('roundtrip-renamed.bin')).hash,
    }]);
    await client.undoMutation(removed.undoToken);
    await client.undoMutation(moved.undoToken);
    await client.undoMutation(created.undoToken);
    assert.deepEqual(await diskManifest(root), original, item.id + ': exact disk state after inverse operations');
    client.disconnect();
  });
}

test('workspace corpus rejects malformed archives and traversing output before producing records', () => {
  const valid = exportWorkspaceZip(corpus[0]);
  assert.throws(() => importWorkspaceZip(valid.subarray(0, valid.length - 1)), /ZIP|archive|directory/i);
  assert.throws(() => exportWorkspaceZip({records: [{path: '../escape.cs', text: 'bad'}]}), /path|travers/i);
  assert.throws(() => exportWorkspaceZip({records: [
    {path: 'same.cs', text: 'one'}, {path: 'SAME.cs', text: 'two'},
  ]}), /collid|duplicate/i);
});

test('native corpus saves unchanged UTF-16 text without changing BOM or byte order', async context => {
  const item = corpus[0], root = await mkdtemp(join(tmpdir(), 'sharpforge-corpus-encoding-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  await materializeCorpus(item, root);
  const host = await startMSBuildHost({root, port: 0, trusted: false});
  context.after(() => host.close());
  const client = new MSBuildClient({token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options)});
  for (const path of [
    'App/Program.cs', 'App/Notes/utf16be-bom.txt', 'App/Notes/utf16le-no-bom.txt', 'App/Notes/utf16be-no-bom.txt',
  ]) {
    const original = await readFile(join(root, path));
    const loaded = await client.read(path);
    await client.save([{path, text: loaded.text, expectedHash: loaded.hash}]);
    assert.deepEqual(await readFile(join(root, path)), original, path + ': save preserves original encoding');
  }
  const original = await client.read('App/Program.cs');
  await assert.rejects(client.save([{path: original.path, text: '// stale', expectedHash: '0'.repeat(64)}]), /conflict/i);
  assert.equal((await client.read(original.path)).hash, original.hash, 'conflicting save cannot change source bytes');
});
