import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findTextMatches, expandReplacement, replaceTextMatches, SearchPatternError, SearchLimitError } from '@sharpforge/text';

function search(text, query, options = {}) {
  return findTextMatches([{ uri: 'test.cs', text, version: 7 }], query, { timeLimitMs: 1000, ...options });
}

for (const [pattern, text, flags] of [
  ['a+', 'baaacaa', ''], ['a+?', 'baaacaa', ''], ['a{2,4}', 'aaaaa a aa aaa', ''],
  ['(?:ab|a)+', 'ababa baab', ''], ['(a|b)\\1', 'aabb ab ba', ''],
  ['(?<word>\\w+):(?<number>\\d+)', 'abc:123 DEF:4', ''],
  ['foo(?=bar)', 'foobar foo baz', ''], ['foo(?!bar)', 'foobar foo baz', ''],
  ['(?<=foo)bar', 'foobar foobar bar', ''], ['(?<!foo)bar', 'foobar bar', ''],
  ['^(\\w+)\\r?$', 'one\r\ntwo\nthree', 'm'], ['a.*b', 'a\nnew\nb', 's'],
  ['[a-z]+', 'aBc xyz 123', 'i'], ['[^0-9]+', '123abc4😀5', ''],
  ['a*', 'aba😀', ''], ['(?=(aa))', 'aaa', ''], ['(a?)*', 'aa', ''],
  ['\\p{L}+', 'abc Ελληνικά 日本語 😀', ''], ['\\u{1F600}', 'x😀😀', ''],
  ['\\bfoo\\b', 'foo foobar _foo (foo)', ''], ['(a(b)?)+', 'aba aa', '']
]) test(`bounded regex matches the native safe-fixture oracle: ${pattern}/${flags}`, () => {
  const native = [...text.matchAll(new RegExp(pattern, `gu${flags}`))];
  const actual = search(text, pattern, { regex: true, matchCase: !flags.includes('i'), multiline: flags.includes('m'), dotAll: flags.includes('s') });
  assert.deepEqual(actual.matches.map(match => [match.start, match.end, match.captures]),
    native.map(match => [match.index, match.index + match[0].length, [...match].slice(1)]));
});

test('literal search preserves Unicode folding, UTF-16 spans and whole-word semantics', () => {
  const text = '😀 İ I ı i ſ S K k Σ ς σ ß ẞ';
  for (const query of ['i', 's', 'k', 'σ', 'ß']) {
    const expected = [...text.matchAll(new RegExp(query, 'giu'))].map(match => [match.index, match.index + match[0].length]);
    assert.deepEqual(search(text, query).matches.map(match => [match.start, match.end]), expected);
  }
  assert.equal(search('a.b axb', 'a.b').matches.length, 1);
  assert.deepEqual(search('é é2 (é)', 'é', { wholeWord: true }).matches.map(match => match.start), [0, 6]);
  assert.equal(search('a\rb\r\nc\nd', 'd').matches[0].line, 3);
});

test('regex replacement expands captures, names, escapes and multiline patterns atomically', () => {
  const source = 'item:12\r\nnext:34';
  const result = replaceTextMatches(source, '(?<key>\\w+):(\\d+)', '$<key>=[$2] $$ $&', { regex: true, timeLimitMs: 1000 });
  assert.equal(result.text, 'item=[12] $ item:12\r\nnext=[34] $ next:34');
  assert.equal(result.count, 2);
  assert.equal(replaceTextMatches('a.b axb', 'a.b', '$&').text, '$& axb');
  const match = search('abc', '(b)', { regex: true }).matches[0];
  assert.equal(expandReplacement('$`/$1/$\'/$12', match, 'abc'), 'a/b/c/b2');
  assert.throws(() => replaceTextMatches('xx', 'x', 'huge', { maxLength: 3 }), /limit/);
  assert.throws(() => expandReplacement('$`', match), /source text/);
});

test('invalid/unsupported patterns report stable positions instead of native engine errors', () => {
  for (const pattern of ['(', '[a-', '*a', '(?<a>x)(?<a>y)', '[z-a]', '\\q', '\\p{NotAProperty}', '(?<=a+)b']) {
    assert.throws(() => search('text', pattern, { regex: true }), error => error instanceof SearchPatternError && Number.isInteger(error.position));
  }
  assert.throws(() => search('text', '(a){10001}', { regex: true }), /10000/);
});

test('pathological regex is interrupted inside the interpreter and a process watchdog remains a second boundary', () => {
  assert.throws(() => search('a'.repeat(60) + '!', '(a+)+$', { regex: true, maxSteps: 10000 }), SearchLimitError);
  const modulePath = fileURLToPath(new URL('../packages/text/src/index.js', import.meta.url));
  const script = `import {findTextMatches} from ${JSON.stringify(modulePath)};\n`
    + `try { findTextMatches([{uri:'x',text:'a'.repeat(1000)+'!'}],'(a+)+$',{regex:true,timeLimitMs:10}); process.exitCode=2; }`
    + `catch(error) { if(error.code!=='SEARCH_LIMIT') throw error; }`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 2000, encoding: 'utf8' });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
});

test('search cancellation, result limits and empty-match advancement are bounded', () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => search('text', 't', { signal: controller.signal }), { name: 'AbortError' });
  const result = search('x x x', 'x', { maxMatches: 2 });
  assert.equal(result.truncated, true);
  assert.equal(result.matches.length, 2);
  assert.deepEqual(search('😀a', '(?:)', { regex: true }).matches.map(match => match.start), [0, 2, 3]);
  assert.throws(() => search('a'.repeat(1000), 'a', { maxSteps: 1 }), SearchLimitError);
});
