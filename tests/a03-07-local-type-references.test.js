import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetadataVerificationTypeSystem as create, codedIndex } from '@sharpforge/cil';
import { localReferenceFixture, localReferenceCases } from './fixtures/a03-local-type-references/input.js';

const fails = code => error => error.name === 'CilError' && error.code === code;
const row = (metadata, token) => metadata.rows[token >>> 24][(token & 0xffffff) - 1];

test('explicit Module-scoped TypeRefs share canonical local TypeDef results', () => {
  const input = localReferenceFixture();
  const adapter = create(input.inspect());
  for (const [reference, definition] of Object.entries(localReferenceCases)) {
    const resolved = adapter.resolveType(input.tokens[reference]);
    assert.equal(resolved.status, 'known', reference);
    assert.equal(resolved, adapter.resolveType(input.tokens[definition]), reference);
    assert.ok(Object.isFrozen(resolved.value));
  }
  assert.notEqual(adapter.resolveType(input.tokens.parent).value, adapter.resolveType(input.tokens.bom).value);
});

test('local aliases normalize base and interface edges before hierarchy queries', () => {
  const input = localReferenceFixture();
  const adapter = create(input.inspect());
  const type = name => adapter.resolveType(input.tokens[name]).value;
  assert.equal(adapter.baseType(type('Child')).value, type('Parent'));
  assert.equal(adapter.interfaces(type('Parent')).value[0].value, type('IChild'));
  assert.equal(adapter.isAssignable(type('Child'), type('IRoot')).value, true);
  assert.equal(adapter.commonBaseType(type('Child'), type('Sibling')).value, type('Parent'));
  const second = create(input.inspect());
  assert.throws(() => adapter.baseType(second.resolveType(input.tokens.parent).value), fails('CILVT0004'));
});

test('unsupported scopes, missing names and generic definitions remain explicitly unknown', () => {
  const input = localReferenceFixture();
  const adapter = create(input.inspect());
  for (const name of ['nil', 'module', 'assembly', 'nested', 'nestedAsTopLevel', 'object', 'missing',
    'wrongCase', 'wrongNamespace', 'moduleType']) {
    assert.deepEqual(adapter.resolveType(input.tokens[name]), {
      status: 'unknown', reason: 'unresolved-type-reference', token: input.tokens[name],
    }, name);
  }
  assert.deepEqual(adapter.resolveType(input.tokens.open), {
    status: 'unknown', reason: 'generic-definition', token: input.tokens.open,
  });
});

test('ambiguous local names never choose a definition by row order', () => {
  const input = localReferenceFixture();
  input.definition('Parent');
  input.definition('Parent');
  const adapter = create(input.inspect());
  assert.equal(adapter.resolveType(input.tokens.parent).status, 'unknown');
  assert.equal(adapter.baseType(adapter.resolveType(input.tokens.Child).value).status, 'unknown');
});

test('cycles and invalid edge kinds introduced through local references are rejected', () => {
  for (const [owner, target] of [['Parent', 'child'], ['Parent', 'parent'], ['Child', 'rootInterface']]) {
    const input = localReferenceFixture();
    row(input.builder, input.tokens[owner])[3] = codedIndex('TypeDefOrRef', input.tokens[target]);
    assert.throws(() => create(input.inspect()), fails('CILVT0001'), `${owner}: ${target}`);
  }
  const input = localReferenceFixture();
  input.builder.addRow('InterfaceImpl', { Class: input.tokens.Child, Interface: input.tokens.parent });
  assert.throws(() => create(input.inspect()), fails('CILVT0001'));
  const interfaces = localReferenceFixture();
  interfaces.builder.addRow('InterfaceImpl', { Class: interfaces.tokens.IRoot, Interface: interfaces.tokens.childInterface });
  assert.throws(() => create(interfaces.inspect()), fails('CILVT0001'));
});

test('invalid physical scopes and nonexistent scope rows are rejected', () => {
  for (const scope of [-1, NaN, 0x100000000, 1, 2, 3, 8, 0xfffffffd]) {
    const input = localReferenceFixture();
    const inspector = input.inspect();
    row(inspector.metadata, input.tokens.parent)[0] = scope;
    assert.throws(() => create(inspector), fails('CILVT0001'), String(scope));
  }
  const input = localReferenceFixture();
  const inspector = input.inspect();
  inspector.metadata.rows[0].push([...inspector.metadata.rows[0][0]]);
  assert.throws(() => create(inspector), fails('CILVT0001'));
});

