export const baselineCommit = '31900dce5c1454c1f9c244c9ac14e1798eac3e5f';
export const productCommit = '02df6354e3152beac511d29b20272050ae03f486';
export const warmupBatches = 20;
export const measuredBatches = 100;
export const controls = Object.freeze([
  { id: 'readMetadata-small', fixture: 'small', api: 'metadata', operations: 128 },
  { id: 'readMetadata-real', fixture: 'real', api: 'metadata', operations: 64 },
  { id: 'readPE-small', fixture: 'small', api: 'pe', operations: 128 },
  { id: 'readPE-real', fixture: 'real', api: 'pe', operations: 64 },
].map(Object.freeze));
export const features = Object.freeze([
  { id: 'generation-construct', operations: 25 },
  { id: 'generation-append-first', operations: 25 },
  { id: 'generation-append-second', operations: 25 },
  { id: 'generation-map-entity', operations: 1000 },
  { id: 'generation-map-heap', operations: 1000 },
  { id: 'generation-row-latest', operations: 1000 },
  { id: 'generation-row-historical', operations: 1000 },
  { id: 'generation-heap-entry', operations: 400 },
].map(Object.freeze));
export const fixturePins = Object.freeze({
  structural: { path: 'tests/fixtures/a03-metadata/fixture.js', sha256: 'be9d1a02714df408b052a266fccd97df547f62b1199d734088439940b77c7594' },
  native: { path: 'tests/fixtures/decompiler-cfg/native.json', sha256: 'bfcaf0f930c76cdfd133565ffd5779f5e85258034f1fd2f21051a868d6a3cfc1',
    imageSha256: '53af64fc5a8db6df9b64fe46ab8e1518a33015a0aec0f33c2101d84edc750aa3', imageBytes: 11776 },
});
export const toolPaths = Object.freeze([
  'packages/cil/tools/benchmark-metadata-generations.mjs',
  'packages/cil/tools/metadata-generations-benchmark-worker.mjs',
  'packages/cil/tools/metadata-generations-benchmark-features.mjs',
  'packages/cil/tools/metadata-generations-benchmark-protocol.mjs',
  'packages/cil/tools/metadata-generations-benchmark-source.mjs',
  'packages/cil/tools/metadata-generations-benchmark-facts.mjs',
  'packages/cil/tools/metadata-generations-benchmark-measure.mjs',
  'tests/fixtures/metadata-generations/validation-plan.json',
  'tests/fixtures/metadata-generations/verify.mjs',
  'tests/fixtures/metadata-generations/replay.mjs',
  'scripts/conformance/perf/core.js', 'scripts/conformance/perf/alloc.js',
  'scripts/conformance/oracle/process.js', 'scripts/conformance/oracle/toolchain.js',
  'scripts/planning/schema/validate.js', 'scripts/limited.js', 'scripts/planning/lib/resource-limits.js',
  'scripts/conformance/static/allowlist.json',
]);
