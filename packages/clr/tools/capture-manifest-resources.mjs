import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2] ?? join(root, 'artifacts/clr-manifest-resources'));
const evidence = resolve(process.argv[3] ?? join(root, 'artifacts/clr-manifest-resources-capture'));
const resultPath = join(output, 'native-manifest-resources.json');
const dotnet = process.env.SHARPFORGE_ORACLE_DOTNET ?? 'dotnet';
const pin = Object.freeze({ sdk: '10.0.201', runtime: '10.0.5', referencePack: '10.0.5',
  metadataLoadContextSha256: '42fb03583ec0a097307dd94a0bb76f00cf18dd3241a8c8c93b9f28114dc06dfb' });
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const identity = path => ({ path: realpathSync(path), bytes: statSync(path).size, sha256: digest(path) });
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

if (existsSync(resultPath)) throw new Error(`Refusing to overwrite native fixture ${resultPath}`);
if (existsSync(evidence)) throw new Error(`Capture evidence directory must be fresh: ${evidence}`);
mkdirSync(evidence, { recursive: true });
const workspace = join(evidence, 'workspace');
mkdirSync(workspace);
const environment = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  DOTNET_CLI_HOME: join(workspace, 'cli-home'), DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: '1' };
const capture = { status: 'started', startedUtc: new Date().toISOString(), pin, output: resultPath,
  evidence, workspace, argv: process.argv, cwd: process.cwd(), steps: [] };
const statusPath = join(evidence, 'capture-status.json');
json(statusPath, capture);

function run(label, args) {
  const stem = `${String(capture.steps.length + 1).padStart(2, '0')}-${label}`;
  const startedUtc = new Date().toISOString();
  const result = spawnSync(dotnet, args, { cwd: workspace, timeout: 120000, maxBuffer: 32 * 1024 * 1024, env: environment });
  const stdout = join(evidence, `${stem}.stdout`), stderr = join(evidence, `${stem}.stderr`);
  writeFileSync(stdout, result.stdout ?? Buffer.alloc(0));
  writeFileSync(stderr, result.stderr ?? Buffer.alloc(0));
  const record = { label, argv: [dotnet, ...args], cwd: workspace, startedUtc, completedUtc: new Date().toISOString(),
    exitCode: result.status, signal: result.signal, error: result.error ? { message: result.error.message, code: result.error.code } : null,
    environment: { DOTNET_CLI_TELEMETRY_OPTOUT: environment.DOTNET_CLI_TELEMETRY_OPTOUT,
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: environment.DOTNET_SKIP_FIRST_TIME_EXPERIENCE,
      DOTNET_CLI_HOME: environment.DOTNET_CLI_HOME,
      DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: environment.DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE },
    stdout: identity(stdout), stderr: identity(stderr) };
  json(join(evidence, `${stem}-execution.json`), record);
  capture.steps.push(record);
  json(statusPath, capture);
  if (result.error || result.status !== 0) throw new Error(`${label} failed; original subprocess evidence retained in ${evidence}`);
  return result.stdout.toString('utf8');
}

