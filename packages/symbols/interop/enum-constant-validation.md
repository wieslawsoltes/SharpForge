# Local enum constant validation

Product revision: `945f58a4e818c604e7159c57eab2ea4eb5cfedba`.
Before revision: `753daab50cfca9efd277cb76fa00d50661cb0e4b`.

The old revision accepts an `int` LocalConstantSig targeting the captured local
`short` enum. The regression failed there with `Missing expected exception`.
The current focused set passed **74/74**, including seven new enum cases:

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 \
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a13-04-enum-constants.test.js tests/a13-04-nullable-constants.test.js \
  tests/a13-04-decimal-constants.test.js tests/a13-04-datetime-constants.test.js \
  tests/a13-04-local-constants.test.js tests/a13-01-imports-constants.test.js \
  tests/portable-pdb.test.js
```

Reference: retained `tests/fixtures/portable-pdb-local-constants` C# corpus;
SDK 10.0.201, compiler 5.3.0-2.26153.122 (4d3023de...), runtime 10.0.5.
The existing SRM capture records `Number : short`, value -1234 and type code 6.
No new native build or broader platform qualification was run.
`npm run check` passed: 3,047 syntax / 3,043 static modules, zero errors;
30 area manifests, 773 Node files / 32 browser scripts, zero unassigned/duplicates.
`npm run check:structure` exited 0 with no findings in changed files; existing
repository findings remain outside this slice. Both ran serially through the limiter.

## One fixed interleaved load comparison

Existing LocalConstants DLL/PDB, eighteen constants including one local short enum.
Thirty warmup loads per revision; twenty pairs alternating AB/BA, 100 loads per
sample, explicit GC before each sample. Both revisions check bound input and the
same enum scalar; only the new revision reports the enum type as verified.
The before package sources were archived from the exact git revision, with their
own workspace dependency links. No other agent validation job ran concurrently;
the host was shared. No repeats, allocation measurements, speedup, significance
or causal noise claims. Median is the mean of sorted positions 10/11; p95 is
nearest-rank position 19. The p95 increase is below the 5% regression threshold.

| Per-load milliseconds | Before | After |
| --- | ---: | ---: |
| Median | 0.538767710 | 0.532829785 |
| p95 | 0.560805830 | 0.578524580 |

Host: darwin arm64 Apple M3 Pro; Node v24.21.0; started 2026-10-04T03:08:17.494Z.

assembly (12800 bytes) SHA-256:
`2bc24dbbe692eea3cabc20af34808395d8f3c649ff955b1116edc85cf7b33226`.

pdb (12180 bytes) SHA-256:
`4c4b2edea79e17147cec25dc25dc0543223525c69560b93ce203a855fec9b48e`.

Chronological samples (per-load values derived from unrounded elapsed milliseconds):

| Pair | Revision | Start offset ms | Elapsed ms | Per load ms |
| ---: | --- | ---: | ---: | ---: |
| 0 | before | 2.669416999999953 | 57.62537500000002 | 0.5762537500000002 |
| 0 | after | 63.83208399999995 | 57.93995800000005 | 0.5793995800000005 |
| 1 | after | 125.31041699999997 | 55.32745799999998 | 0.5532745799999997 |
| 1 | before | 183.60437499999995 | 53.74354200000005 | 0.5374354200000004 |
| 2 | before | 239.95245899999992 | 56.08058300000005 | 0.5608058300000005 |
| 2 | after | 298.70858400000003 | 55.09566599999994 | 0.5509566599999993 |
| 3 | after | 356.883042 | 50.014625000000024 | 0.5001462500000002 |
| 3 | before | 409.99925 | 54.04970900000001 | 0.5404970900000001 |
| 4 | before | 467.70487499999996 | 49.86145899999997 | 0.4986145899999997 |
| 4 | after | 520.3041249999999 | 54.786749999999984 | 0.5478674999999998 |
| 5 | after | 578.7373749999999 | 47.19862499999999 | 0.47198624999999994 |
| 5 | before | 628.6904999999999 | 55.81766700000003 | 0.5581766700000003 |
| 6 | before | 687.5083749999999 | 51.24795900000004 | 0.5124795900000003 |
| 6 | after | 741.8543749999999 | 55.32670899999994 | 0.5532670899999994 |
| 7 | after | 800.2482089999999 | 53.39104100000009 | 0.5339104100000008 |
| 7 | before | 856.401709 | 55.43854099999999 | 0.5543854099999999 |
| 8 | before | 914.866959 | 48.88912499999992 | 0.4888912499999992 |
| 8 | after | 967.2832919999998 | 54.0825420000001 | 0.540825420000001 |
| 9 | after | 1024.2029169999998 | 52.39587500000016 | 0.5239587500000016 |
| 9 | before | 1079.366542 | 54.14499999999998 | 0.5414499999999998 |
| 10 | before | 1136.5091249999998 | 51.5685840000001 | 0.5156858400000011 |
| 10 | after | 1192.755917 | 57.85245800000007 | 0.5785245800000007 |
| 11 | after | 1253.504209 | 53.065000000000055 | 0.5306500000000005 |
| 11 | before | 1309.8473339999998 | 54.236625000000004 | 0.54236625 |
| 12 | before | 1367.0272089999999 | 47.62933300000009 | 0.4762933300000009 |
| 12 | after | 1417.301209 | 54.90062499999999 | 0.5490062499999999 |
| 13 | after | 1475.348084 | 47.865790999999945 | 0.47865790999999946 |
| 13 | before | 1525.895417 | 54.42645799999991 | 0.5442645799999991 |
| 14 | before | 1583.294209 | 48.453457999999955 | 0.48453457999999955 |
| 14 | after | 1634.329334 | 53.17491599999994 | 0.5317491599999994 |
| 15 | after | 1691.128125 | 48.01216700000009 | 0.4801216700000009 |
| 15 | before | 1742.1753749999998 | 54.01000000000022 | 0.5401000000000021 |
| 16 | before | 1799.1978749999998 | 48.99066700000003 | 0.4899066700000003 |
| 16 | after | 1851.373834 | 53.93904100000009 | 0.5393904100000009 |
| 17 | after | 1908.4384999999997 | 46.46545900000001 | 0.4646545900000001 |
| 17 | before | 1957.5607089999999 | 52.836291000000074 | 0.5283629100000007 |
| 18 | before | 2013.319959 | 47.63225000000011 | 0.47632250000000115 |
| 18 | after | 2063.5578339999997 | 53.113958000000366 | 0.5311395800000036 |
| 19 | after | 2119.684625 | 47.13437500000009 | 0.4713437500000009 |
| 19 | before | 2169.437084 | 54.90712499999972 | 0.5490712499999972 |

## Harness

Executed once through the limiter with both concurrency limits set to 1:

```sh
node scripts/limited.js node --expose-gc /tmp/sharpforge-a13-enum-interleaved.mjs
```

The exact host harness follows; paths identify the source archive and checkout.

```js
import { cpus, platform, arch } from 'node:os';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadSymbols as beforeLoad } from '/tmp/sharpforge-a13-enum-base/packages/symbols/src/index.js';
import { loadSymbols as afterLoad } from '/Users/wieslawsoltes/GitHub/SharpForge-a13-enum-constants/packages/symbols/src/index.js';

