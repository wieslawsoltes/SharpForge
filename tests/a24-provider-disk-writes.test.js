import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderDirectory as readDirectory} from '@sharpforge/project-system';
import {encodeWorkspaceFile} from '@sharpforge/archive';
import {TestDirectoryHandle} from './support/a24-fsa.js';

const text = value => new TextDecoder().decode(value);

test('A24 B04 create/save persists new and formerly binary files using configured encoded-byte budget', async () => {
  const root = new TestDirectoryHandle();
  await root.put('binary.cs', Uint8Array.of(0, 255, 0));
  const disk = await readDirectory(root, {maxFileBytes: 3_000_000});
  const source = 'x'.repeat(2_000_001);
  await disk.save([{path: 'New.cs', text: source}, {path: 'binary.cs', text: 'now text'}]);
  assert.equal(text(root.children.get('New.cs').bytes), source);
  assert.equal(text(root.children.get('binary.cs').bytes), 'now text');
  const before = root.children.get('New.cs').writes;
  await assert.rejects(disk.save([{path: 'New.cs', text: '😀'.repeat(800000)}]), error => error.code === 'FileTooLarge');
  assert.equal(root.children.get('New.cs').writes, before);
});

test('A24 disk save detects byte changes even when decoded text is identical', async () => {
  const root = new TestDirectoryHandle();
  const original = encodeWorkspaceFile({text: 'same\n', bom: true, encoding: 'utf-8'});
  const handle = await root.put('A.cs', original);
  const disk = await readDirectory(root);
  handle.bytes = encodeWorkspaceFile({text: 'same\n', bom: false, encoding: 'utf-8'});
  await assert.rejects(disk.save([{path: 'A.cs', text: 'changed\n'}]), error => error.code === 'Conflict');
  assert.equal(handle.writes, 0);
});

test('A24 XML and binary saves retain byte baselines and unloading releases retained text', async () => {
  const root = new TestDirectoryHandle();
  const xml = await root.put('Resources.resx', '<root/>');
  const binary = await root.put('asset.bin', Uint8Array.of(0, 1, 255));
  const disk = await readDirectory(root);
  const saved = [];
  const unsubscribe = disk.subscribeSaves(value => saved.push(value));
  await disk.save([{path: 'Resources.resx', text: '<root><data name="x"/></root>'}, {path: 'asset.bin', bytes: Uint8Array.of(0, 254)}]);
  assert.equal(text(xml.bytes), '<root><data name="x"/></root>');
  assert.deepEqual(binary.bytes, Uint8Array.of(0, 254));
  assert.equal(saved.length, 2);
  assert.equal(disk.loadedBytes, xml.bytes.length + binary.bytes.length);
  assert.match(disk.baselineHashes.get('asset.bin'), /^[0-9a-f]{64}$/);
  const baseline = disk.baselineHashes.get('Resources.resx');
  disk.unload('Resources.resx');
  assert.equal(disk.baseline.has('Resources.resx'), false);
  assert.equal(disk.baselineHashes.get('Resources.resx'), baseline);
  assert.equal(disk.loadedBytes, binary.bytes.length);
  binary.bytes = Uint8Array.of(0, 2, 254);
  await assert.rejects(disk.save([{path: 'asset.bin', bytes: Uint8Array.of(0)}]), error => error.code === 'Conflict');
  unsubscribe();
});

test('A24 case-insensitive directory aliases preserve canonical record paths through rename and delete', async () => {
  const root = new TestDirectoryHandle();
  await root.put('Src/Program.CS', 'class C{}');
  const disk = await readDirectory(root, {caseSensitive: false});
  assert.equal(disk.record('src/program.cs').path, 'Src/Program.CS');
  await disk.create('src/New.cs', 'class N{}');
  assert.equal(disk.record('src/new.cs').path, 'Src/New.cs');
  await disk.rename('src', 'Renamed');
  assert.equal(disk.record('renamed/program.cs').path, 'Renamed/Program.CS');
  assert.equal(disk.record('renamed/new.cs').path, 'Renamed/New.cs');
  await disk.delete('RENAMED', {recursive: true});
  assert.equal(disk.records.length, 0);
  assert.equal(disk.loadedBytes, 0);
  assert.equal(disk.baselineHashes.size, 0);
});

test('A24 browser save requires physical-directory coordination before any write and enforces total loaded bytes', async () => {
  const root = new TestDirectoryHandle();
  const handle = await root.put('a.cs', 'aaaa');
  const disk = await readDirectory(root, {maxTotalBytes: 6, requireSaveLock: true});
  await assert.rejects(disk.save([{path: 'a.cs', text: 'bb'}]), error => error.code === 'Unavailable');
  assert.equal(handle.writes, 0);
  let resolves = 0;
  disk.resolveSaveLocks = async () => { resolves++; return {guardedSave: ({write}) => write()}; };
  await disk.save([{path: 'a.cs', text: 'bb'}]);
  assert.equal(resolves, 1);
  assert.equal(disk.loadedBytes, 2);
  await assert.rejects(disk.save([{path: 'b.cs', text: '12345'}]), error => error.code === 'QuotaExceeded');
  assert(!root.children.has('b.cs'));
});

test('A24 directory operations rename every byte and deny a complete save batch before first write', async () => {
  const root = new TestDirectoryHandle();
  const first = await root.put('A.txt', 'first');
  const second = await root.put('B.txt', 'second');
  const disk = await readDirectory(root);
  second.options.permission = {read: 'granted', readwrite: 'denied'};
  await assert.rejects(disk.save([{path: 'A.txt', text: 'updated'}, {path: 'B.txt', text: 'updated'}]), /permission denied/);
  assert.equal(first.writes, 0);
  assert.equal(second.writes, 0);
  second.options.permission = 'granted';
  const binary = Uint8Array.of(0, 255, 3, 0, 9);
  await disk.create('asset.bin', binary);
  await disk.rename('asset.bin', 'renamed.bin');
  assert.deepEqual(root.children.get('renamed.bin').bytes, binary);
  assert(!root.children.has('asset.bin'));
  assert.equal(disk.record('renamed.bin').path, 'renamed.bin');
  await disk.delete('renamed.bin');
  assert(!disk.record('renamed.bin'));
});
