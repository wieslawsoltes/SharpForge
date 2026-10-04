import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { narrowedType, typesCoveredBy, isSubsumedByTypes } from '../packages/compiler/src/flow/pattern-type-tests.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

const codesOf = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => /^CS/.test(d.code))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);

test('SF-A02-T08.3 corpus: switch-subsumption fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'switch-subsumption');
  assert.equal(fixtures.length, 7);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T08.3 type tests: the type a pattern narrows to and the types it covers', () => {
  const type = name => ({ name, isErrorType: () => false, equals: other => other?.name === name }),
    object = type('object'),
    text = type('string'),
    int = type('int');
  const typeTest = tested => ({ kind: 'TypePattern', testedType: tested }),
    constant = (value, of) => ({ kind: 'ConstantPattern', value: { kind: 'Conversion', type: object, operand: { type: of, constantValue: { value } } } }),
    nullPattern = { kind: 'ConstantPattern', value: { kind: 'Conversion', type: object, operand: { literal: 'null' } } };

  assert.equal(narrowedType(typeTest(text), object), text);
  assert.equal(narrowedType(constant(5, int), object), int, 'the boxing conversion of the constant is not its type');
  assert.equal(narrowedType(nullPattern, object), null, 'a pattern that matches null narrows to nothing');
  assert.equal(narrowedType({ kind: 'NotPattern', pattern: nullPattern }, object), object);
  assert.equal(narrowedType({ kind: 'DiscardPattern' }, object), null);
  assert.equal(narrowedType({ kind: 'RecursivePattern', properties: [{}] }, text), text);

  assert.deepEqual(typesCoveredBy(typeTest(text), object), [text]);
  assert.deepEqual(typesCoveredBy({ kind: 'OrPattern', left: typeTest(text), right: typeTest(int) }, object), [text, int]);
  assert.deepEqual(typesCoveredBy({ kind: 'RecursivePattern', testedType: text, properties: [{}] }, object), [], 'parts restrict the values');
  assert.deepEqual(typesCoveredBy(constant(5, int), object), []);

  const isSubtype = (derived, base) => derived === base || base === object;
  assert.equal(isSubsumedByTypes(typeTest(text), object, [text], isSubtype), true);
  assert.equal(isSubsumedByTypes(constant(5, int), object, [int], isSubtype), true);
  assert.equal(isSubsumedByTypes(constant(5, int), object, [text], isSubtype), false);
  assert.equal(isSubsumedByTypes(nullPattern, object, [object], isSubtype), false, 'null is not a value of a covered type');
  const either = { kind: 'OrPattern', left: typeTest(text), right: typeTest(int) };
  assert.equal(isSubsumedByTypes(either, object, [text], isSubtype), false, 'both sides of a union must be handled');
  assert.equal(isSubsumedByTypes(either, object, [text, int], isSubtype), true);
});

test('SF-A02-T08.3 an arm behind a type test is reported; unrelated and guarded arms are not', () => {
  const program = body => `class A { }\nclass B : A { }\nstatic class P {\n  static int M(object o) => ${body};\n  static void Main() { }\n}\n`;
  assert.deepEqual(codesOf(program('o switch { A => 1, B => 2, _ => 3 }')), ['CS8510@B']);
  assert.deepEqual(codesOf(program('o switch { B => 1, A => 2, _ => 3 }')), []);
  assert.deepEqual(codesOf(program('o switch { A a when a != null => 1, B => 2, _ => 3 }')), []);
  assert.deepEqual(codesOf(program('o switch { int => 1, 5 => 2, _ => 3 }')), ['CS8510@5']);
  assert.deepEqual(codesOf(program('o switch { long => 1, 5 => 2, _ => 3 }')), [], 'a boxed int is not a long');
  assert.deepEqual(codesOf(program('o switch { not null => 1, string => 2, null => 3 }')), ['CS8510@string']);
});

test('SF-A02-T08.3 a switch expression the execution pipeline compiles is checked too', () => {
  const subsumed = 'using System;\nint n = 3;\nstring s = n switch { _ => "any", 1 => "one" };\nConsole.WriteLine(s);\n';
  assert.deepEqual(codesOf(subsumed), ['CS8510@1']);
  const open = 'using System;\nint n = 3;\nstring s = n switch { 1 => "one", 2 => "two" };\nConsole.WriteLine(s);\n',
    result = compile(open),
    warning = result.diagnostics.find(d => d.code === 'CS8509');
  assert.equal(result.success, true, 'CS8509 is a warning: the program still compiles');
  assert.equal(open.slice(warning.start, warning.start + warning.length), 'switch');
  assert.match(warning.message, /'0' is not covered/);
  const exhaustive = 'using System;\nint n = 3;\nConsole.WriteLine(n switch { 1 => "one", _ => "other" });\n';
  assert.deepEqual(codesOf(exhaustive), []);
});
