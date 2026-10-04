# Effective import context reference

Capture with `scripts/validate-pdb-effective-imports.mjs --capture tests/fixtures/portable-pdb-effective-imports`.
The native Roslyn nested-namespace fixture matched all four SRM imports, including
an alias and a static type import. SDK/compiler/runtime and source/DLL/PDB hashes
are recorded in `reference.json`. Offline tests only read these files.

Product source: `e4d3705e10b58d6cb655b35f703fcc1227ebbcbd`.
Capture-only revision: `f2f03531e6ed6589e881fcd10c824c2345e5dda2`.
Before revision: `1db2e1d540a78403b7aaddcf472311fcde1a81ef`.

## Focused validation

Native capture passed using SDK 10.0.201 / compiler 5.3.0-2.26153.122 / CoreCLR 10.0.5.
All **89/89** focused tests passed, including seven new effective-import tests:

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 \
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a13-04-effective-imports.test.js tests/a13-01-imports-constants.test.js \
  tests/a13-01-module-contract.test.js tests/a13-01-native-cdi.test.js \
  tests/a13-04-local-constants.test.js tests/a13-04-nullable-constants.test.js \
  tests/a13-04-decimal-constants.test.js tests/a13-04-datetime-constants.test.js \
  tests/a13-04-enum-constants.test.js tests/portable-pdb.test.js
