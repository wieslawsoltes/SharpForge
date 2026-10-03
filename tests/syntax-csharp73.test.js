import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFeature } from '@sharpforge/syntax';
import { assertGatesMatchRoslyn, assertMatchesRoslyn, classMembersOf, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T37: C# 7.3 field-targeted attributes on auto-properties, the new constraints and expression variables in
// initializers and queries.
test('T37 field-targeted attributes, 7.3 constraints and expression variables match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp7/csharp73.cs');
  for (const kind of ['AttributeTargetSpecifier', 'TypeConstraint', 'DeclarationExpression', 'DeclarationPattern', 'QueryExpression'])
    assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
});

test('T37 [field: Attr] on an auto-property is an attribute list with a field target', () => {
  const [property] = classMembersOf('[field: System.NonSerialized] public int A { get; set; }');
  assert.equal(
    shapeOf(property.attributeLists[0]),
    'AttributeList([ AttributeTargetSpecifier(field :) Attribute(QualifiedName(IdentifierName(System) . IdentifierName(NonSerialized))) ])'
  );
  assert.equal(property.attributeLists[0].target.identifier.kind, 'FieldKeyword');
});

test('T37 unmanaged, System.Enum and System.Delegate are type constraints', () => {
  const [method] = classMembersOf('void M<T, U, V>() where T : unmanaged where U : System.Enum where V : System.Delegate, new() { }');
  assert.deepEqual(
    method.constraintClauses.map(clause => clause.constraints.map(constraint => constraint.kind).join(' ')),
    ['TypeConstraint', 'TypeConstraint', 'TypeConstraint ConstructorConstraint']
  );
  assert.equal(shapeOf(method.constraintClauses[0].constraints[0]), 'TypeConstraint(IdentifierName(unmanaged))');
  // Whether these names are the special constraints depends on what they bind to, so the parser has no gate for them.
  for (const id of ['UnmanagedGenericTypeConstraint', 'EnumGenericTypeConstraint', 'DelegateGenericTypeConstraint'])
    assert.equal(languageFeature(id).version, 7.3);
  assert.deepEqual(diagnosticsOf('class C<T> where T : unmanaged { }', '7.2'), []);
});

test('T37 the 7.3 gates fire where Roslyn reports them', () => {
  const agreed = assertGatesMatchRoslyn('gates/csharp73.rejected.cs');
  assert.equal(agreed.length, 5, 'field, property and constructor initializers and two query clauses');
  assert.deepEqual(diagnosticsOf('class C { [field: A] int P { get; set; } }', '7.2'), ['CS8371@11 "field:"']);
  assert.deepEqual(diagnosticsOf('class C { [field: A] int P { get; set; } }', '7.3'), []);
  assert.deepEqual(diagnosticsOf('class C { int g = F(out var x) ? x : 0; }', '7.2'), ['CS8320@24 "var x"']);
  assert.deepEqual(diagnosticsOf('class C { int g = F(out var x) ? x : 0; }', '7.3'), []);
});

test('T37 expression variables in method bodies and lambdas need no 7.3', () => {
  const source =
    'class C { void M() { if (F(out var a) && o is int b) { } } System.Func<int> g = () => F(out var c) ? c : 0; ' +
    'System.Action h = () => { F(out var d); }; [field: A] event System.Action E; }';
  assert.deepEqual(diagnosticsOf(source, '7.2'), []);
});
