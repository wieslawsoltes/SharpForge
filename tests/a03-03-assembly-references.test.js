import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { MetadataBuilder, readMetadata, readPE, writePE, loadAssembly } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

const key = new Uint8Array(Buffer.from(JSON.parse(readFileSync(new URL('./fixtures/clr-identity/public-keys.json', import.meta.url), 'utf8')).cases[1].key, 'hex'));
function references(version) {
  return ['System.Runtime', 'System.Console'].map(name => ({ name, version: [version, 0, 0, 0], flags: 1, publicKeyOrToken: key }));
}
function referenceBytes(identity) {
  const metadata = new MetadataBuilder(identity.name, { assemblyVersion: identity.version, assemblyCulture: identity.culture });
  metadata.rows[32][0][5] = identity.flags;
  metadata.rows[32][0][6] = metadata.blob(identity.publicKeyOrToken);
  const bytes = metadata.finish(), section = new Uint8Array(72 + bytes.length);
  section.set(bytes, 72);
  return writePE(section, 72, bytes.length, 0);
}
function compile(options) {
  const result = compileToIL('Console.WriteLine(42);', options);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}

for (const version of [9, 10]) {
  test(`A03 net${version} input identities replace fixed versions and survive both JS engines`, () => {
    const result = compile({ framework: `net${version}`, referenceAssemblies: references(version).map(referenceBytes) });
    const pe = readPE(result.assembly);
    assert.deepEqual(pe.metadata.rows[35].map(row => row.slice(0, 5)), [[version, 0, 0, 0, 1], [version, 0, 0, 0, 1]]);
    for (const row of pe.metadata.rows[35]) assert.deepEqual(pe.metadata.blob(row[5]), key);
    assert.equal(loadAssembly(result.assembly).entryPoint, result.image.entryPoint);
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

test('A03 reference identities are copied, case-insensitively interned and preserve version/culture/token', () => {
  const publicKeyOrToken = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), version = [65535, 0, 2, 3];
  const metadata = new MetadataBuilder('Consumer', { assemblyReferences: [{ name: 'Dependency', version,
    culture: 'fr-FR', publicKeyOrToken }] });
  version.fill(0);
  publicKeyOrToken.fill(0);
  assert.equal(metadata.assemblyRef('dependency'), metadata.assemblyRef('Dependency'));
  const decoded = readMetadata(metadata.finish()), row = decoded.rows[35][0];
  assert.deepEqual(row.slice(0, 5), [65535, 0, 2, 3, 0]);
  assert.equal(decoded.string(row[6]), 'Dependency');
  assert.equal(decoded.string(row[7]), 'fr-FR');
  assert.deepEqual(decoded.blob(row[5]), Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
});

test('A03 default reference profiles keep their historical versions and empty custom-key heap handle', () => {
  const metadata = new MetadataBuilder();
  metadata.assemblyRef('System.Runtime');
  metadata.assemblyRef('SharpForge.Runtime');
  assert.deepEqual(metadata.rows[35][0].slice(0, 4), [8, 0, 0, 0]);
  assert.deepEqual(metadata.rows[35][1].slice(0, 6), [0, 10, 0, 0, 0, 0]);
  const desktop = new MetadataBuilder('Desktop', { framework: 'mscorlib4' });
  desktop.assemblyRef('mscorlib');
  assert.deepEqual(desktop.rows[35][0].slice(0, 4), [4, 0, 0, 0]);
});

test('A03 invalid, duplicate, excessive and missing reference identities are explicit diagnostics', () => {
  const valid = references(10)[0];
  for (const assemblyReferences of [null, {}, new Array(1025), [valid, valid], [{ ...valid, name: '' }],
    [{ ...valid, version: undefined }], [{ ...valid, flags: 8 }], [{ ...valid, flags: 0x100000000 }], [{ ...valid, publicKeyOrToken: [] }],
    [{ ...valid, flags: 0, publicKeyOrToken: key }]]) {
    assert.throws(() => new MetadataBuilder('Invalid', { assemblyReferences }), /reference/i);
  }
  for (const options of [{ framework: 'net9' }, { referenceAssemblies: null }, { referenceAssemblies: [new Uint8Array(2)] },
    { referenceAssemblies: [[]] }, { referenceAssemblies: new Array(1025) }, { assemblyReferences: {} }]) {
    const result = compileToIL('Console.WriteLine(42);', options);
    assert.equal(result.success, false);
    assert(result.diagnostics.some(value => value.code === 'SF3001'));
  }
});

test('A03 real net9/net10 reference-pack identities are confirmed by native GetReferencedAssemblies', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-assembly-references/native.json', import.meta.url), 'utf8'));
  assert.match(capture.runtime, /^\.NET /);
  assert.equal(capture.cases.length, 2);
  for (const value of capture.cases) {
    assert.equal(value.references.length, 2);
    for (const reference of value.references) {
      assert.equal(reference.version, `${value.framework === 'net9' ? 9 : 10}.0.0.0`);
      assert.equal(reference.publicKeyToken, 'b03f5f7f11d50a3a');
      assert.equal(reference.culture, '');
    }
  }
});

function forgedReferenceImage(count, keySize) {
  const metadata = new MetadataBuilder('Forged');
  const key = metadata.blob(new Uint8Array(keySize));
  for (let index = 0; index < count; index++) metadata.add(35, [1, 0, 0, 0, 1, key, 0xffff, 0, 0]);
  const bytes = metadata.finish({ format: 'SharpForge.CIL', version: 1, name: 'Forged', framework: 'net8',
    outputKind: 'library', entry: null, methods: [], types: [], statics: [], sequencePoints: [], sources: [] });
  const section = new Uint8Array(72 + bytes.length);
  section.set(bytes, 72);
  return writePE(section, 72, bytes.length, 0);
}

test('A03 canonical reference count is rejected before visiting invalid shared rows', () => {
  assert.throws(() => loadAssembly(forgedReferenceImage(1025, 16385)), /assembly reference identity count/);
});

test('A03 canonical reference key is bounded before copying or reading its invalid name', () => {
  assert.throws(() => loadAssembly(forgedReferenceImage(1, 16385)), /public key\/token exceeds size limit/);
});
