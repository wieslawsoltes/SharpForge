import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession, LoadErrorCode } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-manifest-resources/native-manifest-resources.json', import.meta.url)));
const files = new Map(native.files.map(file => [file.name, new Uint8Array(Buffer.from(file.bytesBase64, 'base64'))]));
const assemblies = new Map(native.files.filter(file => file.assemblyName).map(file => [file.assemblyName, files.get(file.name)]));
const linkedClasses = new Set(['linked-file', 'linked-module', 'module-offset-difference', 'module-parent-name',
  'module-entry-point', 'forwarded-linked-file']);
const differentReaders = new Set(['module-offset-difference', 'module-parent-name']);

function physicalInfo(info) {
  return info === null ? null : { fileName: info.fileName, referencedAssembly: info.referencedAssembly?.identity.name ?? null,
    resourceLocation: info.resourceLocation };
}

function nativeFailure(operation, type, hresult) {
  assert.equal(operation.error.type, type);
  assert.equal(operation.error.hresult, hresult);
}

test('manifest resource reference inputs, generator sources and tool versions are pinned', () => {
  assert.equal(native.format, 1);
  assert.match(native.sdk, /^10\./);
  assert.match(native.framework, /^\.NET 10\./);
  assert.match(native.metadataLoadContextVersion, /^10\./);
  assert.match(native.referenceReader.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(native.sources.map(source => source.path), [
    'tests/fixtures/clr-manifest-resources/Images.cs', 'tests/fixtures/clr-manifest-resources/Program.cs',
    'packages/clr/tools/capture-manifest-resources.mjs',
  ]);
  for (const source of native.sources) {
    const bytes = readFileSync(new URL(`../${source.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, source.path);
  }
  assert.equal(files.size, native.files.length, 'Every physical reference input must have an unambiguous name');
  for (const file of native.files) {
    assert.equal(createHash('sha256').update(files.get(file.name)).digest('hex'), file.sha256, file.name);
  }
});

test('resource bytes and names match their native readers, with explicit linked-module offset differences', async () => {
  const classifications = new Set();
  const hashAlgorithms = new Set();
  for (const fixture of native.cases) {
    classifications.add(fixture.classification);
    const context = new AssemblyLoadSession().createContext({ name: fixture.id, isCollectible: true,
      load: ({ assemblyName }) => assemblies.get(assemblyName.name) ?? null });
    const assembly = await context.loadFromAssemblyName(fixture.assemblyName);
    const reader = assembly.openManifestResources({ fileProvider: ({ name }) => files.get(name) ?? null });
    try {
      if (fixture.classification === 'malformed-embedded') {
        assert.throws(() => reader.names, error => error.code === LoadErrorCode.InvalidImage);
        await assert.rejects(reader.read(fixture.resource), error => error.code === LoadErrorCode.InvalidImage);
        await assert.rejects(reader.getInfo(fixture.resource), error => error.code === LoadErrorCode.InvalidImage);
        assert.deepEqual(fixture.coreClr.names, { value: ['payload'] });
        assert.deepEqual(fixture.metadataLoadContext.names, { value: ['payload'] });
        nativeFailure(fixture.coreClr.stream, 'System.BadImageFormatException', -2147024885);
        nativeFailure(fixture.metadataLoadContext.stream, 'System.OverflowException', -2146233066);
        nativeFailure(fixture.metadataLoadContext.info, 'System.OverflowException', -2146233066);
        assert.deepEqual(fixture.coreClr.info, { value: {
          fileName: null, referencedAssembly: null, resourceLocation: 5,
        } });
        continue;
      }
      const bytes = await reader.read(fixture.resource);
      const actual = bytes === null ? null : Buffer.from(bytes).toString('base64');
      const info = await reader.getInfo(fixture.resource);
      assert.equal(actual, fixture.expectedBase64, fixture.id);
      assert.deepEqual(physicalInfo(info), fixture.expectedInfo, fixture.id);
      assert.deepEqual(reader.names, fixture.coreClr.names.value, `${fixture.id}: CoreCLR names`);
      assert.deepEqual(reader.names, fixture.metadataLoadContext.names.value, `${fixture.id}: metadata names`);
      if (!linkedClasses.has(fixture.classification)) {
        assert.equal(actual, fixture.coreClr.stream.value, `${fixture.id}: CoreCLR stream`);
        assert.deepEqual(physicalInfo(info), fixture.coreClr.info.value, `${fixture.id}: CoreCLR location`);
      } else {
        assert.deepEqual(fixture.coreClr.stream, { value: null }, `${fixture.id}: CoreCLR File resource boundary`);
        assert.deepEqual(fixture.coreClr.info, { value: null }, `${fixture.id}: CoreCLR File info boundary`);
      }
      if (differentReaders.has(fixture.classification)) {
        assert.notEqual(fixture.metadataLoadContext.stream.value, actual, `${fixture.id}: observed name/offset difference`);
      } else {
        assert.equal(actual, fixture.metadataLoadContext.stream.value, `${fixture.id}: MetadataLoadContext stream`);
      }
      if (fixture.classification === 'linked-file') hashAlgorithms.add(assembly.manifestModule.row(0x20000001)[0]);
      if (info?.referencedAssembly) {
        assert.equal(info.referencedAssembly, await context.loadFromAssemblyName(fixture.expectedInfo.referencedAssembly));
      }
    } finally {
      reader.dispose();
      context.unload();
    }
  }
  for (const classification of ['embedded', 'forwarded', 'malformed-embedded', ...linkedClasses]) {
    assert(classifications.has(classification), `Missing native fixture category ${classification}`);
  }
  assert.deepEqual([...hashAlgorithms].sort((left, right) => left - right), [0, 0x8003, 0x8004, 0x800c, 0x800d, 0x800e]);
});
