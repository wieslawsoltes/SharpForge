import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetadataVerificationTypeSystem as create, createMetadataVerificationContext, codedIndex } from '@sharpforge/cil';
import { categoryFixture, coreAuthority, externalFixture } from './fixtures/a03-type-categories/input.js';

const fails = code => error => error.name === 'CilError' && error.code === code;
const category = (adapter, token) => adapter.typeCategory(adapter.resolveType(token).value);
const row = (fixture, name) => fixture.builder.rows[2][(fixture.tokens[name] & 0xffffff) - 1];

test('explicit fundamental identity classifies local roots and concrete descendants without spelling rules', () => {
  const input = coreAuthority();
  const adapter = create(input.inspect(), { coreTypes: input.coreTypes });
  for (const name of ['Root', 'ValueRoot', 'EnumRoot', 'Class', 'Derived', 'Interface'])
    assert.deepEqual(category(adapter, input.tokens[name]), { status: 'known', value: 'reference' }, name);
  assert.deepEqual(category(adapter, input.tokens.Struct), { status: 'known', value: 'value' });
  assert.deepEqual(category(adapter, input.tokens.Enum), { status: 'known', value: 'enum' });
  assert.equal(category(adapter, input.tokens.Orphan).status, 'unknown');
  assert.equal(adapter.resolveType(input.tokens.Open).reason, 'generic-definition');
  assert.ok(Object.isFrozen(category(adapter, input.tokens.Struct)));
});

test('absent authority preserves explicit unknown categories, including same-spelled platform names', () => {
  const input = categoryFixture();
  input.definition('System.Object');
  const adapter = create(input.inspect());
  for (const name of ['Root', 'Class', 'Struct', 'Enum', 'System.Object'])
    assert.equal(category(adapter, input.tokens[name]).reason, 'unbound-type-category');
  assert.equal(category(adapter, input.tokens.Interface).value, 'reference');
});

test('foreign base bindings supply categories without becoming local token identities or hierarchy edges', () => {
  const core = coreAuthority();
  const input = externalFixture(core);
  const adapter = createMetadataVerificationContext(input.inspect(), { coreTypes: input.coreTypes });
  for (const name of ['LocalClass', 'LocalDerived', 'LocalInterface'])
    assert.equal(category(adapter, input.tokens[name]).value, 'reference');
  assert.equal(category(adapter, input.tokens.LocalValue).value, 'value');
  assert.equal(category(adapter, input.tokens.LocalEnum).value, 'enum');
  assert.equal(adapter.resolveType(input.tokens.Root).status, 'unknown');
  assert.equal(adapter.baseType(adapter.resolveType(input.tokens.LocalClass).value).status, 'unknown');
  assert.notEqual(adapter.resolveType(input.tokens.LocalClass).value, core.coreTypes.object);
  assert.throws(() => adapter.typeCategory(core.coreTypes.object), fails('CILVT0004'));
});

test('canonical flags and categories are owned immutable facts; callbacks are not retained by queries', () => {
  const input = externalFixture(coreAuthority());
  const inspector = input.inspect();
  const adapter = create(inspector, { coreTypes: input.coreTypes });
  const type = adapter.resolveType(input.tokens.LocalValue).value;
  assert.deepEqual(type, { kind: 'definition', token: input.tokens.LocalValue, isInterface: false, flags: 0x109 });
  assert.ok(Object.isFrozen(type));
  inspector.metadata.rows[2][3][0] = 1;
  input.bindings.clear();
  input.coreTypes.resolveType = () => { throw new Error('retained authority'); };
  assert.equal(type.flags, 0x109);
  assert.equal(adapter.typeCategory(type).value, 'value');
  assert.throws(() => adapter.typeCategory({ ...type }), fails('CILVT0004'));
});

test('unknown bindings and generic definitions stay unknown, never category guesses', () => {
  const input = externalFixture(coreAuthority());
  input.bindings.delete(input.tokens.Class);
  const open = input.definition('Open', input.tokens.Root);
  input.builder.addRow('GenericParam', { Number: 0, Flags: 0, Owner: open, Name: 'T' });
  const child = input.definition('OpenChild', open);
  const adapter = create(input.inspect(), { coreTypes: input.coreTypes });
  assert.equal(category(adapter, input.tokens.LocalClass).reason, 'unprepared');
  assert.equal(category(adapter, input.tokens.LocalDerived).status, 'unknown');
  assert.equal(category(adapter, child).reason, 'generic-definition');
  assert.equal(adapter.resolveType(open).status, 'unknown');
});

