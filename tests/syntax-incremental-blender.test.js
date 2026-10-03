import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceText } from '@sharpforge/text';
import { SyntaxTree } from '@sharpforge/syntax';
import { editGenerator, assertSameTree } from './support/syntax-edits.js';

// SF-A01-T03.3: the node blender reuses old members and statements that do not intersect the changed range, carry no
// diagnostics and were parsed in the same context.
const full = tree =>
  SyntaxTree.parseText(new SourceText(tree.source.text, tree.source.uri, tree.source.version), { ...tree.options, cache: undefined });
const edit = (tree, find, replacement, length = find.length) => {
  const start = tree.source.text.indexOf(find);
  assert(start >= 0, find);
  const next = tree.withChangedText([{ start, length, text: replacement }]);
  assertSameTree(next, full(next), `${find} -> ${replacement}`);
  return next;
};
function largeFile(methods) {
  const lines = ['using System;', 'namespace Big', '{', '    public class Service', '    {'];
  for (let i = 0; i < methods; i++)
    lines.push(
      `        public int Method${i}(int a, int b)`,
      '        {',
      `            var total = a * ${i} + b;`,
      `            if (total > ${i}) total -= b; else total += a;`,
      '            return total;',
      '        }',
      ''
    );
  lines.push('    }', '}', '');
  return lines.join('\n');
}
test('blender: a single-statement edit in a 5,000-line file reuses at least 95% of member nodes by identity', () => {
  const text = largeFile(714);
  assert(text.split('\n').length >= 5000);
  for (const lazyTokens of [false, true]) {
    const tree = SyntaxTree.parseText(text, { lazyTokens }),
      start = text.indexOf('var total = a * 357 + b;'),
      next = tree.withChangedText([{ start, length: 'var total = a * 357 + b;'.length, text: 'var total = a * 357 - b + 1;' }]);
    assertSameTree(next, full(next), 'large file');
    const before = tree.root.members[0].members[0].members,
      after = next.root.members[0].members[0].members;
    assert.equal(after.length, before.length);
    const reused = after.filter((member, index) => member.green === before[index].green).length;
    assert(reused / after.length >= 0.95, `${reused} of ${after.length} members reused`);
    assert.equal(reused, after.length - 1);
    assert.notEqual(after[357].green, before[357].green);
    const statements = after[357].body.statements,
      old = before[357].body.statements;
    assert.equal(statements[1].green, old[1].green, 'statements after the edited one are reused');
    assert.equal(statements[2].green, old[2].green);
    assert.notEqual(statements[0].green, old[0].green);
    assert(next.reusedNodeCount >= after.length - 1 && next.reusedNodeCount < after.length + 8, String(next.reusedNodeCount));
    assert.equal(tree.reusedNodeCount, 0);
    const typed = next.withChangedText([{ start: text.indexOf('Method5('), length: 0, text: 'X' }]);
    assertSameTree(typed, full(typed), 'second edit');
    assert.equal(typed.root.members[0].members[0].members[700].green, before[700].green, 'identity survives a chain of edits');
  }
});
test('blender: nodes are only reused in the context they were parsed in', () => {
  let tree = SyntaxTree.parseText('class Widget\n{\n    int a;\n    Widget() { a = 1; }\n    void M() { a = 2; }\n}\n');
  let next = edit(tree, 'Widget\n', 'Gadget\n');
  assert.deepEqual(
    next.getDiagnostics().map(d => d.code),
    ['CS1520'],
    'a constructor is re-parsed when the type is renamed'
  );
  assert.equal(next.root.members[0].members[0].green, tree.root.members[0].members[0].green);
  tree = SyntaxTree.parseText('class C\n{\n    async Task M()\n    {\n        int before = 0;\n        await x;\n        int after = 1;\n    }\n}\n');
  const awaitKind = t => t.root.members[0].members[0].body.statements[1].kind;
  assert.equal(awaitKind(tree), 'ExpressionStatement');
  next = edit(tree, 'async ', '');
  assert.equal(awaitKind(next), 'LocalDeclarationStatement', '`await x;` declares a local once the method is not async');
  next = edit(next, 'Task M', 'async ', 0);
  assert.equal(awaitKind(next), 'ExpressionStatement');
  tree = SyntaxTree.parseText('class C\n{\n    void M()\n    {\n        if (a) b();\n        c();\n        d();\n    }\n}\n');
  next = edit(tree, '        c();', '        else c();');
  const statements = next.root.members[0].members[0].body.statements;
  assert.equal(statements.length, 2);
  assert(statements[0].else, 'the if statement before an inserted else is re-parsed');
  assert.equal(statements[1].green, tree.root.members[0].members[0].body.statements[2].green);
  tree = SyntaxTree.parseText('int a = 1;\nint b = ;\nint c = 3;\nint d = 4;\n');
  next = edit(tree, 'd = 4', 'd = 5');
  assert.equal(next.root.members[0].green, tree.root.members[0].green);
  assert.deepEqual(
    next.getDiagnostics().map(d => d.code),
    ['CS1525'],
    'a node with a diagnostic is re-parsed so the diagnostic is reported again'
  );
  tree = SyntaxTree.parseText('namespace N\n{\n    class A { }\n    class B { }\n}\nclass D { }\n');
  next = edit(tree, 'namespace N\n{\n', '', 'namespace N\n{\n'.length);
  assert.equal(next.root.members.length, 3);
  tree = SyntaxTree.parseText('class A { }\n[assembly: X]\nclass B { }\nclass C { }\n');
  next = edit(tree, 'class A { }\n', '');
  assert.equal(next.root.attributeLists.length, 1, 'an attribute list is re-evaluated when it becomes the first thing in the file');
  tree = SyntaxTree.parseText('class C { void M() { a(); b(); c(); } }', { incremental: false });
  next = edit(tree, 'b()', 'bb()');
  assert.equal(next.reusedNodeCount, 0, 'incremental: false always parses in full');
});
test('blender: feature uses inside reused nodes follow the text and stay gated', () => {
  const tree = SyntaxTree.parseText('class C\n{\n    int P => 1;\n    void M() { var t = (1, 2); }\n    void N() { }\n}\n', { languageVersion: '5' });
  const next = edit(tree, 'void N() { }', 'void N() { int n = 0; }');
  assert(next.reusedNodeCount >= 1);
  assert.deepEqual(
    next.getDiagnostics().map(d => d.code),
    full(next)
      .getDiagnostics()
      .map(d => d.code)
  );
  assert(next.getDiagnostics().length >= 2);
  const shifted = edit(next, 'class C', '// header\n', 0),
    offset = '// header\n'.length;
  assert.deepEqual(
    shifted.getDiagnostics().map(d => d.start),
    next.getDiagnostics().map(d => d.start + offset),
    'diagnostics for carried feature uses move with the text'
  );
});
test('blender: 6,000 structure-preserving edits match full parses with eager and lazy token views', () => {
  const identifiers = ['a', 'b', 'total', 'Method3', 'Service', 'x'],
    statements = [
      'a++;',
      'var q = a + b;',
      'if (a > b) return a;',
      'await Task.Yield();',
      'foreach (var i in items) { total += i; }',
      'int? n = null;',
      'yield return a;',
      'lock (this) { }',
      'using var u = Open();'
    ];
  const members = [
    'int field;',
    'public int P { get; set; }',
    'void Extra() { }',
    'async Task Run() { await Task.Delay(1); }',
    'Service() { }',
    'class Nested { int z; }',
    'event Action E;',
    '[Obsolete] static int S => 1;'
  ];
  let reused = 0;
  for (const lazyTokens of [false, true]) {
    const generator = editGenerator(lazyTokens ? 99 : 77),
      seedText = largeFile(12);
    let text = seedText,
      tree = SyntaxTree.parseText(text, { lazyTokens });
    for (let n = 0; n < 3000; n++) {
      if (text.length > seedText.length * 2) {
        text = seedText;
        tree = SyntaxTree.parseText(text, { lazyTokens });
      }
      const kind = generator.random(6);
      let change;
      const lineStarts = [...text.matchAll(/\n/g)].map(m => m.index + 1),
        line = lineStarts[generator.random(lineStarts.length)];
      if (kind === 0) change = { start: line, length: 0, text: '            ' + statements[generator.random(statements.length)] + '\n' };
      else if (kind === 1) change = { start: line, length: 0, text: '        ' + members[generator.random(members.length)] + '\n' };
      else if (kind === 2) {
        const words = [...text.matchAll(/\b[A-Za-z_]\w*\b/g)],
          word = words[generator.random(words.length)];
        change = { start: word.index, length: word[0].length, text: identifiers[generator.random(identifiers.length)] };
      } else if (kind === 3) {
        const numbers = [...text.matchAll(/\b\d+\b/g)],
          number = numbers[generator.random(numbers.length)];
        change = { start: number.index, length: number[0].length, text: String(generator.random(1000)) };
      } else if (kind === 4) {
        const end = text.indexOf('\n', line);
        change = { start: line, length: end < 0 ? 0 : end + 1 - line, text: '' };
      } else
        change = { start: line, length: 0, text: ['async ', 'static ', '// note\n', '#region R\n', '#endregion\n', '/* c */ '][generator.random(6)] };
      text = text.slice(0, change.start) + change.text + text.slice(change.start + change.length);
      tree = tree.withChangedText([change]);
      assertSameTree(tree, full(tree), `lazy=${lazyTokens} edit ${n} ${JSON.stringify(change)}`);
      reused += tree.reusedNodeCount;
    }
  }
  assert(reused > 20000, `structure-preserving edits reuse most members (${reused})`);
});
