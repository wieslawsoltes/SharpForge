import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, AssemblySymbolIndex, AssemblyTypeHierarchy, CilError, codedIndex } from '@sharpforge/cil';
import { builder, type, assemblyReference, reference, implementsType, inspector, hierarchyFixture } from './fixtures/type-hierarchy/input.mjs';

function loaded(inputs, options) {
  const inspectors = inputs.map(input => input instanceof AssemblyInspector ? input : inspector(input));
  const index = new AssemblySymbolIndex(inspectors);
  return { inspectors, index, graph: new AssemblyTypeHierarchy(index, inspectors, options) };
}
const walk = node => [node, ...node.children.flatMap(walk)];
const names = node => walk(node).map(item => item.symbol?.name).filter(Boolean);
const id = (state, module, token) => state.inspectors[module].tokenUri(token);

test('cross-assembly base, derived and interface-implementer trees match explicit fixture sets', () => {
  const fixture = hierarchyFixture(), state = loaded([fixture.a, fixture.b]), t = fixture.tokens;
  assert.deepEqual(names(state.graph.tree(id(state, 1, t.derived))), ['Hierarchy.Derived', 'Hierarchy.Base', 'Hierarchy.IChild', 'Hierarchy.IRoot']);
  assert.deepEqual(names(state.graph.tree(id(state, 0, t.base), { direction: 'derived' })), ['Hierarchy.Base', 'Hierarchy.Derived', 'Hierarchy.Further']);
  assert.deepEqual(names(state.graph.tree(id(state, 0, t.root), { direction: 'implementers' })),
    ['Hierarchy.IRoot', 'Hierarchy.IChild', 'Hierarchy.Derived', 'Hierarchy.Further']);
  const subinterfaces = state.graph.tree(id(state, 0, t.root), { direction: 'derived' });
  assert.deepEqual(names(subinterfaces), ['Hierarchy.IRoot', 'Hierarchy.IChild']);
  assert.equal(subinterfaces.children[0].relation, 'derived');
  const nested = state.graph.tree(id(state, 1, t.nested));
  assert.equal(nested.children[0].symbol.id, id(state, 0, t.inner));
  assert.notEqual(nested.children[0].symbol.token, 0x02000007); // Same display spelling, different lexical owner.
  assert.ok(state.inspectors.every(value => value.cache.size === 0));
});

test('a missing or ambiguous assembly produces stable owned dead-reference nodes', () => {
  const fixture = hierarchyFixture(), state = loaded([fixture.b]);
  const tree = state.graph.tree(id(state, 0, fixture.tokens.derived));
  assert.deepEqual(tree.children.map(node => node.diagnostic.reason), ['missing-assembly', 'missing-assembly']);
  assert.equal(tree.children[0].diagnostic.referenceId, id(state, 0, fixture.tokens.baseReference));
  tree.children[0].diagnostic.reason = 'changed';
  assert.equal(state.graph.tree(id(state, 0, fixture.tokens.derived)).children[0].diagnostic.reason, 'missing-assembly');
  const duplicate = hierarchyFixture().a;
  duplicate.rows[0][0][2] = duplicate.guid(Uint8Array.from({ length: 16 }, (_, i) => i + 66));
  const ambiguous = loaded([fixture.a, duplicate, fixture.b]);
  assert.equal(ambiguous.graph.tree(id(ambiguous, 2, fixture.tokens.derived)).children[0].diagnostic.reason, 'ambiguous-assembly');
});

test('declared assembly name/version/culture/key identity binds exactly, without signature authentication', () => {
  const a = builder('Signed', 41, { assemblyCulture: 'en-US' });
  const key = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  a.rows[32][0][5] = 1; a.rows[32][0][6] = a.blob(key);
  const base = type(a, 'Base');
  const token = new Uint8Array(createHash('sha1').update(key).digest().subarray(12)).reverse();
  for (const [change, expected] of [[{}, true], [{ version: [2, 0, 0, 0] }, false], [{ culture: 'fr' }, false],
    [{ key: new Uint8Array(8) }, false], [{ key, flags: 1 }, true], [{ flags: 0x100 }, false]]) {
    const b = builder('Consumer', 42), scope = assemblyReference(b, 'SIGNED', { culture: 'EN-us', key: token, ...change });
    const derived = type(b, 'Derived', reference(b, scope, 'Base')), state = loaded([a, b]);
    const edge = state.graph.tree(id(state, 1, derived)).children[0];
    assert.equal(edge.symbol?.id ?? null, expected ? id(state, 0, base) : null);
    if (!expected) assert.ok(edge.diagnostic.reason);
  }
});

