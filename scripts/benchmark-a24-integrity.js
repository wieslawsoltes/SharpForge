import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {buildSolutionTree} from '@sharpforge/project-system';

const root = fileURLToPath(new URL('../', import.meta.url));
const reference = process.argv[2] ?? '2706a82';
const temporary = await mkdtemp(join(tmpdir(), 'sharpforge-explorer-benchmark-'));
const baselinePath = join(temporary, 'baseline.mjs');
const original = execFileSync('git', ['show', reference + ':packages/project-system/src/explorer.js'], {cwd: root, encoding: 'utf8'});
const baselineSource = original
  .replace("'./paths.js'", JSON.stringify(new URL('../packages/project-system/src/paths.js', import.meta.url).href))
  .replace("'./xml.js'", JSON.stringify(new URL('../packages/project-system/src/xml.js', import.meta.url).href));
await writeFile(baselinePath, baselineSource);
const baseline = (await import(pathToFileURL(baselinePath).href)).buildSolutionTree;
const files = Array.from({length: 10000}, (_, index) => ({path: `App${index % 5}/Folder${index % 37}/File${index}.cs`}));
const projects = Array.from({length: 5}, (_, index) => ({path: `App${index}/App.csproj`, name: 'App' + index,
  targetFramework: 'net10.0', compile: files.filter(file => file.path.startsWith(`App${index}/`))}));
const input = {files, snapshot: {solution: {path: 'Benchmark.slnx'}, projects}};
const count = nodes => nodes.reduce((total, node) => total + 1 + count(node.children ?? []), 0);
const measure = builder => {
  const times = [];
  let nodes = 0;
  const beforeHeap = process.memoryUsage().heapUsed;
  for (let iteration = 0; iteration < 21; iteration++) {
    const started = performance.now();
    const result = builder(input);
    times.push(performance.now() - started);
    nodes = count(result);
  }
  const heapDelta = process.memoryUsage().heapUsed - beforeHeap;
  const cold = times.shift();
  times.sort((left, right) => left - right);
  return {coldMs: cold, medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * .95) - 1],
    p99Ms: times[Math.ceil(times.length * .99) - 1], observedHeapDeltaBytes: heapDelta, nodes};
};
try {
  console.log(JSON.stringify({node: process.version, platform: process.platform, architecture: process.arch,
    reference, files: files.length, warmSamples: 20, before: measure(baseline), after: measure(buildSolutionTree)}, null, 2));
} finally { await rm(temporary, {recursive: true, force: true}); }
