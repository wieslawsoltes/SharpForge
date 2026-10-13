import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { genericFixture } from '../../../tests/clr-generics-instantiation-fixtures.js';

const [mode, outputPath, selectedPath] = process.argv.slice(2);
if (!['controls', 'service'].includes(mode) || !outputPath) {
  throw new Error('Use controls|service, an explicit output JSON path, and an optional CLR package entrypoint path');
}
const root = fileURLToPath(new URL('../../../', import.meta.url));
const modulePath = resolve(selectedPath ?? fileURLToPath(new URL('../src/index.js', import.meta.url)));
const implementationRoot = resolve(dirname(modulePath), '../../..');
const implementation = await import(pathToFileURL(modulePath));
const { arrayContext } = await import(pathToFileURL(resolve(implementationRoot, 'tests/clr-types-array-fixtures.js')));
const { graphContext } = await import(pathToFileURL(resolve(implementationRoot, 'tests/clr-types-graph-fixtures.js')));
const warmupCount = 10;
const sampleCount = 100;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (directory, args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', timeout: 10000 }).trim();

async function snapshot() {
  const directories = ['packages/clr/src', 'packages/cil/src'];
  const helpers = ['tests/clr-types-array-fixtures.js', 'tests/clr-types-graph-fixtures.js'];
  const selectedDirty = git(implementationRoot, ['status', '--porcelain', '--untracked-files=all', '--', ...directories, ...helpers]);
  if (selectedDirty) throw new Error(`The selected product and fixture helpers must be committed and clean: ${selectedDirty}`);
  const driverPaths = ['packages/clr/tools/benchmark-generic-instantiation.mjs', 'tests/clr-generics-instantiation-fixtures.js',
    'tests/managed-fixtures.js', 'tests/fixtures/clr-type-graphs/native-graphs.json'];
  const driverDirty = git(root, ['status', '--porcelain', '--untracked-files=all', '--', ...driverPaths]);
  if (driverDirty) throw new Error(`The measurement driver and inputs must be committed and clean: ${driverDirty}`);
  const products = [];
  for (const directory of directories) {
    const paths = execFileSync('git', ['ls-files', '-z', '--', directory], { cwd: implementationRoot, encoding: 'utf8' })
      .split('\0').filter(Boolean);
    const hash = createHash('sha256');
    for (const path of paths) {
      const bytes = await readFile(resolve(implementationRoot, path));
      hash.update(`${path}\0${bytes.length}\0`).update(bytes);
    }
    products.push({ directory, files: paths.length, gitTree: git(implementationRoot, ['rev-parse', `HEAD:${directory}`]),
      sha256: hash.digest('hex') });
  }
  const files = [];
  for (const path of driverPaths) files.push({ path, source: 'driver', sha256: digest(await readFile(resolve(root, path))) });
  for (const path of helpers) files.push({ path, source: 'selected implementation',
    sha256: digest(await readFile(resolve(implementationRoot, path))) });
  return { modulePath, commit: git(implementationRoot, ['rev-parse', 'HEAD']), products,
    driverCommit: git(root, ['rev-parse', 'HEAD']), files };
}

function summarize(samples) {
  const ordered = samples.map(sample => sample.microseconds).sort((left, right) => left - right);
  return { median: (ordered[49] + ordered[50]) / 2, p95: ordered[94] };
}

async function measure(operation) {
  const result = { name: operation.name, iterationsPerSample: operation.iterations, unit: 'microseconds/operation',
    asynchronous: operation.asynchronous !== false, warmups: [], samples: [], validatedOperations: 0 };
  report.results.push(result);
  for (let sample = 0; sample < warmupCount + sampleCount; sample++) {
    const state = operation.prepare ? await operation.prepare(operation.iterations) : null;
    const values = new Array(operation.iterations);
    const started = performance.now();
    if (operation.asynchronous === false) {
      for (let index = 0; index < operation.iterations; index++) values[index] = operation.run(index, state);
    } else {
      for (let index = 0; index < operation.iterations; index++) values[index] = await operation.run(index, state);
    }
    const elapsedMilliseconds = performance.now() - started;
    for (let index = 0; index < operation.iterations; index++) operation.validate(values[index], index, state);
    const target = sample < warmupCount ? result.warmups : result.samples;
    target.push({ sample: target.length, elapsedMilliseconds, microseconds: elapsedMilliseconds * 1000 / operation.iterations });
    result.validatedOperations += operation.iterations;
  }
  Object.assign(result, summarize(result.samples));
}

function requireIdentity(actual, expected) {
  if (!(actual instanceof implementation.TypeDesc) || actual !== expected || !actual.isLoaded) {
    throw new Error('Canonical loaded identity guard failed');
  }
}

function graphGuard(type, expected) {
  if (type.fullName !== expected.name || type.metadataToken !== expected.token || !type.isLoaded ||
      type.module.typeDefinition(expected.token) !== type || type.module.methodBodyReadCount !== 0) {
    throw new Error('Canonical metadata token, name, loaded graph or no-body-read guard failed');
  }
}

async function freshArrays(count) {
  return Array.from({ length: count }, () => {
    const types = arrayContext().types;
    return { types, integer: types.intrinsic('System.Int32') };
  });
}

async function controls() {
  const path = 'tests/fixtures/clr-type-graphs/native-graphs.json';
  const bytes = await readFile(resolve(root, path));
  const fixture = JSON.parse(bytes);
  const image = Uint8Array.from(Buffer.from(fixture.image, 'base64'));
  const expected = fixture.definitions.find(type => type.name === 'Fixture.Child');
  if (!expected) throw new Error('Pinned graph fixture has no expected child definition');
  const context = graphContext();
  const module = (await context.loadFromStream(image)).manifestModule;
  const canonical = await context.types.load(module, expected.token);
  graphGuard(canonical, expected);
  const arrays = arrayContext().types;
  const integer = arrays.intrinsic('System.Int32');
  const vector = arrays.szArray(integer);
  const signature = { returnType: integer, parameters: [integer] };
  const pointer = arrays.functionPointer(signature);
  report.inputs = [{ path, sha256: digest(bytes), imageSha256: digest(image), imageBytes: image.length }];
  return [
    { name: 'existing warm TypeDef graph lookup', iterations: 50000, run: () => context.types.load(module, expected.token),
      validate: value => requireIdentity(value, canonical) },
    { name: 'existing warm direct name lookup', iterations: 50000, run: () => context.types.find(module, expected.name),
      validate: value => requireIdentity(value, canonical) },
    { name: 'existing cold context, native image and non-generic graph', iterations: 100, run: async () => {
      const owner = graphContext();
      const assembly = await owner.loadFromStream(image);
      return owner.types.load(assembly.manifestModule, expected.token);
    }, validate: value => graphGuard(value, expected) },
    { name: 'existing warm vector lookup', iterations: 50000, asynchronous: false, run: () => arrays.szArray(integer),
      validate: value => requireIdentity(value, vector) },
    { name: 'existing warm function-pointer lookup', iterations: 50000, asynchronous: false, run: () => arrays.functionPointer(signature),
      validate: value => requireIdentity(value, pointer) },
    { name: 'existing cold vector with prepared framework context', iterations: 200, asynchronous: false, prepare: freshArrays,
      run: (index, owners) => owners[index].types.szArray(owners[index].integer), validate: (value, index, owners) => {
        requireIdentity(value, owners[index].types.szArray(owners[index].integer));
        if (value.interfaces.length !== 11 || value.elementType !== owners[index].integer) throw new Error('Vector shape guard failed');
      } },
    { name: 'existing cold function pointer with prepared framework context', iterations: 200, asynchronous: false, prepare: freshArrays,
      run: (index, owners) => owners[index].types.functionPointer({ returnType: owners[index].integer }),
      validate: (value, index, owners) => {
        requireIdentity(value, owners[index].types.functionPointer({ returnType: owners[index].integer }));
        if (value.signature.returnType !== owners[index].integer) throw new Error('Function-pointer shape guard failed');
      } },
  ];
}

async function services() {
  const fixture = genericFixture();
  async function open(options = {}) {
    const context = arrayContext(options);
    const module = (await context.loadFromStream(fixture.image)).manifestModule;
    const types = context.types;
    return { context, module, types, definition: module.typeDefinition(fixture.tokens.box),
      integer: types.intrinsic('System.Int32'), text: types.intrinsic('System.String') };
  }
  const owner = await open();
  if (typeof owner.types.instantiate !== 'function') throw new Error('Selected CLR has no instantiation service');
  const closed = await owner.types.instantiate(owner.definition, [owner.integer]);
  const pair = owner.module.typeDefinition(fixture.tokens.pair);
  const scopes = [{ typeArguments: [owner.integer], methodArguments: [owner.text] },
    { typeArguments: [owner.text], methodArguments: [owner.integer] }];
  const scoped = await Promise.all(scopes.map(scope => owner.types.load(owner.module, fixture.specs.scopePair, scope)));
  const parameter = owner.module.typeDefinition(fixture.tokens.other).genericParameters[0];
  const partial = await owner.types.instantiate(pair, [owner.text, parameter]);
  const plugin = await open({ isCollectible: true });
  const argument = await plugin.types.load(plugin.module, 0x02000002);
  const collectible = await owner.types.instantiate(owner.definition, [argument]);
  const secondPlugin = await open({ isCollectible: true });
  const secondArgument = await secondPlugin.types.load(secondPlugin.module, 0x02000002);
  const collectibleScope = { typeArguments: [argument], methodArguments: [secondArgument] };
  const scopedCollectible = await owner.types.load(owner.module, fixture.specs.scopePair, collectibleScope);
  report.inputs = [{ name: 'bounded generic fixture', imageSha256: digest(fixture.image), imageBytes: fixture.image.length }];
  return [
    { name: 'new warm closed generic identity', iterations: 50000, run: () => owner.types.instantiate(owner.definition, [owner.integer]),
      validate: value => requireIdentity(value, closed) },
    { name: 'new warm closed TypeSpec', iterations: 5000, run: () => owner.types.load(owner.module, fixture.specs.boxInteger),
      validate: value => requireIdentity(value, closed) },
    { name: 'new alternating VAR and MVAR environments', iterations: 5000,
      run: index => owner.types.load(owner.module, fixture.specs.scopePair, scopes[index & 1]),
      validate: (value, index) => requireIdentity(value, scoped[index & 1]) },
    { name: 'new warm partially open generic identity', iterations: 10000, run: () => owner.types.instantiate(pair, [owner.text, parameter]),
      validate: value => requireIdentity(value, partial) },
    { name: 'new warm collectible-argument identity', iterations: 10000, run: () => owner.types.instantiate(owner.definition, [argument]),
      validate: value => {
        requireIdentity(value, collectible);
        if (!value.isCollectible || value.loadContext !== owner.context) throw new Error('Collectible ownership guard failed');
      } },
    { name: 'new scoped TypeSpec with two collectible context monitors', iterations: 5000,
      run: () => owner.types.load(owner.module, fixture.specs.scopePair, collectibleScope), validate: value => {
        requireIdentity(value, scopedCollectible);
        if (!value.isCollectible || value.genericArguments[0] !== argument || value.genericArguments[1] !== secondArgument) {
          throw new Error('Scoped collectible context and argument guard failed');
        }
      } },
    { name: 'new cold context, image and substituted diamond graph', iterations: 100, run: async () => {
      const fresh = await open();
      return fresh.types.instantiate(fresh.module.typeDefinition(fixture.tokens.derived), [fresh.integer]);
    }, validate: value => {
      if (!value.isLoaded || value.genericDefinition.metadataToken !== fixture.tokens.derived ||
          value.baseType.genericArguments[0] !== value.genericArguments[0] || value.interfaces.length !== 3 ||
          value.module.methodBodyReadCount !== 0) throw new Error('Substituted diamond graph guard failed');
    } },
    { name: 'new cold tuple and graph with prepared loaded definition', iterations: 100, prepare: async count => {
      const owners = [];
      for (let index = 0; index < count; index++) {
        const fresh = await open();
        await fresh.types.load(fresh.module, fixture.tokens.box);
        owners.push(fresh);
      }
      return owners;
    }, run: (index, owners) => owners[index].types.instantiate(owners[index].definition, [owners[index].integer]),
    validate: (value, index, owners) => {
      if (!value.isLoaded || value.genericDefinition !== owners[index].definition ||
          value.genericArguments[0] !== owners[index].integer) throw new Error('Prepared generic identity guard failed');
    } },
  ];
}

const report = { format: 'sharpforge.clr-generic-instantiation-benchmark', version: 1, mode, status: 'running',
  startedAt: new Date().toISOString(), backend: 'host JavaScript CLR metadata service', sampleCount, warmupCount,
  environment: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
    osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, execArgv: process.execArgv,
    sharedMachine: true, concurrentActivity: 'not measured', forcedGc: false },
  measurement: { preparation: 'Fixture production and prepare callbacks are outside timing',
    timing: 'Lookup and result retention, including awaits for asynchronous operations; validation follows each timed batch',
    summary: '100 chronological samples after 10 warmups; median mean of middle two, p95 nearest rank',
    lifetimeChecks: 'Scoped collectible TypeSpecs include subscriptions, bounded root context checks and finally cleanup',
    allocationCounts: 'not measured', previousEquivalentImplementation: mode === 'controls' }, results: [] };
const save = () => writeFile(resolve(outputPath), JSON.stringify(report, null, 2) + '\n');
try {
  report.source = await snapshot();
  const operations = await (mode === 'controls' ? controls() : services());
  await save();
  for (const operation of operations) {
    await measure(operation);
    await save();
  }
  report.status = 'measured';
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message };
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
await save();
console.log(JSON.stringify({ status: report.status, mode, commit: report.source?.commit,
  results: report.results.map(({ warmups, samples, ...result }) => result), error: report.error }));
