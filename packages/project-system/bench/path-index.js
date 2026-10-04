import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { WorkspacePathIndex } from '../src/evaluation/path-index.js';

const paths = Array.from({ length: 20000 }, (_, index) => `project${index % 100}/folder/File${index}.cs`);
const files = new Map(paths.map(path => [path, true]));
const queries = Array.from({ length: 100 }, (_, index) => `project${index}/folder`);
const buildStart = performance.now();
const index = new WorkspacePathIndex(paths);
const indexConstructionMs = performance.now() - buildStart;
const legacy = path => files.has(path) || [...files.keys()].some(file => file.startsWith(path + '/'));
const indexed = path => index.exists(path);
const measure = callback => {
  const samples = [];
  let count = 0;
  for (let iteration = 0; iteration < 60; iteration++) {
    const start = performance.now();
    for (const query of queries) count += callback(query) ? 1 : 0;
    const elapsed = performance.now() - start;
    if (iteration >= 10) samples.push(elapsed);
  }
  samples.sort((first, second) => first - second);
  return { medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)], count };
};
console.log(JSON.stringify({ benchmark: '100 directory Exists queries over 20000 paths; excludes index construction',
  runtime: process.version, machine: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  indexConstructionMs, before: measure(legacy), after: measure(indexed), counters: index.counters }, null, 2));
