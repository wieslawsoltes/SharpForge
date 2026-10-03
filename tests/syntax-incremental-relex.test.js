import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceText, BoundedCache } from '@sharpforge/text';
import { lex, relex, relexTokens, TokenList } from '@sharpforge/syntax';
import { editSeedDocument, editGenerator, applyEdit } from './support/syntax-edits.js';

// SF-A01-T03.2: bounded incremental relexing. The relexed stream must equal a full lex after every edit, tokens before
// the rescanned window must be the old objects, and tokens after it must be the old objects when the edit keeps the
// text length (otherwise they are position-shifted copies that still share value, interned text and trivia structure).
const pieces = list => list.map(p => `${p.kind}@${p.start}-${p.end}`).join(',');
const tokenKey = t => `${t.kind}|${t.syntaxKind}|${t.text}|${t.start}|${t.end}|${t.fullStart}|${pieces(t.leadingTrivia)}|${pieces(t.trailingTrivia)}|${t.green.fullText}|${JSON.stringify(t.flags ?? null)}|${t.bytes ? [...t.bytes].join(' ') : ''}`;
const diagnosticKey = d => `${d.code}@${d.start}+${d.length} ${d.message} ${d.severity} v${d.version} ${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character}`;
const sortedKeys = (list, key) => list.map(key).sort();
function assertSameLex(actual, expected, label) {
  assert.equal(actual.tokens.length, expected.tokens.length, label + ': token count');
  for (let i = 0; i < expected.tokens.length; i++) {
    const a = actual.tokens[i], e = expected.tokens[i]; if (tokenKey(a) !== tokenKey(e)) assert.fail(`${label}: token ${i} ${tokenKey(a)} != ${tokenKey(e)}`);
    if (e.structure || e.literal) assert.deepStrictEqual(a, e, label + ': token ' + i);
  }
  assert.deepEqual(sortedKeys(actual.lexicalDiagnostics, diagnosticKey), sortedKeys(expected.lexicalDiagnostics, diagnosticKey), label + ': lexical diagnostics');
  assert.deepEqual(sortedKeys(actual.diagnostics, diagnosticKey), sortedKeys(expected.diagnostics, diagnosticKey), label + ': diagnostics');
  assert.deepEqual(sortedKeys(actual.features, f => `${f.id}@${f.start}-${f.end}`), sortedKeys(expected.features, f => `${f.id}@${f.start}-${f.end}`), label + ': features');
  assert.equal(pieces(actual.directives), pieces(expected.directives), label + ': directives'); assert.deepEqual(actual.directives.map(d => d.structure), expected.directives.map(d => d.structure));
  assert.deepEqual([...actual.symbols].sort(), [...expected.symbols].sort(), label + ': symbols'); assert.deepEqual(actual.checkpoints, expected.checkpoints, label + ': checkpoints');
}
function run(seed, edits, options = {}) {
  const generator = editGenerator(seed), cache = new BoundedCache(); let text = editSeedDocument, source = new SourceText(text), current = lex(source, cache, options), outside = 0, rescanned = 0, total = 0;
  for (let n = 0; n < edits; n++) {
    if (text.length > 6000 || text.length < 200) { text = editSeedDocument; source = new SourceText(text); current = lex(source, cache, options); }
    const edit = generator.next(text), label = `seed ${seed} edit ${n} ${JSON.stringify(edit)}`; text = applyEdit(text, edit); source = source.withChange(edit.start, edit.length, edit.text);
    const next = relex(current, source, { start: edit.start, length: edit.length, newLength: edit.text.length }, cache, options), expected = lex(new SourceText(text, source.uri, source.version), cache, options);
    assertSameLex(next, expected, label);
    const { first, end, oldEnd, delta, start, endPosition } = next.window;
    for (let i = 0; i < first; i++) if (next.tokens[i] !== current.tokens[i]) assert.fail(`${label}: token ${i} before the window is not the old object`);
    if (delta === 0) { for (let i = end, j = oldEnd; i < next.tokens.length; i++, j++) if (next.tokens[i] !== current.tokens[j]) assert.fail(`${label}: token ${i} after the window is not the old object`); }
    else for (let i = end, j = oldEnd; i < next.tokens.length; i++, j++) { const a = next.tokens[i], b = current.tokens[j]; if (a.green !== b.green || !Object.is(a.value, b.value) && !a.structure || a.start !== b.start + delta) assert.fail(`${label}: token ${i} after the window is not a shifted copy`); }
    assert(start <= edit.start && endPosition >= Math.min(text.length, edit.start + edit.text.length), label + ': the window covers the edit'); assert.equal(next.tokens.length - end, current.tokens.length - oldEnd);
    outside += first + next.tokens.length - end; rescanned += end - first; total += next.tokens.length; current = next;
  }
  return { outside, rescanned, total };
}
test('relex: the relexed stream equals a full lex across 10,000 seeded edits and reuses tokens outside the window', () => {
  let outside = 0, total = 0, rescanned = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) { const stats = run(seed, 1000); outside += stats.outside; total += stats.total; rescanned += stats.rescanned; }
  assert(outside / total > 0.9, `at least 90% of tokens are outside the rescanned windows (${(outside / total).toFixed(3)})`); assert(rescanned > 0);
});
test('relex: preprocessor symbols and script options are honoured', () => {
  run(101, 400, { preprocessorSymbols: ['X', 'DEBUG'] }); run(102, 300, { script: true }); run(103, 300, { profile: false });
});
test('relex: directive state decides where the streams resynchronise', () => {
  const cache = new BoundedCache(), text = 'class A { }\n#if X\nclass B { }\n#else\nclass C { }\n#endif\nclass D { }\n', old = lex(new SourceText(text), cache);
  const edit = { start: 0, length: 0, text: '#define X\n' }, source = new SourceText(applyEdit(text, edit)), next = relex(old, source, { start: 0, length: 0, newLength: edit.text.length }, cache);
  assertSameLex(next, lex(source, cache), 'define'); assert(next.window.endPosition > source.text.indexOf('#endif'), 'the window runs to the #endif where the directive stacks agree again');
  assert.deepEqual(next.tokens.filter(t => t.kind === 'identifier').map(t => t.text), ['A', 'B', 'D']); assert.equal(next.tokens.at(-1), next.tokens[next.tokens.length - 1]);
  const typed = relex(next, new SourceText(source.text.replace('class D', 'class DD')), { start: source.text.indexOf('D {') + 1, length: 0, newLength: 1 }, cache);
  assert(typed.window.end - typed.window.first <= 6, 'a keystroke rescans a handful of tokens'); assert(typed.window.start >= source.text.indexOf('#else'), 'the window starts at the token before the edit');
});
test('relex: TokenList shifts tokens after an edit only when they are read', () => {
  const cache = new BoundedCache(), text = 'int a = 1; string s = $"x{a + 1}y"; int b = 2;', old = lex(new SourceText(text), cache), source = new SourceText('  ' + text);
  const result = relexTokens(old, source, { start: 0, length: 0, newLength: 2 }, cache), list = result.tokens, full = lex(source, cache);
  assert(list instanceof TokenList); assert.equal(list.length, full.tokens.length); assert(list.segments.length >= 2); assert.equal(list.segments.at(-1).cache, null, 'nothing after the window has been shifted yet');
  const view = list.asArray(), index = full.tokens.findIndex(t => t.kind === 'interpolated');
  assert.deepStrictEqual(view[index], full.tokens[index], 'an interpolated string is rescanned at its new position'); assert.equal(view[index], view[index]); assert.equal(view.length, full.tokens.length); assert.equal(view.at(-1).kind, 'eof');
  assert.equal(list.indexAt(source.text.indexOf('b = 2')), full.tokens.findIndex(t => t.text === 'b')); assert.equal(list.compact().segments.length, 1); assert.deepStrictEqual(list.toArray(), [...full.tokens]);
});
