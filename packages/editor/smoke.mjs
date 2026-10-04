import assert from 'node:assert/strict';
import {isAbsolute, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const cssTrivia = /\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g;
const cssString = /"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'/.source;
const cssEscape = /\\(?:[\da-f]{1,6}(?:\r\n|[\t\n\f\r ])?|[\s\S])/.source;
const cssUrl = `((?:${cssEscape}|[^\\s()'"\\\\])+)`;
const cssImport = new RegExp(`^\\s*(?:url\\(\\s*(?:${cssString}|${cssUrl})\\s*\\)|${cssString})`, 'i');

function* stylesheetImports(source) {
  const css = source.replace(cssTrivia, token => token.startsWith('/*') ? ' ' : token);
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(@import\b)/gi;
  for (const token of css.matchAll(tokens)) {
    if (!token[1]) continue;
    const target = cssImport.exec(css.slice(token.index + token[0].length));
    assert(target, 'Packaged editor CSS contains an unsupported or malformed @import');
    const value = target.slice(1).find(part => part !== undefined);
    yield value.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\r\n|([\s\S]))/gi, (_, hex, character) => {
      if (!hex) return character === undefined || /[\n\r\f]/.test(character) ? '' : character;
      const point = parseInt(hex, 16);
      return String.fromCodePoint(point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? point : 0xfffd);
    });
  }
}

function hasPackagedEditorStyles(entry, fs) {
  // Both exported layouts put editor.css in src; imports must stay inside this installed package.
  const root = fs.realpathSync(new URL('../', entry));
  const pending = [entry];
  const visited = new Set();
  const maximumBytes = 4 * 1024 * 1024;
  let bytesRead = 0;
  let imports = 0;
  let found = false;
  while (pending.length) {
    const file = fs.realpathSync(pending.pop());
    const local = relative(root, file);
    assert(!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`), 'CSS import leaves the installed editor package');
    if (visited.has(file)) continue;
    assert(visited.size < 128, 'Editor CSS import graph exceeds 128 files');
    visited.add(file);
    const stat = fs.statSync(file);
    assert(stat.isFile() && stat.size <= maximumBytes - bytesRead, 'Editor CSS import is not a bounded regular file');
    const bytes = fs.readFileSync(file);
    bytesRead += bytes.length;
    assert(bytesRead <= maximumBytes, 'Editor CSS import graph exceeds 4 MiB');
    const source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    found ||= /\.sf-editor(?=[\s.#:\[{>+~,)])/.test(source.replace(cssTrivia, ''));
    for (const target of stylesheetImports(source)) {
      assert(++imports <= 1024, 'Editor CSS import graph exceeds 1024 references');
      const url = new URL(target, pathToFileURL(file));
      if (url.protocol === 'file:') pending.push(url);
    }
  }
  return found;
}

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'editor:stylesheet', order: 670, async run(context) {
    const fs=await import('node:fs');
    assert(hasPackagedEditorStyles(new URL(import.meta.resolve('@sharpforge/editor/editor.css')),fs),
      'Packaged editor styles must contain the .sf-editor selector');
    Object.assign(context, {readFileSync:fs.readFileSync});
  }},
  {id: 'editor:viewport-navigation', order: 890, async run(context) {
    const {SyntaxHighlightIndex,NavigationHistory}=await import('@sharpforge/editor');
    const index=new SyntaxHighlightIndex('int x=1;\n'.repeat(5000)),view=index.window({scrollTop:22000,height:440});
    assert(view.characters<1000);
    assert(view.firstLine>900);
    const history=new NavigationHistory();
    history.push({uri:'A.cs',start:1,end:1});
    history.push({uri:'B.cs',start:2,end:4});
    assert.equal(history.back().uri,'A.cs');
  }},
  {id: 'editor:keymaps-classic-css', order: 1120, async run(context) {
    const {readFileSync} = context;
    const {EDITOR_KEYMAPS}=await import('@sharpforge/editor');
    assert.equal(EDITOR_KEYMAPS.length,5);
    assert.equal(EDITOR_KEYMAPS[0].id,'visual-studio');
    assert(readFileSync(new URL(import.meta.resolve('@sharpforge/editor/classic.css')),'utf8').includes('.CodeMirror'));
  }},
];
