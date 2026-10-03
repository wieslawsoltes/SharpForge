import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, readMetadata, writePE, AssemblyInspector } from '@sharpforge/cil';

function shuffled() {
  const builder = new MetadataBuilder('Pointers', { uncompressed: true, extraData: 0x12345678 });
  builder.addRow('TypeDef', { Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
  for (const [name, start] of [['One', 1], ['Two', 2]]) {
    builder.addRow('TypeDef', { Flags: 1, Name: name, Namespace: '', Extends: 0, FieldList: start, MethodList: start });
  }
  for (const name of ['Second', 'First']) {
    builder.addRow('Field', { Flags: 6, Name: name, Signature: new Uint8Array([6, 8]) });
    builder.addRow('MethodDef', { RVA: 0, ImplFlags: 0, Flags: 6, Name: name,
      Signature: new Uint8Array([0, 1, 1, 8]), ParamList: name === 'Second' ? 1 : 2 });
    builder.addRow('Param', { Flags: 0, Sequence: 1, Name: name });
    builder.addRow('Event', { EventFlags: 0, Name: name, EventType: 0 });
    builder.addRow('Property', { Flags: 0, Name: name, Type: new Uint8Array([8, 0, 8]) });
  }
  for (const table of [3, 5, 7, 19, 22]) for (const row of [2, 1]) builder.add(table, [row]);
  for (const table of [18, 21]) { builder.add(table, [2, 1]); builder.add(table, [3, 2]); }
  builder.add(30, [0x02000002, 1]);
  builder.add(31, [0x02000002]);
  return builder;
}

test('A03 #- pointer lists and ExtraData preserve physical rows and resolved owners', () => {
  const builder = shuffled();
  const bytes = builder.finish();
  const metadata = readMetadata(bytes);
  assert.equal(metadata.uncompressed, true);
  assert.equal(metadata.extraData, 0x12345678);
  assert.deepEqual(metadata.list(0x02000002, 'FieldList'), [0x04000002]);
  assert.deepEqual(metadata.list(0x02000003, 'MethodList'), [0x06000001]);
  assert.deepEqual(metadata.list(0x06000001, 'ParamList'), [0x08000002]);
  assert.deepEqual(metadata.list(0x12000001, 'EventList'), [0x14000002]);
  assert.deepEqual(metadata.list(0x15000001, 'PropertyList'), [0x17000002]);
  assert.deepEqual(metadata.rows[30], [[0x02000002, 1]]);
  assert.deepEqual(metadata.rows[31], [[0x02000002]]);
  assert.throws(() => metadata.list(0x02000002, 'Name'), /Not a metadata list/);
  metadata.rows[3][0][0] = 3;
  assert.throws(() => metadata.list(0x02000002, 'FieldList'), /pointer row/);
});

test('A03 inspector applies #- indirection for all declaration lists', () => {
  const metadata = shuffled().finish();
  const image = writePE(new Uint8Array(), metadata, 0);
  const inspector = new AssemblyInspector(image);
  assert.deepEqual(inspector.types[1].fields.map(field => field.name), ['First']);
  assert.deepEqual(inspector.types[1].methods.map(method => method.name), ['First']);
  assert.deepEqual(inspector.types[1].events.map(event => event.name), ['First']);
  assert.deepEqual(inspector.types[1].properties.map(property => property.name), ['First']);
  assert.equal(inspector.getMethod(0x06000001).parameters[0].name, 'First');
});
