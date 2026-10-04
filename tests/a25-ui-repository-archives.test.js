import test from 'node:test';
import assert from 'node:assert/strict';
import { writeZip } from '@sharpforge/archive';
import { readGitArchiveFile, GIT_ARCHIVE_MAX_BYTES, importGitArchive, exportGitArchive,
  showGitArchiveImport } from '../apps/studio/git-archive-dialogs.js';
import { toolsWorkbench, archiveFile } from './git-tools/fixture.js';
import { toolsDocument, descendants } from './git-tools/dom.js';
import { commitFiles, text, decode } from './git-adjuncts/fixture.js';

test('archive file selection rejects excessive size before allocation and checks actual byte length and cancellation', async () => {
  let reads = 0;
  await assert.rejects(readGitArchiveFile({ size: GIT_ARCHIVE_MAX_BYTES + 1, arrayBuffer() { reads++; } }), { code: 'Limit' });
  assert.equal(reads, 0);
  await assert.rejects(readGitArchiveFile({ size: 2, arrayBuffer: async () => new ArrayBuffer(3) }), { code: 'Corrupt' });
  const exact = new Uint8Array(GIT_ARCHIVE_MAX_BYTES);
  assert.equal((await readGitArchiveFile({ size: exact.byteLength, arrayBuffer: async () => exact.buffer })).byteLength, GIT_ARCHIVE_MAX_BYTES);
  const controller = new AbortController();
  await assert.rejects(readGitArchiveFile({ size: 1, async arrayBuffer() {
    controller.abort();
    return new ArrayBuffer(1);
  } }, { signal: controller.signal }), { code: 'Cancelled' });
});

test('ZIP UI import passes explicit overwrite and staging choices to real validation and adopts only after success', async t => {
  const workbench = await toolsWorkbench(t);
  await commitFiles(workbench.repo, { 'existing.txt': 'original' });
  const bytes = writeZip([{ path: 'new.txt', bytes: text('new') }, { path: 'existing.txt', bytes: text('replacement') }]);
  await assert.rejects(importGitArchive(workbench, archiveFile(bytes), { format: 'zip' }), { code: 'Conflict' });
  assert.equal(await workbench.repo.worktree.read('new.txt'), null);
  assert.equal(workbench.events.some(event => event.type === 'adopt'), false);
  await importGitArchive(workbench, archiveFile(bytes), { format: 'zip', overwrite: true, stage: true });
  assert.equal(decode((await workbench.repo.worktree.read('existing.txt')).data), 'replacement');
  assert.ok(workbench.repo.index.get('new.txt'));
  assert.deepEqual(workbench.adopted.map(file => file.path), ['existing.txt', 'new.txt']);
  assert.equal(workbench.repositoryToolsResult.needsAdoption, false);
  const invalid = writeZip([{ path: 'safe.txt', bytes: text('safe') }, { path: '.git/config', bytes: text('unsafe') }]);
  await assert.rejects(importGitArchive(workbench, archiveFile(invalid), { format: 'zip', overwrite: true }), { code: 'Unsafe' });
  assert.equal(await workbench.repo.worktree.read('safe.txt'), null);
});

test('archive exports cross the host artifact boundary and bundle imports leave references unchanged unless selected', async t => {
  const source = await toolsWorkbench(t);
  const commit = await commitFiles(source.repo, { 'readme.txt': 'bundled' });
  const exported = await exportGitArchive(source, { format: 'bundle', filename: 'repository.bundle' });
  const download = source.events.find(event => event.type === 'download');
  assert.ok(download.bytes instanceof Uint8Array);
  assert.equal(download.mimeType, 'application/x-git-bundle');
  assert.equal(exported.filename, 'repository.bundle');
  assert.equal(typeof source.repositoryToolsResult.details.bytes, 'number');
  const target = await toolsWorkbench(t);
  await importGitArchive(target, archiveFile(download.bytes), { format: 'bundle', force: true });
  assert.equal(await target.repo.refs.read('HEAD'), null);
  assert.equal(await target.repo.odb.has(commit.oid), true);
  assert.equal(target.events.find(event => event.method === 'importBundle').params.force, false);
  await importGitArchive(target, archiveFile(download.bytes), { format: 'bundle', updateRefs: true });
  assert.equal(await target.repo.refs.read('HEAD'), commit.oid);
  assert.equal(target.events.some(event => event.type === 'adopt'), false);
  source.host.download = async () => null;
  await assert.rejects(exportGitArchive(source, { format: 'zip', filename: 'blocked.zip' }), { code: 'Cancelled' });
  assert.equal(source.repositoryToolsResult.ok, false);
});

test('bundle import dialog defaults are explicit and cancellation closes it without repository effects', async t => {
  const workbench = await toolsWorkbench(t);
  const document = toolsDocument();
  const controller = new AbortController();
  const dialog = showGitArchiveImport(document, workbench, 'bundle', { signal: controller.signal });
  const fields = new Map(descendants(dialog).filter(element => element.tagName === 'INPUT').map(element => [element.name, element]));
  assert.equal(fields.get('updateRefs').checked, false);
  assert.equal(fields.get('force').checked, false);
  assert.equal(fields.get('force').disabled, true);
  fields.get('updateRefs').checked = true;
  await fields.get('updateRefs').emit('change');
  assert.equal(fields.get('force').disabled, false);
  fields.get('force').checked = true;
  fields.get('updateRefs').checked = false;
  await fields.get('updateRefs').emit('change');
  assert.equal(fields.get('force').checked, false);
  controller.abort();
  assert.equal(document.body.children.includes(dialog), false);
  assert.equal(workbench.events.some(event => event.method === 'importBundle'), false);
});
