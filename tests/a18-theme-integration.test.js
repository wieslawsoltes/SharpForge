import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {checkThemeSource} from '../scripts/quality/theme-colors.js';
import {activeThemePalette, resolveThemeToken} from './helpers/studio-theme-proof.js';

const read = path => readFileSync(fileURLToPath(new URL('../' + path, import.meta.url)), 'utf8');
const tokens = [
  'apps/studio/workbench/designer-tokens.css',
  'apps/studio/themes.css',
  'apps/studio/workbench/theme-tokens.css'
].map(read);
const styles = [
  'apps/studio/designer-app-host.css',
  'apps/studio/designer-chrome.css',
  'apps/studio/designer-panels.css',
  'apps/studio/designer-property.css',
  'apps/studio/designer-resource-gallery.css',
  'apps/studio/designer-surface.css',
  'apps/studio/styles/designer-documents.css',
  'apps/studio/styles/designer-light.css',
  'apps/studio/styles/designer-sync.css',
  'apps/studio/styles/designer.css'
];

function luminance(value) {
  assert.match(value, /^#[\da-f]{6}$/i);
  const channels = [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test('every A18 stylesheet uses the existing designated palette contribution', () => {
  for (const source of styles) assert.deepEqual(checkThemeSource(source, read(source)), [], source);
  assert.deepEqual(checkThemeSource('apps/studio/workbench/theme-tokens.css', tokens[2]), []);
});

test('designer text remains readable and follows Dark, Light, Blue and High Contrast', () => {
  for (const theme of ['dark', 'light', 'blue', 'high-contrast']) {
    const palette = activeThemePalette(tokens, theme);
    for (const foreground of ['--design-foreground', '--design-muted']) {
      const first = luminance(resolveThemeToken(palette, foreground));
      const second = luminance(resolveThemeToken(palette, '--design-panel'));
      assert((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) >= 4.5, `${theme}: ${foreground}`);
    }
    const primary = luminance(resolveThemeToken(palette, '--design-primary'));
    const selectedText = luminance(resolveThemeToken(palette, '--design-on-primary'));
    assert((Math.max(primary, selectedText) + 0.05) / (Math.min(primary, selectedText) + 0.05) >= 4.5,
      `${theme}: selected command text`);
    if (theme === 'blue' || theme === 'high-contrast') {
      assert.equal(resolveThemeToken(palette, '--design-panel'), resolveThemeToken(palette, '--wb-panel'));
      assert.equal(resolveThemeToken(palette, '--design-foreground'), resolveThemeToken(palette, '--wb-fg'));
      assert.equal(resolveThemeToken(palette, '--design-selection-fill'), 'transparent', `${theme}: preview stays visible`);
    }
  }
  assert.equal(resolveThemeToken(activeThemePalette(tokens, 'light'), '--design-background'), '#dfe5ed');
  assert.match(read('apps/studio/designer-app-host.css'),
    /\.designer-app-host-button\[aria-pressed="true"\]\s*\{\s*background:\s*var\(--design-primary\);\s*color:\s*var\(--design-on-primary\)/);
});

test('forced colors replace every designer palette paint with a system color', () => {
  for (const theme of ['dark', 'light', 'blue', 'high-contrast']) {
    const palette = activeThemePalette(tokens, theme, true);
    for (const name of palette.keys()) {
      if (!name.startsWith('--design-')) continue;
      assert.match(resolveThemeToken(palette, name), /^(?:Canvas|CanvasText|ButtonFace|ButtonText|LinkText|Highlight|HighlightText|transparent)$/,
        `${theme}: ${name}`);
    }
  }
});

test('A18 chrome follows the workbench contributions without duplicate cascade orders', () => {
  const app = JSON.parse(read('apps/studio/build.contrib.json'));
  const designer = JSON.parse(read('packages/designer/build.contrib.json'));
  const entries = [...app.styles, ...designer.styles];
  assert.equal(new Set(entries.map(entry => entry.order)).size, entries.length);
  const order = new Map(entries.map(entry => [entry.source, entry.order]));
  assert(order.get('apps/studio/styles/designer-documents.css') > order.get('apps/studio/workbench/studio-integration.css'));
  assert(order.get('apps/studio/designer-chrome.css') > order.get('apps/studio/workbench/theme-tokens.css'));
});
