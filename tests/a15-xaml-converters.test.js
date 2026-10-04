import test from 'node:test';
import assert from 'node:assert/strict';
import {convertXamlColor, convertXamlValue} from '@sharpforge/winui-properties';
import {literalCases, invalidLiterals} from './fixtures/a15-xaml-literals.js';

const enums = {
  Visibility: {name: 'Visibility', kind: 'enum', values: {Visible: 0, Collapsed: 1}},
  Alignment: {name: 'Alignment', kind: 'enum', values: {Left: 0, Center: 1, Right: 2, Stretch: 3}},
  Options: {name: 'Options', kind: 'enum', flags: true, values: {None: 0, One: 1, Two: 2, Four: 4}}
};
const context = {type: name => enums[name]};

test('A15 literal reference table contains at least 80 documented conversions', () => {
  assert.ok(literalCases.length >= 80);
});

for (const [type, input, expected] of literalCases) {
  test(`XAML conversion ${type}: ${JSON.stringify(input)}`, () => {
    assert.deepEqual(convertXamlValue(input, type, context), expected);
  });
}
for (const [type, input, code] of invalidLiterals) {
  test(`XAML diagnostic ${type}: ${JSON.stringify(input)}`, () => {
    assert.throws(() => convertXamlValue(input, type, context), {code});
  });
}

test('XAML literal services resolve registered types, delegate geometry parsing and enforce input budgets', () => {
  const type = {name: 'Microsoft.UI.Xaml.Controls.Button'};
  assert.equal(convertXamlValue('Button', 'System.Type', {resolveType: name => name === 'Button' ? type : null}), type);
  assert.throws(() => convertXamlValue('Missing', 'System.Type', {resolveType: () => null}), {code: 'SFXAML030'});
  const geometry = {figures: ['bounded parser result']}, calls = [];
  assert.equal(convertXamlValue('M0,0 L10,10 Z', 'Geometry', {parseGeometry: text => { calls.push(text); return geometry; }}), geometry);
  assert.deepEqual(calls, ['M0,0 L10,10 Z']);
  assert.throws(() => convertXamlValue('M0,0', 'Geometry'), {code: 'SFXAML031'});
  assert.equal(convertXamlValue('a', 'Custom', {converters: new Map([['Custom', text => text + '!']])}), 'a!');
  assert.throws(() => convertXamlValue('x'.repeat(16385), 'string'), {code: 'SFXAML027'});
  assert.throws(() => convertXamlValue(null, 'string'), {code: 'SFXAML027'});
  assert.throws(() => convertXamlValue('x', null), {code: 'SFXAML032'});
  assert.equal(convertXamlColor('  Transparent  '), '#00ffffff');
});
