import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { FlowState, MemberSlot, NOT_NULL, MAYBE_NULL } from '../packages/compiler/src/nullable/flow-state.js';
import { nullMatch, isNullLiteral, withoutConversions } from '../packages/compiler/src/nullable/pattern-nullness.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

const node = 'class N { public bool B; public string? S; public N? Next; public int V; }\n';
/** The texts CS8602 is reported on in a method body over `N? x`, `N y` and `string? k`. */
function dereferences(body) {
  const source = `#nullable enable\n${node}static class P {\n  static void M(N? x, N y, string? k) {\n${body}\n  }\n  static void Main() { }\n}\n`;
  return compile(source)
    .diagnostics.filter(d => d.code === 'CS8602')
    .map(d => source.slice(d.start, d.start + d.length));
}

test('SF-A02-T05.4 corpus: conditional-access and member-slot fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'nullable-conditional-access' || f.feature === 'nullable-member-slots');
  assert.equal(fixtures.length, 9);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T05.4 what a pattern says about null', () => {
  const nullConstant = { kind: 'ConstantPattern', value: { kind: 'Conversion', operand: { literal: 'null' } } },
    three = { kind: 'ConstantPattern', value: { constantValue: { value: 3 } } },
    typeTest = { kind: 'TypePattern' },
    not = pattern => ({ kind: 'NotPattern', pattern }),
    both = (kind, left, right) => ({ kind, left, right });
  assert.equal(isNullLiteral(nullConstant.value), true);
  assert.equal(withoutConversions(nullConstant.value).literal, 'null');
  assert.equal(nullMatch(null), 'never', 'the type test of `e is T`');
  assert.equal(nullMatch(nullConstant), 'only');
  assert.equal(nullMatch(three), 'never');
  assert.equal(nullMatch(typeTest), 'never');
  assert.equal(nullMatch({ kind: 'RecursivePattern' }), 'never');
  assert.equal(nullMatch({ kind: 'VarPattern' }), 'maybe');
  assert.equal(nullMatch({ kind: 'DiscardPattern' }), 'maybe');
  assert.equal(nullMatch(not(nullConstant)), 'never');
  assert.equal(nullMatch(not(three)), 'maybe', 'everything but 3 includes null');
  assert.equal(nullMatch(both('OrPattern', nullConstant, three)), 'maybe');
  assert.equal(nullMatch(both('OrPattern', typeTest, three)), 'never');
  assert.equal(nullMatch(both('AndPattern', not(three), typeTest)), 'never');
});

test('SF-A02-T05.4 flow state: assigning a variable forgets its members, a test does not', () => {
  const x = { name: 'x' },
    next = new MemberSlot(x, { name: 'Next' }),
    name = new MemberSlot(next, { name: 'Name' }),
    other = new MemberSlot({ name: 'y' }, { name: 'Next' });
  assert.equal(name.isMemberOf(x), true);
  assert.equal(name.isMemberOf(next), true);
  assert.equal(next.isMemberOf(next), false);
  assert.equal(other.isMemberOf(x), false);
  const flow = new FlowState();
  for (const key of [x, next, name, other]) flow.set(key, NOT_NULL);
  flow.set(x, MAYBE_NULL);
  assert.equal(flow.get(name), NOT_NULL, 'learning about x keeps what is known about its members');
  flow.assign(next, MAYBE_NULL);
  assert.equal(flow.get(name), undefined);
  assert.equal(flow.get(next), MAYBE_NULL);
  flow.assign(x, NOT_NULL);
  assert.deepEqual([...flow.entries.keys()], [x, other]);
});

test('SF-A02-T05.4 a successful test of a conditional access proves the receiver not null', () => {
  assert.deepEqual(dereferences('if (k?.Length > 0) { int n = k.Length; }'), []);
  assert.deepEqual(dereferences('if (k?.Length > 0) { } else { int n = k.Length; }'), ['k']);
  assert.deepEqual(dereferences('if (k?.Length != 3) { int n = k.Length; }'), ['k']);
  assert.deepEqual(dereferences('if (k?.Length != 3) { } else { int n = k.Length; }'), []);
  assert.deepEqual(dereferences('if (x?.S is null) { bool b = x.B; } else { bool c = x.B; }'), ['x']);
  assert.deepEqual(dereferences('if (x?.B ?? false) { bool b = x.B; }'), []);
  assert.deepEqual(dereferences('if (x?.B ?? true) { bool b = x.B; }'), ['x']);
  assert.deepEqual(dereferences('if (x?.Next?.S != null) { int n = x.Next.S.Length; }'), []);
  assert.deepEqual(dereferences('int? v = y?.V; bool b = y.B;'), ['y'], 'a tested variable may be null afterwards');
});

test('SF-A02-T05.4 members of variables are tracked through tests, assignments and copies', () => {
  assert.deepEqual(dereferences('if (y.Next != null) { int v = y.Next.V; }'), []);
  assert.deepEqual(dereferences('int v = y.Next.V;'), ['y.Next']);
  assert.deepEqual(dereferences('y.S = "a"; int n = y.S.Length; y.S = null; int m = y.S.Length;'), ['y.S']);
  assert.deepEqual(dereferences('if (y.S == null) return; y = new N(); int n = y.S.Length;'), ['y.S']);
  assert.deepEqual(dereferences('if (y.S == null) return; N z = y; int n = z.S.Length;'), [], 'a copy keeps the member states');
  assert.deepEqual(dereferences('int n = x.S.Length;'), ['x', 'x.S'], 'both the receiver and its member are reported');
  assert.deepEqual(dereferences('if (y.Next is { S: not null }) { int n = y.Next.S.Length; }'), []);
});
