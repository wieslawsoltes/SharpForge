import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, parse } from '@sharpforge/syntax';
import { assertMatchesRoslyn, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-E03: C# 1.0-2.0 statement, expression and member grammar. Each task has a fixture whose tree equals the pinned
// Roslyn tree, plus direct assertions on the forms its acceptance criteria name.
const statements = body => SyntaxTree.parseText(`class C { void M() { ${body} } }`).root.members[0].members[0].body.statements;
const expression = text => statements(`var _ = ${text};`)[0].declaration.variables[0].initializer.value;
const classMembers = text => SyntaxTree.parseText(`class C { ${text} }`).root.members[0].members;
const codes = (text, version) => diagnosticsOf(text, version).map(d => d.split('@')[0]);
test('T13 goto, labeled statements, goto case and goto default match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp1-2/jumps.cs'); for (const kind of ['GotoStatement', 'GotoCaseStatement', 'GotoDefaultStatement', 'LabeledStatement']) assert(kinds.has(kind), kind); assert.deepEqual(tree.getDiagnostics(), []);
  const labeled = [...tree.root.descendantNodes()].filter(n => n.kind === 'LabeledStatement').map(n => n.statement.kind);
  assert.deepEqual(labeled, ['ExpressionStatement', 'ForStatement', 'WhileStatement', 'EmptyStatement', 'Block', 'LocalDeclarationStatement', 'LabeledStatement', 'ExpressionStatement', 'IfStatement', 'GotoStatement', 'TryStatement', 'ReturnStatement'], 'a label can prefix any statement');
  assert.equal(shapeOf(statements('goto L;')[0]), 'GotoStatement(goto IdentifierName(L) ;)'); assert.equal(shapeOf(statements('goto case 1 + 2;')[0]), 'GotoCaseStatement(goto case AddExpression(NumericLiteralExpression(1) + NumericLiteralExpression(2)) ;)'); assert.equal(shapeOf(statements('goto default;')[0]), 'GotoDefaultStatement(goto default ;)');
  const legacy = parse('class C { void M() { goto L; L: ; } }'); assert(!legacy.diagnostics.some(d => d.code === 'CS0246'), 'goto is never mis-parsed as a declaration of type goto');
  assert.deepEqual(codes('class C { void M() { goto L; L: ; M: { } goto case 1; goto default; } }', '1'), []);
});
test('T14 lock, checked/unchecked and full switch sections match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp1-2/blocks.cs'); for (const kind of ['LockStatement', 'CheckedStatement', 'UncheckedStatement', 'CheckedExpression', 'UncheckedExpression', 'SwitchSection', 'CaseSwitchLabel', 'DefaultSwitchLabel']) assert(kinds.has(kind), kind); assert.deepEqual(tree.getDiagnostics(), []);
  const first = [...tree.root.descendantNodes()].find(n => n.kind === 'SwitchStatement'); assert.deepEqual(first.sections.map(s => [s.labels.length, s.statements.length]), [[2, 2], [2, 1], [1, 2], [1, 2], [1, 1]], 'sections keep several labels and their statements; fall-through is left to the binder');
  assert.equal(shapeOf(statements('lock (o) x++;')[0]), 'LockStatement(lock ( IdentifierName(o) ) ExpressionStatement(PostIncrementExpression(IdentifierName(x) ++) ;))');
  assert.equal(shapeOf(expression('checked(a + b)')), 'CheckedExpression(checked ( AddExpression(IdentifierName(a) + IdentifierName(b)) ))'); assert.equal(statements('unchecked { }')[0].kind, 'UncheckedStatement'); assert.equal(expression('unchecked(a)').kind, 'UncheckedExpression');
  assert.deepEqual(statements('switch (x) { case 1: y = 1; case 2: y = 2; }')[0].sections.length, 2); assert.deepEqual(codes('class C { void M(int x) { switch (x) { case 1: x = 1; case 2: x = 2; break; } } }', '1'), [], 'no parser diagnostic for fall-through');
});
test('T15 typed catch clauses and full try forms match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp1-2/try.cs'); for (const kind of ['TryStatement', 'CatchClause', 'CatchDeclaration', 'FinallyClause']) assert(kinds.has(kind), kind); assert.deepEqual(tree.getDiagnostics(), []);
  const tries = [...tree.root.descendantNodes()].filter(n => n.kind === 'TryStatement');
  assert.deepEqual(tries.slice(0, 6).map(t => [t.catches.map(c => !c.declaration ? 'general' : c.declaration.identifier ? 'typed+name' : 'typed').join(','), !!t.finally]), [['typed', false], ['typed+name', false], ['general', false], ['typed+name,typed,typed+name,general', false], ['', true], ['typed+name', true]]);
  for (const text of ['try { A(); } catch (E', 'try { A(); } catch (E e', 'try { } catch (E e) {', 'try { } catch', 'try { } finally', 'try { A();', 'try', 'try { } catch (', 'try { } catch () { }']) {
    const full = `class C { void M() { ${text}`, recovered = SyntaxTree.parseText(full); assert.equal(recovered.toFullString(), full); assert(recovered.getDiagnostics().length > 0, text);
    assert.equal(recovered.root.members[0].members[0].body.statements[0].kind, 'TryStatement', 'recovery keeps the try statement: ' + text);
  }
  assert.deepEqual(codes('class C { void M() { try { } } }'), ['CS1524']); assert.deepEqual(codes('class C { void M() { try { } catch (System.Exception e) { } catch { } finally { } } }', '1'), []);
});
test('T16 typeof, sizeof, default, is and as take type operands and match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp1-2/type-operators.cs'); for (const kind of ['TypeOfExpression', 'SizeOfExpression', 'DefaultExpression', 'IsExpression', 'AsExpression', 'OmittedTypeArgument']) assert(kinds.has(kind), kind); assert.deepEqual(tree.getDiagnostics(), []);
  assert.equal(shapeOf(expression('o is int')), 'IsExpression(IdentifierName(o) is PredefinedType(int))'); assert.equal(shapeOf(expression('o as string')), 'AsExpression(IdentifierName(o) as PredefinedType(string))');
  assert.equal(shapeOf(expression('typeof(Dictionary<,>)')), 'TypeOfExpression(typeof ( GenericName(Dictionary TypeArgumentList(< OmittedTypeArgument() , OmittedTypeArgument() >)) ))');
  assert.equal(shapeOf(expression('typeof(List<>)')), 'TypeOfExpression(typeof ( GenericName(List TypeArgumentList(< OmittedTypeArgument() >)) ))');
  assert.equal(shapeOf(expression('default(T[])')), 'DefaultExpression(default ( ArrayType(IdentifierName(T) ArrayRankSpecifier([ OmittedArraySizeExpression() ])) ))'); assert.equal(shapeOf(expression('sizeof(long)')), 'SizeOfExpression(sizeof ( PredefinedType(long) ))');
  const legacy = parse('class C { void M(object o) { bool a = o is int; string s = o as string; } }'); assert(!legacy.diagnostics.some(d => d.code === 'CS0103'), '`o is int` no longer looks up a name called int');
  assert.deepEqual(codes('class C { void M(object o) { bool a = o is int; object s = o as string; System.Type t = typeof(int[]); int z = sizeof(int); } }', '1'), []);
});
test('T17 array creation, rank specifiers and initialisers match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp1-2/arrays.cs'); for (const kind of ['ArrayCreationExpression', 'ArrayType', 'ArrayRankSpecifier', 'ArrayInitializerExpression', 'ElementAccessExpression', 'OmittedArraySizeExpression']) assert(kinds.has(kind), kind); assert.deepEqual(tree.getDiagnostics(), []);
  assert.equal(shapeOf(expression('new int[2, 3]')), 'ArrayCreationExpression(new ArrayType(PredefinedType(int) ArrayRankSpecifier([ NumericLiteralExpression(2) , NumericLiteralExpression(3) ])))');
  assert.equal(shapeOf(expression('new int[n][]')), 'ArrayCreationExpression(new ArrayType(PredefinedType(int) ArrayRankSpecifier([ IdentifierName(n) ]) ArrayRankSpecifier([ OmittedArraySizeExpression() ])))');
  assert.equal(shapeOf(expression('new int[,] { { 1, 2 }, { 3, 4 } }').initializer), 'ArrayInitializerExpression({ ArrayInitializerExpression({ NumericLiteralExpression(1) , NumericLiteralExpression(2) }) , ArrayInitializerExpression({ NumericLiteralExpression(3) , NumericLiteralExpression(4) }) })');
  assert.equal(shapeOf(expression('m[0, i + 1][2]')), 'ElementAccessExpression(ElementAccessExpression(IdentifierName(m) BracketedArgumentList([ Argument(NumericLiteralExpression(0)) , Argument(AddExpression(IdentifierName(i) + NumericLiteralExpression(1))) ])) BracketedArgumentList([ Argument(NumericLiteralExpression(2)) ]))');
  assert.deepEqual(codes('class C { int[,] a = new int[2, 3]; int[][] b = new int[2][]; int[] c = { 1, 2 }; int d = new int[] { 1 }[0]; }', '1'), []);
});
test('T18 multi-declarator locals, const locals and for-loop lists match Roslyn', () => {
  const { tree } = assertMatchesRoslyn('reference/csharp1-2/locals.cs'); assert.deepEqual(tree.getDiagnostics().filter(d => d.code !== 'CS8024'), []);
  const [multi, constant, loop, loop2] = statements('int a = 1, b; const int c = 2, d = 3; for (int i = 0, j = 1; i < j; i++, j--) { } for (a = 0, b = 1; ; a++, b--, c += 2) ;');
  assert.deepEqual(multi.declaration.variables.map(v => [v.identifier.text, !!v.initializer]), [['a', true], ['b', false]]); assert.deepEqual(constant.modifiers.map(m => m.kind), ['ConstKeyword']); assert.equal(constant.declaration.variables.length, 2);
  assert.equal(loop.declaration.variables.length, 2); assert.equal(loop.incrementors.length, 2); assert.equal(loop.initializers.length, 0); assert.equal(loop2.declaration, null); assert.equal(loop2.initializers.length, 2); assert.equal(loop2.incrementors.length, 3); assert.equal(loop2.condition, null);
  assert.deepEqual(codes('class C { void M() { int a = 1, b; const int c = 2, d = 3; for (int i = 0, j = 1; i < j; i++, j--) { } for (a = 0, b = 1; ; ) { } } }', '1'), []);
});
test('T19 property and indexer accessor declarations match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp1-2/properties.cs'); for (const kind of ['PropertyDeclaration', 'IndexerDeclaration', 'AccessorList', 'GetAccessorDeclaration', 'SetAccessorDeclaration', 'ExplicitInterfaceSpecifier']) assert(kinds.has(kind), kind); assert.deepEqual(tree.getDiagnostics(), []);
  assert.equal(shapeOf(classMembers('public int P { get; protected set; }')[0]), 'PropertyDeclaration(public PredefinedType(int) P AccessorList({ GetAccessorDeclaration(get ;) SetAccessorDeclaration(protected set ;) }))');
  const [body, abstract, extern, indexer] = classMembers('int A { get { return 1; } set { x = value; } } public abstract int B { get; set; } extern int C { get; } public int this[int i] { get { return 1; } private set { } }');
  assert.deepEqual(body.accessorList.accessors.map(a => [a.keyword.text, !!a.body, !!a.semicolonToken]), [['get', true, false], ['set', true, false]]); assert.deepEqual(abstract.accessorList.accessors.map(a => !!a.semicolonToken), [true, true]);
  assert.equal(extern.modifiers[0].kind, 'ExternKeyword'); assert.equal(indexer.kind, 'IndexerDeclaration'); assert.deepEqual(indexer.accessorList.accessors[1].modifiers.map(m => m.kind), ['PrivateKeyword']);
  assert.deepEqual(codes('class C { public int P { get { return 1; } protected set { } } }', '1'), ['CS8022'], 'accessor accessibility is C# 2'); assert.deepEqual(codes('class C { public int P { get { return 1; } protected set { } } }', '2'), []);
  assert.deepEqual(codes('class C { int x; public int P { get { return x; } set { x = value; } } public int this[int i] { get { return x; } } }', '1'), []);
});
test('T20 iterator statements match Roslyn; `yield` stays an identifier', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp1-2/yield.cs'); assert(kinds.has('YieldReturnStatement') && kinds.has('YieldBreakStatement')); assert.deepEqual(tree.getDiagnostics(), []);
  const tokens = [...tree.root.descendantTokens()].filter(t => t.text === 'yield'); assert.equal(tokens.filter(t => t.kind === 'YieldKeyword').length, 7); assert(tokens.filter(t => t.kind === 'IdentifierToken').length >= 12);
  assert.deepEqual(statements('yield return 1; yield break; int yield = 1; yield = 2; yield(); yield x;').map(s => s.kind), ['YieldReturnStatement', 'YieldBreakStatement', 'LocalDeclarationStatement', 'ExpressionStatement', 'ExpressionStatement', 'LocalDeclarationStatement']);
  assert.deepEqual(codes('class C { System.Collections.IEnumerable M() { yield return 1; } }', '1'), ['CS8022']); assert.deepEqual(codes('class C { System.Collections.IEnumerable M() { yield return 1; yield break; } }', '2'), []);
});
test('T21 generic methods and explicit type-argument invocations match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp1-2/methods.cs'); for (const kind of ['TypeParameterList', 'TypeParameterConstraintClause', 'GenericName', 'TypeArgumentList']) assert(kinds.has(kind), kind); assert.deepEqual(tree.getDiagnostics(), []);
  assert.equal(shapeOf(expression('a.M<int>(x)')), 'InvocationExpression(SimpleMemberAccessExpression(IdentifierName(a) . GenericName(M TypeArgumentList(< PredefinedType(int) >))) ArgumentList(( Argument(IdentifierName(x)) )))');
  assert.equal(expression('F(G<A, B>(7))').argumentList.arguments.length, 1, 'G<A, B>(7) is a generic invocation'); assert.equal(expression('F(G < A, B > 7)').argumentList.arguments.length, 2, 'G < A, B > 7 is two comparisons');
  assert.equal(shapeOf(expression('a < b > c')), 'GreaterThanExpression(LessThanExpression(IdentifierName(a) < IdentifierName(b)) > IdentifierName(c))');
  const method = classMembers('T M<T, U>(T a) where T : class, new() where U : struct { return a; }')[0]; assert.equal(method.typeParameterList.parameters.length, 2); assert.equal(method.constraintClauses.length, 2);
  assert.deepEqual(codes('class C { T M<T>(T a) { return a; } }', '1'), ['CS8022']); assert.deepEqual(codes('class C { T M<T>(T a) where T : class, new() { return this.M<T>(a); } }', '2'), []);
});
test('T22 extern alias, the namespace alias qualifier and global:: match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp1-2/names.cs'); assert(kinds.has('ExternAliasDirective') && kinds.has('AliasQualifiedName')); assert.deepEqual(tree.getDiagnostics(), []);
  assert.equal(tree.root.externs.length, 2); assert.equal(tree.root.members[0].externs.length, 1); const globals = [...tree.root.descendantTokens()].filter(t => t.text === 'global');
  assert(globals.filter(t => t.kind === 'GlobalKeyword').length >= 9); assert.equal(globals.filter(t => t.kind === 'IdentifierToken').length, 3, 'a local named global is an identifier');
  assert.equal(shapeOf(expression('global::System.Console.Out')), 'SimpleMemberAccessExpression(SimpleMemberAccessExpression(AliasQualifiedName(IdentifierName(global) :: IdentifierName(System)) . IdentifierName(Console)) . IdentifierName(Out))');
  assert.equal(shapeOf(classMembers('X::N.T<global::System.Int32> f;')[0].declaration.type), 'QualifiedName(AliasQualifiedName(IdentifierName(X) :: IdentifierName(N)) . GenericName(T TypeArgumentList(< QualifiedName(AliasQualifiedName(IdentifierName(global) :: IdentifierName(System)) . IdentifierName(Int32)) >)))');
  assert.deepEqual(codes('extern alias X; class C { global::System.Int32 a; X::N.T b; }', '1'), ['CS8022', 'CS8022', 'CS8022']); assert.deepEqual(codes('extern alias X; using G = global::System.Int32; class C { global::System.Int32 a; X::N.T b; }', '2'), []);
});
test('T23 static classes, partial types of all kinds and nullable coalescing match Roslyn', () => {
  const { tree } = assertMatchesRoslyn('reference/csharp1-2/type-modifiers.cs'); assert.deepEqual(tree.getDiagnostics(), []);
  assert.deepEqual(tree.root.members.slice(0, 7).map(m => [m.kind, m.modifiers.map(x => x.text).join(' ')]), [['ClassDeclaration', 'public static'], ['ClassDeclaration', 'static partial'], ['ClassDeclaration', 'partial'], ['StructDeclaration', 'public partial'], ['InterfaceDeclaration', 'internal partial'], ['StructDeclaration', 'partial'], ['ClassDeclaration', 'public sealed partial']]);
  assert.equal(shapeOf(expression('a ?? b ?? c')), 'CoalesceExpression(IdentifierName(a) ?? CoalesceExpression(IdentifierName(b) ?? IdentifierName(c)))', '?? is right-associative');
  assert.equal(shapeOf(expression('x as int? ?? 0')), 'CoalesceExpression(AsExpression(IdentifierName(x) as NullableType(PredefinedType(int) ?)) ?? NumericLiteralExpression(0))');
  assert.equal(shapeOf(expression('a ?? b > 0 ? 1 : 2')), 'ConditionalExpression(CoalesceExpression(IdentifierName(a) ?? GreaterThanExpression(IdentifierName(b) > NumericLiteralExpression(0))) ? NumericLiteralExpression(1) : NumericLiteralExpression(2))');
  assert.deepEqual(codes('static class S { }', '1'), ['CS8022']); assert.deepEqual(codes('partial struct P { }', '1'), ['CS8022']); assert.deepEqual(codes('partial interface I { }', '1'), ['CS8022']); assert.deepEqual(codes('class C { int? a; }', '1'), ['CS8022']);
  assert.deepEqual(codes('static class S { } partial struct P { } partial interface I { } public static partial class Q { } class C { void M(int? a, int? c) { int? b = a ?? c ?? 1; } }', '2'), []);
});
