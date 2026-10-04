import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TableId, MethodAttributes, FieldAttributes, MetadataBuilder, CilError, readMetadata, decodeCoded,
  referenceAssemblyMemberIncluded, addReferenceAssemblyAttribute,
} from '@sharpforge/cil';

test('A03-T22 reference visibility policy distinguishes every CLI accessibility', () => {
  const publicAccess = [false, false, false, false, true, true, true];
  const friendAccess = [false, false, true, true, true, true, true];
  for (const table of [TableId.Field, TableId.MethodDef]) {
    for (let access = 0; access <= 6; access++) {
      assert.equal(referenceAssemblyMemberIncluded(table, access), publicAccess[access], `${table}: ${access}`);
      assert.equal(referenceAssemblyMemberIncluded(table, access, { includesInternals: true }), friendAccess[access]);
    }
  }
  assert.equal(referenceAssemblyMemberIncluded(TableId.Field, FieldAttributes.Private, { isStruct: true }), true);
  assert.equal(referenceAssemblyMemberIncluded(TableId.Field, FieldAttributes.Private | FieldAttributes.Static, { isStruct: true }), true);
  assert.equal(referenceAssemblyMemberIncluded(TableId.MethodDef, MethodAttributes.Private | MethodAttributes.Virtual), true);
  assert.equal(referenceAssemblyMemberIncluded(TableId.MethodDef, MethodAttributes.Assembly, { isAttributeConstructor: true }), true);
  assert.equal(referenceAssemblyMemberIncluded(TableId.MethodDef, MethodAttributes.Private, { isStruct: true }), false);
});

test('A03-T22 reference member policy rejects unsupported tables, corrupt flags and malformed context', () => {
  for (const table of [TableId.TypeDef, TableId.Property, TableId.Event, -1, 'MethodDef']) {
    assert.throws(() => referenceAssemblyMemberIncluded(table, 6), CilError);
  }
  for (const flags of [-1, 65536, 1.5, NaN, Infinity, '6']) {
    assert.throws(() => referenceAssemblyMemberIncluded(TableId.MethodDef, flags), CilError);
  }
  assert.equal(referenceAssemblyMemberIncluded(TableId.MethodDef, 65534), true);
  for (const context of [null, 1, { includesInternals: 1 }, { isStruct: 'true' }, { isAttributeConstructor: null }]) {
    assert.throws(() => referenceAssemblyMemberIncluded(TableId.Field, 6, context), CilError);
  }
});

test('A03-T22 marker writer is idempotent and emits the standard zero-argument constructor and blob', () => {
  const builder = new MetadataBuilder('Reference');
  builder.addRow('TypeDef', { Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
  const marker = addReferenceAssemblyAttribute(builder);
  assert.equal(addReferenceAssemblyAttribute(builder), marker);
  const metadata = readMetadata(builder.finish());
  assert.equal(metadata.rows[12].length, 1);
  const [parent, encodedConstructor, blob] = metadata.rows[12][0];
  assert.equal(decodeCoded('HasCustomAttribute', parent), 0x20000001);
  const constructor = metadata.row(decodeCoded('CustomAttributeType', encodedConstructor));
  assert.equal(metadata.string(constructor[1]), '.ctor');
  assert.deepEqual([...metadata.blob(constructor[2])], [0x20, 0, 1]);
  assert.deepEqual([...metadata.blob(blob)], [1, 0, 0, 0]);
});

test('A03-T22 marker writer follows an explicit reference identity and refuses netmodules before mutation', () => {
  const builder = new MetadataBuilder('Reference', {
    framework: 'net10', assemblyReferences: [{ name: 'Custom.Contracts', version: [3, 2, 1, 0] }],
  });
  addReferenceAssemblyAttribute(builder, 'Custom.Contracts');
  assert.deepEqual(builder.rows[35][0].slice(0, 4), [3, 2, 1, 0]);
  const module = new MetadataBuilder('Part', { outputKind: 'netmodule' });
  const before = structuredClone(module.rows);
  assert.throws(() => addReferenceAssemblyAttribute(module), /one Assembly definition/);
  assert.deepEqual(module.rows, before);
});
