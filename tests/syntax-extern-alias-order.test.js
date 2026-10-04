import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SyntaxTree } from '@sharpforge/syntax';
import { diagnosticsOf, fixtureRoot } from './support/syntax-reference.js';

// Defect reported by the compiler workstream: an extern alias after a (global) using directive did not get Roslyn's
// diagnostic. Roslyn reports CS0439 on the `extern` keyword of every extern alias that follows a using directive, an
// attribute or a member of the same compilation unit or namespace, and leaves the directive out of the tree.
function compare(relative) {
  const file = join(fixtureRoot, relative),
    text = readFileSync(file, 'utf8'),
    recorded = JSON.parse(readFileSync(file + '.roslyn.json', 'utf8'));
  const theirs = recorded.errors.filter(entry => entry[0] === 'CS0439').map(entry => `${entry[1]}..${entry[2]} ${text.slice(entry[1], entry[2])}`);
  const tree = SyntaxTree.parseText(text);
  assert.equal(tree.toFullString(), text);
  const mine = tree.getDiagnostics().map(diagnostic => {
    assert.equal(diagnostic.code, 'CS0439', 'the parser reports nothing else');
    return `${diagnostic.start}..${diagnostic.start + diagnostic.length} ${text.slice(diagnostic.start, diagnostic.start + diagnostic.length)}`;
  });
  assert.deepEqual(mine, theirs, relative);
  return { tree, count: mine.length };
}

test('misplaced extern aliases in a compilation unit and a namespace are reported where Roslyn reports them', () => {
  const { tree, count } = compare('gates/extern-alias-order.rejected.cs');
  assert.equal(count, 5);
  const unit = tree.root,
    namespace = unit.members[0];
  assert.deepEqual(unit.externs.map(directive => directive.identifier.text), ['First']);
  assert.equal(unit.usings.length, 2);
  assert.deepEqual(unit.members.map(member => member.kind), ['NamespaceDeclaration']);
  assert.deepEqual(namespace.externs.map(directive => directive.identifier.text), ['Inner']);
  assert.deepEqual(namespace.members.map(member => member.kind), ['ClassDeclaration']);
});

test('the same holds in a file-scoped namespace', () => {
  const { tree, count } = compare('gates/extern-alias-file-scoped.rejected.cs');
  assert.equal(count, 2);
  const namespace = tree.root.members[0];
  assert.equal(namespace.kind, 'FileScopedNamespaceDeclaration');
  assert.deepEqual(namespace.externs.map(directive => directive.identifier.text), ['Inner']);
  assert.deepEqual(namespace.members.map(member => member.kind), ['ClassDeclaration']);
});

test('`extern alias` after `global using` is CS0439 on the keyword; before it there is no diagnostic', () => {
  assert.deepEqual(diagnosticsOf('global using System;\nextern alias A;\nclass C { }\n'), ['CS0439@21 "extern"']);
  assert.deepEqual(diagnosticsOf('using System;\nextern alias A;\n'), ['CS0439@14 "extern"']);
  assert.deepEqual(diagnosticsOf('extern alias A;\nextern alias B;\nglobal using System;\nclass C { }\n'), []);
  assert.deepEqual(diagnosticsOf('class C { }\nextern alias A;\n'), ['CS0439@12 "extern"']);
});

test('an extern method or type is not an extern alias', () => {
  assert.deepEqual(diagnosticsOf('using System;\nclass C { extern static void M(); }\n'), []);
  assert.deepEqual(diagnosticsOf('using System;\nextern alias;\n').includes('CS0439@14 "extern"'), false);
});
