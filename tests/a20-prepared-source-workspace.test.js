import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectSystem, DiskWorkspace, readBrowserFiles, readDirectory, writeWorkspaceSource,
  encodedWorkspaceSourceChunks, isSourceSnapshot} from '@sharpforge/project-system';
import {encodeWorkspaceFile, decodeWorkspaceFile} from '@sharpforge/archive';
import {readStudioSource} from '../apps/studio/workbench/studio-source-reader.js';
import {SlicedFile, sourceFileHandle, sourceDirectory} from './fixtures/a20-source-file-fixture.js';

const limits = {maxFileBytes: 4 * 1024 * 1024, maxAssemblyBytes: 4 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024};
const readOptions = {...limits, readSource: readStudioSource};

test('A20 FileList→DiskWorkspace→ProjectSystem retains prepared descriptors and never reads lazy source text during discovery', async () => {
  const called = [];
  const records = await readBrowserFiles([
    new File(['<Project Sdk="Microsoft.NET.Sdk"/>'], 'App.csproj'),
    new SlicedFile(['class C {}'], 'Program.cs'),
    new File([new Uint8Array([77, 90])], 'asset.dll')
  ], {...limits, async readSource(file, options) {
    called.push(options.path);
    const record = await readStudioSource(file, options);
    Object.defineProperty(record, 'text', {enumerable: true, configurable: true,
      get() { throw new Error('Project discovery must not access lazy text'); }});
    return record;
  }});
  assert.deepEqual(called, ['Program.cs']);
  assert.deepEqual(records[2].bytes, new Uint8Array([77, 90]));
  assert.equal('readSource' in records.limits, false);
  const prepared = records[1];
  assert.equal(isSourceSnapshot(prepared.source), true);
  assert.equal(isSourceSnapshot(prepared.model), false);
  const disk = new DiskWorkspace(records);
  assert.equal(disk.baseline.get('Program.cs'), prepared.source);
  assert.equal(disk.readSource, records.readSource);
  for (const input of [records, new Map(records.map(record => [record.path, record]))]) {
    const system = new ProjectSystem(input);
    const loaded = system.load('App.csproj');
    assert.equal(loaded.diagnostics.filter(item => item.severity === 'error').length, 0);
    const sources = system.compilationFiles('App.csproj');
    assert.deepEqual(sources.map(source => source.uri), ['Program.cs']);
    assert.equal(sources[0].source, prepared.source);
    assert.equal(sources[0].model, prepared.model);
    assert.equal(Object.getOwnPropertyDescriptor(system.files.get('Program.cs'), 'model').enumerable, false);
    assert.equal(Object.getOwnPropertyDescriptor(sources[0], 'source').enumerable, false);
    assert.equal(prepared.source.statistics.textMaterialized, false);
    assert.equal(sources[0].text, 'class C {}');
  }
  prepared.model.dispose();
});

test('A20 failed and cancelled FileList reads dispose their own completed models and publish no partial batch', async () => {
  const created = [];
  const readSource = async (file, options) => {
    const record = await readStudioSource(file, options);
    created.push(record.model);
    return record;
  };
  await assert.rejects(readBrowserFiles([
    new SlicedFile(['class A {}'], 'A.cs'), new SlicedFile([new Uint8Array([0xc3, 0x28])], 'B.cs')
  ], {...limits, readSource}), TypeError);
  assert.equal(created.length, 1);
  assert.throws(() => created[0].applyEdits([{start: 0, end: 0, text: 'bad'}]), /disposed/);
  const controller = new AbortController();
  created.length = 0;
  await assert.rejects(readBrowserFiles([new SlicedFile(['a'], 'A.cs'), new SlicedFile(['second'], 'B.cs')], {
    ...limits, signal: controller.signal,
    async readSource(file, options) {
      const record = await readStudioSource(file, {...options, chunkSize: 2,
        onProgress() { if (options.path === 'B.cs') controller.abort(); }});
      created.push(record.model);
      return record;
    }
  }), {name: 'AbortError'});
  assert.equal(created.length, 1);
  assert.throws(() => created[0].applyEdits([{start: 0, end: 0, text: 'bad'}]), /disposed/);
});

test('A20 failed directory iteration disposes prepared models after traversal loses access', async () => {
  let model;
  const directory = {name: 'Broken directory', async *entries() {
    yield ['A.cs', sourceFileHandle('A.cs', 'class A {}')];
    throw new Error('directory permission lost');
  }};
  await assert.rejects(readDirectory(directory, {...limits, async readSource(file, options) {
    const prepared = await readStudioSource(file, options);
    model = prepared.model;
    return prepared;
  }}), /directory permission lost/);
  assert.throws(() => model.applyEdits([{start: 0, end: 0, text: 'bad'}]), /disposed/);
});

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
  test(`A20 prepared ${encoding} source saves captured snapshots in chunks, preserving BOM, pairs and disk versions`, async () => {
    const original = 'x'.repeat(65_535) + '😀\r\nend';
    const handle = sourceFileHandle('Program.cs', encodeWorkspaceFile({path: 'Program.cs', text: original, encoding, bom: true}));
    const disk = await readDirectory(sourceDirectory({'Program.cs': handle}), readOptions);
    const record = disk.records[0];
    const model = record.model;
    const originalSource = record.source;
    assert.equal(disk.baseline.get('Program.cs'), originalSource);
    model.applyEdits([{start: model.length, end: model.length, text: '!'}]);
    const saved = model.snapshot();
    const expectedVersion = disk.getVersion('Program.cs');
    const saving = disk.save([{path: 'Program.cs', source: saved, expectedVersion}]);
    model.applyEdits([{start: model.length, end: model.length, text: 'later'}]);
    assert.deepEqual(await saving, {written: ['Program.cs'], atomic: false});
    assert.deepEqual(handle.bytes, encodeWorkspaceFile({path: 'Program.cs', text: original + '!', encoding, bom: true}));
    assert.equal(disk.baseline.get('Program.cs'), saved);
    assert.equal(record.source, saved);
    assert.equal(originalSource.statistics.textMaterialized, false);
    assert.equal(saved.statistics.textMaterialized, false);
    assert.equal(model.getText(model.length - 5, model.length), 'later');
    assert.equal(disk.getVersion('Program.cs'), expectedVersion + 1);
    assert(handle.metrics.chunks >= 2);
    assert(handle.metrics.maximumChunkBytes <= 2 * 65_537 + 3);
    assert(handle.reads.every(read => read.end - read.start <= 256 * 1024));
    await assert.rejects(disk.save([{path: 'Program.cs', source: saved, expectedVersion}]), /version conflict/);
    assert.equal(handle.metrics.written, 1);
    model.dispose();
  });
}

