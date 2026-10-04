import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, freemem, loadavg, release, totalmem } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const baselineCommit = 'c1693a9e322295a43d90c3335885b5b5b3cf8daa';
const implementationCommit = '7da8bdc75f834c1ebaa2c4b2585461fca80d7c97';
const candidateRoot = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const protocol = Object.freeze({ warmup: 20, samples: 100, iterations: 20 });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();

function argumentsFor(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--baseline', '--output'].includes(key) || !args[index + 1] || Object.hasOwn(values, key)) {
      throw Error('Usage: benchmark-decompiler-inventory.mjs --baseline /path/to/c1693a9e --output /path/to/result.json');
    }
    values[key] = args[index + 1];
  }
  assert(values['--baseline'] && values['--output'], 'Both --baseline and --output are required');
  return { baseline: realpathSync(resolve(values['--baseline'])), output: resolve(values['--output']) };
}

function sourceHash(directory) {
  const entries = [];
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      assert(!entry.isSymbolicLink(), 'Package source must not alias another checkout');
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) entries.push({ path: relative(directory, path).replaceAll('\\', '/'),
        sha256: sha256(readFileSync(path)) });
    }
  }
  visit(directory);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { files: entries.length, sha256: sha256(JSON.stringify(entries)),
    algorithm: 'SHA-256 of JSON array of sorted relative path/content-SHA-256 records' };
}

function checkout(root, sourceRevision, exactHead) {
  const commit = git(root, 'rev-parse', 'HEAD');
  if (exactHead) assert.equal(commit, sourceRevision, 'Baseline must be actual merged main c1693a9e');
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=no'), '', 'Tracked benchmark checkout must be clean');
  git(root, 'diff', '--exit-code', sourceRevision, '--', ':(glob)packages/*/src/**',
    ':(glob)packages/*/package.json', 'tests/managed-fixtures.js', 'tests/fixtures/decompiler-cfg');
  const packages = new Map();
  function visit(name, importer) {
    const directory = join(root, 'packages', name.slice('@sharpforge/'.length));
    const expected = join(directory, 'src/index.js');
    const actual = realpathSync(createRequire(importer).resolve(name));
    assert.equal(realpathSync(expected), expected, 'Selected package must not alias another source directory');
    assert.equal(actual, expected, name + ' must resolve inside its own selected checkout');
    if (packages.has(name)) return;
    const manifestBytes = readFileSync(join(directory, 'package.json'));
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.name, name);
    packages.set(name, { name, entry: actual, manifestSha256: sha256(manifestBytes), source: sourceHash(join(directory, 'src')) });
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      if (dependency.startsWith('@sharpforge/')) visit(dependency, actual);
    }
  }
  visit('@sharpforge/cil', join(root, 'package.json'));
  return { root, commit, tree: git(root, 'rev-parse', 'HEAD^{tree}'), sourceRevision, packages: [...packages.values()] };
}

function priorResult(result) {
  const { inventory, sourceComplete, ...prior } = result;
  return prior;
}

function physicalRows(library, bytes) {
  const inspector = new library.MetadataTableInspector(bytes);
  const tables = inspector.tables().map((table) => ({ table: table.table, name: table.name, rowCount: table.rowCount,
    present: table.present, externalRowCount: table.externalRowCount, columns: table.columns,
    rows: Array.from({ length: table.rowCount }, (_, index) => {
      const row = inspector.row(table.table * 0x1000000 + index + 1, { resolveTokens: false });
      return { token: row.token, rowId: row.rowId, fileOffset: row.fileOffset, metadataOffset: row.metadataOffset,
        streamOffset: row.streamOffset, byteLength: row.byteLength,
        raw: table.columns.map((column) => row.columns[column.name].raw),
        strings: Object.fromEntries(table.columns.filter((column) => column.kind === 'str')
          .map((column) => [column.name, row.columns[column.name].value])) };
    }) }));
  inspector.dispose();
  return tables;
}

