import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { codeTokens } from '../conformance/static/code-tokens.js';

/** These owners implement application state and the explicit compatibility boundary. UI contributions may only read the facade. */
export const sessionStateOwners = Object.freeze([
  'apps/studio/workbench/app-session.js',
  'apps/studio/workbench/session-compat.js',
  'apps/studio/workbench/state.js'
]);

function stringValue(source, token) {
  if (token?.value !== '<string>') return null;
  return source.slice(token.start + 1, token.end - 1).replace(/\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|(.))/giu,
    (_, long, short, byte, escaped) => long || short || byte ? String.fromCodePoint(parseInt(long ?? short ?? byte, 16)) : escaped);
}

function propertyEnd(source, tokens, index) {
  if (tokens[index].value !== 'state') return -1;
  if (['.', '?.'].includes(tokens[index + 1]?.value) && tokens[index + 2]?.value === 'debug') return index + 3;
  if (tokens[index + 1]?.value === '[' && stringValue(source, tokens[index + 2]) === 'debug' && tokens[index + 3]?.value === ']') {
    return index + 4;
  }
  return -1;
}

/** Lexical direct-write guard, not alias/data-flow analysis. Comments, strings and equality comparisons are excluded. */
export function findDirectDebugWrites(source) {
  const tokens = codeTokens(source);
  const writes = [];
  const prefixes = new Set(['++', '--', 'delete']);
  for (let index = 0; index < tokens.length; index++) {
    let end = propertyEnd(source, tokens, index);
    if (end < 0) continue;
    while ([')', ']', '}'].includes(tokens[end]?.value)) end++;
    const suffix = tokens.slice(end, end + 4).map(token => token.value).join('');
    const prefix = prefixes.has(tokens[index - 1]?.value)
      || tokens[index - 1]?.value === '.' && tokens[index - 2]?.value === 'this' && prefixes.has(tokens[index - 3]?.value);
    const assignment = /^(?:=(?!=)|\+\+|--|(?:\+|-|\*{1,2}|\/|%|&{1,2}|\|{1,2}|\^|\?{2}|<{2}|>{2,3})=)/u.test(suffix);
    if (prefix || assignment) {
      const start = tokens[index].start;
      writes.push({ start, line: source.slice(0, start).split('\n').length });
    }
  }
  return writes;
}

/** Apply the exact owned-path inventory. There are no legacy UI exceptions. */
export function checkSessionStateOwnership(sources) {
  const owners = new Set(sessionStateOwners);
  const diagnostics = [];
  for (const [path, source] of sources) {
    const normalized = path.replaceAll('\\', '/');
    if (owners.has(normalized)) continue;
    for (const write of findDirectDebugWrites(source)) diagnostics.push({
      code: 'SFST0001', path: normalized, ...write,
      message: 'Direct state.debug writes belong to the application session or explicit compatibility facade.'
    });
  }
  return diagnostics;
}

/** Inspect all Studio modules so a new contribution is covered without editing an allowlist. */
export async function scanSessionStateOwnership(root) {
  const sources = [];
  const visit = async directory => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(?:m?js)$/u.test(entry.name)) sources.push([relative(root, path), await readFile(path, 'utf8')]);
    }
  };
  await visit(join(root, 'apps', 'studio'));
  return checkSessionStateOwnership(sources);
}
