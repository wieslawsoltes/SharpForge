import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {designerButton, designerCommands} from '../apps/studio/designer-command-buttons.js';

const read = path => readFileSync(fileURLToPath(new URL('../' + path, import.meta.url)), 'utf8');

test('designer commands use the Studio SVG vocabulary, explicit labels and escaped identifiers', () => {
  for (const [command, descriptor] of Object.entries(designerCommands)) {
    const html = designerButton(descriptor.icon, descriptor.label, command);
    assert.match(html, /class="design-command"/);
    assert.match(html, /<svg class="icon"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /aria-label="[^"]+"/);
    assert.match(html, /class="design-command-label"/);
  }
  assert.match(designerButton('code', '<Unsafe>', 'x"'), /&lt;Unsafe&gt;/);
  assert.match(designerButton('code', 'Label', 'x"'), /x&quot;/);
  assert.throws(() => designerButton('code', '', 'x'), /require/);
});

test('designer sync rules contain no invalid mixed-inherit font shorthand or hardcoded colors', () => {
  for (const path of ['apps/studio/styles/designer-sync.css', 'apps/studio/styles/designer-light.css']) {
    const text = read(path);
    assert(!/font\s*:[^;{}]*\b(?:inherit|initial|unset)\b[^;{}]*(?:px|em|rem)|font\s*:[^;{}]*(?:px|em|rem)[^;{}]*\binherit\b/.test(text), path);
    assert(!/#[0-9a-f]{3,8}\b/i.test(text), path + ' must use designer tokens');
  }
});

test('chrome geometry has symmetric borders, explicit font size, focus and density tokens', () => {
  const css = read('apps/studio/designer-chrome.css');
  assert.match(css, /--design-toolbar-height:\s*36px/);
  assert.match(css, /\[data-design-density="compact"\]/);
  const colors = read('apps/studio/workbench/theme-tokens.css');
  assert.match(colors, /html\[data-theme="light"\]/);
  assert.match(colors, /--design-foreground:\s*#213a52/);
  assert.match(colors, /html\[data-theme="high-contrast"\]/);
  assert.match(css, /\.toolbar \.toolbar-button\s*\{[^}]*display:\s*inline-flex/);
  assert.match(css, /\.toolbar \.toolbar-button\s*\{[^}]*align-items:\s*center/);
  assert.match(css, /\.design-mode-tabs button\s*\{[^}]*border:\s*1px solid transparent/);
  assert.match(css, /\.design-sync-bar button,[\s\S]*?font-size:\s*11px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers|forced-colors/);
});