const directory = '/Users/wieslawsoltes/GitHub/SharpForge-a13-enum-constants/tests/fixtures/portable-pdb-local-constants';
const assembly = readFileSync(`${directory}/LocalConstants.dll`);
const pdb = readFileSync(`${directory}/LocalConstants.pdb`);
const revisions = {
  before: '753daab50cfca9efd277cb76fa00d50661cb0e4b',
  after: '945f58a4e818c604e7159c57eab2ea4eb5cfedba',
};
const loaders = { before: beforeLoad, after: afterLoad };
const observations = {};
for (const label of ['before', 'after']) {
  const symbols = loaders[label](assembly, pdb);
  const enumeration = symbols.constants.find((constant) => constant.name === 'Enumeration');
  if (!symbols.bound || !enumeration) throw Error('Missing bound enum fixture');
  if (enumeration.type !== 'short' || enumeration.value !== -1234) throw Error('Enum control mismatch');
  observations[label] = { constants: symbols.constants.length, enumType: enumeration.type, value: enumeration.value, verified: enumeration.enumTypeVerified ?? false };
}
for (let warmup = 0; warmup < 30; warmup++) {
  beforeLoad(assembly, pdb);
  afterLoad(assembly, pdb);
}
const chronologicalSamples = [];
const startedAt = new Date().toISOString();
const start = performance.now();
for (let pair = 0; pair < 20; pair++) {
  const order = pair % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
  for (const label of order) {
    globalThis.gc?.();
    const sampleStart = performance.now();
    for (let iteration = 0; iteration < 100; iteration++) {
      if (!loaders[label](assembly, pdb).bound) throw Error('Benchmark symbols were not bound');
    }
    const elapsedMs = performance.now() - sampleStart;
    chronologicalSamples.push({ pair, label, startOffsetMs: sampleStart - start, elapsedMs, perLoadMs: elapsedMs / 100 });
  }
}
const summaries = {};
for (const label of ['before', 'after']) {
  const values = chronologicalSamples.filter((sample) => sample.label === label).map((sample) => sample.perLoadMs).sort((left, right) => left - right);
  summaries[label] = { medianMs: (values[9] + values[10]) / 2, p95Ms: values[18] };
}
console.log(JSON.stringify({
  revisions,
  workload: 'Existing LocalConstants load; eighteen constants including one local short enum',
  node: process.version,
  host: `${platform()} ${arch()} ${cpus()[0].model}`,
  startedAt,
  protocol: { warmupsPerRevision: 30, pairs: 20, loadsPerSample: 100, order: 'AB/BA alternating', gcBeforeEachSample: true, median: 'mean of positions10and11', p95: 'nearest-rank position19' },
  fixtures: {
    assemblyBytes: assembly.byteLength,
    assemblySha256: createHash('sha256').update(assembly).digest('hex'),
    pdbBytes: pdb.byteLength,
    pdbSha256: createHash('sha256').update(pdb).digest('hex'),
  },
  observations,
  summaries,
  chronologicalSamples,
}, null, 2));
```
