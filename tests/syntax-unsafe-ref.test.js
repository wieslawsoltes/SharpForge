import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree } from '@sharpforge/syntax';
import { assertMatchesRoslyn, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T11: unsafe and ref syntax - pointers, fixed, stackalloc, ref forms, function pointers, scoped and ref readonly.
const statements = body => SyntaxTree.parseText(`unsafe class C { void M() { ${body} } }`).root.members[0].members[0].body.statements;
const codes = (text, version) => diagnosticsOf(text, version).map(d => d.split('@')[0]);
test('T11.1 pointers: types, unsafe blocks and pointer operators match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/unsafe/pointers.cs');
  for (const kind of ['PointerType', 'UnsafeStatement', 'PointerIndirectionExpression', 'AddressOfExpression', 'PointerMemberAccessExpression', 'ElementAccessExpression', 'SizeOfExpression', 'CastExpression']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  // The `a * b;` rule: a statement that can be a declaration is one; in expression positions `*` multiplies.
  assert.deepEqual(statements('a * b; a * b = c; T* t; a.b * c; x = a * b; M(a * b);').map(s => s.kind), ['LocalDeclarationStatement', 'LocalDeclarationStatement', 'LocalDeclarationStatement', 'LocalDeclarationStatement', 'ExpressionStatement', 'ExpressionStatement']);
  assert.equal(shapeOf(statements('a * b;')[0].declaration.type), 'PointerType(IdentifierName(a) *)'); assert.equal(shapeOf(statements('x = a * b;')[0].expression.right), 'MultiplyExpression(IdentifierName(a) * IdentifierName(b))');
  assert.equal(shapeOf(statements('p->q->r = *&x;')[0].expression), 'SimpleAssignmentExpression(PointerMemberAccessExpression(PointerMemberAccessExpression(IdentifierName(p) -> IdentifierName(q)) -> IdentifierName(r)) = PointerIndirectionExpression(* AddressOfExpression(& IdentifierName(x))))');
  assert.deepEqual(codes('unsafe class C { int* p; void M() { unsafe { int x = sizeof(int); } } }', '1'), [], 'pointers are C# 1');
});
test('T11.2 fixed statements and fixed-size buffers match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/unsafe/fixed.cs'); assert(kinds.has('FixedStatement')); assert.deepEqual(tree.getDiagnostics(), []);
  const fields = tree.root.members[0].members.filter(m => m.kind === 'FieldDeclaration' && m.modifiers.some(x => x.kind === 'FixedKeyword')); assert.equal(fields.length, 3);
  assert.deepEqual(fields[1].declaration.variables.map(v => [v.identifier.text, v.argumentList.arguments[0].toString()]), [['a', '4'], ['b', '8']]);
  assert.deepEqual(codes('unsafe struct S { fixed int buf[8]; }', '1'), ['CS8022'], 'fixed-size buffers are C# 2'); assert.deepEqual(codes('unsafe struct S { fixed int buf[8]; }', '2'), []);
  assert.deepEqual(codes('unsafe class C { void M(int[] a) { fixed (int* p = a, q = &a[0]) { } } }', '1'), [], 'the fixed statement is C# 1');
});
test('T11.3 stackalloc forms match Roslyn with per-version gates', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/unsafe/stackalloc.cs'); assert(kinds.has('StackAllocArrayCreationExpression') && kinds.has('ImplicitStackAllocArrayCreationExpression')); assert.deepEqual(tree.getDiagnostics(), []);
  const wrap = body => `class C { unsafe void M() { ${body} } }`;
  assert.deepEqual(codes(wrap('int* a = stackalloc int[3];'), '1'), []);
  assert.deepEqual(codes(wrap('int* a = stackalloc int[] { 1, 2 };'), '7.2'), ['CS8320']); assert.deepEqual(codes(wrap('int* a = stackalloc int[2] { 1, 2 };'), '7.2'), ['CS8320']);
  assert.deepEqual(codes(wrap('int* a = stackalloc[] { 1, 2 };'), '7.2'), ['CS8320']); assert.deepEqual(codes(wrap('int* a = stackalloc[] { 1, 2 }; int* b = stackalloc int[] { 1 };'), '7.3'), []);
});
test('T11.4 ref locals, returns, expressions and in arguments match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/ref/ref-forms.cs'); for (const kind of ['RefType', 'RefExpression', 'ConditionalExpression', 'ForEachStatement', 'DeclarationExpression']) assert(kinds.has(kind), kind); assert.deepEqual(tree.getDiagnostics(), []);
  const wrap = body => `class C { void M(ref int a, int[] arr) { ${body} } }`;
  assert.deepEqual(codes(wrap('ref int r = ref a;'), '6'), ['CS8059']); assert.deepEqual(codes(wrap('ref int r = ref a;'), '7'), []);
  assert.deepEqual(codes('class C { ref int M(ref int a) { return ref a; } }', '6'), ['CS8059']); assert.deepEqual(codes('class C { void M(in int x) { } }', '7.1'), ['CS8302']); assert.deepEqual(codes('class C { void M(in int x) { } }', '7.2'), []);
  assert.equal(shapeOf(statements('r = ref a;')[0].expression), 'SimpleAssignmentExpression(IdentifierName(r) = RefExpression(ref IdentifierName(a)))');
  assert.equal(shapeOf(statements('var c = t ? ref a : ref b;')[0].declaration.variables[0].initializer.value), 'ConditionalExpression(IdentifierName(t) ? RefExpression(ref IdentifierName(a)) : RefExpression(ref IdentifierName(b)))');
  assert.equal(statements('foreach (ref readonly var i in s) { }')[0].type.kind, 'RefType');
});
test('T11.5 function pointer types match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/unsafe/function-pointers.cs');
  for (const kind of ['FunctionPointerType', 'FunctionPointerParameterList', 'FunctionPointerParameter', 'FunctionPointerCallingConvention', 'FunctionPointerUnmanagedCallingConventionList', 'FunctionPointerUnmanagedCallingConvention']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  const type = SyntaxTree.parseText('unsafe class C { delegate* unmanaged[Cdecl, SuppressGCTransition]<int*, List<int>[], void> p; }').root.members[0].members[0].declaration.type;
  assert.equal(shapeOf(type), 'FunctionPointerType(delegate * FunctionPointerCallingConvention(unmanaged FunctionPointerUnmanagedCallingConventionList([ FunctionPointerUnmanagedCallingConvention(Cdecl) , FunctionPointerUnmanagedCallingConvention(SuppressGCTransition) ])) '
    + 'FunctionPointerParameterList(< FunctionPointerParameter(PointerType(PredefinedType(int) *)) , FunctionPointerParameter(ArrayType(GenericName(List TypeArgumentList(< PredefinedType(int) >)) ArrayRankSpecifier([ OmittedArraySizeExpression() ]))) , FunctionPointerParameter(PredefinedType(void)) >))');
  assert.deepEqual(codes('unsafe class C { delegate*<int, void> p; }', '8'), ['CS8400']); assert.deepEqual(codes('unsafe class C { delegate*<int, void> p; }', '9'), []);
  assert.equal(SyntaxTree.parseText('delegate void D(int x);').root.members[0].kind, 'DelegateDeclaration');
});
test('T11.6 scoped and ref readonly parameter modifiers match Roslyn; `scoped` stays an identifier or type name', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/ref/scoped.cs'); assert(kinds.has('ScopedType')); assert.deepEqual(tree.getDiagnostics(), []);
  const scoped = [...tree.root.descendantTokens()].filter(t => t.text === 'scoped'); assert.equal(scoped.filter(t => t.kind === 'ScopedKeyword').length, 10); assert.equal(scoped.filter(t => t.kind === 'IdentifierToken').length, 10);
  assert.deepEqual(codes('class C { void M(ref readonly int x) { } }', '11'), ['CS9058']); assert.deepEqual(codes('class C { void M(ref readonly int x) { } }', '12'), []);
  assert.deepEqual(codes('class scoped { scoped f; scoped M(scoped p) { scoped local = p; return local; } }', '2'), []);
});
