import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, readMetadata, token } from '@sharpforge/cil';
import { nestedTypeMetadata } from './helpers/nested-type-metadata.js';

function addType(builder, name, parent = 0) {
  const value = builder.add(2, [parent ? 2 : 1, builder.string(name), 0, 0, 1, 1]);
  if (parent) builder.add(41, [value & 0xffffff, parent & 0xffffff]);
  return value;
}

test('A03 B05 names all nested types with one linear NestedClass traversal', () => {
  const count = 1000, metadata = readMetadata(nestedTypeMetadata(count));
  let visits = 0;
  metadata.rows[41] = new Proxy(metadata.rows[41], {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) visits++;
      return Reflect.get(target, property, receiver);
    },
  });
  for (let index = 0; index < count; index++) assert.equal(metadata.typeName(token(2, index + 2)), `Example.Outer+Inner${index}`);
  assert(visits <= count * 2, `NestedClass row visits ${visits} exceed linear budget ${count * 2}`);
  const indexed = visits;
  assert.equal(metadata.typeName(token(2, count + 1)), `Example.Outer+Inner${count - 1}`);
  assert.equal(visits, indexed, 'A repeated lookup must reuse this reader’s index');
});

test('A03 B05 keeps nested TypeRef and TypeSpec formatting and recursion boundaries', () => {
  const builder = new MetadataBuilder(), outer = builder.typeRef('Example.External', 'Dependency');
  const child = builder.addRow('TypeRef', { ResolutionScope: outer, Name: 'Inner', Namespace: '' });
  const definition = addType(builder, 'Local'), nested = addType(builder, 'Child', definition);
  const specification = builder.typeSpec({ kind: 'szarray', element: { kind: 'class', token: nested } });
  const metadata = readMetadata(builder.finish());
  assert.equal(metadata.typeName(child), 'Example.External+Inner');
  assert.equal(metadata.typeName(specification), 'Local+Child[]');
  assert.equal(metadata.typeName(nested, 63), 'Local+Child');
  assert.throws(() => metadata.typeName(nested, 64), /Recursive TypeSpec or nesting limit/);
  assert.throws(() => metadata.typeName(definition, 65), /Recursive TypeSpec or nesting limit/);
  assert.throws(() => metadata.typeName(token(32, 1)), /Unsupported CLI type token/);
  assert.throws(() => metadata.typeName(token(2, 999)), /Invalid metadata token/);
});

test('A03 B05 rejects duplicate and invalid NestedClass records and bounds cycles', () => {
  for (const rows of [[[2, 1], [2, 1]], [[2, 0]], [[9, 1]], [[2, 3]]]) {
    const builder = new MetadataBuilder();
    addType(builder, 'Outer');
    addType(builder, 'Inner');
    builder.rows[41] = rows;
    assert.throws(() => readMetadata(builder.finish()).typeName(token(2, 2)), /NestedClass type index/);
  }
  const builder = new MetadataBuilder();
  const first = addType(builder, 'First'), second = addType(builder, 'Second', first);
  builder.add(41, [first & 0xffffff, second & 0xffffff]);
  assert.throws(() => readMetadata(builder.finish()).typeName(first), /Recursive TypeSpec or nesting limit/);
});

test('A03 B05 builds indexes independently and only when TypeDef names are requested', () => {
  const builder = new MetadataBuilder(), external = builder.typeRef('Example.External');
  addType(builder, 'Local');
  builder.add(41, [1, 99]);
  const metadata = readMetadata(builder.finish());
  assert.equal(metadata.typeName(external), 'Example.External');
  assert.throws(() => metadata.typeName(token(2, 1)), /NestedClass type index/);
  const first = readMetadata(nestedTypeMetadata(2)), second = readMetadata(nestedTypeMetadata(4));
  assert.equal(first.typeName(token(2, 3)), 'Example.Outer+Inner1');
  assert.equal(second.typeName(token(2, 5)), 'Example.Outer+Inner3');
});
