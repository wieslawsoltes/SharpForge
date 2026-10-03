import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, shapeOf, statementsOf } from './support/syntax-reference.js';

// SF-A01-T40: C# 8 await foreach, await using and using declarations.
test('T40 await foreach, await using and using declarations match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp8/async-statements.cs');
  for (const kind of ['ForEachStatement', 'ForEachVariableStatement', 'UsingStatement', 'LocalDeclarationStatement']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T40 the await keyword is a child of the statement it modifies', () => {
  const [each, using, awaitDeclaration, declaration] = statementsOf(
    'await foreach (var x in xs) { } await using (var r = F()) { } await using var s = F(); using var t = F();'
  );
  assert.equal(shapeOf(each), 'ForEachStatement(await foreach ( IdentifierName(var) x in IdentifierName(xs) ) Block({ }))');
  assert.equal(using.kind, 'UsingStatement');
  assert.equal(using.awaitKeyword.kind, 'AwaitKeyword');
  assert.equal(awaitDeclaration.kind, 'LocalDeclarationStatement');
  assert.deepEqual([awaitDeclaration.awaitKeyword.text, awaitDeclaration.usingKeyword.text], ['await', 'using']);
  assert.equal(declaration.awaitKeyword, null);
  assert.equal(declaration.usingKeyword.kind, 'UsingKeyword');
});

test('T40 plain using and foreach forms keep their C# 1 shapes', () => {
  const [statement, expression, each, deconstruct] = statementsOf(
    'using (var q = F()) { } using (F()) { } foreach (int y in xs) { } foreach (var (a, b) in pairs) { }'
  );
  assert.equal(statement.declaration.kind, 'VariableDeclaration');
  assert.equal(statement.awaitKeyword, null);
  assert.equal(expression.expression.kind, 'InvocationExpression');
  assert.equal(each.kind, 'ForEachStatement');
  assert.equal(deconstruct.kind, 'ForEachVariableStatement');
  assert.equal(deconstruct.variable.kind, 'DeclarationExpression');
});

test('T40 each form is rejected below C# 8', () => {
  const body =
    'await foreach (var x in xs) { } await using (var r = F()) { } await using var s = F(); using var t = F(); using (var u = F()) { }';
  assert.deepEqual(diagnosticsOf(`class C { async void M() { ${body} } }`, '7.3'), [
    'CS8370@27 "await"',
    'CS8370@59 "await"',
    'CS8370@89 "await"',
    'CS8370@95 "using"',
    'CS8370@114 "using"'
  ]);
  assert.deepEqual(diagnosticsOf(`class C { async void M() { ${body} } }`, '8'), []);
  assert.deepEqual(diagnosticsOf('class C { void M() { using (var u = F()) { } foreach (int y in xs) { } } }', '1'), []);
});

test('T40 malformed headers recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp8/async-statements-recovery.cs');
  const codes = tree.getDiagnostics().map(diagnostic => diagnostic.code);
  assert(codes.includes('CS1515'), "a missing 'in' reports CS1515 and keeps the foreach statement");
  const statements = tree.root.members[0].members[0].body.statements.map(statement => statement.kind);
  assert.deepEqual(statements.slice(0, 4), ['ForEachStatement', 'ForEachStatement', 'ForEachStatement', 'UsingStatement']);
  assert.equal(shapeOf(statementsOf('foreach (var x xs) { }')[0]), 'ForEachStatement(foreach ( IdentifierName(var) x <InKeyword> IdentifierName(xs) ) Block({ }))');
});