test('ambiguous type names and unsupported TypeSpec/ModuleRef/nil scopes remain explicit', () => {
  const a = builder('Duplicate', 51); type(a, 'Base'); type(a, 'Base');
  const b = builder('Consumer', 52), scope = assemblyReference(b, 'Duplicate');
  const duplicate = type(b, 'DuplicateUse', reference(b, scope, 'Base'));
  const spec = b.add(27, [b.blob(new Uint8Array([0x1d, 8]))]);
  const constructed = type(b, 'Constructed', spec);
  const module = b.add(26, [b.string('other.netmodule')]);
  const moduleType = type(b, 'ModuleUse', reference(b, module, 'Base'));
  const nilType = type(b, 'NilUse', reference(b, 0, 'Base'));
  const state = loaded([a, b]);
  for (const [token, reason] of [[duplicate, 'ambiguous-type'], [constructed, 'type-specification'],
    [moduleType, 'module-reference'], [nilType, 'nil-resolution-scope']])
    assert.equal(state.graph.tree(id(state, 1, token)).children[0].diagnostic.reason, reason);
});

test('resolved inheritance cycles, malformed ownership, coded overflows and wrong target kinds reject', () => {
  const cycle = builder('Cycle', 61), left = type(cycle, 'Left'), right = type(cycle, 'Right', left);
  cycle.rows[2][1][3] = codedIndex('TypeDefOrRef', right);
  assert.throws(() => loaded([cycle]), /cyclic inheritance/);
  const bad = builder('WrongInterface', 62), owner = type(bad, 'Owner'), target = type(bad, 'Class');
  implementsType(bad, owner, target);
  assert.throws(() => loaded([bad]), /InterfaceImpl target/);
  const fixture = hierarchyFixture(), source = inspector(fixture.b);
  source.metadata.rows[1][0][0] = 0x400000007;
  assert.throws(() => loaded([inspector(fixture.a), source]), CilError);
  const duplicate = hierarchyFixture(); duplicate.a.add(41, [...duplicate.a.rows[41][0]]);
  assert.throws(() => loaded([duplicate.a]), /duplicate nested type owner/);
  const a = builder('Cycle.A', 63), b = builder('Cycle.B', 64);
  type(a, 'A', reference(a, assemblyReference(a, 'Cycle.B'), 'B'));
  type(b, 'B', reference(b, assemblyReference(b, 'Cycle.A'), 'A'));
  assert.throws(() => loaded([a, b]), /cyclic inheritance/);
});

test('all hierarchy construction budgets accept exact charges and reject one below before name decoding', () => {
  const fixture = hierarchyFixture(), state = loaded([fixture.a, fixture.b]), limits = state.graph.storage;
  const options = { maxAssemblies: limits.modules, maxTypes: limits.types, maxRows: limits.rows, maxEdges: limits.edges,
    maxNameBytes: limits.nameBytes, maxKeyBytes: limits.keyBytes };
  assert.ok(new AssemblyTypeHierarchy(state.index, state.inspectors, options));
  for (const [key, value] of Object.entries(options)) {
    if (value) assert.throws(() => new AssemblyTypeHierarchy(state.index, state.inspectors, { ...options, [key]: value - 1 }), /limit exceeded/);
  }
  for (const input of state.inspectors) input.metadata.string = () => { throw Error('decoded before preflight'); };
  assert.throws(() => new AssemblyTypeHierarchy(state.index, state.inspectors, { maxNameBytes: 0 }), /aggregate name bytes/);
});

