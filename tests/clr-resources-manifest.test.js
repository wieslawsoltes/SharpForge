import test from 'node:test';
import assert from 'node:assert/strict';
import { ManifestResourceLocation, LoadErrorCode, AssemblyLoadError } from '../packages/clr/src/index.js';
import { manifestImage, manifestContext, openManifest, binaryResource, manifestForwarders } from './clr-manifest-fixtures.js';

const code = expected => error => error.code === expected;
const embeddedLocation = ManifestResourceLocation.Embedded | ManifestResourceLocation.ContainedInManifestFile;

test('manifest resources preserve native row order, visibility-independent bytes, ownership and exact names', async () => {
  const text = new TextEncoder().encode('Zażółć\0😃');
  const image = manifestImage('Embedded', { resources: [
    { name: 'payload', bytes: binaryResource }, { name: 'private/空', bytes: text, flags: 2 },
    { name: 'empty', bytes: new Uint8Array() },
  ] });
  const { reader } = await openManifest(image);
  image.fill(0);
  assert.deepEqual(reader.names, ['payload', 'private/空', 'empty']);
  assert.equal(reader.names, reader.getNames());
  assert(Object.isFrozen(reader.names));
  assert.deepEqual(await reader.read('payload'), binaryResource);
  assert.deepEqual(await reader.read('private/空'), text);
  assert.deepEqual(await reader.read('empty'), new Uint8Array());
  assert.equal(await reader.read('Payload'), null);
  assert.equal(await reader.getInfo('absent'), null);
  const snapshot = await reader.read('payload');
  snapshot.fill(42);
  assert.deepEqual(await reader.read('payload'), binaryResource);
  assert.deepEqual(await reader.getInfo('payload'), { fileName: null, referencedAssembly: null,
    resourceLocation: embeddedLocation, size: binaryResource.length });
  reader.dispose();
});

test('AssemblyRef resource chains resolve through canonical contexts and keep declared name enumeration', async () => {
  const context = manifestContext(manifestForwarders());
  const facade = await context.loadFromAssemblyName('ResourceFacade');
  const reader = facade.openManifestResources();
  assert.equal(context.assemblies.length, 1);
  assert.deepEqual(reader.names, ['payload', 'absent']);
  assert.equal(context.assemblies.length, 1, 'Name enumeration must not bind references');
  assert.deepEqual(await reader.read('payload'), binaryResource);
  const target = await context.loadFromAssemblyName('ResourceTarget');
  const info = await reader.getInfo('payload');
  assert.equal(info.fileName, null);
  assert.equal(info.referencedAssembly, target);
  assert.equal(info.resourceLocation, embeddedLocation | ManifestResourceLocation.ContainedInAnotherAssembly);
  assert.equal(await reader.read('absent'), null);
  assert.deepEqual(await reader.read('payload'), binaryResource);
  await assert.rejects(facade.openManifestResources({ maxHops: 1 }).read('payload'), code(LoadErrorCode.LimitExceeded));
  await assert.rejects(facade.openManifestResources({ maxSources: 2 }).read('payload'), code(LoadErrorCode.LimitExceeded));
  reader.dispose();
});

test('linked data files have explicit host requests, declared hashes and independent pinned snapshots', async () => {
  const image = manifestImage('Linked', { files: [{ name: 'payload.bin', bytes: binaryResource }],
    resources: [{ name: 'payload', file: 0 }, { name: 'alias', file: 0 }] });
  let calls = 0;
  let request;
  const providerBytes = new Uint8Array(binaryResource);
  const { assembly, reader } = await openManifest(image, { fileProvider(value) { calls++; request = value; return providerBytes; } });
  assert.deepEqual(await reader.getInfo('payload'), { fileName: 'payload.bin', referencedAssembly: null, resourceLocation: 0, size: null });
  assert.equal(calls, 0);
  assert.deepEqual(await reader.read('payload'), binaryResource);
  assert.equal(calls, 1);
  assert.equal(request.assembly, assembly);
  assert.equal(request.name, 'payload.bin');
  assert.equal(request.metadataToken, 0x26000001);
  assert.equal(request.hashAlgorithm, 0x800c);
  assert.equal(request.containsMetadata, false);
  assert(Object.isFrozen(request));
  request.hashValue.fill(0);
  providerBytes.fill(8);
  assert.deepEqual(await reader.read('alias'), binaryResource);
  assert.equal(calls, 1);
  await assert.rejects(assembly.openManifestResources().read('payload'), code(LoadErrorCode.MissingFile));
  await assert.rejects(assembly.openManifestResources({ fileProvider: () => null }).read('payload'), code(LoadErrorCode.MissingFile));
  reader.dispose();
});

