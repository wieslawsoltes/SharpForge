import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { MetadataBuilder, readPE, writePE, linkAssemblyModules, readAssemblyModules, loadAssembly } from '@sharpforge/cil';

function moduleBytes(name, type = name) {
  const result = compileToIL(`public class ${type} { public static int Value() { return 42; } }`,
    { outputKind: 'netmodule', name, portablePdb: false });
  assert(result.success, JSON.stringify(result.diagnostics));
  return result.assembly;
}
function manifest(linkedModules, options = {}) {
  const result = compileToIL('public class Main {}', { name: 'Manifest', outputKind: 'library', linkedModules, ...options });
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}
function metadataPE(builder) {
  const bytes = builder.finish(), section = new Uint8Array(72 + bytes.length);
  section.set(bytes, 72);
  return writePE(section, 72, bytes.length, 0);
}
function addType(builder, name, flags = 1) {
  return builder.definitions.typeDef({ Flags: flags, Name: name, Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
}

test('A03 compiler scaffold visibility changes only for netmodules, preserving assembly defaults', () => {
  const module = readPE(moduleBytes('Part'));
  const assembly = readPE(manifest([]).assembly);
  for (const name of ['<>Program', '<>AllocationToken']) {
    const flags = pe => pe.metadata.rows[2].find(row => pe.metadata.string(row[1]) === name)[0] & 7;
    assert.equal(flags(module), 0);
    assert.equal(flags(assembly), 1);
  }
});

test('A03 two modules produce native File hashes, ModuleRef tokens and public exports deterministically', () => {
  const inputs = [moduleBytes('Alpha'), moduleBytes('Beta')], result = manifest(inputs);
  const pe = readPE(result.assembly), modules = readAssemblyModules(pe);
  assert.equal(pe.metadata.rows[32][0][0], 0x800c);
  assert.deepEqual(modules.map(value => value.name), ['Alpha.netmodule', 'Beta.netmodule']);
  modules.forEach((module, index) => {
    assert.equal(module.fileToken, 0x26000001 + index);
    assert.equal(module.moduleRefToken, 0x1a000001 + index);
    assert.equal(module.hashAlgorithm, 0x800c);
    assert.deepEqual(module.hashValue, new Uint8Array(createHash('sha256').update(inputs[index]).digest()));
    assert.deepEqual(module.exportedTypes.map(value => value.name), [index ? 'Beta' : 'Alpha']);
    assert.equal(module.exportedTypes[0].implementation, module.fileToken);
    assert.equal(module.exportedTypes[0].typeDefId, 4);
  });
  assert.deepEqual(manifest(inputs).assembly, result.assembly);
  assert.throws(() => loadAssembly(result.assembly), /Multi-module assembly execution requires module resolution/);
});

test('A03 nested public types retain enclosing ExportedType tokens and hide inaccessible enclosing types', () => {
  const builder = new MetadataBuilder('Nested', { outputKind: 'netmodule' });
  const outer = addType(builder, 'Outer'), inner = addType(builder, 'Inner', 2);
  const hidden = addType(builder, 'Hidden', 0), hiddenInner = addType(builder, 'HiddenInner', 2);
  builder.definitions.nestedClass({ NestedClass: inner, EnclosingClass: outer });
  builder.definitions.nestedClass({ NestedClass: hiddenInner, EnclosingClass: hidden });
  const target = new MetadataBuilder('Manifest'), linked = linkAssemblyModules(target, [metadataPE(builder)]);
  assert.deepEqual(linked[0].exportedTypes.map(value => value.name), ['Outer', 'Outer+Inner']);
  const [module] = readAssemblyModules(readPE(metadataPE(target)));
  assert.deepEqual(module.exportedTypes.map(value => value.flags), [1, 2]);
  assert.equal(module.exportedTypes[1].implementation, module.exportedTypes[0].token);
});

test('A03 linked hash inspection owns Buffer subarray copies and does not mutate inputs', () => {
  const module = moduleBytes('Part'), backing = Buffer.alloc(module.length + 11);
  backing.set(module, 5);
  const input = backing.subarray(5, 5 + module.length), before = Buffer.from(backing);
  const result = manifest([input]), imageBacking = Buffer.from(result.assembly);
  const projected = readAssemblyModules(readPE(imageBacking)), expected = projected[0].hashValue.slice();
  projected[0].hashValue.fill(0);
  assert.deepEqual(readAssemblyModules(readPE(imageBacking))[0].hashValue, expected);
  assert.deepEqual(backing, before);
  assert.deepEqual(imageBacking, Buffer.from(result.assembly));
});

test('A03 linking rejects duplicate files and public types without mutating a builder', () => {
  const module = moduleBytes('Part'), builder = new MetadataBuilder('Manifest'), before = JSON.stringify(builder.rows);
  assert.throws(() => linkAssemblyModules(builder, [module, module]), /Duplicate linked module name/);
  assert.equal(JSON.stringify(builder.rows), before);
  assert.throws(() => linkAssemblyModules(builder, [module, moduleBytes('Other', 'Part')]), /Duplicate linked exported type/);
  assert.equal(JSON.stringify(builder.rows), before);
  const local = new MetadataBuilder('Manifest');
  addType(local, 'Part');
  assert.throws(() => linkAssemblyModules(local, [module]), /Duplicate linked exported type/);
});

test('A03 module input count, aggregate bytes, assembly images and containing manifests are bounded', () => {
  const builder = new MetadataBuilder('Manifest'), block = new Uint8Array(1024 * 1024);
  for (const input of [null, {}, new Array(129), [new Uint8Array()], [new ArrayBuffer(4)]]) {
    assert.throws(() => linkAssemblyModules(builder, input));
  }
  assert.throws(() => linkAssemblyModules(builder, new Array(65).fill(block)), /input size limit/);
  assert.throws(() => linkAssemblyModules(builder, [metadataPE(new MetadataBuilder())]), /must be a netmodule/);
  assert.throws(() => linkAssemblyModules(new MetadataBuilder('Part', { outputKind: 'netmodule' }), [moduleBytes('Other')]),
    /containing Assembly manifest/);
  const invalid = compileToIL('public class A {}', { outputKind: 'library', linkedModules: null });
  assert.equal(invalid.success, false);
  assert(invalid.diagnostics.some(value => value.code === 'SF3001'));
});

test('A03 exports and nesting are bounded before manifest mutation', () => {
  const builder = new MetadataBuilder('Huge', { outputKind: 'netmodule' });
  for (let index = 0; index < 16385; index++) addType(builder, `Type${index}`);
  const target = new MetadataBuilder('Manifest');
  assert.throws(() => linkAssemblyModules(target, [metadataPE(builder)]), /exported type limit/);
  assert.equal(target.rows[38], undefined);
  const cycle = new MetadataBuilder('Cycle', { outputKind: 'netmodule' });
  const type = addType(cycle, 'Cycle', 2);
  cycle.definitions.nestedClass({ NestedClass: type, EnclosingClass: type });
  assert.throws(() => linkAssemblyModules(target, [metadataPE(cycle)]), /Cyclic or excessive/);
});

test('A03 native SRM confirms two module files, SHA256 hashes and exported TypeDef hints', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-module-linking/native.json', import.meta.url), 'utf8'));
  assert.match(capture.runtime, /^\.NET /);
  assert.equal(capture.hashAlgorithm, 'Sha256');
  assert.deepEqual(capture.modules.map(value => value.name), ['Alpha.netmodule', 'Beta.netmodule']);
  assert(capture.modules.every(value => value.hashMatches && value.typeHintsMatch));
  assert.deepEqual(capture.exports.map(value => value.name), ['Alpha', 'Beta', 'Nested']);
});

test('A03 module inspection preflights manifest counts, hash lengths and exported-type cycles', () => {
  assert.throws(() => readAssemblyModules({ metadata: { rows: { 38: new Array(129) } } }), /manifest limit/);
  const builder = new MetadataBuilder('Manifest');
  builder.manifest.file({ Flags: 0, Name: 'Part.netmodule', HashValue: new Uint8Array(65) });
  assert.throws(() => readAssemblyModules(readPE(metadataPE(builder))), /file hash limit/);
  const cyclic = new MetadataBuilder('Manifest');
  cyclic.manifest.exportedType({ Flags: 2, TypeDefId: 1, TypeName: 'Cycle', TypeNamespace: '', Implementation: 0x27000001 });
  assert.throws(() => readAssemblyModules(readPE(metadataPE(cyclic))), /Cyclic or excessive/);
  const hugeName = new MetadataBuilder('Manifest');
  hugeName.manifest.moduleRef({ Name: 'x'.repeat(2049) });
  assert.throws(() => readAssemblyModules(readPE(metadataPE(hugeName))), /name size limit/);
});
