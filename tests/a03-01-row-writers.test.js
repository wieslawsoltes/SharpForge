import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, readMetadata, Tables, tableDefinitions, codedIndex, TypeAttributes, FieldAttributes } from '@sharpforge/cil';

test('A03 every named-column writer preserves physical column order', () => {
  const builder = new MetadataBuilder('Rows');
  for (const definition of Object.values(tableDefinitions)) {
    const values = Object.fromEntries(definition.columns.map(column => [column, 0]));
    builder.addRow(definition.name, values);
  }
  const metadata = readMetadata(builder.finish());
  for (const definition of Object.values(tableDefinitions)) {
    assert.deepEqual(metadata.rows[definition.id].at(-1), definition.columns.map(() => 0));
  }
});

test('A03 definition writers encode token kinds and heap values', () => {
  const builder = new MetadataBuilder('Definitions');
  const owner = builder.definitions.typeDef({ Flags: TypeAttributes.Public, Name: 'Owner', Namespace: 'Demo',
    Extends: 0, FieldList: 1, MethodList: 1 });
  const field = builder.definitions.field({ Flags: FieldAttributes.Public, Name: 'Value', Signature: new Uint8Array([6, 8]) });
  const method = builder.definitions.method({ RVA: 0, ImplFlags: 0, Flags: 6, Name: 'M',
    Signature: new Uint8Array([0, 0, 1]), ParamList: 1 });
  const nested = builder.definitions.typeDef({ Flags: TypeAttributes.NestedPublic, Name: 'Inner', Namespace: '',
    Extends: 0, FieldList: 2, MethodList: 2 });
  builder.definitions.nestedClass({ NestedClass: nested, EnclosingClass: owner });
  builder.definitions.classLayout({ PackingSize: 4, ClassSize: 8, Parent: owner });
  builder.definitions.fieldLayout({ Offset: 4, Field: field });
  builder.definitions.fieldRVA({ RVA: 8192, Field: field });
  builder.definitions.constant({ Type: 8, Parent: field, Value: new Uint8Array([7, 0, 0, 0]) });
  builder.definitions.methodImpl({ Class: owner, MethodBody: method, MethodDeclaration: method });
  const metadata = readMetadata(builder.finish());
  assert.deepEqual(metadata.rows[Tables.NestedClass], [[2, 1]]);
  assert.deepEqual(metadata.rows[Tables.ClassLayout], [[4, 8, 1]]);
  assert.equal(metadata.rows[Tables.Constant][0][1], codedIndex('HasConstant', field));
  assert.deepEqual(metadata.rows[Tables.MethodImpl], [[1, 2, 2]]);
  assert.throws(() => builder.addRow('NotATable', {}), /Invalid named metadata row/);
  assert.throws(() => builder.addRow('Field', { Flags: 0, Name: 'X', Signature: 0, Extra: 1 }), /Unknown Field column/);
  assert.throws(() => builder.addRow('Field', { Flags: 0 }), /Missing Field column/);
  assert.throws(() => builder.definitions.fieldLayout({ Offset: 0, Field: method }), /Wrong token kind/);
  assert.throws(() => builder.definitions.constant({ Type: 65536, Parent: field, Value: 0 }), /overflows/);
  assert.throws(() => builder.definitions.constant({ Type: 8, Parent: owner, Value: 0 }), /cannot be encoded/);
});