function guardInventory(actual, expected, methods) {
  assert(actual.accountingComplete && !actual.sourceComplete);
  assert.equal(actual.tables.length, expected.length);
  let total = 0;
  for (const [index, table] of actual.tables.entries()) {
    const reference = expected[index];
    for (const key of ['table', 'name', 'rowCount', 'present', 'externalRowCount', 'columns']) {
      assert.deepEqual(table[key], reference[key], 'Inventory table ' + key);
    }
    assert.equal(table.rows.length, reference.rows.length);
    assert.equal(table.rendered + table.summarized + table.unsupported, table.rowCount);
    for (const [rowIndex, row] of table.rows.entries()) {
      const source = reference.rows[rowIndex];
      for (const key of ['token', 'rowId', 'fileOffset', 'metadataOffset', 'streamOffset', 'byteLength', 'raw']) {
        assert.deepEqual(row[key], source[key], 'Inventory physical row ' + key);
      }
      assert.equal(row.table, table.table);
      assert.equal(row.tableName, table.name);
      assert(['rendered', 'summarized', 'unsupported'].includes(row.status));
      if (row.summary) assert.deepEqual(row.summary.strings, source.strings);
      if (row.renderedOutput) assert.equal(methods[row.renderedOutput.resultIndex].token, row.token);
      total++;
    }
  }
  assert.equal(actual.totalRows, total);
  assert.equal(actual.accountedRows, total);
  assert.equal(actual.rendered + actual.summarized + actual.unsupported, total);
}

function prepareCase(sample, libraries) {
  const inspectors = {};
  const initial = {};
  for (const variant of ['baseline', 'candidate']) {
    inspectors[variant] = new libraries[variant].AssemblyInspector(sample.bytes.slice());
    initial[variant] = libraries[variant].decompileAssembly(inspectors[variant]);
    assert.deepEqual(libraries[variant].decompileAssembly(sample.bytes), initial[variant], 'Byte and cached API output');
  }
  assert(!Object.hasOwn(initial.baseline, 'inventory'), 'Baseline unexpectedly includes metadata inventory');
  assert(!Object.hasOwn(initial.baseline, 'sourceComplete'), 'Baseline source contract changed');
  assert.deepEqual(priorResult(initial.candidate), initial.baseline, 'Every prior assembly/method output must match');
  const physical = physicalRows(libraries.baseline, sample.bytes);
  assert.deepEqual(physicalRows(libraries.candidate, sample.bytes), physical, 'Common metadata reader facts');
  guardInventory(initial.candidate.inventory, physical, initial.baseline.methods);
  return { ...sample, inspectors, expected: structuredClone(initial.baseline),
    expectedInventory: structuredClone(initial.candidate.inventory), physical };
}

function workloads(cases, libraries, inventoryCore, inventoryContracts) {
  const result = [];
  for (const sample of cases) {
    const guard = (value, variant) => {
      assert.deepEqual(priorResult(value), sample.expected, 'Every prior assembly/method output after timing');
      if (variant === 'candidate') {
        assert.equal(value.sourceComplete, false);
        guardInventory(value.inventory, sample.physical, sample.expected.methods);
        assert.deepEqual(value.inventory, sample.expectedInventory, 'Stable owned inventory');
      }
      return value.source.length + value.methods.length + (value.inventory?.accountedRows ?? 0);
    };
    for (const mode of ['bytes', 'cachedInspector']) for (const variant of ['baseline', 'candidate']) {
      result.push({ case: sample.name, name: 'decompileAssembly.' + mode, variant,
        operation: () => libraries[variant].decompileAssembly(mode === 'bytes' ? sample.bytes : sample.inspectors[variant]),
        consume: (value) => guard(value, variant) });
    }
    result.push({ case: sample.name, name: 'inventoryOnly.cachedInspector', variant: 'candidate',
      operation: () => inventoryCore.finishMetadataInventory(
        inventoryCore.createMetadataInventory(sample.inspectors.candidate, inventoryContracts.inventoryOptions()), sample.expected.methods),
      consume: (value) => {
        guardInventory(value, sample.physical, sample.expected.methods);
        assert.deepEqual(value, sample.expectedInventory, 'Isolated inventory equals the public API inventory');
        return value.accountedRows + value.summaryBytes;
      } });
  }
  return result;
}