test('A20 snapshot saves enforce encoded byte limits before write permission or stream creation', async () => {
  const handle = sourceFileHandle('A.cs', 'a');
  const disk = await readDirectory(sourceDirectory({'A.cs': handle}), {
    maxFileBytes: 10, maxAssemblyBytes: 10, maxTotalBytes: 10, readSource: readStudioSource
  });
  const model = disk.records[0].model;
  model.applyEdits([{start: 0, end: 1, text: 'é'.repeat(6)}]);
  await assert.rejects(disk.save([{path: 'A.cs', source: model.snapshot()}]), /Source file limit/);
  await assert.rejects(disk.save([{path: 'A.cs', source: {length: 1, getText: () => 'a'}}]), /immutable source snapshot/);
  assert.equal(handle.metrics.opened, 0);
  model.dispose();
});

test('A20 prepared baseline checks detect permission-time external changes before any stream opens', async () => {
  const handle = sourceFileHandle('A.cs', 'original', {permission(file) {
    file.setExternal('external');
    return 'granted';
  }});
  const disk = await readDirectory(sourceDirectory({'A.cs': handle}), readOptions);
  const model = disk.records[0].model;
  model.applyEdits([{start: 0, end: model.length, text: 'next'}]);
  await assert.rejects(disk.save([{path: 'A.cs', source: model.snapshot()}]), /Disk conflict/);
  assert.equal(handle.metrics.opened, 0);
  model.dispose();
});

test('A20 prepared save I/O failure aborts its stream and retains the prior baseline and disk version', async () => {
  const handle = sourceFileHandle('A.cs', 'original', {failWrite: true});
  const disk = await readDirectory(sourceDirectory({'A.cs': handle}), readOptions);
  const record = disk.records[0];
  const baseline = record.source;
  const version = disk.getVersion('A.cs');
  record.model.applyEdits([{start: 0, end: 0, text: 'edited'}]);
  await assert.rejects(disk.save([{path: 'A.cs', source: record.model.snapshot()}]), error => {
    assert.deepEqual(error.written, []);
    return /write unavailable/.test(error.message);
  });
  assert.equal(handle.metrics.aborted, 1);
  assert.equal(disk.baseline.get('A.cs'), baseline);
  assert.equal(disk.getVersion('A.cs'), version);
  assert.equal(decodeWorkspaceFile('A.cs', handle.bytes).text, 'original');
  record.model.dispose();
});

test('A20 invalid source reader records are rejected and cleaned up without a lazy text read', async () => {
  let model;
  await assert.rejects(readBrowserFiles([new SlicedFile(['a'], 'A.cs')], {...limits,
    async readSource(file, options) {
      const record = await readStudioSource(file, options);
      model = record.model;
      record.byteLength++;
      return record;
    }
  }), /invalid prepared document/);
  assert.throws(() => model.applyEdits([{start: 0, end: 0, text: 'bad'}]), /disposed/);
  await assert.rejects(readBrowserFiles([], {readSource: true}), /Invalid source reader/);
});

test('A20 default binary-source handling remains intact while explicit reader limits reject before slicing', async () => {
  const bytes = new Uint8Array(2_000_001);
  const records = await readBrowserFiles([new File([bytes], 'Binary.cs')]);
  assert.equal(records[0].bytes.length, bytes.length);
  assert.equal(records[0].text, undefined);
  const guarded = new SlicedFile([bytes], 'Binary.cs');
  await assert.rejects(readBrowserFiles([guarded], {readSource: readStudioSource}), /Source file limit/);
  assert.equal(guarded.reads.length, 0);
});

test('A20 public source encoding shares exact BOM/byte bounds and leaves stream commit ownership with the caller', async () => {
  const chunks = [];
  for await (const bytes of encodedWorkspaceSourceChunks('😀', {encoding: 'utf-16be', bom: true})) chunks.push(bytes);
  assert.deepEqual(new Uint8Array(await new Blob(chunks).arrayBuffer()),
    encodeWorkspaceFile({path: 'Program.cs', text: '😀', encoding: 'utf-16be', bom: true}));
  let writes = 0;
  const stream = {async write() { writes++; }, async close() { throw new Error('caller owns close'); }};
  await assert.rejects(writeWorkspaceSource(stream, 'é', {maxBytes: 1}), /byte limit/);
  assert.equal(writes, 0);
  const controller = new AbortController();
  await assert.rejects(writeWorkspaceSource({async write() { writes++; controller.abort(); }}, 'a'.repeat(70_000), {
    signal: controller.signal
  }), {name: 'AbortError'});
  assert.equal(writes, 1);
  await writeWorkspaceSource(stream, '', {bom: true});
  assert.equal(writes, 2);
});