function toolchain() {
  const sdk = run('sdk-version', ['--version']).trim();
  if (sdk !== pin.sdk) throw new Error(`Expected SDK ${pin.sdk}; found ${sdk}`);
  const sdkLine = run('sdk-inventory', ['--list-sdks']).split(/\r?\n/).find(line => line.startsWith(`${sdk} [`));
  if (!sdkLine?.endsWith(']')) throw new Error(`Cannot locate installed SDK ${sdk}`);
  const sdkRoot = sdkLine.slice(sdk.length + 2, -1), sdkDirectory = join(sdkRoot, sdk);
  const installation = dirname(sdkRoot);
  const runtimeLine = run('runtime-inventory', ['--list-runtimes']).split(/\r?\n/)
    .find(line => line.startsWith(`Microsoft.NETCore.App ${pin.runtime} [`));
  if (!runtimeLine?.endsWith(']')) throw new Error(`Required CoreCLR runtime ${pin.runtime} is absent`);
  const runtimeRoot = join(runtimeLine.slice(`Microsoft.NETCore.App ${pin.runtime} [`.length, -1), pin.runtime);
  const reader = identity(join(sdkDirectory, 'System.Reflection.MetadataLoadContext.dll'));
  if (reader.sha256 !== pin.metadataLoadContextSha256) throw new Error('MetadataLoadContext DLL differs from the pinned reader');
  const refRoot = join(installation, 'packs/Microsoft.NETCore.App.Ref', pin.referencePack, 'ref/net10.0');
  const referenceFiles = readdirSync(refRoot).filter(name => name.endsWith('.dll')).sort().map(name => identity(join(refRoot, name)));
  if (!referenceFiles.length) throw new Error('The pinned net10.0 reference pack is empty');
  const coreFiles = ['System.Private.CoreLib.dll', 'System.Runtime.dll', 'Microsoft.NETCore.App.runtimeconfig.json',
    'libcoreclr.so', 'libcoreclr.dylib', 'coreclr.dll'].filter(name => existsSync(join(runtimeRoot, name)));
  return { sdk, dotnet: identity(join(installation, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet')),
    compiler: ['csc.dll', 'Microsoft.CodeAnalysis.dll', 'Microsoft.CodeAnalysis.CSharp.dll']
      .map(name => identity(join(sdkDirectory, 'Roslyn/bincore', name))),
    runtime: { version: pin.runtime, files: coreFiles.map(name => identity(join(runtimeRoot, name))) },
    referencePack: { version: pin.referencePack, files: referenceFiles }, referenceReader: reader };
}

function prepare(reader) {
  copyFileSync(reader.path, join(workspace, 'System.Reflection.MetadataLoadContext.dll'));
  writeFileSync(join(workspace, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
  writeFileSync(join(workspace, 'global.json'), JSON.stringify({ sdk: { version: pin.sdk, rollForward: 'disable' } }));
  writeFileSync(join(workspace, 'oracle.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
    <TargetFramework>net10.0</TargetFramework><RuntimeFrameworkVersion>${pin.runtime}</RuntimeFrameworkVersion>
    <TargetLatestRuntimePatch>false</TargetLatestRuntimePatch><RollForward>Disable</RollForward>
    <ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><OutputType>Exe</OutputType>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems><Deterministic>true</Deterministic>
    <UseSharedCompilation>false</UseSharedCompilation></PropertyGroup><ItemGroup>
    <Compile Include="Images.cs" /><Compile Include="Program.cs" />
    <Reference Include="System.Reflection.MetadataLoadContext">
      <HintPath>System.Reflection.MetadataLoadContext.dll</HintPath>
    </Reference></ItemGroup></Project>`);
  const paths = ['Images.cs', 'Program.cs'].map(name => {
    const path = `tests/fixtures/clr-manifest-resources/${name}`;
    copyFileSync(join(root, path), join(workspace, name));
    return path;
  });
  const harness = 'packages/clr/tools/capture-manifest-resources.mjs';
  paths.push(harness);
  copyFileSync(join(root, harness), join(evidence, 'capture-manifest-resources.mjs'));
  return paths.map(path => ({ path, sha256: digest(join(root, path)) }));
}

try {
  capture.toolchain = toolchain();
  capture.sources = prepare(capture.toolchain.referenceReader);
  json(statusPath, capture);
  run('build', ['build', '--configuration', 'Release', '--nologo', '--verbosity', 'quiet', '--disable-build-servers', '-m:1']);
  const observations = JSON.parse(run('observe', [join(workspace, 'bin/Release/net10.0/oracle.dll'), join(workspace, 'images')]));
  if (observations.framework !== `.NET ${pin.runtime}`) throw new Error(`Unexpected observed runtime ${observations.framework}`);
  if (observations.files.length !== 24 || observations.cases.length !== 18) throw new Error('Native corpus file/case inventory changed');
  mkdirSync(output, { recursive: true });
  writeFileSync(resultPath, JSON.stringify({ sdk: capture.toolchain.sdk, sources: capture.sources,
    referenceReader: { name: 'System.Reflection.MetadataLoadContext.dll', sha256: capture.toolchain.referenceReader.sha256 },
    toolchain: capture.toolchain, ...observations }, null, 2) + '\n', { flag: 'wx' });
  capture.result = identity(resultPath);
  capture.status = 'completed';
  console.log(`Captured CoreCLR and MetadataLoadContext outcomes in ${resultPath}; retained build and raw evidence in ${evidence}`);
} catch (error) {
  capture.status = 'failed';
  capture.error = { name: error.name, message: error.message, stack: error.stack };
  throw error;
} finally {
  capture.completedUtc = new Date().toISOString();
  json(statusPath, capture);
}
