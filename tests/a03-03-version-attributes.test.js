import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { MetadataBuilder, encodeCustomAttribute, methodSignature, readPE, writePE,
  win32VersionFromAssembly, readWin32Resources, Reader } from '@sharpforge/cil';

function image(builder) {
  const metadata = builder.finish(), section = new Uint8Array(72 + metadata.length);
  section.set(metadata, 72);
  return readPE(writePE(section, 72, metadata.length, 0));
}
function attribute(builder, name, value, parent = 0x20000001) {
  const owner = builder.typeRef(`System.Reflection.${name}`);
  const constructor = builder.member(owner, '.ctor', methodSignature('void', ['string'], false));
  builder.addRow('CustomAttribute', { Parent: parent, Type: constructor, Value: encodeCustomAttribute(['string'], [value]) });
}

test('A03 AssemblyFileVersion and descriptive metadata attributes project into existing Win32 options', () => {
  const builder = new MetadataBuilder('Versioned', { assemblyVersion: '7.8.9.10' });
  for (const [name, value] of [['AssemblyFileVersionAttribute', '1.2.345.65535'], ['AssemblyTitleAttribute', 'Example title'],
    ['AssemblyCompanyAttribute', 'Example company'], ['AssemblyProductAttribute', 'Example product'],
    ['AssemblyDescriptionAttribute', 'Example comments'], ['AssemblyCopyrightAttribute', '© Example']]) {
    attribute(builder, name, value);
  }
  assert.deepEqual(win32VersionFromAssembly(image(builder)), { fileVersion: '1.2.345.65535', fileDescription: 'Example title',
    companyName: 'Example company', productName: 'Example product', comments: 'Example comments', legalCopyright: '© Example' });
});

test('A03 missing version attributes fall back to Assembly version and non-Assembly parents are ignored', () => {
  const builder = new MetadataBuilder('Versioned', { assemblyVersion: '7.8.9.10' });
  attribute(builder, 'AssemblyFileVersionAttribute', '2.3', 1);
  attribute(builder, 'AssemblyInformationalVersionAttribute', 'arbitrary-release+sha');
  assert.deepEqual(win32VersionFromAssembly(image(builder)), { fileVersion: '7.8.9.10' });
  const short = new MetadataBuilder();
  attribute(short, 'AssemblyFileVersionAttribute', '2.3');
  assert.equal(win32VersionFromAssembly(image(short)).fileVersion, '2.3.0.0');
});

test('A03 MethodDef attribute constructors use real metadata ownership and string signatures', () => {
  const builder = new MetadataBuilder('LocalAttribute');
  builder.definitions.typeDef({ Flags: 1, Name: 'AssemblyFileVersionAttribute', Namespace: 'System.Reflection',
    Extends: 0, FieldList: 1, MethodList: 1 });
  const constructor = builder.definitions.method({ RVA: 0, ImplFlags: 0, Flags: 0x1886, Name: '.ctor',
    Signature: methodSignature('void', ['string'], false), ParamList: 1 });
  builder.addRow('CustomAttribute', { Parent: 0x20000001, Type: constructor, Value: encodeCustomAttribute(['string'], ['4.5.6']) });
  assert.equal(win32VersionFromAssembly(image(builder)).fileVersion, '4.5.6.0');
});

test('A03 duplicate, malformed and excessive version metadata fails explicitly', () => {
  for (const value of ['1', '1.2.*', '1.2.3.65536', '1.2.3.4.5', null, 'bad\0value']) {
    const builder = new MetadataBuilder();
    attribute(builder, 'AssemblyFileVersionAttribute', value);
    assert.throws(() => win32VersionFromAssembly(image(builder)), /version|Version/);
  }
  const duplicate = new MetadataBuilder();
  attribute(duplicate, 'AssemblyFileVersionAttribute', '1.2.3.4');
  attribute(duplicate, 'AssemblyFileVersionAttribute', '1.2.3.4');
  assert.throws(() => win32VersionFromAssembly(image(duplicate)), /Duplicate/);
  const bad = new MetadataBuilder();
  attribute(bad, 'AssemblyTitleAttribute', 'ok');
  bad.rows[12][0][2] = bad.blob(Uint8Array.of(0, 0, 0, 0));
  assert.throws(() => win32VersionFromAssembly(image(bad)), /attribute value/);
  assert.throws(() => win32VersionFromAssembly({ metadata: { rows: { 32: [[0, 1, 2, 3, 4]], 12: new Array(4097) } } }), /row limit/);
  assert.throws(() => win32VersionFromAssembly(image(new MetadataBuilder('Part', { outputKind: 'netmodule' }))), /Assembly definition/);
});

test('A03 Roslyn metadata projection produces the exact version payload read independently by LLVM', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-version-attributes/native.json', import.meta.url), 'utf8'));
  const source = Buffer.from(capture.assemblyBase64, 'base64'), before = Buffer.from(source);
  const version = win32VersionFromAssembly(readPE(source));
  assert.equal(version.fileVersion, '1.2.345.65535');
  assert.equal(version.fileDescription, 'Example title');
  assert.equal(version.companyName, 'Example company');
  assert.equal(version.productName, 'Example product');
  assert.equal(version.comments, 'Example comments');
  assert.equal(version.legalCopyright, '© Example');
  assert.deepEqual(source, before);
  const result = compileToIL('public class Versioned {}', { name: 'Projected', outputKind: 'library', portablePdb: false,
    win32Resources: { version } });
  assert(result.success, JSON.stringify(result.diagnostics));
  assert.match(capture.llvmVersion, /LLVM version 22\.1\.8/);
  const hex = [...capture.llvmOutput.matchAll(/^\s*[0-9A-F]+: ([0-9A-F ]+)\s+\|/gm)]
    .map(line => line[1].replaceAll(' ', '')).join('');
  const resource = readWin32Resources(readPE(result.assembly), { includeBytes: true })[0];
  assert.equal(resource.type, 16);
  assert.deepEqual(resource.bytes, new Uint8Array(Buffer.from(hex, 'hex')));
  const fixed = new Reader(resource.bytes, 48, 8);
  assert.deepEqual([fixed.u32(), fixed.u32()], [0x00010002, 345 * 65536 + 65535]);
});
