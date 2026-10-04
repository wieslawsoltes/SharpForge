import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMetadataVerificationTypeSystem as create, createMetadataVerificationContext, codedIndex } from '@sharpforge/cil';
import { nestedReferenceFixture, nestedReferenceCases } from './fixtures/a03-nested-type-references/input.js';
import { nestedMemberFixture, memberAliasCases, memberAliasUnknownCases } from './fixtures/a03-nested-type-references/member-input.js';

const fails = code => error => error.name === 'CilError' && error.code === code;
const row = (metadata, token) => metadata.rows[token >>> 24][(token & 0xffffff) - 1];

test('nested local TypeRefs share canonical definitions through forward and multilevel scopes', () => {
  const input = nestedReferenceFixture();
  const adapter = create(input.inspect());
  for (const [reference, definition] of Object.entries(nestedReferenceCases)) {
    const resolved = adapter.resolveType(input.tokens[reference]);
    assert.equal(resolved.status, 'known', reference);
    assert.equal(resolved, adapter.resolveType(input.tokens[definition]), reference);
  }
  assert.notEqual(adapter.resolveType(input.tokens.leaf), adapter.resolveType(input.tokens.otherLeaf));
  assert.notEqual(adapter.resolveType(input.tokens.leaf), adapter.resolveType(input.tokens.TopLevelLeaf));
  assert.notEqual(adapter.resolveType(input.tokens.unicode), adapter.resolveType(input.tokens.bom));
});

test('wrong enclosing identities and unresolved or generic scopes never bind local names', () => {
  const input = nestedReferenceFixture();
  const adapter = create(input.inspect());
  for (const name of ['wrongEnclosing', 'wrongNamespace', 'wrongCase', 'missing', 'externalNested', 'nilNested', 'inOpen']) {
    assert.equal(adapter.resolveType(input.tokens[name]).status, 'unknown', name);
  }
  assert.equal(adapter.resolveType(input.tokens.open).reason, 'generic-definition');
  const context = createMetadataVerificationContext(input.inspect());
  assert.equal(context.resolveMember(input.tokens.externalMember).status, 'unknown');
  assert.equal(context.resolveMember(input.tokens.genericMember).status, 'unknown');
  input.definition('Leaf', input.tokens.Middle);
  assert.equal(create(input.inspect()).resolveType(input.tokens.leaf).status, 'unknown');
  assert.equal(createMetadataVerificationContext(input.inspect()).resolveMember(input.tokens.valueReference).status, 'unknown');
});

test('nested aliases participate in hierarchy, member resolution and access with existing identities', () => {
  const input = nestedReferenceFixture();
  const adapter = createMetadataVerificationContext(input.inspect());
  const type = name => adapter.resolveType(input.tokens[name]).value;
  assert.equal(adapter.baseType(type('Leaf')).value, type('Base'));
  assert.equal(adapter.baseType(type('Derived')).value, type('Leaf'));
  assert.equal(adapter.isAssignable(type('Derived'), type('Contract')).value, true);
  assert.equal(adapter.commonBaseType(type('Derived'), type('Leaf')).value, type('Leaf'));
  const member = adapter.resolveMember(input.tokens.valueReference);
  assert.equal(member, adapter.resolveMember(input.tokens.value));
  assert.equal(member.value.owner, type('leaf'));
  assert.equal(adapter.isTypeAccessible(type('secret'), type('Outer')).value, true);
  assert.equal(adapter.isTypeAccessible(type('secret'), type('OtherOuter')).value, false);
  assert.throws(() => adapter.isTypeAccessible({ ...type('leaf') }, type('Outer')), fails('CILVT0004'));
});

test('the combined context reuses the validated lexical forest and owns its copied facts', () => {
  const input = nestedReferenceFixture();
  const inspector = input.inspect();
  const rows = inspector.metadata.rows[41];
  let reads = 0;
  Object.defineProperty(inspector.metadata.rows, 41, { get() { reads++; return rows; } });
  const adapter = createMetadataVerificationContext(inspector);
  assert.equal(reads, 1);
  rows.length = 0;
  inspector.metadata.rows[1].length = 0;
  inspector.metadata.streams.get('#Strings').fill(0);
  const leaf = adapter.resolveType(input.tokens.leaf).value;
  assert.equal(adapter.resolveMember(input.tokens.valueReference).value.owner, leaf);
  assert.equal(adapter.isTypeAccessible(adapter.resolveType(input.tokens.secret).value,
    adapter.resolveType(input.tokens.Outer).value).value, true);
});

