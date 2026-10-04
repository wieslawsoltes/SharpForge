import test from 'node:test';
import assert from 'node:assert/strict';
import { DiskWorkspace } from '@sharpforge/project-system';
import { importStudioFiles } from '../apps/studio/workbench/studio-file-import.js';
import { loadStudioSample, importStudioAssembly } from '../apps/studio/workbench/studio-built-in-workspace.js';
import { createStudioMetadataReader } from '../apps/studio/workbench/studio-metadata-reference.js';
import { loadStudioWorkspace } from '../apps/studio/workbench/studio-workspace-loader.js';
import { createStudioRecords } from '../apps/studio/workbench/workspace-records.js';
import { metadataLimits } from '../apps/studio/workbench/metadata/limits.js';
import { studioLoaderFixture } from './support/studio-loader-fixture.js';
import { compileResult, deferred } from './a19-session-fixtures.js';

function fixture(t) {
  const root = studioLoaderFixture(t);
  const tickets = [];
  const history = [];
  const built = [];
  const samples = [{ id: 'review', name: 'Review Workspace', files: [{ uri: 'Sample.cs', text: 'class Sample {}' }],
    compilationOptions: { langVersion: '14' }, debug: { breakpoints: { 'Sample.cs': [{ line: 1 }] }, watches: ['sample'] } }];
  root.state.watchResults = new Map([['old', 'old result']]);
  root.state.watches = ['old'];
  const withLoad = async (action, options = {}) => {
    const load = options.load ?? root.context.workspaceLoads.begin({
      state: root.state, documents: root.services.documents, signal: options.signal
    });
    if (!options.load) tickets.push(load);
    try { load.check(); return await action(load); }
    finally { if (!options.load) load.finish(); }
  };
  const loadRecords = (records, options = {}) => loadStudioWorkspace(records, { ...options, updateOnly: true }, root.context);
  const builtins = {
    ...root.context, builds: root.services.builds, withLoad, samples,
    compiler: () => { throw new Error('No compiler response configured for this test'); },
    openAssembly: async () => true, recent: () => ({ remember: value => history.push(value) }),
    build: async silent => { built.push(silent); return true; }, formatBytes: bytes => String(bytes)
  };
  const imports = {
    state: root.state, withLoad, loadRecords,
    workspaceSettings: () => ({ name: root.state.name, mode: root.state.workspaceMode,
      active: root.state.active, tabs: [...root.state.tabs] }),
    records: () => createStudioRecords({ state: root.state, documents: root.services.documents }),
    compiler: builtins.compiler,
    openDecompiler: async () => true, openAssembly: builtins.openAssembly,
    importAssembly: (bytes, options) => importStudioAssembly(bytes, options, builtins)
  };
  return { ...root, tickets, history, built, samples, builtins, imports, loadRecords };
}

class DelayedTextFile extends File {
  constructor(parts, name, gate, entered) {
    super(parts, name, { type: 'application/json' });
    this.gate = gate;
    this.entered = entered;
  }

  async text() {
    this.entered.resolve();
    await this.gate.promise;
    return super.text();
  }
}

test('a cancelled late JSON file read cannot acquire a newer ticket or replace the succeeding workspace', async t => {
  const current = fixture(t);
  const gate = deferred();
  const entered = deferred();
  const old = { format: 'sharpforge-project', version: 1, name: 'Obsolete', files: [{ uri: 'Obsolete.cs', text: '// obsolete' }] };
  const file = new DelayedTextFile([JSON.stringify(old)], 'old.json', gate, entered);
  const loading = importStudioFiles([file], {}, current.imports);
  const rejected = assert.rejects(loading, { name: 'AbortError' });
  await entered.promise;
  await current.loadRecords([{ path: 'New.cs', text: '// new source' }], { name: 'New workspace' });
  gate.resolve();
  await rejected;
  assert.equal(current.tickets.length, 1);
  assert.equal(current.tickets[0].signal.aborted, true);
  assert.equal(current.state.name, 'New workspace');
  assert.deepEqual(current.services.documents.list().map(record => record.uri), ['New.cs']);
  assert.equal(current.services.documents.require('New.cs').text, '// new source');
});

