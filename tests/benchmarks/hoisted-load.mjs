import { cpus, platform, arch } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadSymbols } from '@sharpforge/symbols';

const directory =
  process.env.SF_BENCH_FIXTURES ?? fileURLToPath(new URL('../fixtures/portable-pdb-hoisted-locals/', import.meta.url));
const assembly = readFileSync(join(directory, 'HoistedLocals.dll'));
const pdb = readFileSync(join(directory, 'HoistedLocals.pdb'));
for (let warmup = 0; warmup < 30; warmup++) loadSymbols(assembly, pdb);
const samples = [];
for (let sample = 0; sample < 15; sample++) {
  globalThis.gc?.();
  const start = performance.now();
  for (let iteration = 0; iteration < 100; iteration++) {
    if (!loadSymbols(assembly, pdb).bound) throw Error('Benchmark symbols were not bound');
  }
  samples.push((performance.now() - start) / 100);
}
samples.sort((left, right) => left - right);
console.log(
  JSON.stringify(
    {
      revision: process.env.SF_BENCH_REVISION ?? null,
      node: process.version,
      host: `${platform()} ${arch()} ${cpus()[0].model}`,
      samples: 15,
      loadsPerSample: 100,
      medianMs: samples[7],
      p95Ms: samples[14],
      assemblyBytes: assembly.byteLength,
      pdbBytes: pdb.byteLength,
    },
    null,
    2,
  ),
);
