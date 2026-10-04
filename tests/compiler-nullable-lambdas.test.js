import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { withTypeArgumentAnnotations } from '../packages/compiler/src/symbols/annotated-instantiations.js';
import { lambdaSignature } from '../packages/compiler/src/nullable/walker-lambdas.js';
import { NullableAnnotation, TypeKind } from '../packages/compiler/src/symbols/types.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

/** The nullable warnings of a method body over `string? n` and `string s`, as `code@text`. */
function warnings(body) {
  const source = `#nullable enable\nusing System;\ndelegate string Make();\nstatic class P {\n  static void M(string? n, string s) {\n${body}\n  }\n  static void Main() { }\n}\n`;
  return compile(source)
    .diagnostics.filter(d => /^CS86/.test(d.code))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);
}

test('SF-A02-T05.4 corpus: lambda fixtures match Roslyn and run on both back ends', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'nullable-lambdas');
  assert.equal(fixtures.length, 2);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T05.4 an annotated framework delegate is a view of the shared instantiation', () => {
  const annotated = { type: {}, nullableAnnotation: NullableAnnotation.Annotated },
    plain = { type: {}, nullableAnnotation: NullableAnnotation.NotAnnotated },
    oblivious = { type: {}, nullableAnnotation: NullableAnnotation.Oblivious },
    shared = { typeKind: TypeKind.Delegate, typeArguments: [oblivious], name: 'Func' },
    list = { typeKind: TypeKind.Class, typeArguments: [oblivious] },
    kinds = { delegate: TypeKind.Delegate, oblivious: NullableAnnotation.Oblivious },
    view = withTypeArgumentAnnotations(shared, [annotated], kinds);
  assert.equal(withTypeArgumentAnnotations(null, [annotated], kinds), null);
  assert.equal(withTypeArgumentAnnotations(shared, [oblivious], kinds), shared, 'nothing to remember');
  assert.equal(withTypeArgumentAnnotations(list, [annotated], kinds), list, 'only delegates get a view');
  assert.notEqual(view, shared);
  assert.equal(view.unannotated, shared);
  assert.equal(view.name, 'Func', 'members come from the shared instantiation');
  assert.equal(view.typeArguments[0], annotated);
  assert.equal(shared.typeArguments[0], oblivious, 'the shared object is not changed');
  assert.equal(withTypeArgumentAnnotations(shared, [annotated], kinds), view, 'one view per annotation pattern');
  assert.notEqual(withTypeArgumentAnnotations(shared, [plain], kinds), view);
});

test('SF-A02-T05.4 the signature a lambda body is checked against', () => {
  assert.equal(lambdaSignature({ boundAs: null }), null);
  assert.equal(lambdaSignature({ boundAs: { typeKind: TypeKind.Class } }), null, 'not a delegate');
});

test('SF-A02-T05.4 returns and parameters of lambdas follow the delegate type', () => {
  assert.deepEqual(warnings('Func<string> f = () => n;'), ['CS8603@n']);
  assert.deepEqual(warnings('Func<string?> f = () => n;'), []);
  assert.deepEqual(warnings('Func<string> f = () => null;'), ['CS8603@null']);
  assert.deepEqual(warnings('Func<string> f = () => n ?? s;'), []);
  assert.deepEqual(warnings('Func<string> f = () => { if (n == null) return s; return n; };'), []);
  assert.deepEqual(warnings('Make f = () => n;'), ['CS8603@n']);
  assert.deepEqual(warnings('Func<string> f = delegate { return n; };'), ['CS8603@n']);
  assert.deepEqual(warnings('Func<string?, int> f = x => x.Length;'), ['CS8602@x']);
  assert.deepEqual(warnings('Func<string, int> f = x => x.Length;'), []);
  assert.deepEqual(warnings('Func<string?, string> f = x => x;'), ['CS8603@x']);
});
