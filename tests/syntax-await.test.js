import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree } from '@sharpforge/syntax';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, classMembersOf, codesOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T28: C# 5 async modifiers and contextual await.
const bodyOf = (member, statements) => classMembersOf(`${member} { ${statements} }`)[0].body.statements;

test('T28 async members, lambdas, anonymous methods and await match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp3-5/await.cs');
  assert(kinds.has('AwaitExpression'));
  assert.deepEqual(tree.getDiagnostics(), []);
  const awaits = [...tree.root.descendantTokens()].filter(token => token.text === 'await');
  assert(awaits.filter(token => token.kind === 'AwaitKeyword').length >= 25);
  assert(awaits.filter(token => token.kind === 'IdentifierToken').length >= 14, 'await is an identifier outside async functions');
});

test('T28 await is an operator inside async methods, lambdas and anonymous methods', () => {
  assert.equal(shapeOf(bodyOf('async Task M()', 'await x;')[0]), 'ExpressionStatement(AwaitExpression(await IdentifierName(x)) ;)');
  assert.equal(shapeOf(bodyOf('async Task M()', 'await (x);')[0].expression), 'AwaitExpression(await ParenthesizedExpression(( IdentifierName(x) )))');
  const lambda = bodyOf('void M()', 'F(async () => await x);')[0].expression.argumentList.arguments[0].expression;
  assert.equal(lambda.expressionBody.kind, 'AwaitExpression');
  const anonymous = bodyOf('void M()', 'F(async delegate { await x; });')[0].expression.argumentList.arguments[0].expression;
  assert.equal(anonymous.block.statements[0].expression.kind, 'AwaitExpression');
});

test('T28 await is an identifier in non-async methods', () => {
  const statements = bodyOf('void M()', 'int await = 1; await++; await = await + 1; await (x); F(await); var y = await.x;');
  assert.deepEqual(
    statements.map(statement => statement.kind),
    [
      'LocalDeclarationStatement',
      'ExpressionStatement',
      'ExpressionStatement',
      'ExpressionStatement',
      'ExpressionStatement',
      'LocalDeclarationStatement'
    ]
  );
  assert.equal(statements[1].expression.kind, 'PostIncrementExpression');
  assert.equal(statements[3].expression.kind, 'InvocationExpression', '`await (x)` calls a method named await');
  assert(![...statements[0].parent.descendantNodes()].some(node => node.kind === 'AwaitExpression'));
  const nonAsyncLambda = bodyOf('async Task M()', 'F(() => { int await = 1; return await; });')[0];
  assert(![...nonAsyncLambda.descendantNodes()].some(node => node.kind === 'AwaitExpression'), 'a non-async lambda resets the context');
});

test('T28 await before a token that cannot follow an identifier is still an operator', () => {
  const [statement] = bodyOf('void M()', 'var y = await new T();');
  assert.equal(statement.declaration.variables[0].initializer.value.kind, 'AwaitExpression');
});

test('T28 async is a modifier only when a declaration follows', () => {
  const members = classMembersOf('async Task A() { } async async async(async async) { return await async; } int async; async M() { }');
  assert.deepEqual(
    members.map(member => [member.kind, member.modifiers.map(modifier => modifier.kind).join(' ')]),
    [
      ['MethodDeclaration', 'AsyncKeyword'],
      ['MethodDeclaration', 'AsyncKeyword'],
      ['FieldDeclaration', ''],
      ['MethodDeclaration', '']
    ]
  );
  assert.equal(shapeOf(members[1].returnType), 'IdentifierName(async)');
  assert.equal(members[1].identifier.text, 'async');
  const statements = bodyOf('void M()', 'int async = 1; async = async + 1; async(); async Task L() { await x; }');
  assert.deepEqual(
    statements.map(statement => statement.kind),
    ['LocalDeclarationStatement', 'ExpressionStatement', 'ExpressionStatement', 'LocalFunctionStatement']
  );
});

test('T28 async functions are rejected below C# 5', () => {
  assert.deepEqual(codesOf('class C { async void M() { await x; } }', '4'), ['CS8025', 'CS8025'], 'the method name and the await');
  assert.deepEqual(codesOf('class C { async void M() { await x; } }', '5'), []);
  assert.deepEqual(codesOf('class C { void M() { int await = 1; await++; } }', '4'), [], 'the identifier needs no feature');
});

test('T28 an await without an operand recovers as Roslyn does', () => {
  assertRecoversLikeRoslyn('reference/csharp3-5/await-recovery.cs');
  const tree = SyntaxTree.parseText('class C { async void M() { await; } }');
  const statement = tree.root.members[0].members[0].body.statements[0];
  assert.equal(shapeOf(statement), 'ExpressionStatement(AwaitExpression(await IdentifierName(<IdentifierToken>)) ;)');
  assert.deepEqual(
    tree.getDiagnostics().map(diagnostic => diagnostic.code),
    ['CS1525']
  );
});
