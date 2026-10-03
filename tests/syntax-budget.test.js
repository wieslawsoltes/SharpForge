import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, parse, nestingBudget } from '@sharpforge/syntax';

// SF-A01-T12.2: one recursion budget covers every recursive parser entry. Inputs nested 100,000 deep terminate without
// a JavaScript stack overflow, keep every character, and report SF1099 (the equivalent of Roslyn's CS8078).
const depth = 100_000;
const cases = {
  parentheses: 'class C { void M() { var x = ' + '('.repeat(depth) + '1' + ')'.repeat(depth) + '; } }',
  generics: 'class C { ' + 'A<'.repeat(depth) + 'int' + '>'.repeat(depth) + ' f; }',
  blocks: 'class C { void M() ' + '{'.repeat(depth) + '}'.repeat(depth) + ' }',
  patterns: 'class C { bool f = x is ' + '('.repeat(depth) + '1' + ')'.repeat(depth) + '; }',
  lambdas: 'class C { object f = ' + 'x => '.repeat(depth) + '1; }',
  initializers: 'class C { int[] f = ' + '{'.repeat(depth) + '}'.repeat(depth) + '; }',
  tupleTypes: 'class C { ' + '('.repeat(depth) + 'int, int' + ')'.repeat(depth) + ' f; }',
  unary: 'class C { int f = ' + '-'.repeat(depth) + '1; }',
  casts: 'class C { int f = ' + '(int)'.repeat(depth) + '1; }',
  conditionals: 'class C { int f = ' + 'a ? b : '.repeat(depth) + 'c; }',
  calls: 'class C { int f = ' + 'f('.repeat(depth) + ')'.repeat(depth) + '; }',
  ifs: 'class C { void M() { ' + 'if (a) '.repeat(depth) + '; } }',
  types: 'class C { '.repeat(depth) + '}'.repeat(depth),
  namespaces: 'namespace N { '.repeat(depth) + '}'.repeat(depth),
  arrayRanks: 'class C { int' + '[]'.repeat(depth) + ' f; }',
  binaryChain: 'class C { int f = 1' + ' + 1'.repeat(depth) + '; }',
  memberChain: 'class C { int f = a' + '.b'.repeat(depth) + '; }',
  interpolations: 'class C { string f = ' + '$"{'.repeat(2000) + '1' + '}"'.repeat(2000) + '; }'
};
const limited = new Set(['parentheses', 'blocks', 'patterns', 'lambdas', 'initializers', 'tupleTypes', 'unary', 'casts', 'conditionals', 'calls', 'ifs', 'types', 'namespaces']);
for (const [name, text] of Object.entries(cases)) test(`budget: ${name === 'interpolations' ? '2,000' : '100,000'}-deep ${name} terminate without a stack overflow`, () => {
  const start = performance.now(), tree = SyntaxTree.parseText(text), elapsed = performance.now() - start;
  assert.equal(tree.green.fullWidth, text.length); assert(tree.toFullString() === text, 'no character is lost'); assert(elapsed < 20_000, `${elapsed} ms`);
  const codes = new Set(tree.getDiagnostics().map(d => d.code));
  if (limited.has(name)) { assert(codes.has('SF1099'), [...codes].join(',')); assert.equal(tree.getDiagnostics().filter(d => d.code === 'SF1099').length, 1, 'the limit is reported once'); }
  if (name !== 'interpolations') assert(tree.getDiagnostics().length <= 400);
  const legacy = parse(text); assert.equal(legacy.green.fullWidth, text.length, 'the legacy AST conversion also terminates');
  if (name === 'binaryChain' || name === 'memberChain') assert(legacy.diagnostics.some(d => d.code === 'SF1099'), 'a chain too deep for the legacy AST is reported, not thrown');
  let tokens = 0; for (const item of tree.root.descendantTokens()) tokens += item.green.fullWidth >= 0 ? 1 : 0; assert(tokens > 0, 'tree iteration is not recursive');
});
test('budget: the limit is the shared budget and nesting below it is untouched', () => {
  assert.equal(nestingBudget, 200);
  const nested = n => 'class C { void M() { var x = ' + '('.repeat(n) + '1' + ')'.repeat(n) + '; } }';
  assert.deepEqual(SyntaxTree.parseText(nested(60)).getDiagnostics(), []); assert.deepEqual(SyntaxTree.parseText(nested(400)).getDiagnostics().filter(d => d.code === 'SF1099').length, 1);
  const blocks = n => 'class C { void M() ' + '{ '.repeat(n) + '} '.repeat(n) + '}'; assert.deepEqual(SyntaxTree.parseText(blocks(150)).getDiagnostics(), []);
  const types = n => 'class C { '.repeat(n) + '}'.repeat(n); assert.deepEqual(SyntaxTree.parseText(types(150)).getDiagnostics(), []); assert(SyntaxTree.parseText(types(300)).getDiagnostics().some(d => d.code === 'SF1099' && /nesting limit/.test(d.message)));
  const lists = n => 'class C { int[] f = ' + '{ '.repeat(n) + '} '.repeat(n) + '; }'; assert.deepEqual(SyntaxTree.parseText(lists(150)).getDiagnostics(), []); assert(SyntaxTree.parseText(lists(300)).getDiagnostics().some(d => d.code === 'SF1099'));
  // After the budget is exhausted the rest of the input is kept as skipped text on the end-of-file token.
  const text = nested(400) + '\nclass After { }', tree = SyntaxTree.parseText(text); assert.equal(tree.toFullString(), text); assert(tree.root.endOfFileToken.leadingTrivia.some(t => t.kind === 'SkippedTokensTrivia' && t.text.includes('class After')));
});
