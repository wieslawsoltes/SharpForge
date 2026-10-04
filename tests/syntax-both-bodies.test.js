import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, classMembersOf, diagnosticsOf, statementsOf } from './support/syntax-reference.js';

// Defect reported by the compiler workstream: a member written with a block body and an expression body kept only
// one of them. Roslyn's parser keeps both and reports nothing; the binder reports CS8057.
test('members with a block body and an expression body match Roslyn and report nothing', () => {
  const { tree } = assertMatchesRoslyn('reference/csharp6/both-bodies.cs');
  assert.deepEqual(tree.getDiagnostics(), []);
  const both = [...tree.root.descendantNodes()].filter(node => node.body && node.expressionBody).map(node => node.kind);
  assert.deepEqual(both, [
    'MethodDeclaration',
    'MethodDeclaration',
    'ConstructorDeclaration',
    'ConstructorDeclaration',
    'DestructorDeclaration',
    'ConstructorDeclaration',
    'OperatorDeclaration',
    'ConversionOperatorDeclaration',
    'GetAccessorDeclaration',
    'SetAccessorDeclaration',
    'GetAccessorDeclaration',
    'AddAccessorDeclaration',
    'RemoveAccessorDeclaration',
    'LocalFunctionStatement',
    'LocalFunctionStatement',
    'MethodDeclaration',
    'MethodDeclaration'
  ]);
});

test('a property or indexer keeps its accessor list and its expression body', () => {
  const [property, auto, indexer] = classMembersOf('int Q { get { return 1; } } => 2; int R { get; } => 3; int this[long i] { get { return 1; } } => 2;');
  for (const member of [property, auto, indexer]) assert(member.accessorList && member.expressionBody && member.semicolonToken, member.kind);
  assert.equal(indexer.kind, 'IndexerDeclaration');
});

test('each form keeps both bodies and the semicolon', () => {
  const [method, constructor, operator] = classMembersOf('int M() { return 1; } => 2; C() { } => M(); public static C operator +(C a, C b) { return a; } => b;');
  for (const member of [method, constructor, operator]) assert(member.body && member.expressionBody && member.semicolonToken, member.kind);
  const [local] = statementsOf('int Local() { return 1; } => 2;');
  assert.equal(local.kind, 'LocalFunctionStatement');
  assert(local.body && local.expressionBody && local.semicolonToken);
  assert.deepEqual(diagnosticsOf('class C { int M() { return 1; } => 2; }'), []);
});

test('one body alone is unchanged', () => {
  const [block, arrow, withSemicolon] = classMembersOf('int M() { return 1; } int N() => 2; int K() { return 1; };');
  assert(block.body && !block.expressionBody && !block.semicolonToken);
  assert(!arrow.body && arrow.expressionBody && arrow.semicolonToken);
  assert(withSemicolon.body && !withSemicolon.expressionBody && withSemicolon.semicolonToken);
});

test('a missing semicolon after the expression body recovers as Roslyn does', () => {
  assertRecoversLikeRoslyn('reference/csharp6/both-bodies-recovery.cs');
  assert.deepEqual(diagnosticsOf('class C { int M() { return 1; } => 2 }'), ['CS1002@37 "}"']);
});

test('the legacy AST has one body per member, so parse() reports the form as outside its profile', () => {
  const result = parse('class C { int M() { return 1; } => 2; }');
  assert.deepEqual(
    result.diagnostics.map(diagnostic => diagnostic.code),
    ['SF1018']
  );
});
