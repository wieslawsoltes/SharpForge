import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightDestination, writeNewDirectory } from '@sharpforge/project-system';
import { chooseWizardDirectory, commitWizardDirectory } from '../apps/studio/project-wizard/destination.js';
import { TestDirectory } from './helpers/a24-directory.js';
import { encodeWorkspaceFile } from '@sharpforge/archive';

const plan = { records: [{ path: 'App/A.cs', text: 'first' }, { path: 'App/B.cs', text: 'second' }], folders: ['Empty'] };

test('The legacy destination default rejects unrelated contents; merge must be explicit', async () => {
  const root = new TestDirectory();
  await root.getDirectoryHandle('Existing', { create: true });
  await assert.rejects(() => writeNewDirectory(root, plan), /empty destination/);
  await assert.rejects(() => writeNewDirectory(root, plan, { overwritePaths: ['App/A.cs'] }), /explicit merge/);
  await assert.rejects(() => writeNewDirectory(root, plan, { mode: 'unknown' }), /Invalid destination mode/);
  assert.equal(root.state.writes, 0);
  assert.deepEqual([...root.children.keys()], ['Existing']);
  const result = await writeNewDirectory(root, plan, { mode: 'merge' });
  assert.deepEqual(result.written, ['App/A.cs', 'App/B.cs']);
  assert(root.children.has('Existing'));
});

test('The legacy destination default keeps completed files and partial-failure metadata even when removal is available', async () => {
  const root = new TestDirectory();
  root.state.failAt = 2;
  await assert.rejects(() => writeNewDirectory(root, plan), error => {
    assert.deepEqual(error.written, ['App/A.cs']);
    assert.match(error.message, /1 file\(s\) written before failure/);
    assert.equal(error.rolledBack, false);
    assert.equal(error.atomic, false);
    assert.equal(error.code, 'SFDST007');
    return true;
  });
  const app = await root.getDirectoryHandle('App');
  assert.equal(new TextDecoder().decode((await app.getFileHandle('A.cs')).bytes), 'first');
});

test('Destination preflight checks collisions and exact overwrite confirmation before writes', async () => {
  const root = new TestDirectory();
  const app = await root.getDirectoryHandle('App', { create: true });
  const old = await app.getFileHandle('A.cs', { create: true });
  old.bytes = new TextEncoder().encode('original');
  const checked = await preflightDestination(root, plan);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.conflicts.map(item => item.path), ['App/A.cs']);
  assert.equal(root.state.writes, 0);
  await assert.rejects(() => writeNewDirectory(root, plan), error => error.code === 'SFDST005');
  const result = await writeNewDirectory(root, plan, { mode: 'merge', overwritePaths: ['App/A.cs'] });
  assert.equal(result.written.length, 2);
  assert.equal(new TextDecoder().decode(old.bytes), 'first');
});

test('Destination denial, quota limits, parent type and case collisions never create directories', async () => {
  const denied = new TestDirectory();
  denied.state.permissions = 'denied';
  await assert.rejects(() => writeNewDirectory(denied, plan), /permission denied/);
  assert.equal(denied.children.size, 0);
  const root = new TestDirectory();
  await assert.rejects(() => preflightDestination(root, plan, { availableBytes: 1 }), /quota/);
  assert.equal(root.children.size, 0);
  await root.getDirectoryHandle('APP', { create: true });
  const checked = await preflightDestination(root, plan);
  assert(checked.conflicts.some(item => item.kind === 'case-collision'));
  await assert.rejects(() => writeNewDirectory(root, plan, { mode: 'merge', overwritePaths: ['App'] }), /conflicts/);
});

test('Destination rollback removes created files/directories and restores overwritten binary bytes', async () => {
  const root = new TestDirectory();
  const app = await root.getDirectoryHandle('App', { create: true });
  const old = await app.getFileHandle('A.cs', { create: true });
  old.bytes = Uint8Array.from([255, 0, 128, 20]);
  root.state.failAt = 2;
  await assert.rejects(() => writeNewDirectory(root, plan, { mode: 'merge', overwritePaths: ['App/A.cs'] }), error => {
    assert.equal(error.rolledBack, true);
    assert.deepEqual(error.leftovers, []);
    return true;
  });
  assert.deepEqual(old.bytes, Uint8Array.from([255, 0, 128, 20]));
  assert.equal(app.children.has('B.cs'), false);
  assert.equal(root.children.has('Empty'), false);
});

test('Destination rollback failures list precise leftover paths', async () => {
  const root = new TestDirectory();
  root.state.failAt = 2;
  root.state.removeFailures.add('A.cs');
  await assert.rejects(() => writeNewDirectory(root, plan, { mode: 'merge' }), error => {
    assert.equal(error.rolledBack, false);
    assert(error.leftovers.some(item => item.path === 'App/A.cs'));
    return true;
  });
});

test('Destination picker cancellation leaves no selected handle; declined overwrite performs no write', async () => {
  const selected = await chooseWizardDirectory({ picker: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
  assert.equal(selected.cancelled, true);
  assert.equal(selected.handle, null);
  const root = new TestDirectory();
  const app = await root.getDirectoryHandle('App', { create: true });
  await app.getFileHandle('A.cs', { create: true });
  const result = await commitWizardDirectory(root, plan, { confirmOverwrite: () => false });
  assert.equal(result.cancelled, true);
  assert.equal(root.state.writes, 0);
});

test('Destination cancellation after the first file rolls everything back', async () => {
  const root = new TestDirectory();
  const controller = new AbortController();
  await assert.rejects(() => writeNewDirectory(root, plan, { mode: 'merge', signal: controller.signal,
    onProgress: () => controller.abort() }), error => error.name === 'AbortError' && error.rolledBack);
  assert.equal(root.children.size, 0);
});

test('Destination expected-text precondition respects UTF-16 encodings before confirmed overwrite', async () => {
  const root = new TestDirectory();
  const existing = await root.getFileHandle('Program.cs', { create: true });
  existing.bytes = encodeWorkspaceFile({ path: 'Program.cs', text: 'original', encoding: 'utf-16be', bom: true });
  const plan = { records: [], modifications: [{ path: 'Program.cs', expectedText: 'original', text: 'updated' }] };
  await writeNewDirectory(root, plan, { mode: 'merge', overwritePaths: ['Program.cs'] });
  assert.equal(new TextDecoder().decode(existing.bytes), 'updated');
});

test('Destination preflight rejects ambiguous existing aliases and bounds plan metadata', async () => {
  const root = new TestDirectory();
  await root.getFileHandle('File.cs', { create: true });
  await root.getFileHandle('file.cs', { create: true });
  const plan = { records: [{ path: 'File.cs', text: 'new' }] };
  const checked = await preflightDestination(root, plan);
  assert.equal(checked.conflicts[0].kind, 'case-collision');
  await assert.rejects(() => writeNewDirectory(root, plan, { mode: 'merge', overwritePaths: ['File.cs'] }), /conflicts/);
  await assert.rejects(() => preflightDestination(new TestDirectory(), { records: [], folders: ['one/two'] }, { maxEntries: 1 }), /budget/);
  await assert.rejects(() => preflightDestination(root, plan, { maxEntries: -1 }), /Invalid destination limit/);
});
