import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '@sharpforge/compiler';
import { fixtures } from '../packages/compiler/test/suppression/end-to-end-fixtures.js';

// Roslyn's final diagnostic lists, pinned by packages/compiler/test/suppression/generate.js.
const pinned = JSON.parse(
  readFileSync(new URL('../packages/compiler/test/suppression/roslyn-suppression-end-to-end.json', import.meta.url), 'utf8'),
);
const byName = new Map(pinned.fixtures.map(f => [f.name, f]));
const rowOf = d => [d.uri, d.start, d.length, d.code, d.severity];
const order = (a, b) => a[1] - b[1] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0);
// The bound pipeline is named explicitly: flow warnings (CS0168, CS0219) are its diagnostics, whatever SHARPFORGE_PIPELINE says.
const library = { outputKind: 'library', pipeline: 'bound' };
const finalList = fixture => compile(fixture.sources, { ...library, ...fixture.options });

test('A02-T37 the end-to-end fixtures are a current Roslyn pin', () => {
  assert.match(pinned.roslyn, /^\d+\.\d+/);
  assert.equal(pinned.fixtures.length, fixtures.length);
  for (const fixture of fixtures) {
    const pin = byName.get(fixture.name);
    assert(pin, `${fixture.name} is not pinned; run packages/compiler/test/suppression/generate.js`);
    assert.deepEqual([pin.sources, pin.options], [fixture.sources, fixture.options], `${fixture.name}: stale pin`);
  }
});

for (const fixture of fixtures) {
  test(`A02-T37 compile() reports Roslyn's final diagnostics: ${fixture.name}`, () => {
    const result = finalList(fixture),
      expected = byName.get(fixture.name).expected;
    assert.deepEqual(result.diagnostics.map(rowOf).sort(order), expected.map(rowOf).sort(order));
    assert.equal(result.success, !expected.some(d => d.severity === 'error'));
  });
}

test('A02-T37 Roslyn does not apply SuppressMessage to compiler warnings, and neither does compile()', () => {
  const pin = byName.get('SuppressMessage does not suppress compiler warnings');
  // The raw list (no filtering) and the final list are the same: the attributes suppressed nothing.
  assert.deepEqual(pin.expected.map(rowOf), pin.raw.map(rowOf));
  assert.deepEqual(pin.expected.map(d => d.code), ['CS0168', 'CS0219', 'CS0168']);
  const result = finalList(pin);
  assert.equal(result.success, true, 'a program with SuppressMessage attributes compiles');
  assert.equal(result.diagnostics.filter(d => d.severity === 'warning').length, 3);
});

test('A02-T37 only attribute lists made of SuppressMessage are accepted by the profile', () => {
  const codes = source => compile(source, library).diagnostics.map(d => d.code);
  const using = 'using System.Diagnostics.CodeAnalysis;\n';
  assert.deepEqual(codes(using + '[SuppressMessage("a", "b")] class C { }'), []);
  assert.deepEqual(codes('[System.Diagnostics.CodeAnalysis.SuppressMessageAttribute("a", "b", Justification = "c")] class C { }'), []);
  // Another attribute, a malformed SuppressMessage and a user type of that name keep the profile diagnostic.
  assert(codes('[System.Obsolete] class C { }').includes('SF1018'));
  assert(codes(using + '[SuppressMessage("a", "b"), System.Obsolete] class C { }').includes('SF1018'));
  assert(codes(using + '[SuppressMessage("a")] class C { }').includes('SF1018'));
  assert(codes(using + '[SuppressMessage("a", 1)] class C { }').includes('SF1018'));
  assert(codes('[SuppressMessage("a", "b")] class C { } class SuppressMessageAttribute { }').includes('SF1018'));
});

test('A02-T37 #pragma warning enable is not a directive: CS1634 on the keyword, nothing restored', () => {
  const source = 'class C\n{\n#pragma warning disable CS0168\n#pragma warning enable CS0168\n    static void A() { int a; }\n}\n';
  const result = compile(source, library);
  assert.deepEqual(
    result.diagnostics.map(d => [d.code, source.slice(d.start, d.start + d.length), d.severity, d.message]),
    [['CS1634', 'enable', 'warning', "Expected 'disable' or 'restore'"]],
  );
  // The directive warning obeys the options like any other warning.
  assert.deepEqual(compile(source, { ...library, noWarn: ['1634'] }).diagnostics, []);
  assert.equal(compile(source, { ...library, warnAsError: ['CS1634'] }).success, false);
});

test('A02-T37 malformed pragma lines are reported once, with the span of the offending token', () => {
  const source = 'class C { }\n#pragma warning foo\n#pragma nope\n#pragma warning disable 168 junk\n#pragma warning disable "x"\n';
  const result = compile(source, library);
  assert.deepEqual(
    result.diagnostics.map(d => [d.code, source.slice(d.start, d.start + d.length)]),
    [
      ['CS1634', 'foo'],
      ['CS1633', 'nope'],
      ['CS1696', 'junk'],
      ['CS1072', '"x"'],
    ],
  );
});