test('nested aliases expose hierarchy cycles and invalid class/interface kinds before queries', () => {
  for (const [owner, target] of [['Leaf', 'leaf'], ['Base', 'leaf'], ['Leaf', 'contract']]) {
    const input = nestedReferenceFixture();
    row(input.builder, input.tokens[owner])[3] = codedIndex('TypeDefOrRef', input.tokens[target]);
    assert.throws(() => create(input.inspect()), fails('CILVT0001'));
  }
  const input = nestedReferenceFixture();
  input.builder.addRow('InterfaceImpl', { Class: input.tokens.Derived, Interface: input.tokens.leaf });
  assert.throws(() => create(input.inspect()), fails('CILVT0001'));
});

test('malformed lexical ownership and cyclic TypeRef scopes reject deterministically', () => {
  const mutations = [
    metadata => metadata.rows[41].push([...metadata.rows[41][0]]),
    metadata => { metadata.rows[41][0][1] = metadata.rows[41][0][0]; },
    metadata => { metadata.rows[41][0][0] = 0; },
    metadata => { metadata.rows[41][0][1] = 0xffffff; },
    metadata => { metadata.rows[41][0].push(1); },
  ];
  for (const mutate of mutations) {
    const inspector = nestedReferenceFixture().inspect();
    mutate(inspector.metadata);
    assert.throws(() => create(inspector), fails('CILVT0001'));
  }
  const input = nestedReferenceFixture();
  for (const [source, target] of [['middle', 'leaf'], ['externalNested', 'externalNested']]) {
    const inspector = input.inspect();
    row(inspector.metadata, input.tokens[source])[0] = codedIndex('ResolutionScope', input.tokens[target]);
    assert.throws(() => create(inspector), fails('CILVT0001'));
  }
  const inspector = input.inspect();
  row(inspector.metadata, input.tokens.Middle)[0] = 1;
  assert.throws(() => create(inspector), fails('CILVT0001'));
});

test('reference-chain limits admit the exact boundary and cap long lexical chains', () => {
  const input = nestedReferenceFixture();
  assert.equal(create(input.inspect(), { maxDepth: 2 }).resolveType(input.tokens.leaf).status, 'known');
  assert.throws(() => create(input.inspect(), { maxDepth: 1 }), fails('CILVT0002'));
  let parent = input.tokens.Outer;
  let scope = input.tokens.outer;
  for (let depth = 1; depth <= 64; depth++) {
    parent = input.definition(`Level${depth}`, parent);
    scope = input.reference(`Level${depth}`, scope);
  }
  const inspector = input.inspect();
  assert.equal(create(inspector).resolveType(scope).value.token, parent);
  // Extend parsed rows to exercise adapter budgets independently of inspector display-name depth.
  const metadata = inspector.metadata;
  metadata.rows[1].push([codedIndex('ResolutionScope', scope), row(metadata, scope)[1], 0]);
  assert.throws(() => create(inspector), fails('CILVT0002'));
  metadata.rows[1].pop();
  metadata.rows[2].push([...row(metadata, parent)]);
  metadata.rows[41].push([metadata.rows[2].length, parent & 0xffffff]);
  assert.throws(() => create(inspector), fails('CILVT0002'));
  input.definition('TooDeep', parent);
  assert.throws(() => input.inspect(), /Recursive TypeSpec or nesting limit exceeded/);
});

test('nested reference construction and subsequent queries observe cancellation', () => {
  const input = nestedReferenceFixture();
  const inspector = input.inspect();
  const controller = new AbortController();
  const rows = inspector.metadata.rows[41];
  Object.defineProperty(inspector.metadata.rows, 41, { get() { controller.abort(); return rows; } });
  assert.throws(() => create(inspector, { signal: controller.signal }), fails('CILVT0003'));
  const next = new AbortController();
  const adapter = create(input.inspect(), { signal: next.signal });
  next.abort();
  assert.throws(() => adapter.resolveType(input.tokens.leaf), fails('CILVT0003'));
  assert.throws(() => create(input.inspect(), { signal: next.signal }), fails('CILVT0003'));
});

