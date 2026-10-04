import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {codeTokens} from '../conformance/static/code-tokens.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const providerSlots = new Set(['rootProvider', 'rootVisitor', 'publishRoots']);
const callableBoundaries = new Set(['roots', 'rootValues', 'registerContextRoots']);
const memberAccess = new Set(['.', '?.', '[']);

function propertyName(token, source) {
  if (!token) return null;
  if (token.value !== '<string>') return token.value;
  return /^['"]([A-Za-z_$][\w$]*)['"]$/.exec(source.slice(token.start, token.end))?.[1] ?? null;
}

function nextOperation(tokens, index) {
  let next = index + 1;
  if (tokens[next]?.value === ']') next++;
  if (tokens[next]?.value === '?.') next++;
  return tokens[next]?.value;
}

function registryBindings(tokens, source) {
  const bindings = new Set(['rootRegistry']);
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value !== 'RootRegistry' || tokens[index - 1]?.value !== 'new') continue;
    if (tokens[index - 2]?.value === '=') {
      const name = propertyName(tokens[index - 3], source);
      if (name) bindings.add(name);
    }
  }
  return bindings;
}

function boundaryAt(tokens, index, source, registries) {
  const name = propertyName(tokens[index], source);
  if (!name) return null;
  const operation = nextOperation(tokens, index);
  if (providerSlots.has(name) && ['(', '=', ':'].includes(operation)) {
    return {api: name, kind: name === 'publishRoots' ? 'publication' : 'provider'};
  }
  if ((callableBoundaries.has(name) || /^visit(?:[A-Z][\w$]*)?Roots$/.test(name))
    && (operation === '(' || name !== 'roots' && ['=', ':'].includes(operation))) {
    const kind = name === 'roots' ? 'root-entry' : name === 'rootValues' ? 'compatibility'
      : name === 'registerContextRoots' ? 'registry' : 'visitor';
    return {api: name, kind};
  }
  if (name === 'RootRegistry' && ['new', 'class'].includes(tokens[index - 1]?.value)) {
    return {api: name, kind: 'registry'};
  }
  if (name === 'register' && operation === '(' && memberAccess.has(tokens[index - 1]?.value)) {
    let receiver = index - 2;
    if (tokens[receiver]?.value === ']') receiver--;
    if (registries.has(propertyName(tokens[receiver], source))) return {api: 'RootRegistry.register', kind: 'registry'};
  }
  return null;
}

/** Lexical ownership boundaries, including visitor dispatch, registration and publication; no execution or data-flow inference. */
export function sourceRootSites(source, file, idPrefix = file) {
  const tokens = codeTokens(source);
  const registries = registryBindings(tokens, source);
  const occurrences = new Map();
  const sites = [];
  for (let index = 0; index < tokens.length; index++) {
    const boundary = boundaryAt(tokens, index, source, registries);
    if (!boundary) continue;
    const occurrence = (occurrences.get(boundary.api) ?? 0) + 1;
    occurrences.set(boundary.api, occurrence);
    const start = tokens[index].start;
    sites.push({id: `${idPrefix}:${boundary.api}:${occurrence}`, file,
      line: source.slice(0, start).split('\n').length, ...boundary,
      provider: source.slice(Math.max(0, start - 40), start + 40).replace(/\s+/g, ' ')});
  }
  return sites;
}

function sourceFiles(directory, prefix = '') {
  return readdirSync(directory, {withFileTypes: true}).flatMap(item => item.isDirectory()
    ? sourceFiles(resolve(directory, item.name), prefix + item.name + '/')
    : item.name.endsWith('.js') ? [prefix + item.name] : []);
}

export function rootSites(base = root) {
  const scopes = [
    {path: 'packages/runtime/src', prefix: ''},
    {path: 'packages/debugger/src', prefix: 'debugger/'},
    {path: 'packages/clr/src', prefix: 'clr/'}
  ];
  const sites = [];
  for (const scope of scopes) {
    const directory = resolve(base, scope.path);
    if (scope.prefix && !existsSync(directory)) continue;
    for (const file of sourceFiles(directory).sort()) {
      sites.push(...sourceRootSites(readFileSync(resolve(directory, file), 'utf8'),
        scope.path + '/' + file, scope.prefix + file));
    }
  }
  return sites;
}

export function checkRootProviders(base = root) {
  const doc = readFileSync(resolve(base, 'planning/contracts/gc-roots.md'), 'utf8');
  const sites = rootSites(base);
  for (const site of sites) {
    if (!doc.includes('`' + site.id + '`')) throw new Error('Undocumented root site ' + site.id);
  }
  return sites;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--generate')) {
    writeFileSync(resolve(root, 'planning/contracts/gc-roots-sites.json'), JSON.stringify(rootSites(), null, 2) + '\n');
  } else console.log(JSON.stringify(checkRootProviders()));
}
