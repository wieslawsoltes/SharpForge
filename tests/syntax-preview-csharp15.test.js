import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SyntaxTree,
  languageFeature,
  pinnedPreviewProposals,
  previewRevisions,
  previewWatchlist,
  previewWatchlistCommit,
  previewWatchlistEntry
} from '@sharpforge/syntax';
import { diagnosticsOf, expressionOf, shapeOf, statementsOf } from './support/syntax-reference.js';

// SF-A01-E11: C# 15 preview syntax beyond unions, closed hierarchies, extension indexers and safety modifiers.
const preview = { languageVersion: 'preview' };

// ---- SF-A01-T53: collection expression arguments ---------------------------------------------------------------
test('T53 with(...) is a structured element of a collection expression under preview', () => {
  const collection = expressionOf('[with(capacity: values.Count * 2), .. values]', preview);
  assert.deepEqual(
    collection.elements.map(element => element.kind),
    ['WithElement', 'SpreadElement']
  );
  assert.equal(
    shapeOf(expressionOf('[with(4), 1]', preview).elements[0]),
    'WithElement(with ArgumentList(( Argument(NumericLiteralExpression(4)) )))'
  );
  assert.equal(expressionOf('[with(), 1]', preview).elements[0].argumentList.arguments.length, 0);
  assert.deepEqual(diagnosticsOf('class C { object M() => [with(capacity: 4), 1, 2]; }', 'preview'), []);
});

test('T53 the pinned examples of the proposal parse under preview', () => {
  for (const example of [
    'List<string> names = [with(capacity: values.Count * 2), .. values];',
    'HashSet<string> set = [with(StringComparer.OrdinalIgnoreCase), "a", "b"];',
    'MyCollection<int> c = [with(1, name: "x"), 1, 2, 3];'
  ])
    assert.deepEqual(diagnosticsOf(`class C { void M() { ${example} } }`, 'preview'), [], example);
});

test('T53 at LangVersion 14 `with` in an element keeps its old meaning: a call to a method named with', () => {
  const older = expressionOf('[with(4), 1]', { languageVersion: '14' });
  assert.equal(
    shapeOf(older.elements[0]),
    'ExpressionElement(InvocationExpression(IdentifierName(with) ArgumentList(( Argument(NumericLiteralExpression(4)) ))))'
  );
  assert.deepEqual(diagnosticsOf('class C { object M() => [with(4), 1]; }', '14'), []);
  assert.equal(languageFeature('CollectionExpressionArguments').olderMeaning, true);
  const [local, call] = statementsOf('int with = 1; var x = [with, with + 1];', preview);
  assert.equal(local.kind, 'LocalDeclarationStatement');
  assert.equal(call.declaration.variables[0].initializer.value.elements[0].kind, 'ExpressionElement', 'without ( it is an identifier at preview too');
});

test('T53 a with element after the first element is still parsed and reported', () => {
  const source = 'class C { object M() => [1, with(4)]; }';
  assert.deepEqual(diagnosticsOf(source, 'preview'), ['SF1097@28 "with"']);
  assert.equal(SyntaxTree.parseText(source, preview).toFullString(), source);
});

// ---- SF-A01-T54: labeled break and continue --------------------------------------------------------------------
test('T54 labeled break and continue follow the pinned proposal grammar and carry its revision stamp', () => {
  const stamp = previewRevisions.LabeledBreakContinue;
  assert.equal(stamp.proposal, 'csharplang/proposals/csharp-15.0/labeled-break-continue.md');
  assert.equal(stamp.commit, previewWatchlistCommit);
  assert.equal(previewWatchlistEntry('csharp-15.0/labeled-break-continue.md').status, 'implemented');
  const [loop] = statementsOf('outer: for (;;) { for (;;) { if (a) continue outer; if (b) break outer; break; continue; } }', preview);
  const jumps = [...loop.descendantNodes()].filter(node => node.kind === 'BreakStatement' || node.kind === 'ContinueStatement');
  assert.deepEqual(
    jumps.map(shapeOf),
    ['ContinueStatement(continue outer ;)', 'BreakStatement(break outer ;)', 'BreakStatement(break ;)', 'ContinueStatement(continue ;)']
  );
});

test('T54 a label needs preview; unlabeled jumps are C# 1', () => {
  const source = 'class C { void M() { outer: for (;;) { break outer; } } }';
  assert.deepEqual(diagnosticsOf(source, '14'), ['CS8652@45 "outer"']);
  assert.deepEqual(diagnosticsOf(source, 'preview'), []);
  assert.match(SyntaxTree.parseText(source, { languageVersion: '14' }).getDiagnostics()[0].message, /labeled-break-continue\.md revision 1/);
  assert.deepEqual(diagnosticsOf('class C { void M() { for (;;) { break; continue; } } }', '1'), []);
});

// ---- SF-A01-T55: the preview watchlist --------------------------------------------------------------------------
test('T55 every proposal in the pinned preview folder has a watchlist entry', () => {
  assert.match(previewWatchlistCommit, /^[0-9a-f]{40}$/);
  assert.equal(previewRevisions.Unions.commit, previewWatchlistCommit, 'the watchlist and the revision stamps are pinned to one commit');
  for (const proposal of pinnedPreviewProposals) assert(previewWatchlistEntry(proposal), proposal + ' is not on the watchlist');
  assert.equal(new Set(previewWatchlist.map(entry => entry.proposal)).size, previewWatchlist.length);
});

test('T55 an implemented entry names stamped catalog features; an unsupported entry is rejected with SF1098', () => {
  for (const entry of previewWatchlist) {
    if (entry.status === 'implemented') {
      assert(entry.features.length > 0, entry.proposal);
      for (const id of entry.features) {
        assert.equal(languageFeature(id)?.preview, true, id);
        assert.equal(previewRevisions[id].proposal, 'csharplang/proposals/' + entry.proposal, id);
      }
      continue;
    }
    assert.equal(entry.status, 'unsupported');
    const tree = SyntaxTree.parseText(entry.sample, preview);
    assert.equal(tree.toFullString(), entry.sample);
    assert(
      tree.getDiagnostics().some(diagnostic => diagnostic.code === 'SF1098'),
      `${entry.proposal}: ${entry.form} must report the unsupported-preview diagnostic`
    );
  }
  const stamped = new Set(previewWatchlist.flatMap(entry => entry.features ?? []));
  for (const id of Object.keys(previewRevisions)) assert(stamped.has(id), id + ' has a stamp but no watchlist entry');
});

test('T55 dictionary expression elements are rejected explicitly and lose no text', () => {
  const source = 'class C { object M() => [1: "one", 2: "two"]; }';
  assert.deepEqual(diagnosticsOf(source, 'preview'), ['SF1098@26 ":"', 'SF1098@36 ":"']);
  const collection = SyntaxTree.parseText(source, preview).root.members[0].members[0].expressionBody.expression;
  assert.equal(collection.kind, 'CollectionExpression');
  assert.equal(collection.elements.length, 2);
  assert.deepEqual(diagnosticsOf('class C { object M() => [a ? b : c, d]; }', 'preview'), [], 'a conditional element is not a key and value');
});
