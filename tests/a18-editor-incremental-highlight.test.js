import test from 'node:test';
import assert from 'node:assert/strict';
import {SyntaxHighlightIndex, bracketPairs, lexicalContext} from '@sharpforge/editor';
import {SourceText} from '@sharpforge/text';
import {lex} from '@sharpforge/syntax';

function assertSourceRuns(index, window) {
  let offset = window.start;
  for (const run of window.runs) {
    assert.equal(run.start, offset, 'run boundaries must tile the visible source');
    assert(run.end > run.start);
    offset = run.end;
  }
  assert.equal(offset, window.end);
  assert.equal(window.runs.map(run => index.source.text.slice(run.start, run.end)).join(''), index.source.text.slice(window.start, window.end));
}

function assertFreshScan(index) {
  const fresh = lex(index.source);
  assert.deepEqual(index.lexed.tokens, fresh.tokens, 'incremental tokens must match an independent complete lexical scan');
  assert.deepEqual(index.lexed.diagnostics, fresh.diagnostics);
  const expected = bracketPairs(index.source.text, fresh.tokens);
  for (const token of fresh.tokens) assert.equal(index.brackets.get(token.start), expected.get(token.start), `bracket at ${token.start}`);
  assert.deepEqual(index.pairs, expected);
  for (let offset = 0; offset <= index.source.length; offset++) {
    assert.equal(index.contextAt(offset), lexicalContext(index.source.text, offset, fresh.tokens), `context at ${offset}`);
  }
  assertSourceRuns(index, index.window());
}

test('A18 editor: a local revision reuses distant tokens and bounds the rescan on 3000 lines', () => {
  const text = Array.from({length: 3000}, (_, line) => `int value${line} = ${line}; // 😀 row ${line}\n`).join('');
  const source = new SourceText(text, 'Large.cs');
  const initial = new SyntaxHighlightIndex(source);
  const oldTokens = initial.lexed.tokens;
  const start = text.indexOf('= 1500') + 2;
  const nextSource = source.withChange(start, 4, '9000');
  const next = initial.withSource(nextSource, {start, length: 4, newLength: 4});
  assert.equal(next.source, nextSource);
  assert.equal(next.lexed.window.resynced, true);
  assert(next.lexed.window.end - next.lexed.window.first < 20, 'a single literal edit must not rescan the whole file');
  for (const line of [0, 1500, 2999]) {
    const window = next.window({scrollTop: line * 22, height: 440});
    assert(window.lastLine - window.firstLine <= 30);
    assert(window.runs.length < 500);
    assertSourceRuns(next, window);
  }
  const tokens = next.lexed.tokens;
  assert.equal(tokens[0], oldTokens[0]);
  assert.equal(tokens.at(-2), oldTokens.at(-2));
  assert.deepEqual(tokens, lex(nextSource).tokens);
  assert.equal(initial.source.text, text);
  assert.equal(initial.lexed.tokens, oldTokens);
  assert.equal(next.withSource(nextSource), next);
});

test('A18 editor: incremental CRLF and UTF-16 edits retain source lines, comments, raw strings and preprocessor state', () => {
  let source = new SourceText('class C {\r\n string S = """{😀}""";\r\n /* note */ int N = (1);\r\n#if SHOW\r\n int X = 2;\r\n#endif\r\n}', 'Syntax.cs');
  let index = new SyntaxHighlightIndex(source);
  const edits = [
    text => ({start: text.indexOf('note'), length: 4, text: 'multi\r\nline { ( ) }'}),
    text => ({start: text.indexOf('*/'), length: 2, text: ''}),
    text => ({start: text.indexOf(' int N'), length: 0, text: '*/'}),
    text => ({start: text.indexOf('{😀}'), length: 4, text: '}😀{' }),
    text => ({start: text.indexOf('""";'), length: 1, text: ''}),
    text => ({start: text.indexOf('"";'), length: 0, text: '"'}),
    text => ({start: 0, length: 0, text: '#define SHOW\r\n'}),
    text => ({start: text.indexOf('SHOW'), length: 4, text: 'HIDE'}),
    text => ({start: text.indexOf('\r\n'), length: 2, text: '\n'}),
    text => ({start: text.length, length: 0, text: '\r\n// unfinished {'})
  ];
  for (const edit of edits) {
    const change = edit(source.text);
    assert(change.start >= 0);
    source = source.withChange(change.start, change.length, change.text);
    index = index.withSource(source, {start: change.start, length: change.length, newLength: change.text.length});
    assert.deepEqual(source.lineStarts, new SourceText(source.text).lineStarts);
    assertFreshScan(index);
  }
});

