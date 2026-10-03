import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFeature } from '@sharpforge/syntax';
import { assertMatchesRoslyn, diagnosticsOf, expressionOf, shapeOf, statementsOf } from './support/syntax-reference.js';

// SF-A01-T35: C# 7.1 default literal (async Main and generic pattern matching have no syntax of their own).
const inMethod = body => `class C { void M() { ${body} } }`;

test('T35 the default literal, async Main and patterns on open types match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp7/literals.cs');
  for (const kind of ['DefaultLiteralExpression', 'DefaultExpression', 'DeclarationPattern', 'TupleExpression']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T35 `default` without parentheses is a literal; with them it is the C# 2 operator', () => {
  assert.equal(shapeOf(expressionOf('default')), 'DefaultLiteralExpression(default)');
  assert.equal(shapeOf(expressionOf('default(int)')), 'DefaultExpression(default ( PredefinedType(int) ))');
  assert.equal(shapeOf(expressionOf('default == default')), 'EqualsExpression(DefaultLiteralExpression(default) == DefaultLiteralExpression(default))');
  assert.equal(expressionOf('c ? default : 1').whenTrue.kind, 'DefaultLiteralExpression');
  assert.equal(expressionOf('F(default, default)').argumentList.arguments.length, 2);
  const [section] = statementsOf('switch (x) { case default: break; default: break; }')[0].sections;
  assert.equal(section.labels[0].kind, 'CaseSwitchLabel', '`case default:` is a case label with a default literal');
  assert.equal(section.labels[0].value.kind, 'DefaultLiteralExpression');
});

test('T35 `int x = default;` parses at 7.1 and reports CS8107 at 7.0', () => {
  assert.deepEqual(diagnosticsOf(inMethod('int x = default;'), '7'), ['CS8107@29 "default"']);
  assert.deepEqual(diagnosticsOf(inMethod('int x = default;'), '7.1'), []);
  assert.deepEqual(diagnosticsOf(inMethod('int x = default(int);'), '7'), [], 'default(T) is C# 2');
  assert.deepEqual(diagnosticsOf('class C { void M(int p = default) { } }', '7'), ['CS8107@25 "default"']);
});

test('T35 async Main and generic pattern matching are gated by the binder, not the parser', () => {
  // Whether a method is the entry point, and whether a pattern's input is an open type, are not syntactic facts.
  assert.equal(languageFeature('AsyncMain').version, 7.1);
  assert.equal(languageFeature('GenericPatternMatching').version, 7.1);
  const asyncMain = 'class C { static async System.Threading.Tasks.Task Main() { await x; } }';
  assert.deepEqual(diagnosticsOf(asyncMain, '7'), []);
  assert.deepEqual(diagnosticsOf('class C { void M<T>(T t) { if (t is int v) { } } }', '7'), []);
});
