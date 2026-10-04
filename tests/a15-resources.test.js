import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ResourceDictionary, ResourceScope, DeferredResource, staticResource, themeResource,
  FluentResources, createAccentRamp, connectThemeHost} from '@sharpforge/winui-properties';

test('resources: nearest scope/local values and reverse merged precedence are deterministic', () => {
  const first = new ResourceDictionary([['value', 1]]);
  const last = new ResourceDictionary([['value', 2]]);
  const application = new ResourceScope({resources: new ResourceDictionary([['outer', 10]])});
  const parent = new ResourceScope({application});
  parent.resources.setMerged([first, last]);
  const child = new ResourceScope({parent});
  assert.equal(child.find('value'), 2);
  assert.equal(child.find('outer'), 10);
  child.resources.set('value', 3);
  assert.equal(child.find('value'), 3);
  child.resources.remove('value');
  assert.equal(child.find('value'), 2);
  assert.throws(() => child.find('missing'), {code: 'SFRES013'});
  application.dispose();
});

test('resources: cyclic graphs, entry limits and reentrant mutation fail without publishing a partial dictionary', () => {
  const first = new ResourceDictionary();
  const second = new ResourceDictionary();
  first.addMerged(second);
  assert.throws(() => second.addMerged(first), {code: 'SFRES011'});
  assert.equal(second.mergedDictionaries.length, 0);
  const limited = new ResourceDictionary([], {maxEntries: 1});
  limited.add('a', 1);
  assert.throws(() => limited.add('b', 2), {code: 'SFRES005'});
  assert.equal(limited.count, 1);
  const off = limited.subscribe({validate: () => limited.set('a', 3)});
  assert.throws(() => limited.set('a', 2), {code: 'SFRES009'});
  assert.equal(limited.get('a'), 1);
  off();
});

test('resources: StaticResource is captured once; ThemeResource follows only its live scope', () => {
  const resources = new ResourceDictionary();
  resources.setTheme('Light', new ResourceDictionary([['brush', 'light']]));
  resources.setTheme('Dark', new ResourceDictionary([['brush', 'dark']]));
  const root = new ResourceScope({resources});
  const left = new ResourceScope({parent: root});
  const right = new ResourceScope({parent: root});
  const events = [];
  const staticEvents = [];
  const rightEvents = [];
  left.observe(themeResource('brush'), {changed: value => events.push(value)});
  left.observe(staticResource('brush'), {changed: value => staticEvents.push(value)});
  right.observe(themeResource('brush'), {changed: value => rightEvents.push(value)});
  const actualThemes = [];
  left.onThemeChanged(change => actualThemes.push(change.newTheme));
  left.setTheme('Dark');
  left.setTheme('Dark');
  assert.deepEqual(events, ['light', 'dark']);
  assert.deepEqual(staticEvents, ['light']);
  assert.deepEqual(rightEvents, ['light']);
  assert.deepEqual(actualThemes, ['Dark']);
  left.dispose();
  root.resources.themes.get('Dark').set('brush', 'changed');
  assert.deepEqual(events, ['light', 'dark']);
  root.dispose();
  assert.equal(resources.listeners.size, 0);
  assert.equal(resources.themes.get('Light').listeners.size, 0);
});

test('resources: validators reject an invalid dynamic mutation before any consumer observes it', () => {
  const dictionary = new ResourceDictionary([['size', 10]]);
  const scope = new ResourceScope({resources: dictionary});
  const observed = [];
  scope.observe(themeResource('size'), {
    validate: value => { if (typeof value !== 'number') throw new TypeError('size must be numeric'); },
    changed: value => observed.push(value)
  });
  assert.throws(() => dictionary.set('size', 'wrong'), TypeError);
  assert.equal(dictionary.get('size'), 10);
  assert.deepEqual(observed, [10]);
  dictionary.transaction(() => { dictionary.set('size', 20); dictionary.set('other', 7); });
  assert.deepEqual(observed, [10, 20]);
  scope.dispose();
});

