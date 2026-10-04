import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, createMetadataVerificationContext as create } from '@sharpforge/cil';
import { accessFixture } from './fixtures/a03-member-access/input.js';
import { nativeCases, accessIL } from './fixtures/a03-member-access/native-input.js';

const fails = code => error => error.name === 'CilError' && error.code === code;
function fixture(options, decorate) {
  const input = accessFixture(decorate);
  const inspector = new AssemblyInspector(input.bytes);
  const context = create(inspector, options);
  const type = name => context.resolveType(input.types[name]).value;
  const member = name => context.resolveMember(input.members[name]).value;
  const access = (name, accessor, receiver) => context.isMemberAccessible(member(name), type(accessor),
    receiver === undefined ? undefined : { receiverType: type(receiver) });
  return { ...input, inspector, context, type, member, access };
}

function known(result, expected) {
  assert.deepEqual(result, { status: 'known', value: expected });
  assert(Object.isFrozen(result));
}

test('all seven access flags distinguish same owner, assembly privilege and family for fields/methods', () => {
  const { access, context, references, member } = fixture();
  for (const kind of ['field', 'method']) for (const storage of ['Static', 'Instance']) {
    for (let flag = 0; flag <= 6; flag++) {
      const name = `${storage}${flag}${kind}`;
      known(access(name, 'Owner'), true);
      known(access(name, 'Other', 'Other'), [0, 3, 5, 6].includes(flag));
      known(access(name, 'Derived', 'Derived'), flag !== 1);
      const reference = context.resolveMember(references[name]);
      if (flag === 0) assert.equal(reference.reason, 'compiler-controlled-reference');
      else assert.equal(reference.value, member(name));
    }
  }
});

test('protected instance receivers use accessor identity, not only the member owner', () => {
  const { access } = fixture();
  for (const flag of [2, 4]) for (const kind of ['field', 'method']) {
    const name = `Instance${flag}${kind}`;
    for (const receiver of ['Derived', 'Further']) known(access(name, 'Derived', receiver), true);
    for (const receiver of ['Owner', 'Sibling', 'Other']) known(access(name, 'Derived', receiver), false);
    assert.equal(access(name, 'Derived').reason, 'protected-receiver-required');
    known(access(name, 'Owner'), true);
    known(access(`Static${flag}${kind}`, 'Derived'), true);
    known(access('Instance5' + kind, 'Other'), true);
  }
});

test('nested identities are accepted while interface family rules remain explicit unknown', () => {
  const { access, context, type, member } = fixture();
  known(access('nested', 'Owner'), true);
  known(access('Instance6field', 'Nested'), true);
  known(access('Instance6method', 'Owner', 'Nested'), true);
  assert.equal(access('interface', 'Interface').reason, 'interface-family-access');
  assert.equal(access('Instance4method', 'Interface').reason, 'interface-family-access');
  assert.equal(access('Instance2field', 'Derived', 'Interface').reason, 'interface-family-access');
  assert.equal(context.resolveType(0x0200000a).reason, 'generic-definition');
  assert.throws(() => context.isMemberAccessible(member('Instance6field'), { ...type('Owner') }), fails('CILVT0004'));
});

test('unresolved family or receiver ancestry propagates unknown instead of granting access', () => {
  const { access } = fixture();
  assert.equal(access('Static4field', 'UnresolvedBase').reason, 'unresolved-type-reference');
  assert.equal(access('Instance4field', 'Derived', 'UnresolvedBase').reason, 'unresolved-type-reference');
});

test('only this context canonical member/type identities are accepted, even with matching tokens', () => {
  const current = fixture(), other = fixture();
  const name = 'Instance6method';
  for (const value of [null, undefined, {}, { ...current.member(name) }, other.member(name)]) {
    assert.throws(() => current.context.isMemberAccessible(value, current.type('Owner')), fails('CILVM0004'));
  }
  assert.throws(() => current.context.isMemberAccessible(current.member(name), other.type('Owner')), fails('CILVT0004'));
  assert.throws(() => current.context.isMemberAccessible(current.member(name), current.type('Owner'),
    { receiverType: other.type('Derived') }), fails('CILVT0004'));
  assert.throws(() => current.context.isMemberAccessible(current.member(name), current.type('Owner'),
    { receiverType: null }), fails('CILVT0004'));
});

test('visibility/member snapshots own bytes and survive metadata and caller result mutation attempts', () => {
  const state = fixture();
  const target = state.member('Instance1field');
  for (const row of state.inspector.metadata.rows[2]) row[0] = 2;
  state.inspector.metadata.rows[4][(target.token & 0xffffff) - 1][0] = 6;
  state.bytes.fill(0);
  known(state.context.isMemberAccessible(target, state.type('Owner')), true);
  known(state.context.isMemberAccessible(target, state.type('Other')), false);
  assert.throws(() => { target.flags = 6; }, TypeError);
  known(state.access('nested', 'Owner'), true);
});

test('existing type/member budgets and cancellation apply to snapshot and cached access queries', () => {
  const input = accessFixture();
  const inspector = new AssemblyInspector(input.bytes);
  assert.throws(() => create(inspector, { maxTypes: 1 }), fails('CILVT0002'));
  assert.throws(() => create(inspector, { maxMembers: 1 }), fails('CILVM0002'));
  const controller = new AbortController();
  const state = fixture({ signal: controller.signal });
  const target = state.member('Instance6field'), owner = state.type('Owner');
  known(state.context.isMemberAccessible(target, owner), true);
  controller.abort();
  assert.throws(() => state.context.isMemberAccessible(target, owner), fails('CILVM0003'));
  const limited = fixture({ maxQueryNodes: 1 });
  assert.throws(() => limited.access('Instance4field', 'Further', 'Further'), fails('CILVT0002'));
  const malformed = new AssemblyInspector(input.bytes);
  malformed.metadata.rows[2][6][0] = -1;
  // Canonical TypeDef flags are validated by the type snapshot before member access facts.
  assert.throws(() => create(malformed), fails('CILVT0001'));
});

test('pinned ILVerify access decisions match known queries and retain unresolved-root negatives', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-member-access/native.json', import.meta.url), 'utf8'));
  const flags = { private: 1, famandassem: 2, assembly: 3, family: 4, famorassem: 5, public: 6 };
  const { access } = fixture();
  assert.equal(capture.observations.length, nativeCases.length);
  for (const [index, input] of nativeCases.entries()) {
    const observed = capture.observations[index];
    assert.equal(observed.name, input.name);
    assert.equal(observed.sourceSHA256, createHash('sha256').update(accessIL(input)).digest('hex'));
    assert.equal(observed.oracle.accepted, input.accepted);
    if (input.query === 'unknown') {
      assert.equal(observed.result.status, 'unknown');
      assert.equal(observed.result.reason, 'unresolved-type-reference');
    } else {
      assert.deepEqual(observed.result, { status: 'known', value: input.query });
      known(access(`${input.isStatic ? 'Static' : 'Instance'}${flags[input.access]}${input.kind}`,
        input.accessor, input.receiver ?? undefined), observed.oracle.accepted);
    }
  }
});
