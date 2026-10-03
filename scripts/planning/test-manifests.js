import {readFile, readdir} from 'node:fs/promises';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validate} from './schema/validate.js';
import {globPattern, safePath} from './lib/paths.js';
export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export async function filesUnder(root, directory = '') {
  const result = [];
  for (const entry of await readdir(resolve(root, directory), {withFileTypes: true})) {
    if (['node_modules', '.git', 'dist', 'artifacts', '__pycache__', 'target'].includes(entry.name)) continue;
    const path = [directory, entry.name].filter(Boolean).join('/');
    if (entry.isDirectory()) result.push(...await filesUnder(root, path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}
export const isNodeTest = path => path.endsWith('.test.js') || path.endsWith('.test.mjs');
export const isBrowserTest = path => /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/.test(path);
export async function discoverManifests(root = repositoryRoot) {
  const [schema, catalog, files] = await Promise.all([
    readJson(resolve(root, 'planning/contracts/test-manifest.schema.json')),
    readJson(resolve(root, 'planning/catalog.json')), filesUnder(root)
  ]);
  const areas = new Set(catalog.areas.map(area => area.id)), errors = [], manifests = [];
  const manifestFiles = files.filter(path => /^tests\/manifests\/[^/]+\.json$/.test(path));
  for (const path of manifestFiles) {
    try {
      const manifest = validate(schema, await readJson(resolve(root, path)));
      if (!areas.has(manifest.area)) throw new Error(`Unknown catalog area ${manifest.area}`);
      if (path !== `tests/manifests/${manifest.area}.json`) throw new Error(`Filename does not match area ${manifest.area}`);
      const nodeFiles = [];
      for (const glob of manifest.nodeGlobs) {
        const pattern = globPattern(glob), matched = files.filter(file => pattern.test(file));
        if (!matched.length) errors.push(`${path}: missing test ${glob}`);
        for (const file of matched) {
          if (!isNodeTest(file)) errors.push(`${path}: not a Node test: ${file}`);
          nodeFiles.push(file);
        }
      }
      for (const file of manifest.browserScripts) {
        safePath(file);
        if (!files.includes(file)) errors.push(`${path}: missing test ${file}`);
        if (!isBrowserTest(file)) errors.push(`${path}: not a Python test: ${file}`);
      }
      manifests.push({...manifest, nodeFiles});
    } catch (error) { errors.push(`${path}: ${error.message}`); }
  }
  for (const area of areas) if (!manifests.some(manifest => manifest.area === area)) errors.push(`Missing manifest tests/manifests/${area}.json`);
  const owners = new Map();
  for (const manifest of manifests) for (const path of [...manifest.nodeFiles, ...manifest.browserScripts]) {
    const previous = owners.get(path);
    if (previous) errors.push(`Duplicate test ${path}: ${previous}, ${manifest.area}`);
    else owners.set(path, manifest.area);
  }
  // Runnable tests are discovered recursively; support modules such as browser_harness.py are not suites.
  const tests = files.filter(path => /^(?:tests|planning\/contracts\/tests)\//.test(path) && (isNodeTest(path) || isBrowserTest(path)));
  for (const path of tests) if (!owners.has(path)) errors.push(`Unassigned test ${path}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return manifests.sort((a, b) => a.area.localeCompare(b.area));
}
export function selectManifests(manifests, area) {
  if (!area) return manifests;
  const selected = manifests.filter(manifest => manifest.area === area);
  if (!selected.length) throw new Error(`Unknown area ${area}`);
  return selected;
}
export function parseTestArgs(args) {
  const options = {root: repositoryRoot, area: undefined, list: false, browser: false, nodeArgs: []};
  while (args.length) {
    const arg = args.shift();
    if (arg === '--root' || arg === '--area') {
      const value = args.shift(); if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = arg === '--root' ? resolve(value) : value;
    } else if (arg === '--list') options.list = true;
    else if (arg === '--browser') options.browser = true;
    else if (arg === '--') {options.nodeArgs.push(...args); break;}
    else throw new Error(`Unknown option ${arg}; use -- to forward Node test options`);
  }
  return options;
}
export const isMain = url => process.argv[1] && relative(resolve(process.argv[1]), fileURLToPath(url)).split(sep).join('/') === '';
