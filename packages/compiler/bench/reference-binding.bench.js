// Cost of compiling against real reference assemblies (the .NET reference pack of the installed SDK).
// Usage: node packages/compiler/bench/reference-binding.bench.js [--iterations 15] [--warmup 3]
// Prints JSON: reading and decoding the pack (cold, once), and per case the cold time and the median and p95 of the
// warm iterations of `compileToAssembly`. `registry` cases compile without references, for comparison; `perCall`
// decodes the references in every compilation (plain `{ bytes }` entries instead of a reference set).
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToAssembly } from '@sharpforge/compiler';
import { locateReferencePack, readReferenceFiles, loadReferencePack } from '@sharpforge/compiler/node';

const option = (name, fallback) => {
  const at = process.argv.indexOf('--' + name);
  return at < 0 ? fallback : process.argv[at + 1];
};
const iterations = Number(option('iterations', 15));
const warmup = Number(option('warmup', 3));
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'cil-emission', 'reference-fixtures');
const fixture = name => readFileSync(join(fixtures, name + '.cs'), 'utf8');
const hello = 'using System; class P { static void Main() { Console.WriteLine("hi " + 42); } }';
const round = value => Math.round(value * 100) / 100;
const percentile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];

const located = locateReferencePack();
if (!located) throw new Error('No .NET reference pack (packs/Microsoft.NETCore.App.Ref) was found; set DOTNET_ROOT');
const loadStart = performance.now();
const { references, pack } = loadReferencePack();
const loadMs = performance.now() - loadStart;
const undecoded = readReferenceFiles(pack.files);

function measure(source, options) {
  const compileOnce = () => {
    const result = compileToAssembly(source, { name: 'Bench', ...options });
    if (!result.assembly) throw new Error('Compilation failed: ' + JSON.stringify(result.diagnostics.slice(0, 2).map(entry => entry.message)));
  };
  const coldStart = performance.now();
  compileOnce();
  const coldMs = performance.now() - coldStart;
  for (let index = 0; index < warmup; index++) compileOnce();
  const times = [];
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    compileOnce();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { lines: source.split('\n').length, coldMs: round(coldMs), medianMs: round(percentile(times, 0.5)), p95Ms: round(percentile(times, 0.95)) };
}

const cases = {
  helloRegistry: [hello, {}],
  helloReferenceSet: [hello, { references }],
  helloPerCall: [hello, { references: undecoded }],
  linqReferenceSet: [fixture('linq'), { references }],
  frameworkTourReferenceSet: [fixture('framework-tour-2'), { references }],
};
const results = {};
for (const [name, [source, options]] of Object.entries(cases)) results[name] = measure(source, options);
console.log(
  JSON.stringify(
    {
      machine: `${platform()} ${arch()}, ${cpus().length} x ${cpus()[0]?.model}`,
      node: process.version,
      referencePack: `${pack.version} (${references.length} assemblies)`,
      readAndDecodePackMs: round(loadMs),
      iterations,
      results,
    },
    null,
    2,
  ),
);