test('A18 editor: queried bracket pairs invalidate across mismatches and comment boundaries', () => {
  for (const text of ['([)]', '(){ [()]}', '{ /* } */ "("; }', '(){ // }\n }', '([){}]']) {
    const source = new SourceText(text, 'Pairs.cs');
    const initial = new SyntaxHighlightIndex(source);
    assertFreshScan(initial);
    const prefixed = source.withChange(0, 0, '// ');
    const next = initial.withSource(prefixed);
    assertFreshScan(next);
    const restored = next.withSource(prefixed.withChange(0, 3, ''));
    assertFreshScan(restored);
  }
});

test('A18 editor: dense unmatched and nested brackets preserve complete query results', () => {
  for (const text of ['('.repeat(3000), '('.repeat(1500) + ')'.repeat(1500), '([)]'.repeat(750)]) {
    const index = new SyntaxHighlightIndex(text);
    const expected = bracketPairs(text);
    assertSourceRuns(index, index.window());
    for (let position = 0; position < text.length; position++) {
      assert.equal(index.brackets.get(position), expected.get(position));
    }
    assert.deepEqual(new Map(index.brackets), expected);
    assert.equal(index.brackets.size, expected.size);
  }
});

test('A18 editor: quote edits cannot reuse a code bracket pair that moved into a string', () => {
  const source = new SourceText('"()" () ""', 'Quotes.cs');
  const initial = new SyntaxHighlightIndex(source);
  assert.equal(initial.brackets.get(5), 6);
  initial.window();
  const next = initial.withSource(source.withChange(0, 1, ''), {start: 0, length: 1, newLength: 0});
  assert.equal(next.brackets.get(4), undefined, 'old code bracket must not be paired inside the new literal');
  assert.equal(next.brackets.get(5), undefined);
  assert.equal(next.brackets.get(0), 1);
  assert.equal(next.contextAt(5), 'literal');
  assertFreshScan(next);
  const restored = next.withSource(next.source.withChange(0, 0, '"'));
  assert.equal(restored.brackets.get(5), 6);
  assert.equal(restored.brackets.get(1), undefined);
  assertFreshScan(restored);
});

test('A18 editor: explicit full snapshots survive viewport reuse, fallback transitions and invalid edit hints', () => {
  const source = new SourceText('int x = (1);\n', 'A.cs');
  const initial = new SyntaxHighlightIndex(source, {maxLexCharacters: 32});
  const pairs = initial.pairs;
  const runs = initial.runs;
  initial.window({scrollTop: 0, height: 22});
  assert.equal(initial.pairs, pairs);
  assert.equal(initial.runs, runs);
  assert.equal(Object.isFrozen(initial.lexed.tokens), true);
  const oversized = initial.withSource(source.withChange(source.length, 0, ' '.repeat(100)));
  assert.equal(oversized.lexed, null);
  assert.equal(oversized.window().syntax, false);
  assertSourceRuns(oversized, oversized.window());
  const restored = oversized.withSource(source);
  assert.deepEqual(restored.lexed.tokens, lex(source).tokens);
  assert.throws(() => initial.withSource(source.withChange(0, 0, 'x'), {start: 4, length: 0, newLength: 1}), RangeError);
  assert.throws(() => initial.withSource(source, {start: 100, length: 0, newLength: 0}), RangeError);
  const renamed = initial.withSource(new SourceText(source.text, 'B.cs'));
  assert.equal(renamed.lexed.window, undefined, 'a different document must start with its own lexer state');
  assert.equal(renamed.source.uri, 'B.cs');
  assert.throws(() => initial.contextAt(-1), RangeError);
});
