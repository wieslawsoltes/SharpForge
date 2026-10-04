import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { checkUsingDirectiveSyntax, checkAliasTargetType } from '../packages/compiler/src/binder/using-alias-rules.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

/** The diagnostics with the given codes, as `code@text`. */
function diagnostics(source, codes, options = {}) {
  return compile(source, options)
    .diagnostics.filter(d => codes.includes(d.code))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);
}
const inMain = body => `static class P {\n  static void Get(out (int, int) pair) { pair = (1, 2); }\n  static void Main() {\n${body}\n  }\n}\n`;

test('SF-A02-T60/T58/T80 corpus: tuple name, out var and using alias fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    ids = [
      'tuple-equality-names/cs8383-names-ignored-by-equality',
      'out-variables/cs8199-var-pattern-as-out-argument',
      'using-unsafe-aliases/alias-rules-with-unsafe',
      'using-unsafe-aliases/alias-rules-without-unsafe',
    ];
  for (const id of ids) {
    const fixture = loadFixtures().find(f => f.id === id);
    assert(fixture, id);
    const row = runFixture(fixture, pinned.results.get(id));
    assert.equal(row.passed, true, `${id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T60 CS8383: a written element name the other side of == does not have', () => {
  const names = body => diagnostics(inMain(`(int a, int b) named = (1, 2); (int, int) plain = (1, 2); int n = 1, m = 2;\n${body}`), ['CS8383']);
  assert.deepEqual(names('bool r = named == (c: 1, d: 2);'), ['CS8383@c: 1', 'CS8383@d: 2']);
  assert.deepEqual(names('bool r = named == (a: 1, b: 2);'), []);
  assert.deepEqual(names('bool r = named != (a: 1, z: 2);'), ['CS8383@z: 2']);
  assert.deepEqual(names('bool r = plain == (c: 1, d: 2);'), ['CS8383@c: 1', 'CS8383@d: 2']);
  assert.deepEqual(names('bool r = (x: 1, y: 2) == (a: 1, b: 2);'), ['CS8383@a: 1', 'CS8383@b: 2'], 'one warning per element, on the right');
  assert.deepEqual(names('bool r = (n: 1, m: 2) == (n, m);'), [], 'inferred names count');
  assert.deepEqual(names('bool r = named == (n, m);'), [], 'only written names are reported');
  assert.deepEqual(names('bool r = (named, 1) == ((e: 1, f: 2), g: 1);').sort(), ['CS8383@e: 1', 'CS8383@f: 2', 'CS8383@g: 1'], 'nested literals');
});

test('SF-A02-T58 CS8199: var (...) as an out argument is reserved', () => {
  const codes = ['CS8199', 'CS0103'];
  assert.deepEqual(diagnostics(inMain('Get(out var (a, b));'), codes), ['CS0103@var', 'CS8199@var (a, b)', 'CS0103@a', 'CS0103@b']);
  assert.deepEqual(diagnostics(inMain('Get(out var ok); var (j, k) = (1, 2);'), codes), []);
  const declared = 'static class P {\n  static ref (int, int) var(int a, int b) => throw null;\n  static void Get(out (int, int) p) { p = (1, 2); }\n';
  assert.deepEqual(diagnostics(declared + '  static void Main() { Get(out var(1, 2)); }\n}\n', codes), [], 'a method named var is called');
});

test('SF-A02-T80 using unsafe and aliases of any type: the syntax rules', () => {
  const directives = text => [...parse(new SourceText(text, 'a.cs')).syntax.usings],
    codes = (text, allowUnsafe) => directives(text).flatMap(directive => checkUsingDirectiveSyntax(directive, allowUnsafe).map(d => d.code));
  assert.deepEqual(codes('using unsafe System;', true), ['CS9131']);
  assert.deepEqual(codes('using unsafe System;', false), ['CS9131'], 'CS0227 is not added to it');
  assert.deepEqual(codes('using unsafe P = int*;', true), []);
  assert.deepEqual(codes('using unsafe P = int*;', false), ['CS0227']);
  assert.deepEqual(codes('using static unsafe System.Console;', false), ['CS0227']);
  assert.deepEqual(codes('using P = int*;', true), ['CS0214']);
  assert.deepEqual(codes('using P = int*[];', true), ['CS0214']);
  assert.deepEqual(codes('using R = ref int;', true), ['CS9130']);
  assert.deepEqual(codes('using A = int[]; using N = int?; using S = System;', true), []);
  const [nullable] = directives('using N = string?;');
  assert.equal(checkAliasTargetType(nullable, { isReferenceType: true })?.code, 'CS9132');
  assert.equal(checkAliasTargetType(nullable, { isReferenceType: false }), null, 'a nullable value type is allowed');
});

test('SF-A02-T80 an alias of a pointer type needs an unsafe context where it is used', () => {
  const source = 'using unsafe UP = int*;\nstatic class P {\n  static unsafe void M(UP p) { }\n  static void N(UP p) { }\n  static void Main() { }\n}\n';
  assert.deepEqual(diagnostics(source, ['CS0214', 'CS0227'], { allowUnsafe: true }), ['CS0214@UP']);
});
