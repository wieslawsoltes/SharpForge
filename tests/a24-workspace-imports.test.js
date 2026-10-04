import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWorkspaceFile} from '@sharpforge/project-system';
import {importWorkspaceFileList} from '../apps/studio/workspace-imports.js';
import {application} from './support/workspace-application.js';

function hostFor(app) {
  return {state: app.state, load: (...args) => app.session.load(...args), openZip() {}, loadBundle: async () => false,
    assemble: async () => { throw new Error('Invalid IL'); }, openAssembly() {}, inspectAssembly() {}, importAssembly() {}};
}

test('the ordinary file picker imports more than 100 source files plus exact binary and UTF-16 content', async () => {
  const app = application();
  const files = Array.from({length: 150}, (_, index) => new File(['class C' + index + ' {}'], 'C' + index + '.cs'));
  const utf16 = Uint8Array.of(255, 254, 47, 0, 47, 0, 32, 0, 65, 0, 13, 0, 10, 0);
  const binary = Uint8Array.of(0, 255, 128, 0);
  files.push(new File([utf16], 'Wide.cs'), new File([binary], 'asset.bin'));
  await importWorkspaceFileList(hostFor(app), files);
  assert.equal(app.state.files.length, 151);
  const records = new Map(app.host.context().records.map(record => [record.path, record]));
  assert.equal(records.size, 152);
  assert.deepEqual(encodeWorkspaceFile(records.get('Wide.cs')), utf16);
  assert.deepEqual(encodeWorkspaceFile(records.get('asset.bin')), binary);
  assert.equal(app.state.disk.handles.size, 0, 'file-picker records never invent writable folder grants');
});

test('legacy JSON source projects use workspace budgets and reject malformed replacements without retiring the old model', async () => {
  const app = application();
  const host = hostFor(app);
  const files = Array.from({length: 120}, (_, index) => ({uri: 'C' + index + '.cs', text: 'class C' + index + ' {}'}));
  await importWorkspaceFileList(host, [new File([JSON.stringify({format: 'sharpforge-project', version: 1, files,
    extraFiles: [{path: 'notes.txt', text: 'retained'}], folders: ['Empty'], name: 'Legacy'})], 'Legacy.json')]);
  assert.equal(app.state.files.length, 120);
  assert.equal(app.state.extraFiles[0].text, 'retained');
  assert.deepEqual(app.state.folders, ['Empty']);
  const original = app.state.files;
  await assert.rejects(importWorkspaceFileList(host, [new File([JSON.stringify({format: 'sharpforge-project', version: 1,
    files: [{uri: 'Good.cs', text: 'class Good {}'}, {uri: '../Bad.cs', text: ''}]})], 'Broken.json')]), /path|travers/i);
  assert.equal(app.state.files, original);
  await assert.rejects(importWorkspaceFileList(host, [new File(['invalid IL'], 'Broken.il')]), /Invalid IL/);
  assert.equal(app.state.files, original);
});

test('file-picker import retains the skipped-name report for Explorer and rejects oversized membership before reading', async () => {
  const app = application();
  const host = hostFor(app);
  await importWorkspaceFileList(host, [new File(['class Valid {}'], 'Valid.cs'), new File([''], 'bad?.cs')]);
  assert.ok(app.state.disk.importReport.outcomes.some(item => item.path === 'bad?.cs'));
  assert.equal(app.state.files.length, 1);
  const original = app.state.files;
  const unread = {name: 'A.cs', arrayBuffer: () => { throw new Error('Must not read'); }};
  await assert.rejects(importWorkspaceFileList(host, Array(20001).fill(unread)), /file limit/);
  assert.equal(app.state.files, original);
});

test('an imported native inspection and a v1 byte bundle use their existing explicit host contracts', async () => {
  const app = application();
  const host = hostFor(app);
  app.state.nativeMode = true;
  const calls = [];
  host.inspectAssembly = (bytes, name) => calls.push({bytes, name});
  host.loadBundle = async (_file, data) => { calls.push(data); return true; };
  await importWorkspaceFileList(host, [new File([Uint8Array.of(77, 90)], 'Inspect.dll')]);
  const data = {format: 'sharpforge-project', version: 1, diskRecords: [{path: 'A.cs', text: 'class A {}'}]};
  await importWorkspaceFileList(host, [new File([JSON.stringify(data)], 'Saved.sharpforge.json')]);
  assert.deepEqual(calls, [{bytes: Uint8Array.of(77, 90), name: 'Inspect.dll'}, data]);
});
