import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { frameworkResultState } from '../packages/compiler/src/nullable/framework-annotations.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

/** The nullable warnings of a method body over `object o`, as `code@text`. */
function warnings(body, declarations = '') {
  const source = `#nullable enable\nusing System;\n${declarations}static class P {\n  static void M(object o) {\n${body}\n  }\n  static void Main() { }\n}\n`;
  return compile(source)
    .diagnostics.filter(d => /^CS86/.test(d.code))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);
}

test('SF-A02-T05.4 corpus: framework annotation fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    ids = ['nullable-framework-annotations/tostring-and-environment', 'nullable/cs8602-nullable-reference-warning'];
  for (const id of ids) {
    const fixture = loadFixtures().find(f => f.id === id);
    assert(fixture, id);
    const row = runFixture(fixture, pinned.results.get(id));
    assert.equal(row.passed, true, `${id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T05.4 the recorded annotation applies to framework members only', () => {
  const type = (name, extra = {}) => ({ name, locations: [], getMembers: () => [], ...extra }),
    object = type('Object', { specialType: 'System_Object' }),
    int = type('Int32', { baseType: type('ValueType', { specialType: 'System_ValueType' }) }),
    toString = { name: 'ToString', containingType: object, locations: [] };
  assert.equal(frameworkResultState(toString, object), 'maybeNull');
  assert.equal(frameworkResultState(toString), 'maybeNull', 'without a receiver the declaring type decides');
  assert.equal(frameworkResultState(toString, { ...int, baseType: object }), 'notNull', 'a framework type overrides it');
  assert.equal(frameworkResultState(toString, { name: 'T', locations: [{}], getMembers: () => [] }), 'maybeNull', 'no base type: a type parameter');
  assert.equal(frameworkResultState({ name: 'Concat', containingType: type('String'), locations: [] }), null);
  assert.equal(frameworkResultState({ name: 'ToString', containingType: object, locations: [{}] }), null, 'declared in source');
  assert.equal(frameworkResultState(null), null);
});

test('SF-A02-T05.4 Object.ToString may return null; an override has the annotation it declares', () => {
  assert.deepEqual(warnings('string t = o.ToString();'), ['CS8600@o.ToString()']);
  assert.deepEqual(warnings('string? t = o.ToString(); string u = o.ToString() ?? ""; string v = o.ToString()!;'), []);
  assert.deepEqual(warnings('int n = o.ToString().Length;'), ['CS8602@o.ToString()']);
  assert.deepEqual(warnings('string t = 1.ToString(); string u = "a".ToString();'), []);
  const classes = 'class C { }\nclass D { public override string ToString() => "d"; }\nclass E { public override string? ToString() => null; }\n';
  assert.deepEqual(warnings('string t = new C().ToString();', classes), ['CS8600@new C().ToString()']);
  assert.deepEqual(warnings('string t = new D().ToString();', classes), []);
  assert.deepEqual(warnings('string t = new E().ToString();', classes), ['CS8600@new E().ToString()']);
  assert.deepEqual(warnings('string t = Environment.GetEnvironmentVariable("X");'), ['CS8600@Environment.GetEnvironmentVariable("X")']);
});
