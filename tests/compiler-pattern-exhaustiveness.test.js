import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { integerValues, stringValues, boolValues, nullAtom, objectAtom, subtract, intersect, isEmpty } from '../packages/compiler/src/flow/pattern-spaces.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

const options = { withReferenceNull: true };
const ints = (...ranges) => [{ values: integerValues(ranges) }];

test('SF-A02-T08.3 corpus: subsumption and exhaustiveness fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.id.startsWith('pattern-lowering/') && /exhaustive|subsumed/.test(f.id));
  assert.equal(fixtures.length, 3);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T08.3 spaces: difference and intersection of scalar sets', () => {
  assert.deepEqual(subtract(ints([0, 10]), ints([3, 4], [8, 20]), options), ints([0, 2], [5, 7]));
  assert.equal(isEmpty(subtract(ints([1, 5]), ints([0, 9]), options)), true);
  assert.deepEqual(intersect(ints([0, 10]), ints([5, 50]), options), ints([5, 10]));
  const allStrings = [{ values: stringValues([], true) }],
    rest = subtract(allStrings, [{ values: stringValues(['a']) }], options);
  assert.equal(isEmpty(rest), false);
  assert.equal(isEmpty(subtract(rest, [{ values: stringValues(['a'], true) }], options)), true, 'everything but "a", minus everything but "a"');
  assert.equal(isEmpty(subtract([{ values: boolValues(true, true) }], [{ values: boolValues(true, false) }, { values: boolValues(false, true) }], options)), true);
  assert.deepEqual(subtract([nullAtom, ...ints([1, 1])], [nullAtom], options), ints([1, 1]));
});

test('SF-A02-T08.3 spaces: the difference of products splits part by part', () => {
  const int = { specialType: 'System_Int32', typeKind: 'Struct' },
    part = space => ({ type: int, space }),
    pair = (a, b) => objectAtom(new Map([['Item1', part(a)], ['Item2', part(b)]]));
  const whole = [pair(ints([0, 1]), ints([0, 1]))];
  // {0,1}x{0,1} minus (0, _) minus (1, 1) leaves (1, 0).
  const afterFirst = subtract(whole, [objectAtom(new Map([['Item1', part(ints([0, 0]))]]))], options),
    left = subtract(afterFirst, [pair(ints([1, 1]), ints([1, 1]))], options);
  assert.equal(isEmpty(left), false);
  assert.equal(isEmpty(subtract(left, [pair(ints([1, 1]), ints([0, 0]))], options)), true);
});

test('SF-A02-T08.3 the example in CS8509 names an uncovered value; opaque patterns silence the check', () => {
  const messageOf = body => {
    const result = compile(`enum Color { Red, Green }\nclass P {\n  static int M(${body};\n  static void Main() { }\n}\n`);
    return result.diagnostics.filter(d => /CS85(09|24)|CS8846/.test(d.code)).map(d => `${d.code} ${/'([^']*)' is not covered/.exec(d.message)?.[1]}`);
  };
  assert.deepEqual(messageOf('int n) => n switch { 0 => 1, > 0 => 2 }'), ['CS8509 -1']);
  assert.deepEqual(messageOf('bool b) => b switch { false => 1 }'), ['CS8509 true']);
  assert.deepEqual(messageOf('(bool, int) t) => t switch { (true, _) => 1, (false, 0) => 2 }'), ['CS8509 (false, 1)']);
  assert.deepEqual(messageOf('Color c) => c switch { Color.Red => 1 }'), ['CS8509 Color.Green']);
  assert.deepEqual(messageOf('Color c) => c switch { Color.Red => 1, Color.Green => 2 }'), ['CS8524 (Color)2']);
  assert.deepEqual(messageOf('int n) => n switch { > 0 when n > 1 => 1, <= 0 => 2 }'), ['CS8846 1']);
  assert.deepEqual(messageOf('object o) => o switch { string s => 1, int n => 2 }'), ['CS8509 _'], 'type tests for part of the input');
  assert.deepEqual(messageOf('object o) => o switch { string s => 1, not string => 2 }'), [], 'a complement is not enumerated');
  assert.deepEqual(messageOf('int[] a) => a switch { [] => 1, [_, ..] => 2 }'), [], 'list patterns are not enumerated');
});
