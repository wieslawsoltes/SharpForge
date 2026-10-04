import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderDirectory as readDirectory, WorkspaceImportReport, GitIgnoreMatcher, PathPolicy} from '@sharpforge/project-system';
import {encodeWorkspaceFile} from '@sharpforge/archive';
import {TestDirectoryHandle, TestFileHandle} from './support/a24-fsa.js';

const text = value => new TextDecoder().decode(value);

test('A24 B03 folder open reports oversized and reserved paths without aborting usable files', async () => {
  const root = new TestDirectoryHandle();
  await root.put('Program.cs', 'class Program {}');
  await root.put('con.txt', 'reserved');
  await root.put('large.bin', new Uint8Array(200));
  const disk = await readDirectory(root, {maxFileBytes: 100});
  assert.equal(disk.records.length, 1);
  assert.equal(disk.records[0].path, 'Program.cs');
  assert(disk.skipped.some(outcome => outcome.path === 'large.bin' && outcome.reason === 'file-too-large'));
  assert(disk.skipped.some(outcome => outcome.path === 'con.txt' && outcome.reason === 'non-portable-path'));
  assert.equal(root.children.get('large.bin').reads, 0);
});

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

test('A24 coherent disk snapshot adoption rebuilds indexes without advancing retained hashes or admitting invalid partial state', async () => {
  const root = new TestDirectoryHandle();
  await root.put('A.cs', 'first');
  await root.put('B.cs', 'second');
  const disk = await readDirectory(root);
  const original = disk.baselineHashes.get('A.cs');
  disk.adoptRecords([{path: 'A.cs', text: 'changed'}, {path: 'new.cs', size: 10, lazy: true}],
    {folders: ['Empty'], report: {outcomes: [{path: 'con.txt', reason: 'non-portable-path'}]}});
  assert.equal(disk.record('a.cs').text, 'changed');
  assert.equal(disk.positions.get('a.cs'), 0);
  assert.equal(disk.baselineHashes.get('A.cs'), original);
  assert.equal(disk.baselineHashes.has('B.cs'), false);
  assert.equal(disk.loadedBytes, 7);
  assert.equal(disk.canonicalPath('empty/New.cs'), 'Empty/New.cs');
  const before = disk.records;
  assert.throws(() => disk.adoptRecords([{path: 'A.cs', lazy: true}, {path: 'a.cs', lazy: true}]), error => error.code === 'AlreadyExists');
  assert.equal(disk.records, before);
  assert.throws(() => disk.adoptRecords([{path: 'A.cs', text: 'unbudgeted', lazy: true}]), /cannot retain contents/);
  assert.equal(disk.records, before);
  assert.equal(disk.skipped[0].path, 'con.txt');
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

test('A24 20000-file scan reads project bytes only; content is loaded explicitly and scan cancellation is atomic', async () => {
  const root = new TestDirectoryHandle();
  for (let index = 0; index < 19999; index++) {
    const name = `Source${index}.cs`;
    root.children.set(name, new TestFileHandle(name, 'class C' + index + '{}'));
  }
  const project = await root.put('App.csproj', '<Project Sdk="Microsoft.NET.Sdk"/>');
  const disk = await readDirectory(root);
  assert.equal(disk.records.length, 20000);
  assert.equal(disk.lazy, true);
  assert.equal(disk.records.filter(record => record.lazy).length, 19999);
  assert.equal(project.reads, 1);
  assert.equal([...root.children.values()].reduce((count, handle) => count + handle.reads, 0), 1);
  const loaded = await disk.load('Source10.cs');
  assert.equal(loaded.text, 'class C10{}');
  assert.equal(loaded.lazy, false);
  assert.equal([...root.children.values()].reduce((count, handle) => count + handle.reads, 0), 2);
  const controller = new AbortController();
  await assert.rejects(readDirectory(root, {signal: controller.signal, onProgress() { controller.abort(); }}), error => error.name === 'AbortError');
  assert.equal(disk.records.length, 20000);
});

test('A24 NFC/NFD/case collisions and gitignore decisions are individually visible', async () => {
  const report = new WorkspaceImportReport();
  assert.equal(report.admit('Program.CS'), 'Program.CS');
  assert.equal(report.admit('program.cs'), null);
  assert.equal(report.admit('é.cs'), 'é.cs');
  assert.equal(report.admit('e\u0301.cs'), null);
  assert.equal(report.skipped.length, 2);
  const ignored = new GitIgnoreMatcher('bin/\n*.tmp\n!keep.tmp\n/root.txt\n**/obj/**\n');
  assert.equal(ignored.ignored('bin/a.dll'), true);
  assert.equal(ignored.ignored('nested/a.tmp'), true);
  assert.equal(ignored.ignored('keep.tmp'), false);
  assert.equal(ignored.ignored('root.txt'), true);
  assert.equal(ignored.ignored('nested/root.txt'), false);
  assert.equal(ignored.ignored('a/obj/b.txt'), true);
  const root = new TestDirectoryHandle();
  await root.put('.gitignore', '*.tmp\n');
  await root.put('ignored.tmp', 'skip');
  await root.put('keep.cs', 'keep');
  const disk = await readDirectory(root, {applyGitignore: true});
  assert(!disk.record('ignored.tmp'));
  assert(disk.skipped.some(outcome => outcome.reason === 'gitignore'));
  assert.equal(new PathPolicy({caseSensitive: false}).equals('Program.CS', 'program.cs'), true);
});

test('A24 nested ignore rules support ranges, escaped literals and directory-only matches', async () => {
  const ignored = new GitIgnoreMatcher('cache/\n[ab]?.tmp\n\\#literal\n');
  assert.equal(ignored.ignored('a/cache', false), false);
  assert.equal(ignored.ignored('a/cache/file.cs', false), true);
  assert.equal(ignored.ignored('a1.tmp'), true);
  assert.equal(ignored.ignored('c1.tmp'), false);
  assert.equal(ignored.ignored('#literal'), true);
  const root = new TestDirectoryHandle();
  await root.put('.gitignore', '*.tmp\n');
  await root.put('src/.gitignore', '!keep.tmp\ncache/\n');
  await root.put('src/keep.tmp', 'kept');
  await root.put('src/rejected.tmp', 'skipped');
  await root.put('elsewhere/keep.tmp', 'skipped');
  await root.put('src/cache/item.cs', 'skipped');
  const disk = await readDirectory(root, {applyGitignore: true});
  assert(disk.record('src/keep.tmp'));
  assert(!disk.record('src/rejected.tmp'));
  assert(!disk.record('elsewhere/keep.tmp'));
  assert(!disk.record('src/cache/item.cs'));
  assert(disk.importReport.outcomes.some(outcome => outcome.path === 'src/cache' && outcome.reason === 'gitignore'));
});
