import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {auditStudioThemes, checkThemeSource, cssDeclarations, findLiteralColors, colorLiterals} from '../scripts/quality/theme-colors.js';
import {loadBuildContributions} from '../scripts/build-contributions.js';
import {applyEnvironment} from '../apps/studio/workbench/theme.js';
import {literalThemePalette, normalizedDeclarations, fingerprintDeclarations, activeThemePalette, resolveThemeToken}
  from './helpers/studio-theme-proof.js';

const root = resolve(import.meta.dirname, '..');
const read = file => readFile(resolve(root, file), 'utf8');
const migrationStyles = ['apps/studio/workbench/designer-tokens.css', 'apps/studio/themes.css'];

test('theme gate detects hex and numeric functional colors inside declarations, fallbacks, gradients and nested rules', () => {
  const css = '@media (min-width:1px){#abcdef{color:#abc;--new:#AAbb;box-shadow:0 0 1px #123456;'
    + 'background:linear-gradient(#ABCDEF12,var(--accent,#def));&:hover{border-color:#AbCdEf}}}';
  assert.deepEqual(findLiteralColors(css).map(value => value.literal), ['#abc', '#AAbb', '#123456', '#ABCDEF12', '#def', '#AbCdEf']);
  assert.equal(findLiteralColors(css).at(-1).selector, '&:hover');
  assert.deepEqual(findLiteralColors(css).at(-1).context, ['@media (min-width:1px)', '#abcdef']);
  assert.equal(findLiteralColors('@keyframes pulse{50%{filter:drop-shadow(0 0 2px #0008)}}')[0].literal, '#0008');
  assert.deepEqual(findLiteralColors('.a{color:rgb(1 2 3);background:rgba(1,2,3,.5)}').map(color => color.literal),
    ['rgb(1 2 3)', 'rgba(1,2,3,.5)']);
});

test('theme gate ignores selectors, comments, strings, URL fragments and identifiers that are not color tokens', () => {
  const css = '/* #fff */ #abc,#12345678{content:"#fff; }";background:url(#abcd);filter:url("icons.svg#ffffff");'
    + '--label:"a\\\"#000";--escaped:\\#fff;--invalid:#12 #12345 #1234567 #abcdefghi #abc-name;}';
  assert.deepEqual(findLiteralColors(css), []);
  assert.deepEqual(colorLiterals('var(--value,/*#fff*/#abcd) url(#fff) #12345678'),
    [{literal: '#abcd', index: 20}, {literal: '#12345678', index: 37}]);
});

test('only explicit token files may define literal palette values; token files cannot hide painted rules', () => {
  assert.equal(checkThemeSource('apps/studio/themes.css', ':root{--background:#123}').length, 0);
  assert.equal(checkThemeSource('apps/studio/workbench/designer-tokens.css', ':root{--line:#1234}').length, 0);
  assert.equal(checkThemeSource('apps/studio/styles/new-tokens.css', ':root{--background:#123}').length, 1);
  assert.equal(checkThemeSource('apps/studio/themes.css', '.button{color:#123}')[0].reason,
    'Theme literals must define custom properties');
  assert.equal(checkThemeSource('apps/studio/styles/tool.css', '.button{color:var(--text,#123)}').length, 1);
});

test('theme gate fails closed on malformed CSS and validates empty and non-string input boundaries', () => {
  assert.deepEqual(findLiteralColors('/* no rules */'), []);
  for (const css of ['.a{color:#fff', '.a{color:var(--x,#fff}', '.a{content:"unfinished}', '.a{color:#fff}}']) {
    assert.throws(() => findLiteralColors(css), SyntaxError);
  }
  assert.throws(() => findLiteralColors(null), TypeError);
  assert.throws(() => colorLiterals(null), TypeError);
});

