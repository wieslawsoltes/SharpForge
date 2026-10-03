import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMatchesRoslyn,
  assertRecoversLikeRoslyn,
  classMembersOf,
  codesOf,
  expressionOf,
  shapeOf,
  statementsOf
} from './support/syntax-reference.js';

// SF-A01-T27: C# 4 named and optional arguments and the contextual type name `dynamic`.
test('T27 named arguments, argument modifiers and dynamic match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp3-5/arguments.cs');
  for (const kind of ['NameColon', 'Argument', 'ArgumentList', 'BracketedArgumentList', 'AttributeArgument']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T27 named arguments may precede positional ones and carry ref, out and in', () => {
  assert.equal(
    shapeOf(expressionOf('F(a: 1, 2, ref b, c: out d, e: in f)').argumentList),
    'ArgumentList(( Argument(NameColon(IdentifierName(a) :) NumericLiteralExpression(1)) , ' +
      'Argument(NumericLiteralExpression(2)) , ' +
      'Argument(ref IdentifierName(b)) , ' +
      'Argument(NameColon(IdentifierName(c) :) out IdentifierName(d)) , ' +
      'Argument(NameColon(IdentifierName(e) :) in IdentifierName(f)) ))'
  );
  const conditional = expressionOf('F(a ? b : c)').argumentList.arguments[0];
  assert.equal(conditional.nameColon, null, 'a conditional operator is not a named argument');
  assert.equal(conditional.expression.kind, 'ConditionalExpression');
  assert.equal(expressionOf('t[x: 1, y: 2]').argumentList.arguments[1].nameColon.name.identifier.text, 'y');
});

test('T27 dynamic is an ordinary identifier used as a type name', () => {
  const [local, cast] = statementsOf('dynamic d = 1; var e = (dynamic)d;');
  assert.equal(shapeOf(local.declaration.type), 'IdentifierName(dynamic)');
  assert.equal(shapeOf(cast.declaration.variables[0].initializer.value), 'CastExpression(( IdentifierName(dynamic) ) IdentifierName(d))');
  const [named, call, field] = statementsOf('int dynamic = 1; dynamic.M(); dynamic = 2;');
  assert.deepEqual([named.kind, call.kind, field.kind], ['LocalDeclarationStatement', 'ExpressionStatement', 'ExpressionStatement']);
  assert.equal(classMembersOf('dynamic P { get; set; }')[0].type.identifier.kind, 'IdentifierToken');
});

test('T27 named arguments are rejected below C# 4', () => {
  assert.deepEqual(codesOf('class C { void M() { F(a: 1); } }', '3'), ['CS8024']);
  assert.deepEqual(codesOf('class C { void M() { F(a: 1); } }', '4'), []);
});

test('T27 malformed argument lists recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp3-5/arguments-recovery.cs');
  assert.deepEqual(
    tree.getDiagnostics().map(diagnostic => diagnostic.code),
    ['CS1525', 'CS1525', 'CS0839', 'CS1525', 'CS1003', 'CS1026', 'CS1002']
  );
});