test('name keys reject invalid indices, empty names and unterminated strings', () => {
  for (const index of [-1, NaN, 0, 0xffffffff]) {
    const input = localReferenceFixture();
    const inspector = input.inspect();
    row(inspector.metadata, input.tokens.parent)[1] = index;
    assert.throws(() => create(inspector), fails('CILVT0001'));
  }
  const input = localReferenceFixture();
  const inspector = input.inspect();
  const heap = inspector.metadata.streams.get('#Strings');
  row(inspector.metadata, input.tokens.parent)[1] = heap.length - 1;
  heap[heap.length - 1] = 65;
  assert.throws(() => create(inspector), fails('CILVT0001'));
});

test('reference and byte budgets admit exact boundaries and reject excess before copying', () => {
  const input = localReferenceFixture();
  const inspector = input.inspect();
  const count = inspector.metadata.rows[1].length;
  assert.equal(create(inspector, { maxTypeReferences: count }).resolveType(input.tokens.parent).status, 'known');
  for (const options of [{ maxTypeReferences: count - 1 }, { maxTypeReferences: -1 }, { maxTypeReferences: 65536 },
    { maxTypeNameBytes: 0 }, { maxTypeNameBytes: 1048577 }, { maxTypeNameBytes: NaN }]) {
    assert.throws(() => create(inspector, options), fails('CILVT0002'));
  }
  // The tiny fixture reuses both name indices: their bytes must only count once.
  const tiny = localReferenceFixture();
  tiny.builder.rows[2] = tiny.builder.rows[2].slice(0, 2);
  tiny.builder.rows[1] = [tiny.builder.rows[1][1], tiny.builder.rows[1][2]];
  tiny.builder.rows[2][1][3] = 0;
  for (const table of [9, 41, 42]) tiny.builder.rows[table] = [];
  const bytes = Buffer.byteLength('ParentFixture');
  assert.equal(create(tiny.inspect(), { maxTypeNameBytes: bytes }).resolveType(0x01000001).status, 'known');
  assert.throws(() => create(tiny.inspect(), { maxTypeNameBytes: bytes - 1 }), fails('CILVT0002'));
});

test('individual names have a 1 KiB bound before argument expansion', () => {
  const input = localReferenceFixture();
  const name = 'A'.repeat(1024);
  const token = input.definition(name);
  const reference = input.reference(name);
  const adapter = create(input.inspect());
  assert.equal(adapter.resolveType(reference), adapter.resolveType(token));
  input.reference(name + 'A');
  assert.throws(() => create(input.inspect()), fails('CILVT0002'));
});

test('local alias facts survive later metadata and string heap mutation', () => {
  const input = localReferenceFixture();
  const inspector = input.inspect();
  const adapter = create(inspector);
  const parent = adapter.resolveType(input.tokens.parent);
  inspector.metadata.rows[1].length = 0;
  inspector.metadata.rows[2].length = 0;
  inspector.metadata.streams.get('#Strings').fill(0);
  assert.equal(adapter.resolveType(input.tokens.parent), parent);
  assert.equal(adapter.baseType(adapter.resolveType(input.tokens.Child).value), parent);
});

test('construction checks cancellation during local name indexing and queries remain cancellable', () => {
  const input = localReferenceFixture();
  const inspector = input.inspect();
  const controller = new AbortController();
  const definition = row(inspector.metadata, input.tokens.Parent);
  const name = definition[1];
  Object.defineProperty(definition, 1, { get() { controller.abort(); return name; } });
  assert.throws(() => create(inspector, { signal: controller.signal }), fails('CILVT0003'));
  const next = new AbortController();
  const adapter = create(input.inspect(), { signal: next.signal });
  next.abort();
  assert.throws(() => adapter.resolveType(input.tokens.parent), fails('CILVT0003'));
  assert.throws(() => create(input.inspect(), { signal: next.signal }), fails('CILVT0003'));
});
