import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, diagnosticsOf } from './support/syntax-reference.js';

// Defects found by the compiler's stress programs (SF-A02-T30, round 2):
//   `switch (a, b) { ... }`  C# 8: the governing expression is a tuple literal whose parentheses are the statement's
//                            (CS1026 ") expected" before);
//   `when map.TryGetValue(name, out int bound) => bound`, `when map.ContainsKey(key) => 1`  an invocation before the
//                            arrow of a switch arm was read as a lambda with a return type; Roslyn parses the guard
//                            of an arm above the lambda precedence.
// Reference: the Roslyn 5.3.0 dump of packages/syntax/test/reference/csharp8/switch-tuples-and-guards.cs.

test('a switch statement over a tuple literal and guards that end in an invocation match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp8/switch-tuples-and-guards.cs');
  assert.deepEqual(tree.getDiagnostics(), []);
  assert(kinds.has('TupleExpression'));
  const statements = [...tree.root.descendantNodes()].filter(node => node.kind === 'SwitchStatement');
  assert.deepEqual(
    statements.map(node => [node.expression.kind, !!node.openParenToken, !!node.closeParenToken]),
    [
      ['TupleExpression', false, false],
      ['TupleExpression', false, false],
      ['TupleExpression', false, false],
      ['TupleExpression', true, true],
      ['IdentifierName', true, true],
    ],
  );
  const lambdas = [...tree.root.descendantNodes()].filter(node => node.kind === 'ParenthesizedLambdaExpression');
  assert.equal(lambdas.length, 3, 'only the three lambdas of the fixture are lambdas; the guards are invocations');
});

test('a tuple-governed switch is a C# 8 form: gated below it, and an unclosed one still reports the parenthesis', () => {
  const inMethod = body => `class C { void M(int a, int b) { ${body} } }`;
  assert.deepEqual(diagnosticsOf(inMethod('switch (a, b) { case (1, 2): break; }'), '8'), []);
  assert.ok(diagnosticsOf(inMethod('switch (a, b) { case (1, 2): break; }'), '6').some(line => line.startsWith('CS')));
  assert.ok(diagnosticsOf(inMethod('switch (a, b { }')).some(line => line.startsWith('CS1026')));
});

test('the guard of a switch expression arm is parsed above the lambda precedence', () => {
  const inMethod = body => `class C { int M(object o, System.Collections.Generic.Dictionary<string, int> map) { ${body} } }`;
  assert.deepEqual(diagnosticsOf(inMethod('return o switch { string s when map.TryGetValue(s, out int n) => n, _ => 0 };')), []);
  assert.deepEqual(diagnosticsOf(inMethod('return o switch { string s when map.ContainsKey(s) => 1, _ => 0 };')), []);
  assert.deepEqual(diagnosticsOf(inMethod('System.Func<int, int, int> f = int (int x, int y) => x; return f(1, 2);')), []);
  assert.deepEqual(diagnosticsOf(inMethod('System.Func<int, int, int> f = (x, y) => x; return f(1, 2);')), []);
});
