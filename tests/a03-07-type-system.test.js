import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMetadataVerificationTypeSystem as create, verificationTypeSystemDiagnosticCatalog,
  verificationType, VerificationKind, mergeVerificationTypes, codedIndex,
} from '@sharpforge/cil';
import { typeSystemFixture } from './fixtures/a03-verifier-types/input.js';

const fails = code => error => error.name === 'CilError' && error.code === code;
function fixture(options) {
  const input = typeSystemFixture();
  const inspector = input.inspect();
  const adapter = create(inspector, options);
  const type = name => adapter.resolveType(input.tokens[name]).value;
  return { ...input, inspector, adapter, type };
}

test('local definitions have immutable adapter-scoped canonical identities', () => {
  const { adapter, tokens, type } = fixture();
  assert.equal(type('Left'), type('Left'));
  assert.ok(Object.isFrozen(adapter));
  assert.ok(Object.isFrozen(type('Left')));
  assert.ok(Object.isFrozen(adapter.resolveType(tokens.Left)));
  assert.equal(adapter.baseType(type('Left')).value, type('Parent'));
  assert.equal(adapter.baseType(type('Root')).value, null);
  const second = fixture();
  assert.notEqual(type('Left'), second.type('Left'));
  assert.throws(() => adapter.isAssignable(type('Left'), second.type('Left')), fails('CILVT0004'));
  assert.throws(() => adapter.baseType({ ...type('Left') }), fails('CILVT0004'));
});

test('class and interface assignments include inherited and transitive interfaces', () => {
  const { adapter, type } = fixture();
  for (const [source, target] of [['Left', 'Root'], ['Left', 'IContract'], ['IChild', 'IContract'], ['Right', 'Parent']]) {
    assert.deepEqual(adapter.isAssignable(type(source), type(target)), { status: 'known', value: true });
  }
  for (const [source, target] of [['Root', 'Left'], ['Left', 'Right'], ['IContract', 'IChild'], ['Left', 'IUnrelated']]) {
    assert.deepEqual(adapter.isAssignable(type(source), type(target)), { status: 'known', value: false });
  }
  const interfaces = adapter.interfaces(type('Parent')).value;
  assert.ok(Object.isFrozen(interfaces));
  assert.equal(interfaces[0].value, type('IChild'));
  assert.equal(adapter.commonBaseType(type('Left'), type('Right')).value, type('Parent'));
});

test('the existing stack merge seam uses the adapter and refuses unavailable relations', () => {
  const { adapter, type } = fixture();
  const value = name => verificationType(VerificationKind.Object, type(name));
  const joined = mergeVerificationTypes(value('Left'), value('Right'), adapter.relations);
  assert.equal(joined.kind, VerificationKind.Object);
  assert.equal(joined.type, type('Parent'));
  assert.equal(mergeVerificationTypes(value('Left'), value('IContract'), adapter.relations).type, type('IContract'));
  assert.throws(() => mergeVerificationTypes(value('ExternalChild'), value('Left'), adapter.relations), fails('CILV0003'));
  const pointer = name => verificationType(VerificationKind.ManagedPointer, type(name));
  assert.throws(() => mergeVerificationTypes(pointer('Left'), pointer('Parent'), adapter.relations), fails('CILV0003'));
});

test('unresolved externals cannot bind to a same-named local type or become false certainty', () => {
  const { adapter, tokens, type } = fixture();
  assert.equal(adapter.resolveType(tokens.external).reason, 'unresolved-type-reference');
  assert.equal(adapter.baseType(type('ExternalChild')).status, 'unknown');
  assert.equal(adapter.isAssignable(type('ExternalChild'), type('Parent')).status, 'unknown');
  assert.equal(adapter.resolveType(tokens.array).reason, 'type-specification');
  assert.equal(adapter.resolveType(tokens.Open).reason, 'generic-definition');
  assert.equal(adapter.isAssignable(type('IContract'), type('Root')).reason, 'interface-object-root');
  assert.equal(adapter.commonBaseType(type('IContract'), type('IChild')).status, 'unknown');
  assert.throws(() => adapter.isAssignable(adapter.resolveType(tokens.external), type('Parent')), fails('CILVT0004'));
});

