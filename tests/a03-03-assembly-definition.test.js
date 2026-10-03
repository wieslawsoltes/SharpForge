import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { MetadataBuilder, readMetadata, readPE, loadAssembly } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

function compile(options = {}) {
  const result = compileToIL('Console.WriteLine(42);', options);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}
function identity(metadata) {
  const row = metadata.rows[32][0];
  return { version: row.slice(1, 5).join('.'), culture: metadata.string(row[8]), name: metadata.string(row[7]) };
}

for (const platform of ['anycpu', 'x86', 'x64', 'arm64']) {
  test(`A03 explicit definition version/culture survive canonical execution on ${platform}`, () => {
    const options = { name: 'Versioned', platform, assemblyVersion: '1.2.345.65535', assemblyCulture: 'en-US' };
    const result = compile(options);
    assert.deepEqual(identity(readPE(result.assembly).metadata), { name: 'Versioned', version: '1.2.345.65535', culture: 'en-US' });
    assert.equal(loadAssembly(result.assembly).entryPoint, result.image.entryPoint);
    assert.deepEqual(compile(options).assembly, result.assembly);
    for (const Engine of [VirtualMachine, CilVirtualMachine]) {
      const vm = new Engine(result.assembly);
      try {
        const execution = vm.run();
        assert.equal(execution.state, 'terminated', execution.fault?.message);
        assert.equal(execution.output, '42\n');
      } finally { vm.stop(); }
    }
  });
}

test('A03 low-level definition identity preserves defaults and owns numeric version arrays', () => {
  assert.deepEqual(identity(readMetadata(new MetadataBuilder().finish())), { name: 'Application', version: '0.2.0.0', culture: '' });
  const version = [65535, 65535, 65535, 65535];
  const builder = new MetadataBuilder('Boundary', { assemblyVersion: version, assemblyCulture: 'neutral' });
  version.fill(0);
  assert.deepEqual(identity(readMetadata(builder.finish())), { name: 'Boundary', version: '65535.65535.65535.65535', culture: '' });
  const zero = new MetadataBuilder('Zero', { assemblyVersion: [0, 0, 0, 0], assemblyCulture: 'ja-JP' });
  assert.equal(identity(readMetadata(zero.finish())).version, '0.0.0.0');
});

test('A03 invalid version and culture options produce explicit diagnostics without wildcard expansion', () => {
  for (const assemblyVersion of ['1.2', '1.2.3.*', '1.2.3.65536', '1.2.3.-1', null, [], new Array(4),
    [1, 2, 3, NaN], [1, 2, 3, 1.5], [1, 2, 3, 65536], ['1', 2, 3, 4]]) {
    assert.throws(() => new MetadataBuilder('Invalid', { assemblyVersion }), /Assembly version/);
  }
  for (const assemblyCulture of [null, 42, 'en\0US', 'en_US', 'en/US', '-en', 'a'.repeat(86), '\ud800']) {
    const result = compileToIL('Console.WriteLine(42);', { assemblyCulture });
    assert.equal(result.success, false);
    assert(result.diagnostics.some(value => value.code === 'SF3001' && /Assembly culture/.test(value.message)));
  }
});

test('A03 AssemblyName reads the same emitted definition identities as the metadata reader', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/a03-assembly-definition/native.json', import.meta.url), 'utf8'));
  assert.match(reference.runtime, /^\.NET /);
  for (const value of reference.cases) {
    const result = compile({ name: value.name, assemblyVersion: value.version, assemblyCulture: value.culture, portablePdb: false });
    assert.deepEqual(identity(readPE(result.assembly).metadata), value);
  }
});

test('A03 definition identity composes with public signing and both resource directories', () => {
  const keys = JSON.parse(readFileSync(new URL('./fixtures/clr-identity/public-keys.json', import.meta.url), 'utf8'));
  const result = compile({ assemblyVersion: '2.3.4.5', assemblyCulture: 'fr-FR', publicSign: true,
    publicKey: new Uint8Array(Buffer.from(keys.cases[1].key, 'hex')),
    managedResources: [{ name: 'data', bytes: Uint8Array.of(1, 2) }], win32Resources: { manifest: '<assembly/>' } });
  const pe = readPE(result.assembly);
  assert.equal(identity(pe.metadata).version, '2.3.4.5');
  assert.equal(identity(pe.metadata).culture, 'fr-FR');
  assert.equal(pe.corFlags & 8, 8);
  assert(pe.resources.size > 0);
  assert(pe.directories.resource.size > 0);
  assert.equal(loadAssembly(result.assembly).entryPoint, result.image.entryPoint);
});
