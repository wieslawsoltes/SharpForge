import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, languageFeature } from '@sharpforge/syntax';
import { assertGatesMatchRoslyn, assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, expressionOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T49: C# 12 using alias for any type and default lambda parameters.
const usingsOf = text => SyntaxTree.parseText(text).root.usings;

test('T49 type aliases and lambda parameters with defaults and params match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp11-12/csharp12.cs');
  for (const kind of ['UsingDirective', 'TupleType', 'PointerType', 'FunctionPointerType', 'NullableType', 'ArrayType', 'ParenthesizedLambdaExpression'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T49 a using alias may name any type', () => {
  const [tuple, pointer, array, nullable, named] = usingsOf(
    'using P = (int x, int y); using unsafe X = int*; using A = int[]; using N = int?; using L = System.Collections.Generic.List<int>;'
  );
  assert.equal(
    shapeOf(tuple),
    'UsingDirective(using NameEquals(IdentifierName(P) =) ' +
      'TupleType(( TupleElement(PredefinedType(int) x) , TupleElement(PredefinedType(int) y) )) ;)'
  );
  assert.equal(pointer.unsafeKeyword.kind, 'UnsafeKeyword');
  assert.equal(shapeOf(pointer.namespaceOrType), 'PointerType(PredefinedType(int) *)');
  assert.equal(array.namespaceOrType.kind, 'ArrayType');
  assert.equal(nullable.namespaceOrType.kind, 'NullableType');
  assert.equal(named.namespaceOrType.kind, 'QualifiedName');
});

test('T49 lambda parameters take default values and params', () => {
  const defaults = expressionOf('(int x, int y = 2) => x + y').parameterList.parameters;
  assert.equal(defaults[0].default, null);
  assert.equal(shapeOf(defaults[1].default), 'EqualsValueClause(= NumericLiteralExpression(2))');
  const [first, rest] = expressionOf('(int x, params int[] xs) => x').parameterList.parameters;
  assert.equal(first.modifiers.length, 0);
  assert.equal(rest.modifiers[0].kind, 'ParamsKeyword');
  assert.equal(expressionOf('([A] int x = 1) => x').parameterList.parameters[0].attributeLists.length, 1);
});

test('T49 the 12.0 gates fire where Roslyn reports them', () => {
  const agreed = assertGatesMatchRoslyn('gates/csharp12.rejected.cs');
  assert.equal(agreed.length, 16);
  assert.deepEqual(diagnosticsOf('using P = (int x, int y);', '11'), ['CS9058@10 "(int x, int y)"']);
  assert.deepEqual(diagnosticsOf('using unsafe X = int*;', '11'), ['CS9058@6 "unsafe"'], 'with unsafe, the keyword is what is reported');
  assert.deepEqual(diagnosticsOf('using A = int[]; using I = int;', '11'), ['CS9058@10 "int[]"', 'CS9058@27 "int"']);
  assert.deepEqual(diagnosticsOf('using L = System.Collections.Generic.List<int>; using M = System.Math; using G = global::System.Int32;', '2'), []);
  const inMethod = body => `class C { void M() { ${body} } }`;
  assert.deepEqual(diagnosticsOf(inMethod('var a = (int x = 1) => x;'), '11'), ['CS9058@36 "="']);
  assert.deepEqual(diagnosticsOf(inMethod('var d = (params int[] xs) => xs;'), '11'), ['CS9058@30 "params"']);
  assert.deepEqual(diagnosticsOf('using P = (int x, int y); class C { void M() { var a = (int x = 1, params int[] xs) => x; } }', '12'), []);
  assert.deepEqual(diagnosticsOf('class C { void M(int x = 1, params int[] xs) { } }', '4'), [], 'method parameters always allowed both');
});

test('T49 inline arrays have no syntax of their own', () => {
  // An inline array is a struct with an attribute; the feature is decided when the attribute is bound.
  assert.equal(languageFeature('InlineArrays').version, 12);
  assert.deepEqual(diagnosticsOf('[System.Runtime.CompilerServices.InlineArray(4)] struct Buffer { int element; }', '11'), []);
});

test('T49 malformed aliases and lambda parameters recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp11-12/csharp12-recovery.cs');
  assert.equal(tree.root.usings.length, 2);
});