test('top-level and nested TypeRef member owners preserve declaration and inherited-method semantics', () => {
  const input = nestedMemberFixture();
  const adapter = createMetadataVerificationContext(input.inspect());
  for (const [name, token] of Object.entries(memberAliasCases)) {
    const resolved = adapter.resolveMember(input.tokens[name]);
    assert.equal(resolved.status, 'known', name);
    assert.equal(resolved, adapter.resolveMember(token), name);
  }
  for (const name of Object.keys(memberAliasUnknownCases)) {
    assert.equal(adapter.resolveMember(input.tokens[name]).status, 'unknown', name);
  }
});

test('retained native ResolveMember comparisons cover local aliases and declaration-only fields', () => {
  const fixtureURL = new URL('./fixtures/a03-nested-type-references/', import.meta.url);
  const capture = JSON.parse(readFileSync(new URL('member-native.json', fixtureURL), 'utf8'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const input = nestedMemberFixture();
  assert.equal(hash(input.bytes), capture.fixtureSHA256);
  assert.equal(hash(readFileSync(new URL('member-input.js', fixtureURL))), capture.inputSHA256);
  assert.equal(hash(readFileSync(new URL('../a03-verifier-members/InheritedProgram.cs', fixtureURL))), capture.templateSHA256);
  assert.equal(capture.execution.exitCode, 0);
  assert.equal(capture.execution.signal, null);
  const observed = JSON.parse(capture.execution.stdout).members;
  const adapter = createMetadataVerificationContext(input.inspect());
  for (const [name, token] of Object.entries(memberAliasCases)) {
    const native = observed.find(member => member.token === input.tokens[name]);
    const resolved = adapter.resolveMember(input.tokens[name]);
    assert.equal(native.success, true, name);
    assert.equal(native.definition, token, name);
    assert.equal(resolved.value.token, native.definition, name);
    assert.equal(resolved.value.owner.token, native.owner, name);
    assert.equal(resolved.value.kind, native.kind, name);
  }
  for (const [name, error] of Object.entries(memberAliasUnknownCases)) {
    const native = observed.find(member => member.token === input.tokens[name]);
    assert.equal(native.success, false, name);
    assert.equal(native.error, error, name);
    assert.equal(adapter.resolveMember(input.tokens[name]).status, 'unknown', name);
  }
});

test('retained CoreCLR nested ResolveType observations agree with known identities and hierarchy', () => {
  const fixtureURL = new URL('./fixtures/a03-nested-type-references/', import.meta.url);
  const capture = JSON.parse(readFileSync(new URL('native.json', fixtureURL), 'utf8'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const input = nestedReferenceFixture();
  assert.equal(hash(input.bytes()), capture.fixtureSHA256);
  assert.equal(hash(readFileSync(new URL('input.js', fixtureURL))), capture.inputSHA256);
  assert.equal(hash(readFileSync(new URL('../a03-local-type-references/Program.cs', fixtureURL))), capture.templateSHA256);
  assert.equal(capture.execution.exitCode, 0);
  assert.equal(capture.execution.signal, null);
  const native = JSON.parse(capture.execution.stdout);
  assert.equal(native.runtime, capture.toolchain.runtime);
  const adapter = create(input.inspect());
  for (const [name, definition] of Object.entries(nestedReferenceCases)) {
    const observed = native.types.find(type => type.token === input.tokens[name]);
    assert.equal(observed.success, true, name);
    assert.equal(observed.local, true, name);
    assert.equal(observed.definition, input.tokens[definition], name);
    const resolved = adapter.resolveType(input.tokens[name]);
    assert.equal(resolved, adapter.resolveType(observed.definition), name);
    if (observed.baseToken !== null) assert.equal(adapter.baseType(resolved.value).value.token, observed.baseToken);
    for (const token of observed.interfaces) assert.equal(adapter.isAssignable(resolved.value, adapter.resolveType(token).value).value, true);
  }
  for (const name of ['wrongEnclosing', 'wrongNamespace', 'wrongCase', 'missing']) {
    assert.equal(native.types.find(type => type.token === input.tokens[name]).success, false, name);
    assert.equal(adapter.resolveType(input.tokens[name]).status, 'unknown', name);
  }
});