test('linked metadata files are inspected for resource data without becoming loaded runtime modules', async () => {
  const netmodule = manifestImage('Child', { netmodule: true, resources: [
    { name: 'first', bytes: Uint8Array.of(1) }, { name: 'payload', bytes: binaryResource },
  ] });
  const root = manifestImage('ModuleOwner', { files: [{ name: 'Child.netmodule', bytes: netmodule, containsMetadata: true }],
    resources: [{ name: 'payload', file: 0, offset: 8 }, { name: 'renamed', file: 0, offset: 8 },
      { name: 'first', file: 0, offset: 8 }] });
  const { assembly, context, reader } = await openManifest(root, { fileProvider: () => netmodule });
  assert.deepEqual(await reader.read('payload'), binaryResource);
  assert.deepEqual(await reader.read('renamed'), binaryResource, 'A linked resource name need not occur in the child metadata');
  assert.deepEqual(await reader.read('first'), binaryResource, 'The parent offset wins over a differently located child name');
  assert.equal(await reader.read('absent'), null);
  assert.deepEqual(await reader.getInfo('payload'), { fileName: 'Child.netmodule', referencedAssembly: null,
    resourceLocation: ManifestResourceLocation.Embedded, size: binaryResource.length });
  assert.deepEqual(context.assemblies, [assembly]);
  assert.equal(assembly.manifestModule.methodBodyReadCount, 0);
  reader.dispose();
});

test('linked module resource inspection permits managed entry points and does not require a child resource row', async () => {
  const netmodule = manifestImage('Entry', { netmodule: true, entryPoint: true,
    resources: [{ name: 'payload', bytes: binaryResource }], decorate: ({ md }) => { md.rows[40] = []; } });
  const root = manifestImage('Owner', { files: [{ name: 'Entry.netmodule', bytes: netmodule, containsMetadata: true }],
    resources: [{ name: 'payload', file: 0 }] });
  const { context, reader, assembly } = await openManifest(root, { fileProvider: () => netmodule });
  assert.deepEqual(await reader.read('payload'), binaryResource);
  assert.deepEqual(context.assemblies, [assembly]);
  assert.equal(assembly.manifestModule.methodBodyReadCount, 0);
  reader.dispose();
});

test('reader disposal and cancellation guard cold and warm paths, while retained assembly data survives cooperative unloading', async () => {
  const image = manifestImage('Lifetime', { resources: [{ name: 'payload', bytes: binaryResource }] });
  const { reader, assembly, context } = await openManifest(image);
  const names = reader.names;
  const bytes = await reader.read('payload');
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => assembly.openManifestResources({ signal: controller.signal }), code(LoadErrorCode.Cancelled));
  assert.throws(() => reader.getNames({ signal: controller.signal }), code(LoadErrorCode.Cancelled));
  await assert.rejects(reader.read('payload', { signal: controller.signal }), code(LoadErrorCode.Cancelled));
  await assert.rejects(reader.getInfo('payload', { signal: controller.signal }), code(LoadErrorCode.Cancelled));
  context.unload();
  assert.deepEqual(await reader.read('payload'), binaryResource);
  reader.dispose();
  reader.dispose();
  assert.equal(reader.isDisposed, true);
  assert.throws(() => reader.names, code(LoadErrorCode.Disposed));
  await assert.rejects(reader.read('payload'), code(LoadErrorCode.Disposed));
  await assert.rejects(reader.getInfo('payload'), code(LoadErrorCode.Disposed));
  assert.deepEqual(names, ['payload']);
  assert.deepEqual(bytes, binaryResource);
});

test('stable resource file diagnostics extend rather than renumber the existing registry', () => {
  assert.equal(LoadErrorCode.TypeLoad, 'SFCLR012');
  assert.equal(LoadErrorCode.UnsupportedFeature, 'SFCLR013');
  assert.equal(LoadErrorCode.MissingFile, 'SFCLR014');
  assert.equal(LoadErrorCode.FileLoad, 'SFCLR015');
  for (const [failure, managedType] of [[LoadErrorCode.UnsupportedFeature, 'System.NotSupportedException'],
    [LoadErrorCode.MissingFile, 'System.IO.FileNotFoundException'], [LoadErrorCode.FileLoad, 'System.IO.FileLoadException']]) {
    assert.equal(new AssemblyLoadError(failure, 'fixture').managedType, managedType);
  }
});
