import test from 'node:test';
import assert from 'node:assert/strict';
import { IgnoreMatcher, compilePathspec, compileWildmatch } from '../packages/git/src/ignore.js';
import { AttributesMatcher } from '../packages/git/src/attributes.js';
import { cleanEol, smudgeEol } from '../packages/git/src/eol.js';
import { MemoryWorktree, KeyValueWorktree } from '../packages/git/src/worktree.js';
import { MemoryStore } from '../packages/git/src/memory-odb.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('ignore semantics cover nested precedence, directory ancestry, classes and escaped characters', () => {
  const matcher = new IgnoreMatcher();
  matcher.add('*.tmp\n/root.log\nbuild/\n!build/keep.txt\ncache/**/data?.[ch]\n\\#literal\n\\!literal\ntrailing\\ \n');
  matcher.add('!keep.tmp\nlocal.txt\n', { base: 'src', source: 'src/.gitignore' });
  const cases = [
    ['a.tmp', true], ['dir/a.tmp', true], ['src/keep.tmp', false], ['other/keep.tmp', true],
    ['root.log', true], ['dir/root.log', false], ['build/a', true], ['build/keep.txt', true],
    ['cache/data1.c', true], ['cache/a/b/data2.h', true], ['cache/data22.c', false], ['cache/data1.js', false],
    ['#literal', true], ['!literal', true], ['trailing ', true], ['trailing', false],
    ['src/local.txt', true], ['other/local.txt', false], ['a.txt', false], ['src/file.tmp', true]
  ];
  for (let repetition = 0; repetition < 15; repetition++) {
    for (const [path, expected] of cases) assert.equal(matcher.test(path), expected, `case ${repetition * 20}: ${path}`);
  }
  assert.equal(matcher.match('src/local.txt').source, 'src/.gitignore');
  assert.equal(compileWildmatch('**/file[[:digit:]].txt').test('a/file2.txt'), true);
  assert.equal(compileWildmatch('a/**/b').test('a/b'), true);
  assert.equal(compileWildmatch('a/**/b').test('a/x/y/b'), true);
  assert.throws(() => compileWildmatch('*a'.repeat(1000), { maxWork: 10 }).test('a'.repeat(100)), { code: 'Limit' });
});

test('pathspec glob, literal, icase and exclude magic compose deterministically', () => {
  const paths = ['src/a.cs', 'src/nested/b.cs', 'src/test/c.cs', 'README.md'];
  const match = compilePathspec([':(glob)src/**/*.cs', ':(exclude)src/test/**']);
  assert.deepEqual(paths.filter(match), ['src/a.cs', 'src/nested/b.cs']);
  assert.equal(compilePathspec([':(icase)readme.md'])('README.md'), true);
  assert.equal(compilePathspec([':(literal)*.cs'])('a.cs'), false);
  assert.equal(compilePathspec(['src'])('src/nested/a.txt'), true);
  assert.throws(() => compilePathspec([':(glob,literal)a']), { code: 'Corrupt' });
});

test('attributes preserve unset states, macro expansion and repository precedence', () => {
  const attributes = new AttributesMatcher();
  attributes.add('*.txt text eol=lf\n*.bin binary\n*.out export-ignore\n[attr]custom -diff merge=union\n*.list custom\n');
  attributes.add('*.txt -text\n', { base: 'assets' });
  attributes.add('assets/one.txt !text eol=crlf\n', { priority: 1000 });
  assert.deepEqual(attributes.get('a.bin'), { binary: true, diff: false, merge: false, text: false });
  assert.equal(attributes.get('a.list').merge, 'union');
  assert.equal(attributes.get('assets/a.txt').text, false);
  assert.equal(attributes.get('assets/one.txt').text, undefined);
  assert.equal(attributes.get('a.out')['export-ignore'], true);
});

test('EOL normalization preserves binary bytes and enforces safecrlf', () => {
  const input = encoder.encode('a\r\nb\r\n');
  for (const autocrlf of [true, 'true', 'input']) assert.equal(decoder.decode(cleanEol(input, { autocrlf })), 'a\nb\n');
  assert.deepEqual(cleanEol(input, { autocrlf: false }), input);
  assert.equal(decoder.decode(smudgeEol(encoder.encode('a\nb\n'), { autocrlf: true })), 'a\r\nb\r\n');
  const binary = new Uint8Array([0, 13, 10]);
  assert.deepEqual(cleanEol(binary, { autocrlf: true }), binary);
  assert.throws(() => cleanEol(encoder.encode('a\nb\r\n'), { autocrlf: true, safecrlf: true }), { code: 'Conflict' });
  assert.equal(decoder.decode(cleanEol(input, { attributes: { text: true, eol: 'lf' } })), 'a\nb\n');
});

test('memory and persisted worktrees preserve bytes and modes without registering documents', async () => {
  for (const worktree of [new MemoryWorktree(), new KeyValueWorktree(new MemoryStore())]) {
    await worktree.write('src/program', new Uint8Array([0, 255, 10]), { mode: 0o100755 });
    const file = await worktree.read('src/program');
    assert.deepEqual(file.data, new Uint8Array([0, 255, 10]));
    assert.equal(file.mode, 0o100755);
    assert.deepEqual(await worktree.list(), ['src/program']);
    await worktree.remove('src/program');
    assert.equal(await worktree.read('src/program'), null);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(worktree.write('cancelled', 'x', { signal: controller.signal }), { code: 'Cancelled' });
  }
});
