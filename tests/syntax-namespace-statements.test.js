import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SyntaxTree, parse } from '@sharpforge/syntax';
import { assertRecoversLikeRoslyn, diagnosticsOf, fixtureRoot } from './support/syntax-reference.js';

// Defect reported by the compiler workstream: a statement after a file-scoped namespace declaration did not get
// Roslyn's diagnostics. A namespace (file-scoped or with braces) holds no statements: Roslyn reports a type that stands
// alone as CS0116 on its last token, and the first token of each run it has to skip as CS1022.
function compare(relative) {
  const file = join(fixtureRoot, relative),
    text = readFileSync(file, 'utf8'),
    recorded = JSON.parse(readFileSync(file + '.roslyn.json', 'utf8')),
    show = (code, start, end) => `${code}@${start}..${end} ${text.slice(start, end)}`;
  const theirs = recorded.errors.map(entry => show(entry[0], entry[1], entry[2]));
  const tree = SyntaxTree.parseText(text);
  assert.equal(tree.toFullString(), text);
  const mine = tree.getDiagnostics().map(diagnostic => show(diagnostic.code, diagnostic.start, diagnostic.start + diagnostic.length));
  assert.deepEqual(mine, theirs, relative);
  return { tree, count: mine.length };
}

test('statements after a file-scoped namespace get the diagnostics Roslyn reports', () => {
  const { tree, count } = compare('gates/file-scoped-statements.rejected.cs');
  assert.equal(count, 16);
  const namespace = tree.root.members[0];
  assert.equal(namespace.kind, 'FileScopedNamespaceDeclaration');
  assert.deepEqual(namespace.members.filter(member => member.kind.endsWith('Declaration')).map(member => member.kind), ['ClassDeclaration', 'StructDeclaration']);
});

test('statements inside a namespace with braces get the same diagnostics', () => {
  const { count } = compare('gates/namespace-statements.rejected.cs');
  assert.equal(count, 10);
});

test('a type that stands alone is CS0116 on its last token; the token after it is CS1022', () => {
  assert.deepEqual(diagnosticsOf('namespace N;\nx = 1;\n'), ['CS0116@13 "x"', 'CS1022@15 "="']);
  assert.deepEqual(diagnosticsOf('namespace N;\nSystem.Console.WriteLine();\n'), ['CS0116@28 "WriteLine"', 'CS8124@38 ")"', 'CS1022@39 ";"']);
  assert.deepEqual(diagnosticsOf('namespace N { a.b++; }'), ['CS0116@16 "b"', 'CS1022@17 "++"']);
});

test('a statement keyword is skipped with one CS1022 for the run', () => {
  assert.deepEqual(diagnosticsOf('namespace N;\nreturn 1;\nclass C { }\n'), ['CS1022@13 "return"']);
  assert.deepEqual(diagnosticsOf('namespace N { ) ] class C { } ] }'), ['CS1022@14 ")"', 'CS1022@30 "]"']);
});

test('members and types in a namespace are unaffected, and top-level statements still parse', () => {
  assert.deepEqual(diagnosticsOf('namespace N;\nclass C { int f; void M() { return; } }\nenum E { A }\n'), []);
  assert.deepEqual(diagnosticsOf('x = 1;\nreturn;\n'), []);
  const tree = SyntaxTree.parseText('System.Console.WriteLine();\nnamespace N { class C { } }\n');
  assert.deepEqual(tree.root.members.map(member => member.kind), ['GlobalStatement', 'NamespaceDeclaration']);
});

test('a tuple type of fewer than two elements is completed with missing elements and reports CS8124', () => {
  assertRecoversLikeRoslyn('reference/csharp7/short-tuple-types.cs');
  const [member] = SyntaxTree.parseText('class C { () M() => default; }').root.members[0].members;
  assert.equal(member.returnType.kind, 'TupleType');
  assert.equal(member.returnType.elements.length, 2);
  assert.deepEqual(diagnosticsOf('class C { () M() => default; }'), ['CS8124@11 ")"']);
  assert.deepEqual(diagnosticsOf('class C { (int a, int b) M() => default; }'), []);
});

test('the back end profile keeps its statement parsing inside namespaces', () => {
  const legacy = parse('namespace N { class C { } }');
  assert.deepEqual(legacy.diagnostics, []);
});