test('bundle import retains source overrides, encoding/BOM, folders and zero-length binary entries', async t => {
  const current = fixture(t);
  const bundle = {
    format: 'sharpforge-project', version: 1, name: 'Imported bundle', mode: 'folder',
    active: 'Program.cs', tabs: ['Program.cs'], folders: ['Empty', 'Content'],
    diskRecords: [
      { path: 'Program.cs', text: '// disk baseline', encoding: 'utf-16le', bom: true },
      { path: 'Content/empty.bin', base64: '' },
      { path: 'Content/bytes.bin', base64: 'AP8B' }
    ],
    files: [{ uri: 'Program.cs', text: '// captured unsaved override\r\n', version: 9, encoding: 'utf-16le', bom: true }]
  };
  const result = await importStudioFiles([new File([JSON.stringify(bundle)], 'project.sharpforge.json')], {}, current.imports);
  assert.equal(result, true);
  assert.equal(current.services.documents.require('Program.cs').text, '// captured unsaved override\r\n');
  assert.equal(current.services.documents.require('Program.cs').version, 9);
  assert.equal(current.services.documents.require('Program.cs').encoding, 'utf-16le');
  assert.equal(current.services.documents.require('Program.cs').bom, true);
  assert.equal(current.state.disk.byPath.get('Program.cs').text, '// captured unsaved override\r\n');
  assert.deepEqual(current.state.disk.byPath.get('Content/empty.bin').bytes, new Uint8Array());
  assert.deepEqual(current.state.disk.byPath.get('Content/bytes.bin').bytes, new Uint8Array([0, 255, 1]));
  assert.deepEqual(current.state.folders, ['Empty', 'Content']);
  assert.equal(current.state.name, 'Imported bundle');
  assert.deepEqual(current.state.tabs, ['Program.cs']);
  assert.equal(current.tickets.length, 1);
});

test('sample reset observers see the matching source, workspace metadata and cleared old artifacts', async t => {
  const current = fixture(t);
  const oldModel = current.services.documents.models.get('Old.cs');
  const oldResult = compileResult();
  current.services.builds.active.applyResult(oldResult, 'build');
  current.state.disk = { old: true };
  current.state.pdb = new Uint8Array([1]);
  current.state.ilDump = 'old disassembly';
  current.state.importedAssembly = true;
  const observed = [];
  const unsubscribe = current.services.documents.subscribe(event => {
    if (event.type !== 'reset') return;
    observed.push({ uris: current.services.documents.list().map(record => record.uri),
      active: current.state.active, name: current.state.name, disk: current.state.disk, epoch: current.state.workspaceEpoch,
      image: current.state.image, result: current.state.result, assembly: current.state.assembly,
      pdb: current.state.pdb, ilDump: current.state.ilDump, imported: current.state.importedAssembly });
  });
  t.after(unsubscribe);
  assert.equal(await loadStudioSample('review', false, {}, current.builtins), true);
  assert.deepEqual(observed, [{ uris: ['Sample.cs'], active: 'Sample.cs', name: 'ReviewWorkspace', disk: null, epoch: 2,
    image: null, result: null, assembly: null, pdb: null, ilDump: null, imported: false }]);
  assert.throws(() => oldModel.prepareEdits([]), /disposed/);
  assert.deepEqual(current.state.watches, ['sample']);
  assert.equal(current.state.watchResults.size, 0);
  assert.deepEqual(current.state.breakpoints, { 'Sample.cs': [{ line: 1 }] });
  assert.deepEqual(current.history, [{ name: 'Review Workspace', sampleId: 'review' }]);
  assert.deepEqual(current.built, [true]);
});

test('stale assembly completion cannot replace a workspace opened during compiler import', async t => {
  const current = fixture(t);
  const imported = deferred();
  const entered = deferred();
  current.builtins.compiler = () => ({ request: async method => {
    if (method === 'inspectAssembly') return { summary: { streams: [{ name: '#SF' }] } };
    assert.equal(method, 'importAssembly');
    entered.resolve();
    return imported.promise;
  } });
  const loading = importStudioAssembly(new Uint8Array([77, 90]), {}, current.builtins);
  const rejected = assert.rejects(loading, { name: 'AbortError' });
  await entered.promise;
  await current.loadRecords([{ path: 'New.cs', text: '// keep new workspace' }], { name: 'New workspace' });
  imported.resolve({ ...compileResult(), image: { name: 'OldAssembly', sources: [{ uri: 'OldAssembly.cs', text: '// stale' }], methods: [] } });
  await rejected;
  assert.equal(current.state.name, 'New workspace');
  assert.deepEqual(current.services.documents.list().map(record => record.uri), ['New.cs']);
  assert.equal(current.state.importedAssembly, false);
});

