// SF-A02-T05.4: the nullable walker iterates loops to a fixed point of the state at the loop head, as Roslyn does,
// and reports each warning once. The `nullable-loops/*` differential fixtures are pinned with Roslyn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { sameFlow } from '../packages/compiler/src/nullable/walker-loops.js';
import { FlowState, MAYBE_NULL, NOT_NULL } from '../packages/compiler/src/nullable/flow-state.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';

const analyzeSource = source => {
  const file = parse(new SourceText(source, 'a.cs'));
  return [...file.diagnostics.filter(d => /^CS/.test(d.code)), ...analyze([file]).diagnostics];
};

/** Nullable warnings as `code@line`, in source order. */
const warningsOf = source =>
  analyzeSource(source)
    .filter(d => d.severity === 'warning' && /^CS86/.test(d.code))
    .sort((a, b) => a.start - b.start)
    .map(d => `${d.code}@${source.slice(0, d.start).split('\n').length}`);

const inMethod = body => `#nullable enable
using System;
static class P {
  static string? Maybe(int i) => i > 2 ? null : "x";
  static void M(int n, int[] items) {
${body}
  }
}`;

test('nullable-loops fixtures match the pinned Roslyn errors and warnings', () => {
  const fixtures = loadFixtures().filter(fixture => fixture.feature === 'nullable-loops');
  const pinned = loadPinned().results;
  assert.ok(fixtures.length >= 9, `expected the nullable-loops corpus, found ${fixtures.length} fixtures`);
  let cs8602 = 0;
  for (const fixture of fixtures) {
    const expected = pinned.get(fixture.id);
    assert.ok(expected, `${fixture.id} is not pinned`);
    const want = expected.diagnostics.map(row => `${row[0]}@${row[1]}+${row[2]}`).sort();
    const got = analyzeSource(fixture.source)
      .map(d => `${d.code}@${d.start}+${d.length}`)
      .sort();
    assert.deepEqual(got, want, `${fixture.id} differs from Roslyn`);
    cs8602 += expected.diagnostics.filter(row => row[0] === 'CS8602').length;
  }
  assert.ok(cs8602 >= 18, `the corpus pins ${cs8602} CS8602 warnings`);
});

test('an assignment later in the body reaches the top of the next iteration', () => {
  const loops = {
    while: 'string? s = "a";\nwhile (n-- > 0) {\nConsole.WriteLine(s.Length);\ns = Maybe(n);\n}',
    do: 'string? s = "a";\ndo {\nConsole.WriteLine(s.Length);\ns = Maybe(n);\n} while (n-- > 0);',
    for: 'string? s = "a";\nfor (int i = 0; i < n; i++) {\nConsole.WriteLine(s.Length);\ns = Maybe(i);\n}',
    forIncrementor: 'string? s = "a";\nfor (int i = 0; i < n; s = Maybe(i), i++) {\nConsole.WriteLine(s.Length);\n}',
    foreach: 'string? s = "a";\nforeach (var item in items) {\nConsole.WriteLine(s.Length);\ns = Maybe(item);\n}',
    continue: 'string? s = "a";\nwhile (n-- > 0) {\nConsole.WriteLine(s.Length);\nif (n == 1) { s = null; continue; }\ns = "b";\n}',
  };
  for (const [name, body] of Object.entries(loops)) {
    assert.deepEqual(warningsOf(inMethod(body)), ['CS8602@8'], `${name} loop`);
  }
});

test('each warning is reported once although the loop is walked several times', () => {
  const source = inMethod(`string? a = "a"; string? b = "b";
for (int i = 0; i < n; i++) {
  for (int j = 0; j < n; j++) {
    Console.WriteLine(a.Length + b.Length);
    a = b;
  }
  b = Maybe(i);
}`);
  const all = analyzeSource(source).filter(d => d.code === 'CS8602');
  assert.equal(all.length, new Set(all.map(d => d.start)).size, 'no duplicate CS8602 at one position');
  // Only `b` can be null at the top: `a` is assigned from `b` after `b` was dereferenced.
  assert.deepEqual(warningsOf(source), ['CS8602@9']);
  assert.equal(source.slice(all[0].start, all[0].start + all[0].length), 'b');
});

test('loops that keep a variable not null stay free of warnings', () => {
  assert.deepEqual(warningsOf(inMethod('string? s = "a";\nwhile (n-- > 0) {\nConsole.WriteLine(s.Length);\ns = "b";\n}\nConsole.WriteLine(s.Length);')), []);
  assert.deepEqual(warningsOf(inMethod('string? s = null;\nwhile (n-- > 0) {\nif (s != null) Console.WriteLine(s.Length);\ns = Maybe(n);\n}')), []);
  assert.deepEqual(warningsOf(inMethod('string? s = null;\nwhile (s == null) { s = Maybe(n--); }\nConsole.WriteLine(s.Length);')), []);
});

test('break and the loop condition decide the state after the loop', () => {
  const afterBreak = 'string? s = "a";\nwhile (true) {\nif (n-- < 0) { s = null; break; }\nConsole.WriteLine(s.Length);\n}\nConsole.WriteLine(s.Length);';
  assert.deepEqual(warningsOf(inMethod(afterBreak)), ['CS8602@11']);
  const afterForEach = 'string? s = "a";\nforeach (var item in items) { s = Maybe(item); }\nConsole.WriteLine(s.Length);';
  assert.deepEqual(warningsOf(inMethod(afterForEach)), ['CS8602@8']);
  const inSwitch = 'string? s = "a";\nwhile (n-- > 0) {\nConsole.WriteLine(s.Length);\nswitch (n) { case 1: s = null; break; default: break; }\n}';
  assert.deepEqual(warningsOf(inMethod(inSwitch)), ['CS8602@8']);
});

test('sameFlow compares states entry by entry', () => {
  const a = new FlowState(new Map([['x', NOT_NULL]]));
  const b = new FlowState(new Map([['x', NOT_NULL]]));
  assert.equal(sameFlow(a, b), true);
  b.set('x', MAYBE_NULL);
  assert.equal(sameFlow(a, b), false);
  b.set('x', NOT_NULL);
  b.set('y', MAYBE_NULL);
  assert.equal(sameFlow(a, b), false);
  assert.equal(sameFlow(null, null), true);
  assert.equal(sameFlow(a, null), false);
});
