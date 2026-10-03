import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importGraph } from './import-graph.js';
import { matches, safePath } from './lib/paths.js';
import { git, isMain, report } from './lib/io.js';

export function impactedTests({ graph, files, manifests, previousGraph }) {
  if (graph.errors.length || previousGraph?.errors.length) throw new Error('Cannot select tests from an unresolved import graph');
  files = [...new Set(files.map(safePath))].sort();
  const reverse = new Map();
  for (const module of [...graph.modules, ...(previousGraph?.modules ?? [])]) for (const dependency of module.dependencies) {
    if (!reverse.has(dependency)) reverse.set(dependency, new Set());
    reverse.get(dependency).add(module.path);
  }
  const impacted = new Set(files), queue = [...files];
  while (queue.length) for (const consumer of reverse.get(queue.shift()) ?? []) if (!impacted.has(consumer)) { impacted.add(consumer); queue.push(consumer); }
  const known = new Set(graph.modules.map(m => m.path));
  const all = files.some(path => /(^|\/)package(?:-lock)?\.json$/.test(path) || path.startsWith('scripts/planning/') ||
    (!previousGraph && path.endsWith('.js') && !known.has(path)));
  const selected = manifests.filter(manifest => all || files.includes(`tests/manifests/${manifest.area}.json`) ||
    [...impacted].some(path => (manifest.nodeFiles ?? []).includes(path) || matches(path, manifest.nodeGlobs) || (manifest.browserScripts ?? []).includes(path)));
  return { files, impacted: [...impacted].sort(), areas: selected.map(m => m.area).sort(), manifests: selected.map(m => `tests/manifests/${m.area}.json`).sort(), errors: [] };
}

if (isMain(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals:true, options:{root:{type:'string',default:'.'},base:{type:'string',default:'origin/main'}} });
  const root = resolve(values.root), { discoverManifests } = await import(pathToFileURL(resolve(root,'scripts/planning/test-manifests.js')));
  const files = positionals.length ? positionals : git(['diff','--no-renames','--name-only','-z',`${values.base}...HEAD`],root).split('\0').filter(Boolean);
  report(impactedTests({graph:importGraph(root),files,manifests:discoverManifests(root)}));
}
