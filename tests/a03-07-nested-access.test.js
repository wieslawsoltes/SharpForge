import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, createMetadataVerificationContext as create } from '@sharpforge/cil';
import { nestedFixture } from './fixtures/a03-nested-access/input.js';
import { nativeCases, nestedIL } from './fixtures/a03-nested-access/native-input.js';

const fails = code => error => error.name === 'CilError' && error.code === code;
function fixture(options, decorate) {
  const input = nestedFixture(decorate);
  const inspector = new AssemblyInspector(input.bytes);
  const context = create(inspector, options);
  const type = name => context.resolveType(input.types[name]).value;
  const member = name => context.resolveMember(input.members[name]).value;
  const access = (name, caller, receiver) => context.isMemberAccessible(member(name), type(caller),
    receiver === undefined ? undefined : { receiverType: type(receiver) });
  return { ...input, inspector, context, type, member, access };
}
function known(result, expected) {
  assert.deepEqual(result, { status: 'known', value: expected });
  assert(Object.isFrozen(result));
}

test('nested callers inherit enclosing privileges without granting reverse or sibling private access', () => {
  const { access } = fixture();
  for (const kind of ['field', 'method']) for (const storage of ['Static', 'Instance']) {
    for (const caller of ['Inner', 'Deep', 'Sibling']) known(access(`Outer.${storage}1${kind}`, caller), true);
    known(access(`Inner.${storage}1${kind}`, 'Deep'), true);
    for (const caller of ['Outer', 'Sibling', 'Other']) known(access(`Inner.${storage}1${kind}`, caller), false);
  }
});

test('every target nesting boundary restricts public members using its own access flags', () => {
  const { access } = fixture();
  for (let visibility = 2; visibility <= 7; visibility++) for (const kind of ['field', 'method']) {
    const target = `Visibility${visibility}.Static6${kind}`;
    known(access(target, 'Outer'), true);
    known(access(target, 'Inner'), true);
    known(access(target, 'Other'), [2, 5, 7].includes(visibility));
    known(access(target, 'Derived'), visibility !== 3);
  }
  known(access('PublicInPrivate.Static6field', 'Other'), false);
  known(access('PublicInPrivate.Static6method', 'Sibling'), true);
});

test('protected instance access uses the enclosing accessor that actually grants family privilege', () => {
  const { access } = fixture();
  for (const kind of ['field', 'method']) for (const flag of [2, 4]) {
    const target = `Outer.Instance${flag}${kind}`;
    known(access(target, 'NestedDerived', 'Derived'), true);
    known(access(target, 'NestedDerived', 'NestedReceiver'), true);
    known(access(target, 'NestedDerived', 'Outer'), false);
    assert.equal(access(target, 'NestedDerived').reason, 'protected-receiver-required');
    known(access(`Outer.Static${flag}${kind}`, 'NestedDerived'), true);
    known(access(target, 'Inner'), true);
  }
});

test('nested snapshots own parent facts and still reject foreign identities and cancellation', () => {
  const controller = new AbortController();
  const state = fixture({ signal: controller.signal }), foreign = fixture();
  for (const row of state.inspector.metadata.rows[41]) row[1] = state.types.Other & 0xffffff;
  state.bytes.fill(0);
  known(state.access('Outer.Static1field', 'Deep'), true);
  known(state.access('Inner.Static1field', 'Outer'), false);
  assert.throws(() => state.context.isMemberAccessible(foreign.member('Outer.Static1field'), state.type('Deep')), fails('CILVM0004'));
  assert.throws(() => state.context.isMemberAccessible(state.member('Outer.Static1field'), foreign.type('Deep')), fails('CILVT0004'));
  const member = state.member('Outer.Static1field'), caller = state.type('Deep');
  controller.abort();
  assert.throws(() => state.context.isMemberAccessible(member, caller), fails('CILVM0003'));
});

test('malformed raw RIDs, duplicate owners, missing flags and lexical cycles reject before queries', () => {
  const changes = [
    rows => { rows[41][0][0] = 0x1000001; }, rows => { rows[41][0][1] = 0x1000001; },
    rows => { rows[41][0][0] = 0; }, rows => { rows[41][0][1] = 1.5; },
    rows => { rows[41].push([...rows[41][0]]); }, rows => { rows[41][0] = [4]; },
    rows => { rows[41][0][1] = rows[41][0][0]; },
    rows => { rows[41][0][1] = rows[41][1][0]; },
    rows => { rows[2][rows[41][0][0] - 1][0] = 1; }, rows => { rows[41].shift(); },
  ];
  for (const change of changes) {
    const inspector = new AssemblyInspector(nestedFixture().bytes);
    change(inspector.metadata.rows);
    assert.throws(() => create(inspector), fails('CILVM0001'));
  }
  const inspector = new AssemblyInspector(nestedFixture().bytes);
  inspector.metadata.rows[41] = Array(inspector.metadata.rows[2].length + 1).fill([4, 3]);
  assert.throws(() => create(inspector), fails('CILVM0002'));
});

test('nesting depth stays bounded independently of inheritance', () => {
  const state = fixture(undefined, ({ type, types }) => {
    for (let index = 0; index < 65; index++) type('Level' + index, { enclosing: types.Outer });
  });
  const rows = state.inspector.metadata.rows;
  for (let index = 0; index < 65; index++) {
    const rid = state.types['Level' + index] & 0xffffff;
    rows[41].find(row => row[0] === rid)[1] = (index ? state.types['Level' + (index - 1)] : state.types.Outer) & 0xffffff;
  }
  const last = rows[41].find(row => row[0] === (state.types.Level64 & 0xffffff));
  last[1] = state.types.Outer & 0xffffff;
  assert.doesNotThrow(() => create(state.inspector));
  last[1] = state.types.Level63 & 0xffffff;
  assert.throws(() => create(state.inspector), fails('CILVM0002'));
});

test('a deep uncertain target/caller product stops at the aggregate access budget', () => {
  const state = fixture(undefined, ({ md, type, types }) => {
    const base = md.typeRef('Missing.Base', 'Missing');
    let owner = type('OwnerRoot', { base }), caller = type('CallerRoot', { base });
    for (let index = 0; index < 64; index++) {
      owner = type('Owner' + index, { base, enclosing: owner, visibility: 4 });
      caller = type('Caller' + index, { base, enclosing: caller });
    }
  });
  assert.throws(() => state.access('Owner63.Static6field', 'Caller63'), fails('CILVM0002'));
});

test('generic enclosing definitions remain unknown without forging a nongeneric access proof', () => {
  const { access } = fixture();
  assert.equal(access('InGeneric.Static6method', 'Other').reason, 'generic-definition');
});

test('pinned ILVerify nested access agrees where local metadata produces known decisions', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-nested-access/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.observations.length, nativeCases.length);
  for (const [index, input] of nativeCases.entries()) {
    const observed = capture.observations[index];
    assert.equal(observed.name, input.name);
    assert.equal(observed.sourceSHA256, createHash('sha256').update(nestedIL(input)).digest('hex'));
    assert.equal(observed.oracle.accepted, input.accepted);
    if (!input.accepted) assert(observed.oracle.errors.includes(input.kind === 'field' ? 'FieldAccess' : 'MethodAccess'));
    if (input.query === 'unknown') assert.equal(observed.result.status, 'unknown');
    else assert.deepEqual(observed.result, { status: 'known', value: input.query });
  }
});