test('snapshots own hierarchy facts and do not expose mutable metadata arrays', () => {
  const { adapter, inspector, tokens, type } = fixture();
  inspector.metadata.rows[2][(tokens.Left & 0xffffff) - 1][3] = 0;
  inspector.metadata.rows[9].length = 0;
  assert.equal(adapter.baseType(type('Left')).value, type('Parent'));
  assert.equal(adapter.isAssignable(type('Left'), type('IContract')).value, true);
});

test('invalid tokens, local cycles and class/interface edge kinds are rejected', () => {
  const { adapter } = fixture();
  for (const token of [0, -1, 1.5, 0x100000000, 0x06000001, 0x0200ffff]) {
    assert.throws(() => adapter.resolveType(token), fails('CILVT0001'));
  }
  const cyclic = typeSystemFixture();
  cyclic.builder.rows[2][1][3] = codedIndex('TypeDefOrRef', cyclic.tokens.Left);
  assert.throws(() => create(cyclic.inspect()), fails('CILVT0001'));
  const badInterface = typeSystemFixture();
  badInterface.builder.addRow('InterfaceImpl', { Class: badInterface.tokens.Left, Interface: badInterface.tokens.Right });
  assert.throws(() => create(badInterface.inspect()), fails('CILVT0001'));
  const badBase = typeSystemFixture();
  badBase.builder.rows[2][1][3] = codedIndex('TypeDefOrRef', badBase.tokens.IContract);
  assert.throws(() => create(badBase.inspect()), fails('CILVT0001'));
  assert.equal(Object.keys(verificationTypeSystemDiagnosticCatalog).length, 4);
});

test('metadata and traversal budgets are enforced before unbounded expansion', () => {
  const input = typeSystemFixture();
  const inspector = input.inspect();
  for (const options of [{ maxTypes: 1 }, { maxEdges: 1 }, { maxTypes: 65536 }, { maxDepth: -1 }, { maxQueryNodes: NaN }]) {
    assert.throws(() => create(inspector, options), fails('CILVT0002'));
  }
  const adapter = create(inspector, { maxDepth: 1 });
  const left = adapter.resolveType(input.tokens.Left).value;
  const root = adapter.resolveType(input.tokens.Root).value;
  assert.throws(() => adapter.isAssignable(left, root), fails('CILVT0002'));
  const nodes = create(inspector, { maxQueryNodes: 1 });
  assert.throws(() => nodes.isAssignable(nodes.resolveType(input.tokens.Left).value,
    nodes.resolveType(input.tokens.Root).value), fails('CILVT0002'));
});

test('construction and subsequent queries observe cancellation', () => {
  const controller = new AbortController();
  const { adapter, tokens } = fixture({ signal: controller.signal });
  controller.abort();
  assert.throws(() => adapter.resolveType(tokens.Left), fails('CILVT0003'));
  const input = typeSystemFixture();
  assert.throws(() => create(input.inspect(), { signal: controller.signal }), fails('CILVT0003'));
});

test('diamond interfaces are de-duplicated and query frontier allocation respects the node budget', () => {
  const input = typeSystemFixture();
  input.builder.addRow('InterfaceImpl', { Class: input.tokens.Left, Interface: input.tokens.IContract });
  const adapter = create(input.inspect(), { maxQueryNodes: 5 });
  assert.equal(adapter.isAssignable(adapter.resolveType(input.tokens.Left).value,
    adapter.resolveType(input.tokens.IContract).value).value, true);
  const tiny = create(input.inspect(), { maxQueryNodes: 1 });
  assert.throws(() => tiny.isAssignable(tiny.resolveType(input.tokens.Left).value,
    tiny.resolveType(input.tokens.IContract).value), fails('CILVT0002'));
});
