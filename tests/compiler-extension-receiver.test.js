// SF-A02-T06.6: an extension method whose receiver cannot convert to the `this` parameter reports CS1929, as Roslyn
// does, also when the receiver is a predefined type whose members the closed registry lists only in part.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { isKnownMissingMember } from '../packages/compiler/src/symbols/predefined-member-names.js';
import { receiverRefKind } from '../packages/compiler/src/overload/extension-methods.js';
import { coreTypes } from '../packages/compiler/src/symbols/core-types.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { semanticRow } from '../packages/compiler/test/differential/tools/semantic-report.mjs';

const errorsOf = source =>
  analyze([parse(new SourceText(source, 'a.cs'))])
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`)
    .sort();

const extensions = `static class E {
  public static int Twice(this int value) => value * 2;
  public static long Wide(this long value) => value;
  public static int Legs(this Dog dog) => 4;
  public static void Bump(ref this int value) { value++; }
}
class Animal { } class Dog : Animal { }
`;
const inMain = body => `${extensions}static class P { static void Main() { ${body} } }`;

test('extension-methods fixtures match the pinned Roslyn errors', () => {
  const fixtures = loadFixtures().filter(fixture => fixture.feature === 'extension-methods');
  const pinned = loadPinned().results;
  assert.ok(fixtures.length >= 8, `expected the extension-methods corpus, found ${fixtures.length} fixtures`);
  let cs1929 = 0;
  for (const fixture of fixtures) {
    const expected = pinned.get(fixture.id);
    assert.ok(expected, `${fixture.id} is not pinned`);
    cs1929 += expected.diagnostics.filter(row => row[0] === 'CS1929').length;
    const row = semanticRow(fixture, expected);
    assert.equal(row.crash, undefined, `${fixture.id}: ${row.crash}`);
    assert.deepEqual(row.details, [], `${fixture.id} differs from Roslyn`);
  }
  assert.ok(cs1929 >= 14, `the corpus pins ${cs1929} CS1929 diagnostics`);
});

test('CS1929 sits on the receiver and names the best candidate', () => {
  const source = inMain('string s = "a"; s.Twice();');
  const result = analyze([parse(new SourceText(source, 'a.cs'))]);
  const found = result.diagnostics.filter(d => d.code === 'CS1929');
  assert.equal(found.length, 1);
  assert.equal(source.slice(found[0].start, found[0].start + found[0].length), 's');
  assert.match(found[0].message, /'string' does not contain a definition for 'Twice'/);
  assert.match(found[0].message, /E\.Twice\(int\)' requires a receiver of type 'int'/);
});

test('only identity, reference and boxing conversions reach the receiver', () => {
  assert.deepEqual(errorsOf(inMain('int i = 1; i.Twice();')), []);
  assert.deepEqual(errorsOf(inMain('var d = new Dog(); d.Legs();')), []);
  assert.deepEqual(errorsOf(inMain('double d = 1.5; d.Twice();')), ['CS1929:d']);
  assert.deepEqual(errorsOf(inMain('int i = 1; i.Wide();')), ['CS1929:i']);
  assert.deepEqual(errorsOf(inMain('Animal a = new Dog(); a.Legs();')), ['CS1929:a']);
  assert.deepEqual(errorsOf(inMain('object o = null; o.Legs();')), ['CS1929:o']);
  assert.deepEqual(errorsOf(inMain('(1, 2).Twice();')), ['CS1929:(1, 2)']);
});

test('a ref this receiver is passed by reference', () => {
  assert.deepEqual(errorsOf(inMain('int i = 1; i.Bump();')), []);
  assert.deepEqual(errorsOf(inMain('5.Bump();')), ['CS1510:5']);
  assert.equal(receiverRefKind([{ parameters: [{ refKind: 'ref' }] }]), 'ref');
  assert.equal(receiverRefKind([{ parameters: [{ refKind: 'ref' }] }, { parameters: [{ refKind: 'none' }] }]), null);
});

test('a name no extension offers is CS1061 on a predefined type, unless an unmodelled using could supply it', () => {
  assert.deepEqual(errorsOf(inMain('int i = 1; i.Missing();')), ['CS1061:Missing']);
  assert.deepEqual(errorsOf(`using System.Linq;\n${inMain('int[] a = { 1 }; a.Sum(); a.Legs();')}`), []);
  // Members the framework has but the registry may not list are never reported.
  assert.deepEqual(errorsOf(inMain('string s = "a"; s.Normalize(); s.AsSpan(); int[] a = { 1 }; a.Clone();')), []);
});

test('member names of the predefined types are known in full', () => {
  const core = coreTypes();
  assert.equal(isKnownMissingMember(core.int, 'Twice'), true);
  assert.equal(isKnownMissingMember(core.int, 'CompareTo'), false);
  assert.equal(isKnownMissingMember(core.string, 'Substring'), false);
  assert.equal(isKnownMissingMember(core.string, 'Shout'), true);
  assert.equal(isKnownMissingMember(core.arrayOf(core.int), 'Length'), false);
  assert.equal(isKnownMissingMember(core.arrayOf(core.int), 'Size'), true);
  assert.equal(isKnownMissingMember(core.nint, 'Twice'), false);
  assert.equal(isKnownMissingMember(core.exception, 'Anything'), false);
});
