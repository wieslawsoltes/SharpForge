import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, boundPhaseCodes } from '@sharpforge/syntax';
import { assertGatesMatchRoslyn, assertMatchesRoslyn, assertRecoversLikeRoslyn, diagnosticsOf, shapeOf } from './support/syntax-reference.js';

// SF-A01-T44: C# 10 global usings and file-scoped namespaces.
const rootOf = (text, options) => SyntaxTree.parseText(text, options).root;

test('T44 global usings and a file-scoped namespace match Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp9-10/file-scoped.cs');
  for (const kind of ['FileScopedNamespaceDeclaration', 'UsingDirective', 'ExternAliasDirective']) assert(kinds.has(kind), kind);
  assert.deepEqual(tree.getDiagnostics(), []);
  assert.deepEqual(
    tree.root.usings.map(using => [using.globalKeyword?.text ?? '', using.staticKeyword?.text ?? '', using.unsafeKeyword?.text ?? '', !!using.alias]),
    [
      ['global', '', '', false],
      ['global', '', '', false],
      ['global', 'static', '', false],
      ['global', '', '', true],
      ['global', '', 'unsafe', true],
      ['global', 'static', 'unsafe', false],
      ['', '', '', false],
      ['', 'static', '', false],
      ['', '', '', true]
    ]
  );
  const scoped = tree.root.members[0];
  assert.equal(scoped.kind, 'FileScopedNamespaceDeclaration');
  assert.deepEqual([scoped.externs.length, scoped.usings.length, scoped.members.length], [1, 2, 7]);
});

test('T44 `namespace X;` holds the rest of the file', () => {
  const root = rootOf('namespace A.B;\nclass C { }\nstruct S { }\n');
  assert.equal(root.members.length, 1);
  assert.equal(shapeOf(root.members[0].name), 'QualifiedName(IdentifierName(A) . IdentifierName(B))');
  assert.deepEqual(
    root.members[0].members.map(member => member.kind),
    ['ClassDeclaration', 'StructDeclaration']
  );
  assert.equal(rootOf('int global = 1; global++;').members[0].kind, 'GlobalStatement', '`global` is an identifier unless `using` follows');
});

test('T44 file-scoped namespace placement reports CS8954, CS8955 and CS8956 at the name', () => {
  for (const code of ['CS8954', 'CS8955', 'CS8956']) assert(boundPhaseCodes.has(code), 'Roslyn reports ' + code + ' while binding');
  assert.deepEqual(diagnosticsOf('class Before { }\nnamespace A;\nclass C { }\n'), ['CS8956@27 "A"']);
  assert.deepEqual(diagnosticsOf('System.Console.WriteLine(1);\nnamespace A;\n'), ['CS8956@39 "A"']);
  assert.deepEqual(diagnosticsOf('namespace A;\nnamespace B;\n'), ['CS8954@23 "B"']);
  assert.deepEqual(diagnosticsOf('namespace A;\nnamespace B.C { }\n'), ['CS8955@23 "B.C"']);
  assert.deepEqual(diagnosticsOf('namespace Outer\n{\n    namespace Inner;\n    class C { }\n}\n'), ['CS8955@32 "Inner"']);
  assert.deepEqual(diagnosticsOf('using System;\nnamespace A;\nclass C { }\n'), [], 'usings may precede it');
  assert.deepEqual(diagnosticsOf('namespace A { }\nnamespace B { namespace C { } }\n'), []);
  const { tree } = assertMatchesRoslyn('reference/csharp9-10/file-scoped-order.cs');
  assert.deepEqual(
    tree.getDiagnostics().map(diagnostic => diagnostic.code),
    ['CS8956', 'CS8954', 'CS8955'],
    'the three diagnostics Roslyn reports for this file when it binds it'
  );
  assertMatchesRoslyn('reference/csharp9-10/file-scoped-statements.cs');
});

test('T44 a file-scoped namespace inside braces ends at the enclosing brace, as in Roslyn', () => {
  const { tree } = assertMatchesRoslyn('reference/csharp9-10/file-scoped-nested.cs');
  const outer = tree.root.members[0];
  assert.equal(outer.kind, 'NamespaceDeclaration');
  assert.equal(outer.members[0].kind, 'FileScopedNamespaceDeclaration');
  assert.equal(outer.members[0].members[0].kind, 'ClassDeclaration');
  assert.equal(outer.closeBraceToken.isMissing, false);
});

test('T44 both forms are rejected below C# 10, at the keyword as in Roslyn', () => {
  assert.equal(assertGatesMatchRoslyn('gates/csharp10-namespaces.rejected.cs').length, 4);
  assert.deepEqual(diagnosticsOf('global using System;', '9'), ['CS8773@0 "global"']);
  assert.deepEqual(diagnosticsOf('namespace N;', '9'), ['CS8773@0 "namespace"']);
  assert.deepEqual(diagnosticsOf('global using System;\nnamespace N;\nclass C { }\n', '10'), []);
  assert.deepEqual(diagnosticsOf('using System;\nnamespace N { class C { } }\n', '1'), []);
});

test('T44 malformed directives and namespaces recover as Roslyn does', () => {
  const { tree } = assertRecoversLikeRoslyn('reference/csharp9-10/file-scoped-recovery.cs');
  assert.equal(tree.root.usings.length, 2, '`global using ;` and an unterminated `global using System` are still directives');
});