test('all Studio styles pass the color gate and extracted paint and token styles have explicit cascade order', async () => {
  const audit = await auditStudioThemes(root);
  assert(audit.files >= 31);
  assert.deepEqual(audit.findings, []);
  const {styles} = await loadBuildContributions(root), order = new Map(styles.map(style => [style.source, style.order]));
  const proof = JSON.parse(await read('planning/contracts/fixtures/css/studio-theme-migration.json'));
  for (const style of proof.extractedStyles) {
    assert.equal(order.get(style.source), style.order);
    assert(style.order > order.get('apps/studio/studio.css'));
    assert(style.order < order.get('packages/editor/src/view/virtual.css'));
  }
  assert(order.get('apps/studio/workbench/designer-tokens.css') < order.get('apps/studio/themes.css'));
  assert(order.get('apps/studio/themes.css') < order.get('apps/studio/workbench/theme-tokens.css'));
});

test('the migration preserves every legacy dark/light paint value, geometry declaration and ordered override', async () => {
  const proof = JSON.parse(await read('planning/contracts/fixtures/css/studio-theme-migration.json'));
  assert.match(proof.sourceRevision, /^[\da-f]{40}$/);
  const palette = literalThemePalette(await Promise.all(migrationStyles.map(read)));
  assert.equal(palette.size, proof.tokenCount);
  assert.equal(fingerprintDeclarations([...palette.keys()].sort()), proof.tokenNamesSha256);
  for (const source of proof.files) {
    let records = cssDeclarations(await read(source.file));
    if (source.file === 'apps/studio/studio.css') {
      for (const style of proof.extractedStyles) records.push(...cssDeclarations(await read(style.source)));
    }
    const groups = normalizedDeclarations(records, {palette, declared: proof.declaredTokens, animations: proof.extractedAnimations});
    for (const group of ['paint', 'other']) {
      assert.equal(groups[group].length, source[group].count, `${source.file} ${group} count`);
      assert.equal(fingerprintDeclarations(groups[group]), source[group].sha256, `${source.file} ${group} declarations`);
    }
  }
});

test('Light keeps its authored palette, Blue keeps syntax distinctions, and contrast modes resolve every legacy token', async () => {
  const styles = await Promise.all([...migrationStyles, 'apps/studio/workbench/theme-tokens.css'].map(read));
  const dark = activeThemePalette(styles, 'dark'), light = activeThemePalette(styles, 'light'), blue = activeThemePalette(styles, 'blue');
  assert.equal(resolveThemeToken(dark, '--studio-background'), '#1e1e1e');
  assert.equal(resolveThemeToken(light, '--studio-background-light'), '#eee');
  assert.equal(resolveThemeToken(light, '--designer-mode-bar-light-background'), '#edf2f7');
  assert.equal(resolveThemeToken(blue, '--source-editor-editor-background'), '#17273e');
  assert.equal(resolveThemeToken(blue, '--source-editor-editor-syntax-keyword-foreground'), '#569cd6');
  const legacy = literalThemePalette(styles.slice(0, 2));
  for (const mode of ['high-contrast', 'light', 'blue', 'dark']) {
    const palette = activeThemePalette(styles, mode, mode !== 'high-contrast');
    for (const token of legacy.keys()) {
      const value = resolveThemeToken(palette, token);
      const colors = /^(?:Canvas|CanvasText|ButtonFace|ButtonText|LinkText|Highlight|HighlightText|transparent)$/;
      assert.match(value, mode === 'high-contrast' ? /^(?:#[\da-f]+|transparent)$/i : colors);
    }
  }
  assert.equal(resolveThemeToken(activeThemePalette(styles, 'light', true), '--wb-selected-fg'), 'HighlightText');
});

test('system theme follows OS changes immediately and disposal removes its media listener', () => {
  const listeners = new Set(), properties = new Map();
  const media = {matches: false, addEventListener(type, listener) { listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); }};
  const element = {dataset: {theme: 'blue', density: 'compact'}, style: {setProperty: (key, value) => properties.set(key, value)}};
  const dispose = applyEnvironment(element, {theme: 'system', density: 'comfortable', fontFamily: 'system-ui', fontSize: 14},
    {matchMedia: query => { assert.equal(query, '(prefers-color-scheme: dark)'); return media; }});
  assert.equal(element.dataset.theme, 'light');
  assert.equal(properties.get('--wb-row-height'), '34px');
  media.matches = true;
  for (const listener of listeners) listener();
  assert.equal(element.dataset.theme, 'dark');
  dispose();
  assert.equal(listeners.size, 0);
  assert.equal(element.dataset.theme, 'blue');
});
