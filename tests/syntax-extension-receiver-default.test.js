import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesRoslyn, assertRecoversLikeRoslyn, classMembersOf, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// Reported by the compiler workstream: a default value on an extension receiver (`extension(int x = 0)`) failed in
// the parser. Roslyn parses it as an ordinary parameter default and reports CS9284 while binding.
test('extension receivers with a default value match Roslyn and report nothing', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp13-14/extension-receiver-default.cs');
  assert(kinds.has('ExtensionBlockDeclaration'));
  assert(kinds.has('EqualsValueClause'));
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('the default is the EqualsValueClause of the receiver parameter, with or without a name', () => {
  const [named, unnamed, plain] = classMembersOf('extension(int x = 0) { } extension(int = 1) { } extension(int y) { }');
  const receiver = block => block.parameterList.parameters[0];
  assert.equal(shapeOf(receiver(named)), 'Parameter(PredefinedType(int) x EqualsValueClause(= NumericLiteralExpression(0)))');
  assert.equal(shapeOf(receiver(unnamed)), 'Parameter(PredefinedType(int) EqualsValueClause(= NumericLiteralExpression(1)))');
  assert.equal(receiver(plain).default, null);
  assert.deepEqual(diagnosticsOf('static class E { extension(int x = 0) { public int A => x; } }'), []);
});

test('a missing default expression recovers as Roslyn does', () => {
  assertRecoversLikeRoslyn('reference/csharp13-14/extension-receiver-default-recovery.cs');
  assert.deepEqual(diagnosticsOf('static class E { extension(int x = ) { } }'), ['CS1525@35 ")"']);
});