test('authority roots reject duplicates, foreign clones, interfaces, generics and malformed base chains', () => {
  const input = coreAuthority();
  const root = input.coreTypes;
  const variants = [null, {}, { ...root, enum: root.valueType }, { ...root, object: { ...root.object } },
    { ...root, object: input.context.resolveType(input.tokens.Interface).value },
    { ...root, object: { ...root.object, token: input.tokens.Open } },
    { ...root, enum: input.context.resolveType(input.tokens.Class).value }];
  for (const coreTypes of variants) assert.throws(() => create(input.inspect(), { coreTypes }), fails('CILVT0001'));
  const generic = categoryFixture();
  generic.builder.addRow('GenericParam', { Number: 0, Flags: 0, Owner: generic.tokens.Root, Name: 'T' });
  const context = create(generic.inspect());
  assert.throws(() => create(input.inspect(), { coreTypes: { ...root, context } }), fails('CILVT0001'));
});

test('fundamental local aliases and shape mismatches are rejected', () => {
  const input = coreAuthority();
  const resolveType = input.coreTypes.resolveType;
  assert.throws(() => create(input.inspect(), { coreTypes: { ...input.coreTypes,
    resolveType: token => token === input.tokens.Class ? { status: 'known', value: input.coreTypes.object } : resolveType(token),
  } }), fails('CILVT0001'));
  row(input, 'Root')[0] = 0x81;
  assert.throws(() => create(input.inspect(), { coreTypes: input.coreTypes }), fails('CILVT0001'));
});

test('sealed bases, value inheritance and unsealed concrete values reject malformed category chains', () => {
  for (const mutate of [
    input => { row(input, 'Struct')[0] = 1; },
    input => { row(input, 'Derived')[3] = codedIndex('TypeDefOrRef', input.tokens.Struct); },
    input => { row(input, 'Class')[0] |= 0x100; },
  ]) {
    const input = categoryFixture();
    mutate(input);
    const { coreTypes } = coreAuthority(input);
    assert.throws(() => create(input.inspect(), { coreTypes }), fails('CILVT0001'));
  }
});

test('foreign category traversal rejects cycles and malformed synchronous results', () => {
  const core = coreAuthority();
  const input = externalFixture(core);
  const context = { ...core.context, baseType(type) {
    if (type.token === core.tokens.Class) return core.context.resolveType(core.tokens.Derived);
    return core.context.baseType(type);
  } };
  assert.throws(() => create(input.inspect(), { coreTypes: { ...input.coreTypes, context } }), fails('CILVT0001'));
  for (const value of [null, Promise.resolve(null), { status: 'unknown' }, { status: 'unknown', reason: 'x'.repeat(257) },
    { status: 'known', value: { ...core.coreTypes.object } }]) {
    assert.throws(() => create(input.inspect(), { coreTypes: { ...input.coreTypes, resolveType: () => value } }), fails('CILVT0001'));
  }
});

test('construction enforces exact authority node and cumulative category depth boundaries', () => {
  const input = externalFixture(coreAuthority());
  const options = { coreTypes: input.coreTypes, maxQueryNodes: 4, maxDepth: 3 };
  const adapter = create(input.inspect(), options);
  assert.equal(category(adapter, input.tokens.LocalDerived).value, 'reference');
  for (const limits of [{ maxQueryNodes: 3 }, { maxDepth: 2 }, { maxDepth: 0 }])
    assert.throws(() => create(input.inspect(), { ...options, ...limits }), fails('CILVT0002'));
});

test('metadata flags must be uint32 and authority errors/cancellation propagate unchanged', () => {
  const input = externalFixture(coreAuthority());
  for (const flags of [-1, 0x100000000, 1.5, NaN]) {
    const inspector = input.inspect();
    inspector.metadata.rows[2][1][0] = flags;
    assert.throws(() => create(inspector), fails('CILVT0001'));
  }
  const failure = new Error('binding failed');
  assert.throws(() => create(input.inspect(), { coreTypes: { ...input.coreTypes, resolveType() { throw failure; } } }),
    error => error === failure);
  const controller = new AbortController();
  const coreTypes = { ...input.coreTypes, resolveType(token) { controller.abort(); return input.coreTypes.resolveType(token); } };
  assert.throws(() => create(input.inspect(), { coreTypes, signal: controller.signal }), fails('CILVT0003'));
  const live = new AbortController();
  const adapter = create(input.inspect(), { coreTypes: input.coreTypes, signal: live.signal });
  const type = adapter.resolveType(input.tokens.LocalClass).value;
  live.abort();
  assert.throws(() => adapter.typeCategory(type), fails('CILVT0003'));
});
