import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeConfig } from '@sharpforge/cil';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourceDirectory = join(root, 'packages/clr/interop/GenericInstantiation');
const driver = 'packages/clr/tools/capture-generic-instantiation.mjs';
const pin = Object.freeze({ sdk: '10.0.201', runtime: '10.0.5', framework: 'net10.0' });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function optionsOf(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    if (!['--dotnet', '--output'].includes(option) || !arguments_[index + 1] || Object.hasOwn(options, option)) {
      throw new Error('Usage: capture-generic-instantiation.mjs --dotnet /absolute/dotnet --output directory');
    }
    options[option] = arguments_[index + 1];
  }
  const executable = options['--dotnet'] ?? process.env.SHARPFORGE_ORACLE_DOTNET ?? process.env.DOTNET_PATH ?? process.env.DOTNET;
  if (!executable || !isAbsolute(executable)) throw new Error('An absolute pinned dotnet host path is required.');
  return { dotnet: realpathSync(executable),
    output: resolve(options['--output'] ?? join(root, 'artifacts/clr-generic-instantiation')) };
}

const options = optionsOf(process.argv.slice(2));
if (['native-instantiation.json', 'capture-inputs.json', 'capture-status.json'].some(name => existsSync(join(options.output, name)))) {
  throw new Error('Native capture already exists; select a fresh output directory to retain previous evidence.');
}
mkdirSync(options.output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'sharpforge-generic-instantiation-'));
const staged = join(temporary, 'source');
const imagesDirectory = join(temporary, 'images');
const commands = [];
const environment = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  DOTNET_NOLOGO: '1', DOTNET_MULTILEVEL_LOOKUP: '0', DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: '1' };