function measure(cases, operations) {
  const chronologicalSamples = [];
  let checksum = 0;
  globalThis.gc?.();
  for (let round = -protocol.warmup; round < protocol.samples; round++) {
    const variants = Math.abs(round) % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (let slot = 0; slot < cases.length; slot++) {
      const sample = cases[(slot + Math.abs(round)) % cases.length];
      for (const variant of variants) for (const operation of operations.filter((item) => item.case === sample.name && item.variant === variant)) {
        const returned = new Array(protocol.iterations);
        const before = process.memoryUsage();
        const start = performance.now();
        for (let iteration = 0; iteration < protocol.iterations; iteration++) returned[iteration] = operation.operation();
        const elapsedMs = performance.now() - start;
        const after = process.memoryUsage();
        // Consume and fully compare every retained result after the timing and memory interval.
        let consumed = 0;
        for (const value of returned) consumed += operation.consume(value);
        checksum = (checksum + consumed) >>> 0;
        chronologicalSamples.push({ sequence: chronologicalSamples.length, round, phase: round < 0 ? 'warmup' : 'measured',
          case: sample.name, workload: operation.name, variant, elapsedMs,
          batchMeanNanosecondsPerCall: elapsedMs * 1_000_000 / protocol.iterations, consumed,
          batchHeapDeltaBytes: after.heapUsed - before.heapUsed, batchArrayBufferDeltaBytes: after.arrayBuffers - before.arrayBuffers });
      }
    }
  }
  return { chronologicalSamples, checksum };
}

function distribution(values) {
  const ordered = [...values].sort((left, right) => left - right);
  assert.equal(ordered.length, protocol.samples);
  return { median: (ordered[49] + ordered[50]) / 2, p95: ordered[Math.ceil(ordered.length * 0.95) - 1],
    p99: ordered[Math.ceil(ordered.length * 0.99) - 1] };
}

function summaries(operations, samples) {
  return operations.map((operation) => {
    const matching = samples.filter((sample) => sample.phase === 'measured' && sample.case === operation.case &&
      sample.workload === operation.name && sample.variant === operation.variant);
    return { case: operation.case, workload: operation.name, variant: operation.variant, measuredSamples: matching.length,
      batchMeanNanosecondsPerCall: distribution(matching.map((sample) => sample.batchMeanNanosecondsPerCall)),
      batchHeapDeltaBytes: distribution(matching.map((sample) => sample.batchHeapDeltaBytes)),
      batchArrayBufferDeltaBytes: distribution(matching.map((sample) => sample.batchArrayBufferDeltaBytes)) };
  });
}

const args = argumentsFor(process.argv.slice(2));
assert.notEqual(args.baseline, candidateRoot, 'Baseline and candidate must use separate checkouts');
assert(!existsSync(args.output), 'Keep each controlled run: the output must be a new file');
for (const root of [candidateRoot, args.baseline]) {
  const path = relative(root, args.output);
  assert(path === '..' || path.startsWith('..' + sep) || isAbsolute(path), 'Save benchmark output outside both checkouts');
}
const revisions = { baseline: checkout(args.baseline, baselineCommit, true), candidate: checkout(candidateRoot, implementationCommit, false) };
const libraries = {
  baseline: await import(pathToFileURL(join(args.baseline, 'packages/cil/src/index.js')).href),
  candidate: await import(pathToFileURL(join(candidateRoot, 'packages/cil/src/index.js')).href),
};
const { arithmeticLibrary } = await import(pathToFileURL(join(candidateRoot, 'tests/managed-fixtures.js')).href);
const inventoryCore = await import(pathToFileURL(join(candidateRoot, 'packages/cil/src/decompiler/inventory.js')).href);
const inventoryContracts = await import(pathToFileURL(join(candidateRoot, 'packages/cil/src/decompiler/inventory-contracts.js')).href);
const fixturePath = join(candidateRoot, 'tests/fixtures/decompiler-cfg/native.json');
const fixtureBytes = readFileSync(fixturePath);
const reference = JSON.parse(fixtureBytes);
const nativeBytes = new Uint8Array(Buffer.from(reference.image, 'base64'));
assert.equal(sha256(nativeBytes), reference.imageSha256);
assert.equal(reference.toolchain.runtime, '10.0.5');
const cases = [{ name: 'ArithmeticAssembly', bytes: arithmeticLibrary() }, { name: 'NativeCfgAssembly', bytes: nativeBytes }]
  .map((sample) => prepareCase(sample, libraries));
