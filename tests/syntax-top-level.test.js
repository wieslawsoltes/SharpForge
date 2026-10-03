import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, parse } from '@sharpforge/syntax';
import { assertGatesMatchRoslyn, assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf } from './support/syntax-reference.js';

// SF-A01-T42: C# 9 top-level statements.
const unitMembers = (text, options) => SyntaxTree.parseText(text, options).root.members;

test('T42 a program of top-level statements matches Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp9-10/top-level.cs');
  for (const kind of ['GlobalStatement', 'LocalFunctionStatement', 'NamespaceDeclaration', 'RecordDeclaration']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  const members = tree.root.members.map(member => member.kind);
  const firstType = members.findIndex(kind => kind !== 'GlobalStatement');
  assert(firstType >= 29, 'every statement is a GlobalStatement member, in source order');
  assert(members.slice(firstType).every(kind => kind !== 'GlobalStatement'));
});

test('T42 functions at the top level are local functions and await is an operator', () => {
  const members = unitMembers('int Twice(int v) => v * 2; static void Helper() { } await Task.Delay(1); [Obsolete] void Old() { } class C { }');
  assert.deepEqual(
    members.map(member => member.statement?.kind ?? member.kind),
    ['LocalFunctionStatement', 'LocalFunctionStatement', 'ExpressionStatement', 'LocalFunctionStatement', 'ClassDeclaration']
  );
  assert.equal(members[2].statement.expression.kind, 'AwaitExpression');
  assert.equal(members[3].statement.attributeLists.length, 1);
});

test('T42 a statement after a type or namespace reports CS8803 once, where Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp9-10/top-level-order.cs');
  assert.deepEqual(
    tree.getDiagnostics().map(diagnostic => [diagnostic.code, diagnostic.start]),
    [['CS8803', 48]]
  );
  assert.deepEqual(diagnosticsOf('class C { } int x = 1; x++; struct S { } x--;'), ['CS8803@12 "int x = 1;"']);
  assert.deepEqual(diagnosticsOf('int x = 1; x++; class C { } struct S { }'), []);
  assert.deepEqual(diagnosticsOf('namespace N { } System.Console.WriteLine();').length, 1);
});

test('T42 the legacy entry point keeps accepting statements after declarations', () => {
  const source = 'class Counter { public int Value; } var counter = new Counter(); Console.WriteLine(counter.Value);';
  assert.deepEqual(parse(source).diagnostics, [], 'the back end has always run such programs');
  assert.deepEqual(
    parse(source, undefined, { statementsAfterDeclarations: false }).diagnostics.map(diagnostic => diagnostic.code),
    ['CS8803']
  );
});

test('T42 top-level statements are rejected below C# 9, at the first statement as in Roslyn', () => {
  assert.deepEqual(assertGatesMatchRoslyn('gates/csharp9-top-level.rejected.cs').length, 1);
  assert.deepEqual(diagnosticsOf('System.Console.WriteLine(1); int x = 2;', '8'), ['CS8400@0 "System.Console.WriteLine(1);"']);
  assert.deepEqual(diagnosticsOf('System.Console.WriteLine(1); int x = 2;', '9'), []);
  assert.deepEqual(diagnosticsOf('class C { }', '8'), []);
});

test('T42 an incremental parse reports the same order errors and feature uses as a full parse', () => {
  const before = 'int a = 1;\nclass C { }\n';
  const tree = SyntaxTree.parseText(before, { languageVersion: '8' });
  const edited = tree.withChangedText([{ start: 0, length: 0, text: 'int z = 0;\n' }]);
  const full = SyntaxTree.parseText('int z = 0;\n' + before, { languageVersion: '8' });
  const describe = t => t.getDiagnostics().map(diagnostic => `${diagnostic.code}@${diagnostic.start}`);
  assert.deepEqual(describe(edited), describe(full));
  assert.deepEqual(describe(edited), ['CS8400@0']);
  const appended = tree.withChangedText([{ start: before.length, length: 0, text: 'a++;\n' }]);
  assert.deepEqual(describe(appended), ['CS8400@0', 'CS8803@23']);
});

test('T42 malformed top-level statements recover as Roslyn does', () => {
  assertRecoversLikeRoslyn('reference/csharp9-10/top-level-recovery.cs');
});
