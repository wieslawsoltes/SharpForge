import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createHostStringOrdering, defaultStringOrdering} from '@sharpforge/bcl-core';

const referenceURL = new URL('../packages/bcl-core/reference/culture-ordering-net10.json', import.meta.url);
const decode = units => units === null ? null : String.fromCharCode(...units);

test('host string ordering matches all 9,409 pinned native corpus pair signs', async () => {
  const reference = JSON.parse(await readFile(referenceURL, 'utf8'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.values.length, 97);
  const provider = createHostStringOrdering();
  const values = reference.values.map(decode);
  for (let first = 0; first < values.length; first++) {
    for (let second = 0; second < values.length; second++) {
      assert.equal(provider.compare(values[first], values[second]), reference.invariant.signs[first][second],
        `Native pair ${first}/${second}; host ${JSON.stringify(provider.info.resolvedOptions)}`);
    }
  }
});

test('host normalization explicitly differs from five pinned native boundary comparisons', async () => {
  const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
  const reference = JSON.parse(await readFile(new URL('culture-ordering-boundaries-net10.json', directory), 'utf8'));
  const source = await readFile(new URL('culture-ordering-boundaries/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.pairs.length, 12);
  const limitations = new Set(['reordered-acute-cedilla', 'reordered-comma-grave', 'composed-acute-cedilla',
    'composed-dot-below', 'reordered-hebrew']);
  const provider = createHostStringOrdering();
  let mismatches = 0;
  for (const row of reference.pairs) {
    const forward = provider.compare(decode(row.left), decode(row.right));
    const reverse = provider.compare(decode(row.right), decode(row.left));
    if (limitations.has(row.id)) {
      // Intl normalizes these equivalent strings; the captured native default keeps their distinction.
      assert.notEqual(row.sign, 0, row.id);
      assert.equal(row.reverseSign, -row.sign, row.id);
      assert.equal(forward, 0, row.id);
      assert.equal(reverse, 0, row.id);
      mismatches += 2;
    } else {
      assert.equal(forward, row.sign, row.id);
      assert.equal(reverse, row.reverseSign, row.id);
    }
  }
  assert.equal(mismatches, 10, 'These known native differences must remain visible until the backend changes');
});

test('host string ordering fixes options once and preserves nullable string boundaries', () => {
  let constructions = 0;
  let observed;
  class Collator extends Intl.Collator {
    constructor(locale, options) {
      constructions++;
      observed = {locale, ...options};
      super(locale, options);
    }
  }
  const provider = createHostStringOrdering({Collator});
  assert.deepEqual(observed, {locale: 'en', localeMatcher: 'lookup', usage: 'sort', sensitivity: 'variant',
    numeric: false, caseFirst: 'false', ignorePunctuation: false});
  assert.equal(provider.compare(null, ''), -1);
  assert.equal(provider.compare('', null), 1);
  assert.equal(provider.compare(null, null), 0);
  assert.equal(provider.compare('a', 'A'), -1);
  assert.equal(provider.compare('10', '2'), -1);
  assert.equal(provider.compare('ab', 'a\0b'), 0);
  assert.equal(constructions, 1);
  assert.equal(Object.isFrozen(provider), true);
  assert.equal(Object.isFrozen(provider.info.resolvedOptions), true);
  assert.throws(() => provider.compare(undefined, ''), TypeError);
  assert.throws(() => provider.compare(1, '1'), TypeError);
});

test('host string ordering rejects unavailable locales and substituted collation options without fallback', () => {
  assert.throws(() => createHostStringOrdering({Collator: null}), {name: 'NotSupportedException'});
  class UnsupportedLocale extends Intl.Collator {static supportedLocalesOf() {return [];}}
  assert.throws(() => createHostStringOrdering({Collator: UnsupportedLocale}), {name: 'NotSupportedException'});
  for (const change of [{locale: 'tr'}, {collation: 'emoji'}, {numeric: true}, {caseFirst: 'upper'},
    {usage: 'search'}, {sensitivity: 'base'}, {ignorePunctuation: true}]) {
    class SubstitutedOptions extends Intl.Collator {
      resolvedOptions() {return {...super.resolvedOptions(), ...change};}
    }
    assert.throws(() => createHostStringOrdering({Collator: SubstitutedOptions}), {name: 'NotSupportedException'});
  }
});

test('default provider caches by platform identity without adding snapshot state', () => {
  const first = {};
  const second = {};
  const provider = defaultStringOrdering(first);
  assert.strictEqual(defaultStringOrdering(first), provider);
  assert.notStrictEqual(defaultStringOrdering(second), provider);
  assert.deepEqual(Object.keys(first), []);
  assert.deepEqual(Object.keys(second), []);
});