test('resources: deferred values instantiate once, detect recursion, and dispose their lifetime', () => {
  let created = 0;
  let disposed = 0;
  const dictionary = new ResourceDictionary();
  dictionary.add('item', new DeferredResource(() => ({created: ++created}), {dispose: () => disposed++}));
  assert.equal(created, 0);
  assert.equal(dictionary.get('item'), dictionary.get('item'));
  assert.equal(created, 1);
  dictionary.add('cycle', new DeferredResource(() => dictionary.get('cycle')));
  assert.throws(() => dictionary.get('cycle'), {code: 'SFRES003'});
  dictionary.dispose();
  assert.equal(disposed, 1);
});

test('Fluent: every pinned upstream color/brush key exists in Light Dark and HighContrast', () => {
  const inventoryPath = fileURLToPath(new URL('../packages/winui-properties/src/resources/fluent-inventory.json', import.meta.url));
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const resources = new FluentResources();
  assert.equal(inventory.commit, '7b68d3e0b771a57d80098799406234efee479517');
  for (const [theme, expected] of Object.entries(inventory.themes)) {
    const dictionary = resources.themes.get(theme);
    const missing = expected.keys.filter(key => !dictionary.containsKey(key));
    assert.deepEqual(missing, [], `${theme} missing upstream keys`);
    assert.equal(expected.count, 184);
  }
  assert.equal(resources.get('TextFillColorPrimary', {theme: 'Light'}).toLowerCase(), '#e4000000');
  assert.equal(resources.get('TextFillColorPrimary', {theme: 'Dark'}).toLowerCase(), '#ffffff');
  assert.equal(resources.get('SystemColorWindowColor', {theme: 'HighContrast'}), 'Canvas');
  assert.equal(resources.get('ControlFillColorDefaultBrush', {theme: 'HighContrast'}).color, 'ButtonFace');
  assert.equal(resources.get('ControlElevationBorderBrush', {theme: 'Light'}).stops.length, 2);
  resources.dispose();
});

test('Fluent: accent changes update theme consumers and the configurable ramp is deterministic', () => {
  const resources = new FluentResources();
  const scope = new ResourceScope({resources});
  const values = [];
  scope.observe(themeResource('AccentFillColorDefaultBrush'), {changed: brush => values.push(brush.color)});
  resources.setAccent('#804020');
  assert.equal(values.length, 2);
  assert.notEqual(values[0], values[1]);
  assert.equal(createAccentRamp('#804020').SystemAccentColor, '#804020');
  assert.throws(() => createAccentRamp('#80ffffff'), {code: 'SFRES016'});
  scope.dispose();
  resources.dispose();
});

test('Fluent: host theme and forced colors notifications release browser listeners on disconnect', () => {
  const queries = new Map();
  const matchMedia = query => {
    const listeners = new Set();
    const value = {matches: false, addEventListener: (_, callback) => listeners.add(callback),
      removeEventListener: (_, callback) => listeners.delete(callback),
      set: active => { value.matches = active; for (const listener of listeners) listener(); }, listeners};
    queries.set(query, value);
    return value;
  };
  const attributes = new Map();
  const css = new Map();
  const scope = new ResourceScope({resources: new FluentResources()});
  const disconnect = connectThemeHost(scope, {matchMedia, element: {
    setAttribute: (name, value) => attributes.set(name, value), style: {setProperty: (name, value) => css.set(name, value)}
  }});
  queries.get('(prefers-color-scheme: dark)').set(true);
  assert.equal(attributes.get('data-theme'), 'dark');
  queries.get('(forced-colors: active)').set(true);
  assert.equal(scope.actualTheme, 'HighContrast');
  assert.equal(css.get('--sf-app-bg'), 'Canvas');
  disconnect();
  for (const query of queries.values()) assert.equal(query.listeners.size, 0);
  scope.dispose();
});
