import test from 'node:test';
import assert from 'node:assert/strict';
import { boundPhaseCodes } from '@sharpforge/syntax';
import {
  assertMatchesRoslyn,
  assertRecoversLikeRoslyn,
  classMembersOf,
  diagnosticsOf,
  expressionOf,
  shapeOf
} from './support/syntax-reference.js';

// SF-A01-T34: C# 7.0 throw expressions.
const inMethod = body => `class C { void M() { ${body} } }`;

test('T34 throw expressions match Roslyn in every position', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp7/throw.cs');
  assert(kinds.has('ThrowExpression'));
  const codes = tree.getDiagnostics().map(diagnostic => diagnostic.code);
  assert.equal(codes.filter(code => code === 'CS1525').length, 5, 'tighter than ?? is a syntax error, as in Roslyn');
  assert.equal(codes.filter(code => code === 'CS8115').length, 6);
  assert(boundPhaseCodes.has('CS8115'), 'Roslyn reports CS8115 while binding, so its parse-only tree does not carry it');
});

test('T34 throw is allowed in conditional, null-coalescing and expression-bodied positions', () => {
  assert.equal(
    shapeOf(expressionOf('x ?? throw new E()')),
    'CoalesceExpression(IdentifierName(x) ?? ThrowExpression(throw ObjectCreationExpression(new IdentifierName(E) ArgumentList(( )))))'
  );
  assert.equal(
    shapeOf(expressionOf('c ? throw a : throw b')),
    'ConditionalExpression(IdentifierName(c) ? ThrowExpression(throw IdentifierName(a)) : ThrowExpression(throw IdentifierName(b)))'
  );
  const [method, property, accessors, constructor] = classMembersOf(
    'int M() => throw new E(); int P => throw new E(); int Q { get => throw new E(); set => throw new E(); } C() => throw new E();'
  );
  assert.equal(method.expressionBody.expression.kind, 'ThrowExpression');
  assert.equal(property.expressionBody.expression.kind, 'ThrowExpression');
  assert.equal(accessors.accessorList.accessors[1].expressionBody.expression.kind, 'ThrowExpression');
  assert.equal(constructor.expressionBody.expression.kind, 'ThrowExpression');
  const allowed =
    'var a = x ?? throw new E(); var b = c ? d : throw e; var f = c ? throw e : d; Func<int> g = () => throw new E(); ' +
    'Func<int, int> h = v => throw new E(); a = b ?? throw new E(); var i = j ?? k ?? throw new E(); return x ?? throw new E();';
  assert.deepEqual(diagnosticsOf(inMethod(allowed)), []);
});

test('T34 throw in any other position reports CS8115', () => {
  for (const body of [
    'var a = throw new E();',
    'F(throw new E());',
    'var c = (throw new E());',
    'var i = new[] { throw e };',
    'return throw e;',
    'throw throw e;',
    'a = throw e;',
    'var t = (1, throw e);'
  ])
    assert.deepEqual(
      diagnosticsOf(inMethod(body)).map(entry => entry.split('@')[0]),
      ['CS8115'],
      body
    );
  assert.deepEqual(diagnosticsOf(inMethod('throw new E(); throw;')), [], 'the throw statement is unaffected');
});

test('T34 throw as an operand that binds tighter than ?? is CS1525, as in Roslyn', () => {
  for (const body of ['var b = 1 + throw e;', 'var g = x && throw e;', 'var j = -throw e;', 'var k = (int)throw e;', 'var l = x == throw e;'])
    assert.deepEqual(
      diagnosticsOf(inMethod(body)).map(entry => entry.split('@')[0]),
      ['CS1525'],
      body
    );
});

test('T34 throw expressions are rejected below C# 7', () => {
  assert.deepEqual(diagnosticsOf(inMethod('var a = x ?? throw new E();'), '6'), ['CS8059@34 "throw"']);
  assert.deepEqual(diagnosticsOf(inMethod('var a = x ?? throw new E();'), '7'), []);
  assert.deepEqual(diagnosticsOf(inMethod('throw new E();'), '1'), []);
});

test('T34 a throw expression without an operand recovers as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp7/throw-recovery.cs');
  const throws = [...tree.root.descendantNodes()].filter(node => node.kind === 'ThrowExpression');
  assert.equal(throws.length, 4);
  assert.equal(shapeOf(throws[0]), 'ThrowExpression(throw IdentifierName(<IdentifierToken>))');
});
