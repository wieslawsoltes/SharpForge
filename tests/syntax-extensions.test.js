import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, previewRevisions } from '@sharpforge/syntax';
import { assertMatchesRoslyn, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T08: C# 14 extension blocks and operators, and C# 15 preview extension indexers.
const classMembers = (text, options) => SyntaxTree.parseText(text, options).root.members[0].members;
test('T08.1 extension blocks: instance and static forms match Roslyn and round-trip', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/versioned/extensions.cs'); assert(kinds.has('ExtensionBlockDeclaration')); assert.deepEqual(tree.getDiagnostics(), []);
  const blocks = tree.root.members[0].members.filter(m => m.kind === 'ExtensionBlockDeclaration'); assert.equal(blocks.length, 5);
  assert.deepEqual(blocks.map(b => [b.typeParameterList?.parameters.length ?? 0, b.parameterList.parameters[0].identifier?.text ?? null, b.constraintClauses.length, b.members.length]), [[1, 'source', 1, 5], [0, null, 0, 1], [0, 'value', 0, 3], [2, 'map', 2, 0], [0, 'text', 0, 1]]);
  assert.deepEqual(blocks[0].members.map(m => m.kind), ['PropertyDeclaration', 'MethodDeclaration', 'PropertyDeclaration', 'OperatorDeclaration', 'PropertyDeclaration'], 'every member kind is allowed in the block');
  assert.equal(blocks[2].attributeLists.length, 1); assert.equal(blocks[1].keyword.kind, 'ExtensionKeyword');
});
test('T08.1 extension blocks: LangVersion 13 rejects them and `extension` stays an identifier elsewhere', () => {
  const { kinds } = assertMatchesRoslyn('reference/versioned/extensions-langversion13.cs'); assert(!kinds.has('ExtensionBlockDeclaration')); assert(kinds.has('ConstructorDeclaration'));
  const generic = 'static class E { extension<T>(T value) { public bool IsNull => value == null; } }';
  assert.deepEqual(diagnosticsOf(generic, '13'), ['CS9260@17 "extension"']); assert.deepEqual(diagnosticsOf(generic, '14'), []); assert.equal(classMembers(generic, { languageVersion: '13' })[0].kind, 'ExtensionBlockDeclaration');
  const plain = 'class extension { extension(int a) { } }';
  assert.equal(classMembers(plain, { languageVersion: '13' })[0].kind, 'ConstructorDeclaration', 'below C# 14 `extension(` is a constructor of a type named extension'); assert.deepEqual(diagnosticsOf(plain, '13'), []);
  assert.equal(classMembers(plain, { languageVersion: '14' })[0].kind, 'ExtensionBlockDeclaration');
  const identifiers = 'class C { int extension; void M(int extension) { extension = 1; var x = extension + this.extension; extension(); } int N() => extension; }';
  for (const version of ['2', '13', '14', 'preview']) assert.deepEqual(diagnosticsOf(identifiers.replace('var x', 'int x').replace('int N() => extension;', ''), version), [], version);
  assert.deepEqual(classMembers(identifiers).map(m => m.kind), ['FieldDeclaration', 'MethodDeclaration', 'MethodDeclaration']);
  assert.deepEqual(diagnosticsOf('static class E { extension Named(int x) { } }', '14').map(d => d.split('@')[0]), ['CS9281'], 'a named extension block is an explicit error');
  assert.equal(shapeOf(classMembers('static class E { extension(string) { } extension(int y); }')[1]), 'ExtensionBlockDeclaration(extension ParameterList(( Parameter(PredefinedType(int) y) )) ;)');
});
test('T08.2 extension operators and user-defined compound assignment operators match Roslyn; older versions reject', () => {
  const { tree } = assertMatchesRoslyn('reference/versioned/extensions.cs'), operators = [...tree.root.descendantNodes()].filter(n => n.kind === 'OperatorDeclaration');
  assert.deepEqual(operators.map(o => (o.checkedKeyword ? 'checked ' : '') + o.operatorToken.text), ['+', '+=', '++', '+=', 'checked +=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '++', 'checked --', '+', '++']);
  assert.deepEqual(operators.filter(o => o.parent.kind === 'ExtensionBlockDeclaration').length, 3);
  const gate = (member, version) => diagnosticsOf(`class C { ${member} }`, version).map(d => d.split('@')[0]);
  assert.deepEqual(gate('public void operator +=(int x) { }', '13'), ['CS9260']); assert.deepEqual(gate('public void operator ++() { }', '13'), ['CS9260']); assert.deepEqual(gate('public void operator checked -=(int x) { }', '13'), ['CS9260']);
  assert.deepEqual(gate('public void operator +=(int x) { } public void operator --() { } public void operator checked <<=(int x) { }', '14'), []);
  assert.deepEqual(gate('public static C operator ++(C c) => c; public static C operator +(C a, C b) => a;', '6'), [], 'static increment and binary operators are C# 1');
  assert.deepEqual(gate('public static C operator checked +(C a, C b) => a;', '10'), ['CS8936']);
  assert.deepEqual(diagnosticsOf('class C { public void operator +=(int x) { } }', '13'), ['CS9260@31 "+="']);
});
test('T08.3 extension indexers parse under preview with a revision stamp; LangVersion 14 reports the preview diagnostic', () => {
  const { tree, kinds } = assertMatchesRoslyn('matrix/15-preview/ExtensionIndexers/positive.cs'); assert(kinds.has('IndexerDeclaration')); assert.deepEqual(tree.getDiagnostics(), []);
  const text = 'static class E { extension(string s) { public char this[int i] => s[i]; public char this[int i, int j] { get { return s[i + j]; } } } }';
  assert.deepEqual(diagnosticsOf(text, 'preview'), []);
  const rejected = SyntaxTree.parseText(text, { languageVersion: '14' }).getDiagnostics(); assert.deepEqual(rejected.map(d => [d.code, text.slice(d.start, d.start + d.length)]), [['CS8652', 'this'], ['CS8652', 'this']]);
  const stamp = previewRevisions.ExtensionIndexers; assert.equal(stamp.proposal, 'csharplang/proposals/csharp-15.0/extension-indexers.md'); assert(rejected[0].message.includes(stamp.proposal) && rejected[0].message.includes('revision ' + stamp.revision));
  assert.deepEqual(diagnosticsOf('class C { public char this[int i] => \'a\'; }', '14'), [], 'ordinary indexers are not gated'); assert.deepEqual(diagnosticsOf('static class E { extension(string s) { class N { int this[int i] => i; } } }', '14'), [], 'only members of the block itself');
});
