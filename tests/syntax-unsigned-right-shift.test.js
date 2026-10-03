import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, classMembersOf, diagnosticsOf, expressionOf, shapeOf, statementsOf } from './support/syntax-reference.js';

// SF-A01-T47: C# 11 unsigned right shift operators.
test('T47 >>>, >>>= and operator >>> match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp11-12/shift.cs');
  for (const kind of ['UnsignedRightShiftExpression', 'UnsignedRightShiftAssignmentExpression', 'RightShiftExpression', 'LeftShiftExpression'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(
    tree.getDiagnostics().map(diagnostic => diagnostic.code),
    ['CS1525'],
    'only `a > > b`, which is not a shift'
  );
});

test('T47 >>> has the precedence and associativity of the other shifts', () => {
  assert.equal(shapeOf(expressionOf('a >>> b')), 'UnsignedRightShiftExpression(IdentifierName(a) >>> IdentifierName(b))');
  assert.equal(
    shapeOf(expressionOf('a >>> b >>> c')),
    'UnsignedRightShiftExpression(UnsignedRightShiftExpression(IdentifierName(a) >>> IdentifierName(b)) >>> IdentifierName(c))'
  );
  assert.equal(expressionOf('a + b >>> c - 1').kind, 'UnsignedRightShiftExpression', 'additive operators bind tighter');
  assert.equal(expressionOf('a >>> b > c').kind, 'GreaterThanExpression', 'relational operators bind looser');
  assert.equal(expressionOf('a >> b >>> c << 1').kind, 'LeftShiftExpression');
  const [assignment] = statementsOf('a >>>= b >>> 1;');
  assert.equal(assignment.expression.kind, 'UnsignedRightShiftAssignmentExpression');
  assert.equal(assignment.expression.right.kind, 'UnsignedRightShiftExpression');
});

test('T47 nested generics still close with single > tokens', () => {
  assert.equal(expressionOf('x as List<List<int>>').kind, 'AsExpression');
  assert.equal(expressionOf('new Dictionary<int, List<List<int>>>()').kind, 'ObjectCreationExpression');
  assert.equal(expressionOf('F<A<B<C>>>(1)').kind, 'InvocationExpression');
});

test('T47 operator >>> is an operator declaration with one token', () => {
  const [declaration] = classMembersOf('public static C operator >>>(C a, int b) => a;');
  assert.equal(declaration.kind, 'OperatorDeclaration');
  assert.equal(declaration.operatorToken.kind, 'GreaterThanGreaterThanGreaterThanToken');
  assert.equal(declaration.operatorToken.text, '>>>');
});

test('T47 LangVersion 10 rejects each form over the span Roslyn reports', () => {
  assert.deepEqual(diagnosticsOf('class C { void M(int a, int b) { var s = a >>> b; a >>>= 1; } }', '10'), [
    'CS8936@41 "a >>> b"',
    'CS8936@50 "a >>>= 1"'
  ]);
  assert.deepEqual(diagnosticsOf('class C { public static C operator >>>(C a, int b) => a; }', '10'), ['CS8936@35 ">>>"']);
  assert.deepEqual(diagnosticsOf('class C { void M(int a, int b) { var s = a >>> b; a >>>= 1; var t = a >> b; a >>= 1; } }', '11'), []);
  assert.deepEqual(diagnosticsOf('class C { void M(int a, int b) { int t = a >> b; a >>= 1; a <<= 1; } }', '1'), []);
});

test('T47 an operator needs the right number of parameters, as in Roslyn', () => {
  const codes = text => diagnosticsOf(`class C { ${text} }`).map(entry => entry.split('@')[0]);
  assert.deepEqual(codes('public static C operator >>>(C a) => a;'), ['CS1019']);
  assert.deepEqual(codes('public static C operator !(C a, C b) => a;'), ['CS1020']);
  assert.deepEqual(codes('public static C operator +(C a) => a; public static C operator +(C a, C b) => a; public static C operator -(C a) => a;'), []);
});

test('T47 malformed shifts recover as Roslyn does', () => {
  assertRecoversLikeRoslyn('reference/csharp11-12/shift-recovery.cs');
});