```

`npm run check` passed: 3,088 syntax / 3,084 static modules, zero errors;
30 area manifests, 789 Node files / 32 browser scripts, zero unassigned/duplicates.
`npm run check:structure` exited 0 with 268 existing repository findings and none
in changed files. Both ran through the serial limiter.

No broad matrix was run. Other engine/platform qualification remains separate.

## One fixed interleaved load comparison

The existing LocalConstants DLL/PDB contains eighteen constants and recorded
import scopes. This compares complete load startup, including the new snapshot;
it does not measure the new query API's throughput. Thirty warmups per revision,
twenty pairs alternating AB/BA, 100 loads per sample, explicit GC before each.
Both revisions check bound input and the same enum scalar. The before package
sources were archived from the exact revision with private workspace links.
The limiter waited for an existing host run before this comparison; no other
agent in this team was authorized to run validation. The host was shared.
No repeats, allocation measurements, speedup/significance or causal noise claims.
Median is the mean of sorted positions 10/11; p95 is nearest-rank position 19.
Neither result exceeds the 5% regression threshold.

| Per-load milliseconds | Before | After |
| --- | ---: | ---: |
| Median | 0.567482920 | 0.565602710 |
| p95 | 0.631360420 | 0.616627500 |

Host: darwin arm64 Apple M3 Pro; Node v24.21.0; started 2026-10-04T03:37:26.808Z.

Control assembly (12800 bytes) SHA-256:
`2bc24dbbe692eea3cabc20af34808395d8f3c649ff955b1116edc85cf7b33226`.

Control pdb (12180 bytes) SHA-256:
`4c4b2edea79e17147cec25dc25dc0543223525c69560b93ce203a855fec9b48e`.

Chronological samples (per-load values derive from unrounded elapsed milliseconds):

| Pair | Revision | Start offset ms | Elapsed ms | Per load ms |
| ---: | --- | ---: | ---: | ---: |
| 0 | before | 4.264625000000024 | 63.136041999999975 | 0.6313604199999997 |
| 0 | after | 71.24816700000002 | 61.66274999999996 | 0.6166274999999996 |
| 1 | after | 138.30587500000001 | 58.26075000000003 | 0.5826075000000003 |
| 1 | before | 200.651833 | 57.856833999999935 | 0.5785683399999993 |
| 2 | before | 261.738333 | 58.497292000000016 | 0.5849729200000001 |
| 2 | after | 323.49691700000005 | 61.09229099999993 | 0.6109229099999993 |
| 3 | after | 387.94729199999995 | 64.49866600000007 | 0.6449866600000007 |
| 3 | before | 455.616667 | 60.64337499999999 | 0.6064337499999999 |
| 4 | before | 520.271417 | 55.856583 | 0.55856583 |
| 4 | after | 579.345708 | 55.236375000000066 | 0.5523637500000007 |
| 5 | after | 637.50575 | 55.15945799999997 | 0.5515945799999997 |
| 5 | before | 695.58375 | 55.790250000000015 | 0.5579025000000002 |
| 6 | before | 754.3345830000001 | 52.819458999999824 | 0.5281945899999982 |
| 6 | after | 810.332917 | 54.71312499999999 | 0.54713125 |
| 7 | after | 867.913542 | 56.47087499999998 | 0.5647087499999998 |
| 7 | before | 927.2600829999999 | 56.36920900000018 | 0.5636920900000019 |
| 8 | before | 986.6910419999999 | 50.0412080000001 | 0.5004120800000009 |
| 8 | after | 1039.595458 | 55.439959000000044 | 0.5543995900000005 |
| 9 | after | 1098.244042 | 50.17366599999991 | 0.5017366599999992 |
| 9 | before | 1151.579667 | 57.04012499999999 | 0.5704012499999999 |
| 10 | before | 1211.90375 | 52.4072920000001 | 0.5240729200000009 |
| 10 | after | 1267.4575 | 55.7532920000001 | 0.557532920000001 |
| 11 | after | 1326.33075 | 49.04099999999994 | 0.4904099999999994 |
| 11 | before | 1378.462875 | 55.62395800000013 | 0.5562395800000013 |
| 12 | before | 1437.2015 | 54.30666700000006 | 0.5430666700000006 |
| 12 | after | 1496.331875 | 58.865332999999964 | 0.5886533299999996 |
| 13 | after | 1559.670333 | 56.64966699999991 | 0.566496669999999 |
| 13 | before | 1619.723333 | 58.855625000000146 | 0.5885562500000014 |
| 14 | before | 1682.299375 | 57.380916999999954 | 0.5738091699999995 |
| 14 | after | 1742.6685830000001 | 57.374209000000064 | 0.5737420900000006 |
| 15 | after | 1803.0548330000001 | 55.11204199999975 | 0.5511204199999975 |
| 15 | before | 1861.1359579999998 | 56.456458999999995 | 0.5645645899999999 |
| 16 | before | 1920.509208 | 56.15475000000015 | 0.5615475000000015 |
| 16 | after | 1979.5218329999998 | 58.585459000000355 | 0.5858545900000035 |
| 17 | after | 2041.004167 | 55.329957999999806 | 0.553299579999998 |
| 17 | before | 2099.345708 | 61.09245899999996 | 0.6109245899999997 |
| 18 | before | 2165.338708 | 66.13374999999996 | 0.6613374999999997 |
| 18 | after | 2235.221042 | 60.41258299999981 | 0.6041258299999981 |
| 19 | after | 2299.838208 | 58.04841699999997 | 0.5804841699999997 |
| 19 | before | 2361.875125 | 59.12258299999985 | 0.5912258299999985 |

## Exact host harness

Executed once with both concurrency limits set to 1:

```sh
node scripts/limited.js node --expose-gc /tmp/sharpforge-a13-imports-interleaved.mjs
```

```js
import { cpus, platform, arch } from 'node:os';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadSymbols as beforeLoad } from '/tmp/sharpforge-a13-imports-base/packages/symbols/src/index.js';
import { loadSymbols as afterLoad } from '/Users/wieslawsoltes/GitHub/SharpForge-a13-effective-imports/packages/symbols/src/index.js';

const directory = '/Users/wieslawsoltes/GitHub/SharpForge-a13-effective-imports/tests/fixtures/portable-pdb-local-constants';
const assembly = readFileSync(`${directory}/LocalConstants.dll`);
const pdb = readFileSync(`${directory}/LocalConstants.pdb`);
const revisions = {
  before: '1db2e1d540a78403b7aaddcf472311fcde1a81ef',
  after: 'f2f03531e6ed6589e881fcd10c824c2345e5dda2',
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
  workload: 'Existing LocalConstants load control; eighteen constants and recorded import scopes',
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
