import { cpus, platform, arch } from 'node:os';
import { bindSources } from '@sharpforge/symbols';

function fixture(methodCount) {
  const methods = Array.from({ length: methodCount }, (_, index) => ({ token: 0x06000001 + index, points: [] }));
  const scopes = Array.from({ length: methodCount * 2 }, (_, index) => ({
    methodToken: methods[index % methodCount].token,
    start: index,
    end: index + 10,
    variables: Array.from({ length: 5 }, (_, slot) => ({ name: 'local-' + slot, index: slot, hidden: false })),
  }));
  return { documents: [], methods, scopes };
}

const cases = [];
for (const methodCount of [250, 1000, 4000]) {
  const symbols = fixture(methodCount);
  for (let warmup = 0; warmup < 3; warmup++) bindSources(symbols);
  const samples = [];
  let result;
  for (let iteration = 0; iteration < 15; iteration++) {
    const start = performance.now();
    result = bindSources(symbols);
    samples.push(performance.now() - start);
  }
  if (result.methods.reduce((count, method) => count + method.locals.length, 0) !== methodCount * 10) {
    throw Error('Projection benchmark output was incomplete');
  }
  samples.sort((left, right) => left - right);
  cases.push({
    methods: methodCount,
    scopes: symbols.scopes.length,
    locals: methodCount * 10,
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
  });
}
console.log(
  JSON.stringify(
    {
      revision: process.env.SF_BENCH_REVISION ?? null,
      node: process.version,
      host: `${platform()} ${arch()} ${cpus()[0].model}`,
      samples: 15,
      cases,
    },
    null,
    2,
  ),
);