const operations = workloads(cases, libraries, inventoryCore, inventoryContracts);
const environment = { capturedAt: new Date().toISOString(), node: process.version, v8: process.versions.v8,
  platform: process.platform, architecture: process.arch, osRelease: release(), cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytes: freemem(), loadAverage: loadavg(),
  execArgv: process.execArgv, gcExposed: typeof globalThis.gc === 'function', sharedHost: true };
const measured = measure(cases, operations);
const results = summaries(operations, measured.chronologicalSamples);
const comparisons = results.filter((result) => result.variant === 'baseline').map((baseline) => {
  const candidate = results.find((result) => result.case === baseline.case && result.workload === baseline.workload && result.variant === 'candidate');
  return { case: baseline.case, workload: baseline.workload,
    medianWholeApiChangePercent: (candidate.batchMeanNanosecondsPerCall.median / baseline.batchMeanNanosecondsPerCall.median - 1) * 100 };
});
const report = { format: 'sharpforge.decompiler-inventory-benchmark', version: 1, revisions, environment,
  driverSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  fixtureSources: [{ path: 'tests/managed-fixtures.js', sha256: sha256(readFileSync(join(candidateRoot, 'tests/managed-fixtures.js'))) },
    { path: 'tests/fixtures/decompiler-cfg/native.json', sha256: sha256(fixtureBytes) }],
  fixtures: cases.map((sample) => ({ name: sample.name, imageSha256: sha256(sample.bytes), imageBytes: sample.bytes.length,
    methods: sample.expected.methods.length, rows: sample.expectedInventory.totalRows,
    priorOutputSha256: sha256(JSON.stringify(sample.expected)), inventorySha256: sha256(JSON.stringify(sample.expectedInventory)) })),
  protocol: { ...protocol, clock: 'performance.now', variantOrder: 'alternates each round', caseOrder: 'rotates each round',
    median: 'mean of the two central measured samples', p95AndP99: 'nearest rank', rawWarmupsRetained: true,
    sampleStatistic: '20-call batch mean in ns/call; p95/p99 are percentiles of batch means, not individual-call tail latency',
    timing: 'Only API calls and storing returned references; all comparisons, consumption and memory observations are outside timing' },
  interpretation: 'New inventory output cost and net whole-assembly API overhead; no same-output speedup claim.',
  limitations: ['Shared host scheduling, GC and load can affect samples.',
    'Each batch retains 20 results until its memory observation; observed heap deltas are not allocation counters.',
    'Correctness checks precede measurement and follow every batch; no process-cold latency is measured.',
    'The default bytes workload includes parsing/inspector construction; cachedInspector prewarms those phases.',
    'Whole-API changes include replacing the old full-summary name lookup; inventoryOnly isolates the new census/classification.',
    'Native fixtures are retained observations; this benchmark does not compile or execute native code.'],
  correctness: { everyPriorMethodOutput: true, everyPhysicalMetadataRow: true, stableInventory: true },
  allocationCounter: null, results, comparisons, ...measured };
writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: args.output, results, comparisons }, null, 2));
