// SF-A02-T07.5: lambdas converted to Expression<TDelegate> - the tree the lowering builds has the shape Roslyn's has
// (the text and the node-type walk .NET prints for it), and what a tree may not contain is reported as Roslyn does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { lowerExpressionTree } from '../packages/compiler/src/lowering/expression-trees.js';
import { treeToString, nodeTypes, factoryCalls } from '../packages/compiler/src/lowering/expression-tree-text.js';
import { expressionTreeDelegate } from '../packages/compiler/src/symbols/expression-tree-types.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { semanticRow } from '../packages/compiler/test/differential/tools/semantic-report.mjs';
import { notExecutable } from './support/semantic-codegen.js';

const fixtures = loadFixtures().filter(fixture => fixture.feature === 'expression-trees');
const pinned = loadPinned().results;

/** Every lambda of a program that is converted to an expression tree, lowered, in source order. */
function treesOf(source) {
  const analysis = analyze([parse(new SourceText(source, 'a.cs'))]);
  const found = [];
  for (const body of analysis.bound.values())
    walk(body, node => {
      const delegateType = node.kind === 'Conversion' ? expressionTreeDelegate(node.type, analysis.core) : null;
      if (!delegateType || node.operand?.kind !== 'Lambda') return true;
      found.push({ start: node.operand.syntax.span.start, lowered: lowerExpressionTree(node.operand, delegateType, analysis.core) });
      return false;
    });
  return found.sort((a, b) => a.start - b.start).map(entry => entry.lowered);
}

test('SF-A02-T07.5 tree shapes equal what .NET prints for the Roslyn-compiled program: ToString and node-type walk', () => {
  const outputs = fixtures.filter(fixture => fixture.kind === 'output');
  assert.equal(outputs.length, 4);
  let compared = 0;
  for (const fixture of outputs) {
    const lines = pinned.get(fixture.id).output.trimEnd().split('\n');
    const declared = [...fixture.source.matchAll(/Expression<[^=]+>\s+(\w+)\s*=/g)].map(match => match[1]);
    const shown = [...fixture.source.matchAll(/Tree\.Show\((\w+)\)/g)].map(match => match[1]);
    const trees = treesOf(fixture.source);
    assert.equal(trees.length, declared.length, `${fixture.id}: every declared tree is found`);
    assert.equal(lines.length, shown.length * 2, `${fixture.id}: two lines per tree`);
    shown.forEach((name, index) => {
      const lowered = trees[declared.indexOf(name)];
      assert.ok(lowered.tree, `${fixture.id} ${name}: not lowered (${lowered.unsupported})`);
      assert.equal(treeToString(lowered.tree), lines[index * 2], `${fixture.id} ${name}: ToString`);
      assert.equal(nodeTypes(lowered.tree).join(' '), lines[index * 2 + 1], `${fixture.id} ${name}: node types`);
      compared++;
    });
  }
  assert.equal(compared, 40);
});

test('SF-A02-T07.5 what an expression tree may not contain is reported where Roslyn reports it', () => {
  const diagnostics = fixtures.filter(fixture => fixture.kind === 'diagnostics');
  assert.equal(diagnostics.length, 3);
  for (const fixture of fixtures) {
    const row = semanticRow(fixture, pinned.get(fixture.id));
    assert.equal(row.crash, undefined, `${fixture.id}: ${row.crash}`);
    assert.equal(row.ok, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T07.5 the tree is a tree of factory calls: one parameter node per parameter, typed constants', () => {
  const [lowered] = treesOf(`
    using System;
    using System.Linq.Expressions;
    class P { static void Main() { Expression<Func<int, int, bool>> e = (a, b) => a + 1 > b; } }`);
  const tree = lowered.tree;
  assert.equal(tree.factory, 'Lambda');
  const comparison = tree.body,
    sum = comparison.operands[0];
  assert.equal(comparison.factory, 'GreaterThan');
  assert.equal(sum.operands[0], tree.parameters[0], 'a use of a parameter is the parameter node itself');
  assert.equal(comparison.operands[1], tree.parameters[1]);
  assert.deepEqual([sum.operands[1].factory, sum.operands[1].value, sum.operands[1].type.toDisplayString()], ['Constant', 1, 'int']);
  assert.deepEqual(factoryCalls(tree), [
    'var a = Expression.Parameter(typeof(int), "a");',
    'var b = Expression.Parameter(typeof(int), "b");',
    'Expression.Lambda<System.Func<int, int, bool>>(Expression.GreaterThan(Expression.Add(a, Expression.Constant(1, typeof(int))), b), a, b);',
  ]);
});

test('SF-A02-T07.5 a lambda converted to a delegate is not checked as a tree; a nested lambda in a tree is', () => {
  const codes = source =>
    analyze([parse(new SourceText(source, 'a.cs'))])
      .diagnostics.filter(d => d.severity === 'error')
      .map(d => d.code);
  const wrap = body => `using System; using System.Linq.Expressions; class P { static int f; static void Main() { ${body} } }`;
  assert.deepEqual(codes(wrap('Func<int, int> d = x => f = x; Func<int, int> b = x => { return x; };')), []);
  assert.deepEqual(codes(wrap('Expression<Func<int, Func<int, int>>> e = x => y => f = y;')), ['CS0832']);
  assert.deepEqual(codes(wrap('Expression<Func<int, Func<int, int>>> e = x => y => { return y; };')), ['CS0834']);
});

test('SF-A02-T07.5 lifted arithmetic lowers, while the source-image runtime retains its explicit expression-tree boundary', () => {
  const [lowered] = treesOf(`
    using System;
    using System.Linq.Expressions;
    class P { static void Main() { int captured = 1; Expression<Func<int, int?>> e = x => (int?)x + captured; } }`);
  assert.equal(lowered.unsupported, undefined);
  assert.equal(lowered.tree.body.factory, 'Add');
  const diagnostic = notExecutable(`
    using System;
    using System.Linq.Expressions;
    class P { static void Main() { Expression<Func<int, int>> e = x => x + 1; Console.WriteLine("built"); } }`);
  assert.match(diagnostic.message, /expression trees/);
});