function run(label, arguments_) {
  const record = { label, executable: options.dotnet, arguments: arguments_, cwd: temporary, startedUtc: new Date().toISOString() };
  commands.push(record);
  const result = spawnSync(options.dotnet, arguments_, {
    cwd: temporary, env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  record.finishedUtc = new Date().toISOString();
  record.exitCode = result.status;
  record.signal = result.signal;
  record.status = result.error || result.status !== 0 ? 'failed' : 'passed';
  writeFileSync(join(options.output, label + '.stdout.txt'), result.stdout ?? '');
  writeFileSync(join(options.output, label + '.stderr.txt'), result.stderr ?? '');
  if (record.status !== 'passed') {
    throw new Error(label + ': ' + (result.error?.message ?? result.stderr ?? 'native process failed'));
  }
  return result.stdout.trim();
}

function preserveImages() {
  if (!existsSync(imagesDirectory)) return;
  for (const name of readdirSync(imagesDirectory).sort()) {
    if (name.endsWith('.dll') || name.endsWith('.runtimeconfig.json')) {
      copyFileSync(join(imagesDirectory, name), join(options.output, name));
    }
  }
}

function git(arguments_) {
  return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).trim();
}

try {
  mkdirSync(staged);
  mkdirSync(imagesDirectory);
  writeFileSync(join(temporary, 'global.json'), JSON.stringify({
    sdk: { version: pin.sdk, rollForward: 'disable', allowPrerelease: false },
  }));
  writeFileSync(join(temporary, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
  const sourceNames = readdirSync(sourceDirectory).filter(name => name.endsWith('.cs')).sort();
  for (const required of ['FixtureTypes.cs', 'Program.cs', 'TypeObservations.cs', 'SignatureObservations.cs',
    'MetadataImages.cs', 'CaseMatrix.cs', 'LifetimeObservations.cs']) {
    assert.ok(sourceNames.includes(required), 'Required native source is absent: ' + required);
  }
  const sources = sourceNames.map(name => {
    const bytes = readFileSync(join(sourceDirectory, name));
    writeFileSync(join(staged, name), bytes);
    return { path: 'packages/clr/interop/GenericInstantiation/' + name, sha256: sha256(bytes) };
  });
  sources.push({ path: driver, sha256: sha256(readFileSync(join(root, driver))) });
  const inputs = { schemaVersion: 1, pin, head: git(['rev-parse', 'HEAD']),
    trackedChanges: git(['status', '--porcelain', '--untracked-files=all', '--', sourceDirectory, join(root, driver)]),
    node: process.version, platform: process.platform, architecture: process.arch,
    dotnet: options.dotnet, dotnetSha256: sha256(readFileSync(options.dotnet)), sources };
  writeFileSync(join(options.output, 'capture-inputs.json'), JSON.stringify(inputs, null, 2) + '\n');

  const sdk = run('sdk-version', ['--version']);
  assert.equal(sdk, pin.sdk, 'global.json must select the exact SDK');
  const sdkLine = run('sdk-list', ['--list-sdks']).split(/\r?\n/).find(line => line.startsWith(pin.sdk + ' ['));
  const sdkDirectory = sdkLine?.match(/\[(.*)\]$/)?.[1];
  assert.ok(sdkDirectory, 'The selected SDK installation must be observable');
  const compiler = join(sdkDirectory, pin.sdk, 'Roslyn/bincore/csc.dll');
  const referenceDirectory = join(dirname(sdkDirectory), 'packs/Microsoft.NETCore.App.Ref', pin.runtime, 'ref', pin.framework);
  const references = readdirSync(referenceDirectory).filter(name => name.endsWith('.dll')).sort();
  assert.ok(references.length > 0, 'The pinned reference pack must be installed');
  const referenceHashes = references.map(name => ({ name, sha256: sha256(readFileSync(join(referenceDirectory, name))) }));
  const compilerVersion = run('compiler-version', [compiler, '-version']);
  const common = [compiler, '-nologo', '-noconfig', '-nostdlib+', '-langversion:14.0', '-nullable:enable',
    '-unsafe+', '-deterministic+', '-optimize+', '-debug-', '-pathmap:' + staged + '=/src/GenericInstantiation',
    ...references.map(name => '-r:' + join(referenceDirectory, name))];
  const fixturePath = join(imagesDirectory, 'Fixture.dll');
  const observerPath = join(imagesDirectory, 'GenericInstantiationOracle.dll');
  run('compile-fixture', [...common, '-target:library', '-out:' + fixturePath, join(staged, 'FixtureTypes.cs')]);
  run('compile-observer', [...common, '-target:exe', '-out:' + observerPath, '-r:' + fixturePath,
    ...sourceNames.filter(name => name !== 'FixtureTypes.cs').map(name => join(staged, name))]);
  writeFileSync(join(imagesDirectory, 'GenericInstantiationOracle.runtimeconfig.json'),
    JSON.stringify(createRuntimeConfig({ version: pin.runtime, rollForward: 'Disable' }), null, 2) + '\n');
  const observed = JSON.parse(run('native-observer', [observerPath, imagesDirectory]));
  assert.equal(observed.schemaVersion, 2);
  assert.equal(observed.runtime, pin.runtime);
  assert.equal(observed.architecture, process.arch === 'ia32' ? 'x86' : process.arch);
  const cases = new Map(observed.cases.map(item => [item.id, item]));
  assert.equal(cases.size, observed.cases.length, 'Native case IDs must be unique');
  assert.equal(observed.cases.length, 101, 'The complete native case matrix must be present');
  assert.equal(observed.lifetime.reference.cases.length, 7, 'The complete lifetime case matrix must be present');
  for (const identity of observed.identities) {
    const unavailable = [identity.left, identity.right].filter(id => {
      assert.ok(cases.has(id), 'Identity endpoint must be an observed case');
      return !cases.get(id).result;
    });
    assert.deepEqual(identity.unavailable, unavailable);
    assert.equal(identity.status, unavailable.length ? 'unavailable' : 'observed');
    if (unavailable.length) assert.equal(identity.same, null, 'Unavailable identity is not a ReferenceEquals result');
    else assert.equal(typeof identity.same, 'boolean');
  }
  assert.ok(Object.hasOwn(cases.get('null-arguments').request, 'arguments'), 'Explicit null arguments must survive JSON serialization');
  assert.equal(cases.get('null-arguments').request.arguments, null);
  assert.equal(Object.hasOwn(cases.get('scope-no-environment').request, 'typeArguments'), false);
  assert.equal(Object.hasOwn(cases.get('scope-no-environment').request, 'methodArguments'), false);
  for (const id of ['definition-box', 'box-integer', 'scope-pair-open', 'metadata-detachedInner',
    'nested-closed', 'circular-inheritance', 'wrapped-pointer-argument', 'wrapped-function-argument']) {
    assert.ok(cases.has(id), 'Required native case is absent: ' + id);
  }
  const nativeImages = [{ id: 'fixture', file: 'Fixture.dll', assemblyName: 'Fixture' }, ...observed.images].map(image => {
    const bytes = readFileSync(join(imagesDirectory, image.file));
    return { ...image, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const reference = { ...observed, sdk, compilerVersion, compilerSha256: sha256(readFileSync(compiler)),
    referencePack: pin.runtime, referenceAssemblies: referenceHashes, sources, images: nativeImages,
    observerSha256: sha256(readFileSync(observerPath)),
    runtimeConfigSha256: sha256(readFileSync(join(imagesDirectory, 'GenericInstantiationOracle.runtimeconfig.json'))),
    captureInputSha256: sha256(readFileSync(join(options.output, 'capture-inputs.json'))) };
  preserveImages();
  writeFileSync(join(options.output, 'native-instantiation.json'), JSON.stringify(reference, null, 2) + '\n');
  writeFileSync(join(options.output, 'capture-status.json'), JSON.stringify({ status: 'passed', sdk, runtime: observed.runtime,
    cases: observed.cases.length, lifetimeCases: observed.lifetime.reference.cases.length, commands }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', sdk, runtime: observed.runtime, cases: observed.cases.length,
    lifetimeCases: observed.lifetime.reference.cases.length, output: options.output }, null, 2));
} catch (error) {
  preserveImages();
  writeFileSync(join(options.output, 'capture-status.json'), JSON.stringify({ status: 'failed', error: error.message, commands }, null, 2) + '\n');
  throw error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
