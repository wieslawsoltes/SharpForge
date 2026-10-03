import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SyntaxTree, parse, Parser, lex, overloadableOperators } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { repoRoot, filesUnder } from './support/syntax-reference.js';

const tree = (text, options) => SyntaxTree.parseText(text, options), codes = (text, options) => tree(text, options).getDiagnostics().map(d => d.code);
const shape = node => node.isToken ? (node.isMissing ? '<' + node.kind + '>' : node.text) : '(' + node.kind + ' ' + node.childNodesAndTokens().map(shape).join(' ') + ')';
const expression = text => tree('x = ' + text + ';').root.members[0].statement.expression.right;
const member = (text, index = 0) => tree('class C { ' + text + ' }').root.members[0].members[index];
// ---- SF-A01-T02.1: module layout ------------------------------------------------------------------------------------
test('parser modules: cursor, types, statements, expressions and one module per declaration, expression and pattern family', () => {
  const directory = join(repoRoot, 'packages/syntax/src/parser');
  for (const module of ['core', 'recovery', 'types', 'modifiers', 'statements', 'expressions', 'declarations/namespaces', 'declarations/types', 'declarations/enums', 'declarations/delegates', 'declarations/members', 'declarations/attributes', 'declarations/events', 'declarations/operators',
    'declarations/constructors', 'declarations/type-parameters', 'expressions/anonymous-functions', 'expressions/lambdas', 'expressions/queries', 'expressions/tuples', 'expressions/nullability', 'expressions/generic-names', 'patterns/basic', 'patterns/recursive', 'patterns/combinators', 'patterns/lists']) assert(existsSync(join(directory, module + '.js')), module);
  for (const file of filesUnder(directory, name => name.endsWith('.js'))) assert(readFileSync(file, 'utf8').split('\n').length <= 400, file + ' exceeds 400 lines');
  for (const method of ['at', 'peek', 'take', 'match', 'expect', 'guardProgress', 'type', 'statement', 'expression', 'pattern', 'compilationUnit']) assert.equal(typeof Parser.prototype[method], 'function', method);
  const parser = new Parser(lex(new SourceText('a + b'))); assert.equal(parser.expression().kind, 'AddExpression'); assert(parser.at('eof'));
});
// ---- SF-A01-T05: declarations ---------------------------------------------------------------------------------------
test('T05.1 namespaces: namespace, using and alias nodes are preserved in order; the adapter still flattens names', () => {
  const source = 'extern alias L;\nusing System;\nusing static System.Math;\nusing IO = System.IO;\nnamespace A.B { using C; namespace D { class E { } } class F { } }\nclass G { }', root = tree(source).root;
  assert.deepEqual(root.externs.map(e => e.identifier.text), ['L']); assert.deepEqual(root.usings.map(u => [u.staticKeyword?.text ?? null, u.alias?.name.toString() ?? null, u.namespaceOrType.toString()]), [[null, null, 'System'], ['static', null, 'System.Math'], [null, 'IO', 'System.IO']]);
  assert.deepEqual(root.members.map(m => m.kind), ['NamespaceDeclaration', 'ClassDeclaration']); const outer = root.members[0]; assert.equal(outer.name.toString(), 'A.B'); assert.equal(outer.usings.length, 1); assert.deepEqual(outer.members.map(m => m.kind), ['NamespaceDeclaration', 'ClassDeclaration']);
  assert.deepEqual(parse('using System;\nnamespace A.B { namespace D { class E { } } class F { } }\nclass G { }').root.members.map(m => [m.name, m.namespace]), [['E', 'A.B.D'], ['F', 'A.B'], ['G', '']]);
  assert.equal(tree('namespace N;\nclass C { }').root.members[0].kind, 'FileScopedNamespaceDeclaration'); assert.deepEqual(codes('class C { }\nusing System;'), ['CS1529']); assert.equal(tree('class C { }\nusing System;').toFullString(), 'class C { }\nusing System;');
});
test('T05.2-T05.5 types: structs, interfaces, enums, delegates and nested types with recovery on missing braces', () => {
  const root = tree('struct S : IA, IB<int> { } interface I : IA { void M(); } class C : Base, IA, IB<int> { class N1 { struct N2 { enum N3 { A, B = 2, } } } } enum E : byte { X = 1, Y } delegate T D<in T>(T x) where T : class;').root;
  assert.deepEqual(root.members.map(m => m.kind), ['StructDeclaration', 'InterfaceDeclaration', 'ClassDeclaration', 'EnumDeclaration', 'DelegateDeclaration']); assert.deepEqual(root.members[2].baseList.types.map(t => t.toString()), ['Base', 'IA', 'IB<int>']);
  const nested = root.members[2].members[0]; assert.equal(nested.members[0].members[0].kind, 'EnumDeclaration'); assert.deepEqual(nested.members[0].members[0].members.map(m => m.identifier.text), ['A', 'B']); assert.equal(root.members[3].baseList.types[0].toString(), 'byte'); assert.equal(root.members[4].constraintClauses.length, 1);
  for (const [text, missing] of [['struct S { int a;', 'CS1513'], ['interface I { void M();', 'CS1513'], ['class C : A, B { class D { }', 'CS1513'], ['enum E { A B, C }', 'CS1003'], ['enum E { A,', 'CS1513'], ['class C { void M() { }', 'CS1513'], ['delegate void D(', 'CS1026']]) {
    const parsed = tree(text); assert(parsed.getDiagnostics().some(d => d.code === missing), text + ' ' + parsed.getDiagnostics().map(d => d.code)); assert.equal(parsed.toFullString(), text); assert(parsed.root.members.length >= 1);
  }
  assert.deepEqual(tree('enum E { A B, C }').root.members[0].members.map(m => m.identifier.text), ['A', 'B', 'C'], 'a missing comma recovers to the next member');
  const unclosed = tree('struct S { int a;\nclass After { }'); assert.equal(unclosed.root.members[0].members.at(-1).kind, 'ClassDeclaration');
});
test('T05.6 attributes: targets and named arguments on every declaration kind', () => {
  const root = tree('[assembly: A(1, Name = "n")]\n[module: M]\n[Serializable, Obsolete("x", error: true)] class C<[T] X> { [field: F] int f; [return: R] int M([param: P] int a) { return 0; } [property: Q] int P { [method: G] get; set; } [event: E] event H Ev; } enum En { [D] A }').root;
  assert.deepEqual(root.attributeLists.map(l => [l.target.identifier.kind, l.attributes[0].name.toString()]), [['AssemblyKeyword', 'A'], ['ModuleKeyword', 'M']]);
  const args = root.attributeLists[0].attributes[0].argumentList.arguments; assert.equal(args[1].nameEquals.name.toString(), 'Name'); const type = root.members[0]; assert.deepEqual(type.attributeLists[0].attributes.map(a => a.name.toString()), ['Serializable', 'Obsolete']);
  assert.equal(type.attributeLists[0].attributes[1].argumentList.arguments[1].nameColon.name.toString(), 'error'); assert.equal(type.typeParameterList.parameters[0].attributeLists.length, 1);
  assert.deepEqual(type.members.map(m => m.attributeLists[0].target.identifier.kind), ['FieldKeyword', 'ReturnKeyword', 'PropertyKeyword', 'EventKeyword']); assert.equal(type.members[1].parameterList.parameters[0].attributeLists[0].target.identifier.kind, 'ParamKeyword'); assert.equal(root.members[1].members[0].attributeLists.length, 1);
  assert.equal(tree('[1, 2].ToString();').root.members[0].statement.expression.kind, 'InvocationExpression', 'a bracket before an expression is a collection expression, not an attribute');
});
test('T05.7-T05.9 members: events, explicit interface names, indexers, operators, constructors', () => {
  assert.equal(shape(member('event EventHandler I.E { add {} remove {} }')), '(EventDeclaration event (IdentifierName EventHandler) (ExplicitInterfaceSpecifier (IdentifierName I) .) E (AccessorList { (AddAccessorDeclaration add (Block { })) (RemoveAccessorDeclaration remove (Block { })) }))');
  assert.equal(member('event H A, B;').kind, 'EventFieldDeclaration'); assert.equal(member('void I<int>.M() { }').explicitInterfaceSpecifier.name.kind, 'GenericName'); assert.equal(member('int A.B.I.P => 1;').explicitInterfaceSpecifier.name.toString(), 'A.B.I');
  assert.equal(member('int this[int i, string s] { get; set; }').parameterList.kind, 'BracketedParameterList'); assert.equal(member('int I.this[int i] => i;').kind, 'IndexerDeclaration');
  for (const operator of overloadableOperators) { const text = `public static C operator ${operator}(C a${['+', '-', '!', '~', '++', '--', 'true', 'false'].includes(operator) && operator.length <= 5 && !['+', '-'].includes(operator) ? '' : ', C b'}) { return a; }`, declared = member(text); assert.equal(declared.kind, 'OperatorDeclaration', operator); assert.equal(declared.operatorToken.text, operator); assert.equal(tree('class C { ' + text + ' }').toFullString(), 'class C { ' + text + ' }'); }
  assert(codes('class C { public static C operator =(C a, C b) { return a; } }').includes('CS1019')); assert(codes('class C { public static C operator &&(C a, C b) { return a; } }').includes('CS1019'));
  assert.equal(member('public static implicit operator int(C c) => 0;').implicitOrExplicitKeyword.text, 'implicit'); assert.equal(member('public static explicit operator C(int i) { return null; }').type.toString(), 'C');
  const constructor = member('public C(int x) : base(x, 1) { }'); assert.equal(constructor.kind, 'ConstructorDeclaration'); assert.equal(constructor.initializer.kind, 'BaseConstructorInitializer'); assert.equal(constructor.initializer.argumentList.arguments.length, 2);
  assert.equal(member('C() : this(1) { }').initializer.kind, 'ThisConstructorInitializer'); assert.equal(member('static C() { }').modifiers[0].text, 'static'); assert.equal(member('~C() { }').kind, 'DestructorDeclaration');
  const recovered = tree('class C { C() : base { } void M() { } }'); assert(recovered.getDiagnostics().length > 0); assert.equal(recovered.root.members[0].members.at(-1).identifier.text, 'M', 'a missing initializer argument list recovers'); assert.equal(recovered.toFullString(), 'class C { C() : base { } void M() { } }');
  assert.deepEqual(member('const int A = 1, B = A + 1;').declaration.variables.map(v => v.identifier.text), ['A', 'B']); assert.deepEqual(member('int a, b = 2, c;').declaration.variables.length, 3);
});
test('T05.10-T05.11 modifiers, parameters, type parameters and constraints', () => {
  const modifiers = text => member(text).modifiers.map(m => m.text);
  assert.deepEqual(modifiers('public new virtual void M() { }'), ['public', 'new', 'virtual']); assert.deepEqual(modifiers('protected internal abstract override int P { get; }'), ['protected', 'internal', 'abstract', 'override']); assert.deepEqual(modifiers('private protected sealed override void M() { }'), ['private', 'protected', 'sealed', 'override']);
  assert.deepEqual(modifiers('static extern unsafe void M();'), ['static', 'extern', 'unsafe']); assert.deepEqual(modifiers('volatile int f;'), ['volatile']); assert.deepEqual(modifiers('public async Task M() { }'), ['public', 'async']); assert.deepEqual(modifiers('partial void M();'), ['partial']);
  assert.deepEqual(codes('class C { public public int x; }'), ['CS1004']); assert.deepEqual(codes('class C { static readonly static int x; }'), ['CS1004']); assert.deepEqual(codes('class C { void M(ref ref int x) { } }'), ['CS1107']);
  assert.deepEqual(member('void M(ref int a, out int b, params int[] c, in int d, this int e, int f = 1) { }').parameterList.parameters.map(p => p.modifiers.map(m => m.text).join(' ')), ['ref', 'out', 'params', 'in', 'this', '']);
  const generic = tree('class G<in A, out B, C> where A : class, new() where B : struct where C : Base, IFoo<C>, notnull { T M<T>() where T : unmanaged { return default(T); } }').root.members[0];
  assert.deepEqual(generic.typeParameterList.parameters.map(p => (p.varianceKeyword?.text ?? '') + p.identifier.text), ['inA', 'outB', 'C']); assert.deepEqual(generic.constraintClauses.map(c => c.constraints.map(k => k.kind)), [['ClassConstraint', 'ConstructorConstraint'], ['StructConstraint'], ['TypeConstraint', 'TypeConstraint', 'TypeConstraint']]);
  assert.equal(generic.members[0].typeParameterList.parameters.length, 1); assert.equal(parse('class G<T> { }').diagnostics[0].code, 'SF1012', 'the legacy profile still reports generic declarations');
  for (const removed of ['SF1010', 'SF1011', 'SF1012', 'SF1013', 'SF1014', 'SF1015', 'SF1017']) for (const file of filesUnder(join(repoRoot, 'packages/syntax/src/parser'), name => name.endsWith('.js'))) assert(!readFileSync(file, 'utf8').includes(removed), `${removed} is no longer a parser diagnostic (${file})`);
});
// ---- SF-A01-T06: expressions and patterns ---------------------------------------------------------------------------
test('T06.1-T06.2 anonymous functions and the lambda / cast / parenthesised-expression scan', () => {
  assert.equal(shape(expression('(a) => a')), '(ParenthesizedLambdaExpression (ParameterList ( (Parameter a) )) => (IdentifierName a))'); assert.equal(shape(expression('(int a, int b) => {}')), '(ParenthesizedLambdaExpression (ParameterList ( (Parameter (PredefinedType int) a) , (Parameter (PredefinedType int) b) )) => (Block { }))');
  assert.equal(shape(expression('async x => await x')), '(SimpleLambdaExpression async (Parameter x) => (AwaitExpression await (IdentifierName x)))'); assert.equal(shape(expression('(a)(b)')), '(CastExpression ( (IdentifierName a) ) (ParenthesizedExpression ( (IdentifierName b) )))');
  assert.equal(expression('(a) - b').kind, 'SubtractExpression'); assert.equal(expression('(int)-b').kind, 'CastExpression'); assert.equal(expression('(a, b)').kind, 'TupleExpression'); assert.equal(expression('(a)').kind, 'ParenthesizedExpression'); assert.equal(expression('(a).b').kind, 'SimpleMemberAccessExpression');
  assert.equal(expression('delegate (int p) { return p; }').parameterList.parameters.length, 1); assert.equal(expression('delegate { }').parameterList, null); assert.deepEqual(expression('static async delegate { }').modifiers.map(m => m.text), ['static', 'async']);
  assert.equal(expression('a + b => c').kind, 'AddExpression', 'no lambda where precedence is above lambda'); assert.equal(expression('x => y => x + y').expressionBody.kind, 'SimpleLambdaExpression');
});
test('T06.3-T06.4 queries, tuples and deconstruction', () => {
  const query = expression('from c in cs join o in os on c.Id equals o.Id into g orderby c.A descending, c.B select g into r where r != null group r by r.K');
  assert.equal(query.kind, 'QueryExpression'); assert.deepEqual(query.body.clauses.map(c => c.kind), ['JoinClause', 'OrderByClause']); assert.equal(query.body.clauses[0].into.identifier.text, 'g'); assert.deepEqual(query.body.clauses[1].orderings.map(o => o.kind), ['DescendingOrdering', 'AscendingOrdering']);
  assert.equal(query.body.continuation.body.selectOrGroup.kind, 'GroupClause'); assert.deepEqual(codes('int from = 1; from = from + 1; var select = from; var x = from.ToString();'), []); assert.equal(expression('from').kind, 'IdentifierName');
  assert.equal(shape(tree('(int a, string b) t = (1, "x");').root.members[0].statement), '(LocalDeclarationStatement (VariableDeclaration (TupleType ( (TupleElement (PredefinedType int) a) , (TupleElement (PredefinedType string) b) )) (VariableDeclarator t (EqualsValueClause = (TupleExpression ( (Argument (NumericLiteralExpression 1)) , (Argument (StringLiteralExpression "x")) ))))) ;)');
  assert.equal(shape(tree('var (x, (y, z)) = e;').root.members[0].statement.expression.left), '(DeclarationExpression (IdentifierName var) (ParenthesizedVariableDesignation ( (SingleVariableDesignation x) , (ParenthesizedVariableDesignation ( (SingleVariableDesignation y) , (SingleVariableDesignation z) )) )))');
  assert.equal(tree('foreach (var (k, v) in d) { }').root.members[0].statement.kind, 'ForEachVariableStatement'); assert.equal(tree('var (a, b);').root.members[0].statement.expression.kind, 'InvocationExpression', 'var(...) without = is a call');
});
test('T06.5-T06.8 patterns: precedence and forms', () => {
  assert.equal(shape(tree('switch (o) { case int n when n > 0: break; }').root.members[0].statement.sections[0].labels[0]), '(CasePatternSwitchLabel case (DeclarationPattern (PredefinedType int) (SingleVariableDesignation n)) (WhenClause when (GreaterThanExpression (IdentifierName n) > (NumericLiteralExpression 0))) :)');
  assert.equal(shape(expression('x is > 0 and < 10 or not null').pattern), '(OrPattern (AndPattern (RelationalPattern > (NumericLiteralExpression 0)) and (RelationalPattern < (NumericLiteralExpression 10))) or (NotPattern not (ConstantPattern (NullLiteralExpression null))))');
  assert.equal(shape(expression('x is not A and B').pattern), '(AndPattern (NotPattern not (ConstantPattern (IdentifierName A))) and (ConstantPattern (IdentifierName B)))', 'not binds tighter than and');
  assert.equal(expression('a is T ? b : c').kind, 'ConditionalExpression'); assert.equal(expression('a is T ? b : c').condition.kind, 'IsExpression'); assert.equal(expression('x is { A.B: > 1, C: var c } d').pattern.propertyPatternClause.subpatterns[0].expressionColon.kind, 'ExpressionColon');
  assert.equal(expression('x is T(1, var y) z').pattern.positionalPatternClause.subpatterns.length, 2); assert.equal(expression('x is [1, .., var last]').pattern.patterns[1].kind, 'SlicePattern'); assert.equal(expression('x is [.., .. var rest] all').pattern.designation.identifier.text, 'all', 'two slices parse; the binder reports them');
  assert.equal(expression('x is var (a, b)').pattern.designation.kind, 'ParenthesizedVariableDesignation'); assert.equal(expression('o switch { _ => 1 }').arms[0].pattern.kind, 'DiscardPattern'); assert.equal(expression('x is _').kind, 'IsExpression');
});
test('T06.9-T06.10 nullable types, suppression and generic names', () => {
  assert.equal(expression('x as T?').right.kind, 'NullableType'); assert.equal(expression('x as T ?? y').kind, 'CoalesceExpression'); assert.equal(expression('c ? [1] : [2]').kind, 'ConditionalExpression'); assert.equal(expression('c ? a?[0] : b').whenTrue.kind, 'ConditionalAccessExpression'); assert.equal(expression('a?[0]').kind, 'ConditionalAccessExpression');
  assert.equal(expression('x!.y').expression.kind, 'SuppressNullableWarningExpression'); assert.equal(expression('d?.e.f!').kind, 'SuppressNullableWarningExpression'); assert.equal(tree('int[]? a = null;').root.members[0].statement.declaration.type.kind, 'NullableType'); assert.equal(tree('int?[] a = null;').root.members[0].statement.declaration.type.elementType.kind, 'NullableType');
  assert.equal(tree('a ? b : c;').root.members[0].statement.kind, 'ExpressionStatement'); assert.equal(tree('a? b = c;').root.members[0].statement.kind, 'LocalDeclarationStatement');
  assert.equal(expression('F<A, B>(x)').expression.kind, 'GenericName'); assert.equal(expression('a < b > c').kind, 'GreaterThanExpression'); assert.equal(expression('F(G<A, B>(7))').argumentList.arguments.length, 1); assert.equal(expression('F(G < A, B > 7)').argumentList.arguments.length, 2);
  assert.equal(expression('G<List<List<int>>>(1)').expression.typeArgumentList.arguments[0].typeArgumentList.arguments[0].kind, 'GenericName'); assert.equal(expression('G<(int, int[])>(1)').expression.typeArgumentList.arguments[0].kind, 'TupleType'); assert.equal(expression('a.b<c>.d()').kind, 'InvocationExpression');
  assert.equal(parse('int? x = null;').diagnostics[0].code, 'SF1013', 'nullable annotations are reported by the legacy profile, not the parser');
});
test('T02.7 types are TypeSyntax nodes, never strings', () => {
  const root = tree('class C { System.Collections.Generic.Dictionary<string, int[]>[,] a; (int x, string)? b; int* c; delegate*<int, void> d; global::A.B e; void M() { ref readonly int f = ref g; var h = typeof(List<>); } }').root;
  const types = root.members[0].members.slice(0, 5).map(m => m.declaration.type.kind); assert.deepEqual(types, ['ArrayType', 'NullableType', 'PointerType', 'FunctionPointerType', 'QualifiedName']);
  assert.equal(root.members[0].members[0].declaration.type.rankSpecifiers[0].sizes.length, 2); assert.equal(root.members[0].members[1].declaration.type.elementType.kind, 'TupleType'); assert.equal(root.members[0].members[4].declaration.type.left.kind, 'AliasQualifiedName');
  for (const node of root.descendantNodes()) for (const child of node.green.children) assert(child === null || typeof child === 'object', 'no node carries a type as a plain string');
  assert.equal(parse('class C { System.Collections.Generic.List<int>[] a; }').root.members[0].members[0].type, 'System.Collections.Generic.List<int>[]', 'the adapter rebuilds the legacy type string');
});
