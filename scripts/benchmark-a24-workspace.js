import {performance} from 'node:perf_hooks';
import {WorkspaceSearchIndex, LazyDocumentStore} from '@sharpforge/workspace';
import {LazyExplorerTree} from '../packages/project-system/src/explorer/lazy-tree.js';

const records = Array.from({length: 20000}, (_, index) => ({path: `src/Program${index}.cs`, size: 128, lazy: true}));
const provider = {check: path => path, readFile: async path => new TextEncoder().encode('// ' + path + '\nclass Program {}')};
const percentile = (values, fraction) => [...values].sort((left, right) => left - right)[Math.ceil(values.length * fraction) - 1];
const deferIndex = process.argv.includes('--defer-index');
const samples = [];
for (let iteration = 0; iteration < 7; iteration++) {
  const started = performance.now();
  const store = new LazyDocumentStore(provider);
  store.registerAll(records);
  const registered = performance.now();
  const tree = new LazyExplorerTree({files: records, deferIndex});
  const constructed = performance.now();
  await tree.prepare();
  const prepared = performance.now();
  const page = await tree.loadChildren('src', {limit: 100});
  const expanded = performance.now();
  const search = new WorkspaceSearchIndex(provider);
  await search.addFiles(records);
  const indexed = performance.now();
  const first = await search.findPaths('P19999', {limit: 1}).next();
  const found = performance.now();
  samples.push({registerMs: registered - started, treeMs: constructed - registered, prepareMs: prepared - constructed,
    expandMs: expanded - prepared,
    indexMs: indexed - expanded, firstPathMs: found - indexed, rows: page.nodes.length, loadedBytes: store.loadedBytes,
    indexedBytes: search.indexBytes, firstPath: first.value?.path});
  store.dispose();
  tree.dispose();
  search.dispose();
}
const timings = Object.fromEntries(['registerMs', 'treeMs', 'prepareMs', 'expandMs', 'indexMs', 'firstPathMs'].map(name =>
  [name, {median: percentile(samples.map(sample => sample[name]), 0.5), p95: percentile(samples.map(sample => sample[name]), 0.95)}]));
console.log(JSON.stringify({backend: 'Node JavaScript, metadata-only provider', platform: process.platform,
  node: process.version, files: records.length, deferIndex, timings, samples}, null, 2));