test('malformed heap extents, oversized keys and cyclic reference scopes reject before binding', () => {
  const oversized = builder('Oversized', 71);
  oversized.rows[32][0][5] = 1; oversized.rows[32][0][6] = oversized.blob(new Uint8Array(16385));
  assert.throws(() => loaded([oversized]), /individual assembly key bytes/);
  const fixture = hierarchyFixture(), source = inspector(fixture.b);
  source.metadata.rows[2][1][1] = source.metadata.streams.get('#Strings').length;
  assert.throws(() => loaded([source]), /name heap index/);
  const cyclic = hierarchyFixture();
  cyclic.b.rows[1][0][0] = codedIndex('ResolutionScope', 0x01000002);
  cyclic.b.rows[1][1][0] = codedIndex('ResolutionScope', 0x01000001);
  assert.throws(() => loaded([cyclic.a, cyclic.b]), /cyclic TypeRef scopes/);
  const deep = builder('DeepReferences', 72);
  let parent = reference(deep, assemblyReference(deep, 'Absent'), 'Outer');
  type(deep, 'First', parent);
  for (let depth = 1; depth < 65; depth++) {
    parent = reference(deep, parent, 'Inner' + depth, '');
    type(deep, 'Use' + depth, parent); // Earlier aliases are cached before deeper ones are bound.
  }
  assert.throws(() => loaded([deep]), /TypeRef scope depth/);
});

test('queries bound nodes/depth, mark repeated DAG nodes, cancel, and return independently owned records', () => {
  const fixture = hierarchyFixture(); implementsType(fixture.b, fixture.tokens.further, fixture.tokens.interfaceReference);
  const state = loaded([fixture.a, fixture.b]), root = id(state, 0, fixture.tokens.root);
  const original = state.graph.tree(root, { direction: 'implementers' });
  assert.ok(walk(original).some(node => node.repeated));
  assert.throws(() => state.graph.tree(root, { direction: 'implementers', maxQueryNodes: 1 }), /limit exceeded/);
  assert.throws(() => state.graph.tree(root, { direction: 'implementers', maxDepth: 0 }), /limit exceeded/);
  assert.throws(() => state.graph.tree(root, { signal: AbortSignal.abort() }), /cancelled/);
  let checks = 0;
  assert.throws(() => state.graph.tree(root, { direction: 'implementers', signal: { get aborted() { return ++checks > 4; } } }), /cancelled/);
  assert.throws(() => new AssemblyTypeHierarchy(state.index, state.inspectors, { signal: AbortSignal.abort() }), /cancelled/);
  assert.throws(() => state.graph.tree(root, { direction: 'other' }), CilError);
  assert.throws(() => state.graph.tree(root, null), CilError);
  assert.equal(state.graph.tree('missing'), null);
  state.graph.tree(root, { direction: 'implementers' }).children[0].symbol.name = 'changed';
  state.graph.storage.types = 0;
  for (const value of state.inspectors) { value.pe.bytes.fill(0); value.metadata.rows[2].length = 0; }
  assert.deepEqual(state.graph.tree(root, { direction: 'implementers' }), original);
});

test('retained CoreCLR hierarchy sets and missing framework reference nodes match the captured image', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/clr-type-graphs/native-graphs.json', import.meta.url), 'utf8'));
  const bytes = Buffer.from(reference.image, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '6f2ba4d03f35bb7b4be65463c2f6bc19fd9451da21a695ce3ccf8a66b504131a');
  const state = loaded([new AssemblyInspector(bytes)]);
  const definitions = reference.definitions, byName = name => definitions.find(type => type.name === name);
  const base = byName('Fixture.Base'), root = byName('Fixture.IRoot');
  const expected = definitions.filter(type => type.interfaces.includes(root.name)).map(type => type.name).sort();
  const actual = names(state.graph.tree(id(state, 0, root.token), { direction: 'implementers' }));
  assert.deepEqual([...new Set(actual.filter(name => name !== root.name))].sort(), expected);
  assert.equal(state.graph.tree(id(state, 0, base.token)).children[0].diagnostic.reason, 'missing-assembly');
  assert.equal(state.graph.tree(id(state, 0, byName('Fixture.Child').token)).children[0].symbol.id, id(state, 0, base.token));
});