test('successful assembly reset never pairs imported documents with previous build artifacts', async t => {
  const current = fixture(t);
  current.services.builds.active.applyResult(compileResult(), 'build');
  current.state.pdb = new Uint8Array([9]);
  current.state.ilDump = 'obsolete IL';
  current.state.importedAssembly = true;
  const result = { ...compileResult(), image: { name: 'Imported', sources: [{ uri: 'Imported.cs', text: 'class Imported {}' }],
    methods: [{ id: 3 }] } };
  current.builtins.compiler = () => ({ request: async method => method === 'inspectAssembly'
    ? { summary: { streams: [{ name: '#SF' }] } } : result });
  const resets = [];
  const unsubscribe = current.services.documents.subscribe(event => {
    if (event.type === 'reset') resets.push({ uri: current.state.active, name: current.state.name,
      image: current.state.image, result: current.state.result, assembly: current.state.assembly,
      pdb: current.state.pdb, ilDump: current.state.ilDump });
  });
  t.after(unsubscribe);
  const assembly = new Uint8Array([77, 90]);
  assert.equal(await importStudioAssembly(assembly, {}, current.builtins), result);
  assert.deepEqual(resets, [{ uri: 'Imported.cs', name: 'Imported', image: null, result: null, assembly: null, pdb: null, ilDump: null }]);
  assert.equal(current.state.image, result.image);
  assert.equal(current.state.assembly, assembly);
  assert.equal(current.state.importedAssembly, true);
  assert.equal(current.state.selectedMethod, 3);
});

function diskFor(file, getFile = async () => file) {
  return new DiskWorkspace([{ path: 'Library.dll', bytes: new Uint8Array([77, 90]) }],
    new Map([['Library.dll', { getFile }]]));
}

test('metadata reads use the captured browser handle or native client and return actual bounded bytes', async t => {
  const current = fixture(t);
  const bytes = new Uint8Array([77, 90, 0, 255]);
  current.state.disk = diskFor(new File([bytes], 'Library.dll'));
  let native = null;
  const reader = createStudioMetadataReader({ state: () => current.state, nativeBuild: () => native });
  const descriptor = { path: 'Library.dll', name: 'Library' };
  assert.deepEqual(await reader(descriptor), bytes);
  current.state.nativeMode = true;
  native = { client: { binary: async path => { assert.equal(path, descriptor.path); return bytes; } } };
  assert.equal(await reader(descriptor), bytes);
});

test('a browser metadata read rejects after its owning disk changes while getFile is pending', async t => {
  const current = fixture(t);
  const pending = deferred();
  const file = new File([new Uint8Array([77, 90])], 'Library.dll');
  current.state.disk = diskFor(file, () => pending.promise);
  const reader = createStudioMetadataReader({ state: () => current.state, nativeBuild: () => null });
  const loading = reader({ path: 'Library.dll', name: 'Library' });
  const rejected = assert.rejects(loading, { name: 'AbortError' });
  current.state.disk = diskFor(file);
  pending.resolve(file);
  await rejected;
});

for (const kind of ['native client', 'backend mode', 'workspace epoch']) {
  test('pending native metadata rejects a change to ' + kind, async t => {
    const current = fixture(t);
    const pending = deferred();
    current.state.nativeMode = true;
    const native = { client: { binary: () => pending.promise } };
    const reader = createStudioMetadataReader({ state: () => current.state, nativeBuild: () => native });
    const loading = reader({ path: 'Library.dll', name: 'Library' });
    const rejected = assert.rejects(loading, { name: 'AbortError' });
    if (kind === 'native client') native.client = { binary: async () => new Uint8Array([77, 90]) };
    if (kind === 'backend mode') current.state.nativeMode = false;
    if (kind === 'workspace epoch') current.state.workspaceEpoch++;
    pending.resolve(new Uint8Array([77, 90]));
    await rejected;
  });
}

test('metadata cancellation and advertised byte limits stop before consuming an oversized file', async t => {
  const current = fixture(t);
  let reads = 0;
  const oversized = { size: metadataLimits.bytes + 1, arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } };
  current.state.disk = diskFor(oversized);
  const reader = createStudioMetadataReader({ state: () => current.state, nativeBuild: () => null });
  const descriptor = { path: 'Library.dll', name: 'Library' };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(reader(descriptor, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(reader(descriptor), { code: 'METADATA_BYTES_LIMIT' });
  assert.equal(reads, 0);
});
