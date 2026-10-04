import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (checkout, ...parameters) => execFileSync('git', ['-C', checkout, ...parameters], { encoding: 'utf8' }).trim();
assert.ok(option('--compiler') && option('--output'), 'Specify trusted local --compiler and new --output paths');
const compilerEntry = realpathSync(resolve(option('--compiler')));
const checkout = realpathSync(resolve(dirname(compilerEntry), '../../..'));
assert.equal(compilerEntry, join(checkout, 'packages/compiler/src/index.js'));
const compilerRequire = createRequire(pathToFileURL(compilerEntry));
const dependencies = JSON.parse(readFileSync(join(checkout, 'packages/compiler/package.json'))).dependencies;
const aliases = Object.keys(dependencies).filter(name => name.startsWith('@sharpforge/')).map(name => {
  const actual = realpathSync(compilerRequire.resolve(name));
  const expected = realpathSync(join(checkout, 'packages', name.slice('@sharpforge/'.length), 'src/index.js'));
  assert.equal(actual, expected, `${name} must resolve inside the selected checkout`);
  return { name, path: actual, ownCheckout: true };
});
const headerMode = option('--headers');
assert.ok(['legacy', 'auto'].includes(headerMode), 'Specify expected --headers legacy or auto');
const workload = option('--workload');
assert.ok(['controls', 'corpus'].includes(workload), 'Specify --workload controls or corpus');
const sourcePath = fileURLToPath(new URL(`../../../tests/fixtures/a03-method-headers/${workload}.cs`, import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const compilerRevision = git(checkout, 'rev-parse', 'HEAD');
if (headerMode === 'legacy') assert.equal(compilerRevision, 'e60b0764782f1122439e5b161cb9494c75724e32');
assert.equal(git(checkout, 'status', '--porcelain', '--untracked-files=no'), '', 'Freeze tracked compiler sources before measurement');
const driverPath = fileURLToPath(import.meta.url);
const report = { schemaVersion: 1, workload, headerMode, compilerEntry, compilerRevision, aliases,
  compilerEntrySHA256: hash(readFileSync(compilerEntry)), driverPath, driverSHA256: hash(readFileSync(driverPath)),
  driverRevision: git(resolve(dirname(driverPath), '../../..'), 'rev-parse', 'HEAD'),
  sourcePath, sourceSHA256: hash(source), sourceBytes: Buffer.byteLength(source),
  node: process.version, arguments: process.argv, nodeArguments: process.execArgv,
  platform: process.platform, architecture: process.arch, osRelease: release(), cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, totalMemoryBytes: totalmem(), samplesMs: [], heapUsedDeltas: [], qualified: false };
const output = resolve(option('--output'));
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
try {
  // Nothing from either CIL/compiler checkout was imported before this timer.
  const importStart = performance.now();
  const { compileToAssembly } = await import(pathToFileURL(compilerEntry).href);
  report.compilerImportMs = performance.now() - importStart;
  const options = { name: 'HeaderBenchmark', outputKind: 'library', allowUnsafe: true };
  let first;
  for (let index = 0; index < 121; index++) {
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    const result = compileToAssembly(source, options);
    report.samplesMs.push(performance.now() - start);
    report.heapUsedDeltas.push(process.memoryUsage().heapUsed - before);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    if (index !== 0) assert.deepEqual(result.assembly, first.assembly);
    else {
      first = result;
      const { AssemblyInspector, readMethodHeader } = await import(pathToFileURL(compilerRequire.resolve('@sharpforge/cil')).href);
      const inspector = new AssemblyInspector(first.assembly);
      report.methods = [...inspector.methods.values()].filter(method => method.rva).map(method => {
        const header = readMethodHeader(inspector.pe, method.token);
        const body = inspector.pe.methodBody(method.token);
        if (headerMode === 'legacy') assert.equal(header.headerSize, 12, method.name);
        else if (method.name === 'Empty' || method.name === 'Literal') assert.equal(header.headerSize, 1, method.name);
        if (method.name === 'DeepCall' || method.name === 'Filtered') assert.equal(header.headerSize, 12, method.name);
        return { name: method.name, token: method.token, ...header, codeSHA256: hash(body.code), handlers: body.handlers };
      });
      for (const name of ['Empty', 'Literal', ...(workload === 'corpus' ? ['DeepCall', 'Filtered', 'Patterns'] : ['Identity'])]) {
        assert.ok(report.methods.some(method => method.name === name), `Missing fixture method ${name}`);
      }
      report.assemblySHA256 = hash(first.assembly);
      report.assemblyBytes = first.assembly.length;
    }
  }
  const measured = report.samplesMs.slice(21).toSorted((left, right) => left - right);
  report.firstCompileMs = report.samplesMs[0];
  report.medianMs = (measured[49] + measured[50]) / 2;
  report.p95Ms = measured[94];
  report.p99Ms = measured[98];
  report.firstCompilations = 1;
  report.warmupCompilations = 20;
  report.measuredCompilations = 100;
  report.gcExposed = typeof globalThis.gc === 'function';
  report.timingNote = 'Fresh process; compiler import separate; 121 chronological compiles retained. Summary uses only final100.';
  report.memoryNote = 'Optional GC precedes each compilation; heapUsed deltas include temporary objects and are not allocation/retained-heap totals.';
  report.scope = 'Whole checkout e60b0764 to candidate; header/RVA/PE size changes are intentional. Method IL hashes remain separately reviewable.';
  report.qualified = true;
  save();
  console.log(JSON.stringify(report));
} catch (error) {
  report.failure = { name: error.name, message: error.message, stack: error.stack };
  save();
  throw error;
}
