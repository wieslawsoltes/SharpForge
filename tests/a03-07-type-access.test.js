import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, createMetadataVerificationContext as create } from '@sharpforge/cil';
import { nestedFixture } from './fixtures/a03-nested-access/input.js';
import { nativeCases, typeAccessIL } from './fixtures/a03-type-access/native-input.js';

const fails = code => error => error.name === 'CilError' && error.code === code;
function fixture(options, decorate) {
  const input = nestedFixture(decorate);
  const inspector = new AssemblyInspector(input.bytes);
  const context = create(inspector, options);
  const type = name => context.resolveType(input.types[name]).value;
  const access = (target, caller) => context.isTypeAccessible(type(target), type(caller));
  return { ...input, inspector, context, type, access };
}
function known(result, value) {
  assert.deepEqual(result, { status: 'known', value });
  assert(Object.isFrozen(result));
}

test('same-assembly top-level public and internal types are accessible from flat and nested callers', () => {
  const { access } = fixture(undefined, ({ md, type }) => {
    const token = type('Internal');
    md.rows[2][(token & 0xffffff) - 1][0] = 0;
  });
  for (const target of ['Outer', 'Internal']) for (const caller of ['Other', 'Deep']) known(access(target, caller), true);
});

test('type accessibility checks all six nested flags and every enclosing type', () => {
  const { access } = fixture();
  for (let visibility = 2; visibility <= 7; visibility++) {
    const target = 'Visibility' + visibility;
    known(access(target, 'Outer'), true);
    known(access(target, 'Other'), [2, 5, 7].includes(visibility));
    known(access(target, 'Derived'), visibility !== 3);
    known(access(target, 'NestedDerived'), visibility !== 3);
  }
  known(access('PublicInPrivate', 'Other'), false);
  known(access('PublicInPrivate', 'Outer'), true);
  known(access('Visibility3', 'Visibility3'), true);
});

test('nested callers inherit enclosing type privileges without requiring an instance receiver', () => {
  const { access, context, type, members } = fixture();
  known(access('Visibility3', 'Sibling'), true);
  known(access('PublicInPrivate', 'Deep'), true);
  known(access('Visibility4', 'NestedDerived'), true);
  // A containing type can name its private nested type, but cannot access that type's private members.
  known(access('Visibility3', 'Outer'), true);
  const privateMember = context.resolveMember(members['Visibility3.Instance1field']).value;
  known(context.isMemberAccessible(privateMember, type('Outer')), false);
});

test('type-access results use owned visibility and parent facts after source metadata is released', () => {
  const state = fixture();
  for (const row of state.inspector.metadata.rows[2]) row[0] = 1;
  for (const row of state.inspector.metadata.rows[41]) row[1] = state.types.Other & 0xffffff;
  state.bytes.fill(0);
  known(state.access('Visibility3', 'Other'), false);
  known(state.access('PublicInPrivate', 'Deep'), true);
});

test('type-access identity and cancellation checks apply to flat and nested queries', () => {
  const controller = new AbortController();
  const state = fixture({ signal: controller.signal }), foreign = fixture();
  const target = state.type('Outer'), caller = state.type('Deep'), nested = state.type('Visibility3');
  assert.throws(() => state.context.isTypeAccessible(foreign.type('Outer'), caller), fails('CILVT0004'));
  assert.throws(() => state.context.isTypeAccessible(target, foreign.type('Deep')), fails('CILVT0004'));
  assert.throws(() => state.context.isTypeAccessible({ ...nested }, caller), fails('CILVT0004'));
  assert.throws(() => state.context.isTypeAccessible(state.types.Outer, caller), fails('CILVT0004'));
  controller.abort();
  for (const value of [target, nested]) assert.throws(() => state.context.isTypeAccessible(value, caller), fails('CILVM0003'));
});

test('generic enclosing types and interface family relations stay explicitly unknown', () => {
  const { access } = fixture(undefined, ({ md, type }) => {
    const token = type('Interface', { base: 0 });
    md.rows[2][(token & 0xffffff) - 1][0] |= 0x20;
  });
  assert.equal(access('InGeneric', 'Other').reason, 'generic-definition');
  assert.equal(access('Visibility4', 'Interface').reason, 'interface-family-access');
});

test('type-only queries reuse the aggregate lexical and hierarchy work limits', () => {
  const state = fixture(undefined, ({ md, type }) => {
    const base = md.typeRef('Missing.Base', 'Missing');
    let owner = type('OwnerRoot', { base }), caller = type('CallerRoot', { base });
    for (let index = 0; index < 64; index++) {
      owner = type('Owner' + index, { base, enclosing: owner, visibility: 4 });
      caller = type('Caller' + index, { base, enclosing: caller });
    }
  });
  assert.throws(() => state.access('Owner63', 'Caller63'), fails('CILVM0002'));
  const bounded = fixture({ maxQueryNodes: 0 });
  known(bounded.access('Visibility3', 'Outer'), true);
  assert.throws(() => bounded.access('Visibility4', 'Derived'), fails('CILVT0002'));
});

test('pinned ILVerify type access agrees where local metadata produces known decisions', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-type-access/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.observations.length, nativeCases.length);
  for (const [index, input] of nativeCases.entries()) {
    const observed = capture.observations[index];
    assert.equal(observed.name, input.name);
    assert.equal(observed.sourceSHA256, createHash('sha256').update(typeAccessIL(input)).digest('hex'));
    assert.equal(observed.oracle.accepted, input.accepted);
    if (!input.accepted) assert(observed.oracle.errors.includes('TypeAccess'));
    if (input.query === 'unknown') assert.equal(observed.result.status, 'unknown');
    else assert.deepEqual(observed.result, { status: 'known', value: input.query });
  }
});
