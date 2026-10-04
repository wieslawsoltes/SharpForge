import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeWorkspaceFile} from '@sharpforge/project-system';
import {readZip} from '@sharpforge/archive';
import {exportWorkspaceToWritable} from '../apps/studio/workspace-export.js';
import {createLegacyWorkspaceBundle} from '../apps/studio/workspace-bundle.js';
import {directoryFiles} from './support/workspace-application.js';

test('streaming ZIP export reads one lazy file at a time and aborts its sink after a stale workspace decision', async () => {
  const {disk} = await directoryFiles([['one.bin', Uint8Array.of(1, 2)], ['two.bin', Uint8Array.of(3, 4)]], {lazy: true});
  const context = {records: disk.records, folders: disk.folders, disk, provider: disk.provider, settings: {mode: 'folder'}};
  const chunks = [];
  let closed = false;
  await exportWorkspaceToWritable(context, {write: value => chunks.push(value.slice()), close: () => { closed = true; }});
  assert.equal(closed, true);
  assert.equal(disk.loadedBytes, 0, 'streaming reads never populate the retained editor cache');
  const zip = new Uint8Array(chunks.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const chunk of chunks) { zip.set(chunk, offset); offset += chunk.length; }
  assert.deepEqual(readZip(zip).find(entry => entry.path === 'two.bin').bytes, Uint8Array.of(3, 4));
  let aborted = false;
  await assert.rejects(exportWorkspaceToWritable(context, {write() {}, abort() { aborted = true; }}, {isCurrent: () => false}),
    /Workspace changed/);
  assert.equal(aborted, true);
});

test('JSON interchange includes hydrated folder files and preserves UTF-16 bytes with edited source text', () => {
  const source = decodeWorkspaceFile('Source.cs', Uint8Array.of(255, 254, 65, 0, 13, 0, 10, 0));
  source.text = 'B\r\n';
  const binary = {path: 'Data.bin', bytes: Uint8Array.of(0, 128, 255)};
  const value = JSON.parse(createLegacyWorkspaceBundle({records: [source, binary], folders: ['Empty'],
    settings: {name: 'Folder', mode: 'folder', active: 'Source.cs'}}));
  assert.equal(value.mode, 'folder');
  assert.deepEqual(value.files, [{uri: 'Source.cs', text: 'B\r\n'}]);
  assert.deepEqual(value.folders, ['Empty']);
  const decoded = value.diskRecords.map(record => Uint8Array.from(atob(record.base64), character => character.charCodeAt(0)));
  assert.deepEqual(decoded, [Uint8Array.of(255, 254, 66, 0, 13, 0, 10, 0), binary.bytes]);
  assert.throws(() => createLegacyWorkspaceBundle({records: [{path: 'Unread.cs', lazy: true, size: 12}]}),
    /must be loaded/, 'unopened files are never exported as empty strings');
});
