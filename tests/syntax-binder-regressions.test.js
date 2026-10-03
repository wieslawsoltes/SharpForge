import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree } from '../packages/syntax/src/index.js';

/** Node kinds of the tree in pre-order. */
function kinds(node, out = []) {
  out.push(node.kind);
  for (const child of node.childNodes()) kinds(child, out);
  return out;
}

test('`new T();` at compilation-unit level is an object-creation statement', () => {
  const tree = SyntaxTree.parseText('new T();');
  assert.deepEqual(tree.diagnostics, []);
  const found = kinds(tree.root);
  assert.ok(found.includes('GlobalStatement'));
  assert.ok(found.includes('ObjectCreationExpression'));
  assert.ok(!found.includes('ConstructorDeclaration'));
});

test('`new` stays a modifier before a member declaration in a type', () => {
  const tree = SyntaxTree.parseText('class B { public int F; } class C : B { new int F; }');
  assert.deepEqual(tree.diagnostics, []);
  assert.ok(kinds(tree.root).includes('FieldDeclaration'));
});

test('a parenthesised multiplication is not a pointer declaration expression', () => {
  const tree = SyntaxTree.parseText('class C { void M(int a, int b) { var x = (a * b); var y = (a * b, 1); } }');
  assert.deepEqual(tree.diagnostics, []);
  const found = kinds(tree.root);
  assert.equal(found.filter(kind => kind === 'MultiplyExpression').length, 2);
  assert.ok(!found.includes('DeclarationExpression'));
  assert.ok(!found.includes('PointerType'));
});

test('tuple deconstruction declarations still parse as declaration expressions', () => {
  const tree = SyntaxTree.parseText('class C { void M() { (int a, var b) = (1, 2); } }');
  assert.deepEqual(tree.diagnostics, []);
  assert.equal(kinds(tree.root).filter(kind => kind === 'DeclarationExpression').length, 2);
});

test('a missing token is reported on the current token unless a line break follows the previous one', () => {
  const sameLine = SyntaxTree.parseText('class C{void M(){int x = 1 int y;}}').diagnostics[0];
  assert.deepEqual([sameLine.code, sameLine.start, sameLine.length], ['CS1002', 27, 3]);
  const nextLine = SyntaxTree.parseText('class C{void M(){int x = 1\n int y;}}').diagnostics[0];
  assert.deepEqual([nextLine.code, nextLine.start], ['CS1002', 26]);
});
