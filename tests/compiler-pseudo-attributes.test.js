import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, decodeCoded, decodeMarshalDescriptor } from '@sharpforge/cil';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';

const source = readFileSync(new URL('../packages/compiler/test/cil-emission/reference-fixtures/pseudo-attributes.cs', import.meta.url), 'utf8');
const pack = loadReferencePack();
const options = { skip: pack ? false : 'no .NET reference pack installed' };
const oracle = new URL('./fixtures/attribute-metadata/', import.meta.url);

function inspect(emit) {
  const result = emit(source, { name: 'PseudoAttributes', references: pack.references });
  assert.deepEqual(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
  assert.ok(result.assembly instanceof Uint8Array);
  const pe = new AssemblyInspector(result.assembly), metadata = pe.metadata;
  return { pe, metadata, type: name => pe.types.find(type => type.name === name) };
}

function marshalRows(pe) {
  const metadata = pe.metadata, names = new Map();
  for (const type of pe.types) {
    for (const field of type.fields) names.set(field.token, `${type.name}.${field.name}`);
    for (const method of type.methods) {
      for (const parameter of metadata.list(method.token, 'ParamList')) {
        const [, sequence, name] = metadata.row(parameter);
        names.set(parameter, `${type.name}.${method.name}/${sequence}:${metadata.string(name)}`);
      }
    }
  }
  return metadata.rows[13].map(([parent, native]) => ({
    target: names.get(decodeCoded('HasFieldMarshal', parent)), bytes: [...metadata.blob(native)],
  })).sort((left, right) => left.target.localeCompare(right.target));
}

test('A02-T41 marshal oracle is a hash-pinned genuine Roslyn assembly', () => {
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', oracle), 'utf8'));
  const assembly = readFileSync(new URL('PseudoAttributes.dll', oracle));
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  assert.equal(sha256(source), provenance.sourceSha256);
  assert.equal(sha256(assembly), provenance.assemblySha256);
});

for (const [kind, emit] of [['executable', compileToAssembly], ['reference', compileToReferenceAssembly]]) {
  test(`A02-T41 ${kind} pseudo-attributes write layout, flags and field offsets`, options, () => {
    const { metadata, type } = inspect(emit), layout = type('Layout'), array = type('ArrayLayout');
    assert.equal(layout.flags & 0x32018, 0x12010);
    assert.deepEqual(metadata.rows[15].find(row => row[2] === (layout.token & 0xffffff)), [2, 24, layout.token & 0xffffff]);
    assert.deepEqual(metadata.rows[15].find(row => row[2] === (array.token & 0xffffff)), [4, 16, array.token & 0xffffff]);
    assert.deepEqual(metadata.rows[16].map(([offset]) => offset), [0, 8]);
    assert.equal(layout.fields.find(field => field.name === 'Number').flags & 0x80, 0x80);
    assert.equal(type('ICom').flags & 0x1000, 0x1000);
    const managed = type('Native').methods.find(method => method.name === 'Managed');
    assert.equal(metadata.row(managed.token)[1], 0x48);
    assert.equal(metadata.row(managed.token)[2] & 0x800, 0x800);
    const customAttributeTypes = (metadata.rows[12] ?? []).map(([, constructor]) => peOwner(metadata, constructor));
    assert.ok(customAttributeTypes.every(name => !/DllImport|MarshalAs|StructLayout|FieldOffset|MethodImplAttribute|SpecialName/.test(name)));
  });

  test(`A02-T48 ${kind} P/Invoke writes shared ModuleRefs, entry points and exact ImplMap flags`, options, () => {
    const { metadata, type } = inspect(emit), native = type('Native');
    const imports = metadata.rows[28].map(([flags, member, name, scope]) => ({
      flags, member: decodeCoded('MemberForwarded', member), name: metadata.string(name),
      module: metadata.string(metadata.row(0x1a000000 | scope)[0]),
    }));
    assert.equal(metadata.rows[26].length, 2);
    const abs = native.methods.find(method => method.name === 'Abs'), mapped = native.methods.find(method => method.name === 'Mapped');
    assert.deepEqual(imports.find(entry => entry.member === abs.token), { flags: 0x1263, member: abs.token, name: 'abs', module: 'libc.so.6' });
    assert.deepEqual(imports.find(entry => entry.member === mapped.token), { flags: 0x2314, member: mapped.token, name: 'unused', module: 'libc.so.6' });
    assert.equal(metadata.row(abs.token)[0], 0);
    assert.equal(metadata.row(abs.token)[1] & 0x80, 0x80);
    assert.equal(metadata.row(mapped.token)[1] & 0x80, 0);
    assert.equal(metadata.row(mapped.token)[2] & 0x2000, 0x2000);
  });

  test(`A02-T41 ${kind} marshal descriptors preserve array sizing and managed marshaler strings`, options, () => {
    const { metadata, type } = inspect(emit);
    const descriptors = metadata.rows[13].map(([parent, native]) => ({
      parent: decodeCoded('HasFieldMarshal', parent), value: decodeMarshalDescriptor(metadata.blob(native)),
    }));
    for (const descriptor of descriptors) {
      assert.equal(metadata.row(descriptor.parent)[0] & (descriptor.parent >>> 24 === 4 ? 0x1000 : 0x2000),
        descriptor.parent >>> 24 === 4 ? 0x1000 : 0x2000);
    }
    const field = type('ArrayLayout').fields[0];
    assert.deepEqual(descriptors.find(entry => entry.parent === field.token).value,
      { type: 30, name: 'ByValArray', sizeConstant: 3, elementType: { type: 5, name: 'I2' } });
    const arrays = descriptors.map(entry => entry.value).filter(value => value.name === 'LPArray');
    assert.equal(arrays.length, 4);
    assert.ok(arrays.some(array => array.sizeParameterIndex === 1 && array.sizeConstant === 2 && array.flags === 1));
    assert.ok(arrays.some(array => array.sizeParameterIndex === 0 && array.sizeConstant === 3 && array.flags === 0));
    assert.ok(arrays.some(array => array.sizeParameterIndex === 3 && !Object.hasOwn(array, 'sizeConstant')));
    assert.ok(arrays.some(array => !Object.hasOwn(array, 'sizeParameterIndex') && array.elementType.name === 'Default'));
    const custom = descriptors.find(entry => entry.value.name === 'CustomMarshaler').value;
    assert.deepEqual(custom, { type: 44, name: 'CustomMarshaler', guid: '', nativeTypeName: '',
      managedTypeName: 'PassthroughMarshaler', cookie: 'ą-cookie' });
    const safeArray = descriptors.find(entry => entry.value.name === 'SafeArray').value;
    assert.equal(safeArray.variantType, 36);
    assert.equal(safeArray.userDefinedType, 'Layout');
  });

  test(`A02-T41 ${kind} marshal blobs and their targets match genuine Roslyn byte for byte`, options, () => {
    const expected = new AssemblyInspector(readFileSync(new URL('PseudoAttributes.dll', oracle)));
    assert.deepEqual(marshalRows(inspect(emit).pe), marshalRows(expected));
  });
}

function peOwner(metadata, constructor) {
  const method = decodeCoded('CustomAttributeType', constructor);
  return method >>> 24 === 10 ? metadata.typeName(decodeCoded('MemberRefParent', metadata.row(method)[0])) : '';
}
