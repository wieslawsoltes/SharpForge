import {readdir, readFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cssRules} from '../planning/css-rules.js';

export const themeTokenFiles = Object.freeze([
  'apps/studio/themes.css',
  'apps/studio/workbench/designer-tokens.css',
  'apps/studio/workbench/theme-tokens.css'
]);

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const propertyName = /^(?:--[\w-]+|[a-z-]+)$/i;
const withoutComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').trim();

/** Read declarations in ordinary rules, nested selectors, media rules and keyframes. */
export function cssDeclarations(css) {
  cssRules(css);
  const result = [], frames = [{selector: '', start: 0}];
  let quote = null, comment = false, round = 0, square = 0;
  const append = end => {
    const frame = frames.at(-1), text = withoutComments(css.slice(frame.start, end));
    const colon = text.indexOf(':'), property = text.slice(0, colon).trim();
    if (frames.length > 1 && colon >= 0 && propertyName.test(property)) {
      result.push({selector: frame.selector, context: frames.slice(1, -1).map(item => item.selector),
        property, value: text.slice(colon + 1).trim()});
    }
  };
  for (let index = 0; index < css.length; index++) {
    const character = css[index], next = css[index + 1];
    if (comment) {
      if (character === '*' && next === '/') { comment = false; index++; }
      continue;
    }
    if (quote) {
      if (character === '\\') index++;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '*') { comment = true; index++; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '\\') { index++; continue; }
    if (character === '(') round++;
    else if (character === ')') round--;
    else if (character === '[') square++;
    else if (character === ']') square--;
    if (round || square) continue;
    if (character === '{') {
      frames.push({selector: withoutComments(css.slice(frames.at(-1).start, index)), start: index + 1});
    } else if (character === ';') {
      append(index);
      frames.at(-1).start = index + 1;
    } else if (character === '}') {
      append(index);
      frames.pop();
      frames.at(-1).start = index + 1;
    }
  }
  return result;
}

/** Quoted text, CSS escapes and URL fragment identifiers are not color tokens. */
export function colorLiterals(value) {
  if (typeof value !== 'string') throw new TypeError('A CSS value must be a string');
  const colors = [], functions = [];
  let quote = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '\\') { index++; continue; }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '/' && value[index + 1] === '*') {
      const end = value.indexOf('*/', index + 2);
      index = end < 0 ? value.length : end + 1;
      continue;
    }
    if (character === '(') {
      const name = value.slice(0, index).match(/[\w-]+$/)?.[0].toLowerCase() ?? '';
      functions.push(name);
      if (!functions.includes('url') && /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/.test(name)) {
        const end = value.indexOf(')', index + 1), body = value.slice(index + 1, end);
        if (end >= 0 && /[\d.]/.test(body) && !body.includes('(')) {
          const start = index - name.length;
          colors.push({literal: value.slice(start, end + 1), index: start});
        }
      }
    }
    else if (character === ')') functions.pop();
    else if (character === '#' && !functions.includes('url')) {
      const name = value.slice(index + 1).match(/^[\w-]+/)?.[0] ?? '';
      if ([3, 4, 6, 8].includes(name.length) && /^[\da-f]+$/i.test(name) && value[index + name.length + 1] !== '\\') {
        colors.push({literal: '#' + name, index});
      }
      index += name.length;
    }
  }
  return colors;
}

export function findLiteralColors(css) {
  return cssDeclarations(css).flatMap(declaration =>
    colorLiterals(declaration.value).map(color => ({...declaration, ...color})));
}

export function checkThemeSource(source, css) {
  const tokenFile = themeTokenFiles.includes(source.replaceAll('\\', '/'));
  return findLiteralColors(css).filter(color => !tokenFile || !color.property.startsWith('--'))
    .map(color => ({source, ...color, reason: tokenFile ? 'Theme literals must define custom properties' : 'Use a theme token'}));
}

async function stylesheetPaths(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (['node_modules', 'dist', 'artifacts'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await stylesheetPaths(path));
    else if (entry.isFile() && entry.name.endsWith('.css')) files.push(path);
  }
  return files.sort();
}

/** #1566 names Studio and the split release08–14 styles; package-owned CSS has separate owners. */
export async function auditStudioThemes(root = repository) {
  const paths = await stylesheetPaths(join(root, 'apps/studio'));
  const findings = [];
  for (const path of paths) findings.push(...checkThemeSource(relative(root, path).replaceAll('\\', '/'), await readFile(path, 'utf8')));
  return {files: paths.length, tokenFiles: themeTokenFiles, findings};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditStudioThemes();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.findings.length ? 1 : 0;
}
