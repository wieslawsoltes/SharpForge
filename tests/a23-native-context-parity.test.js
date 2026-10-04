import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectSystem } from '@sharpforge/project-system';
import { Workspace } from '@sharpforge/workspace';
import { NativeWorkspace } from '../packages/msbuild/src/workspace.js';
import { NativeMSBuild } from '../packages/msbuild/src/engine.js';
import { DesignTimeBuildService } from '../packages/msbuild/src/design-time.js';
import {
  createProjectContext, contextFromPortableEvaluation, projectContextCompilationInput
} from '../packages/msbuild/src/project-context.js';
import { discoverSdkEnvironment } from '../packages/msbuild/src/sdk-discovery.js';

test('context compilation input preserves generated flags and rejects unhydrated documents explicitly', () => {
  const context = createProjectContext({ project: 'App.csproj', sources: [{ path: 'Program.cs' }],
    generatedSources: [{ path: 'obj/Generated.cs', text: '// generated', generated: true, readOnly: true }],
    defines: ['B', 'A'], langVersion: '12.0' });
  assert.throws(() => projectContextCompilationInput(context), { code: 'SFMSB_CONTEXT_SOURCE_MISSING', path: 'Program.cs' });
  const input = projectContextCompilationInput(context, new Map([['Program.cs', 'Console.WriteLine(42);']]));
  assert.equal(input.files[1].readOnly, true);
  assert.equal(input.files[1].generated, true);
  assert.equal(input.options.langVersion, '12');
  assert.deepEqual(input.options.defines, ['A', 'B']);
});

test('actual native and portable contexts build language workspaces with equal sources and options', {
  skip: process.env.SHARPFORGE_DOTNET ? false : 'Set SHARPFORGE_DOTNET for native/portable IDE context parity', timeout: 90000
}, async t => {
  const executable = process.env.SHARPFORGE_DOTNET;
  const inventory = await discoverSdkEnvironment({ executable });
  const sdk = process.env.SHARPFORGE_NATIVE_SDK ?? inventory.sdks.at(-1)?.version;
  assert(sdk, inventory.error);
  const framework = 'net' + sdk.split('.')[0] + '.0';
  const root = await mkdtemp(join(tmpdir(), 'sf-context-parity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'App'));
  const sources = new Map([
    ['global.json', JSON.stringify({ sdk: { version: sdk, rollForward: 'disable' } })],
    ['NuGet.Config', '<configuration><packageSources><clear/></packageSources></configuration>'],
    ['App/App.csproj', '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
      + `<TargetFramework>${framework}</TargetFramework><OutputType>Exe</OutputType>`
      + '<LangVersion>12.0</LangVersion><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings>'
      + '<GenerateAssemblyInfo>false</GenerateAssemblyInfo><GenerateTargetFrameworkAttribute>false</GenerateTargetFrameworkAttribute>'
      + '<DisableImplicitFrameworkDefines>true</DisableImplicitFrameworkDefines><DefineConstants>PROJECT</DefineConstants>'
      + '<WarningLevel>4</WarningLevel><NoWarn>1701;1702</NoWarn><AllowUnsafeBlocks>true</AllowUnsafeBlocks>'
      + '<CheckForOverflowUnderflow>true</CheckForOverflowUnderflow></PropertyGroup></Project>'],
    ['App/Program.cs', 'var values = new List<int>(); values.Add(42); Console.WriteLine(values[0]);']
  ]);
  for (const [path, text] of sources) await writeFile(join(root, path), text);
  const disk = await NativeWorkspace.open(root);
  const engine = new NativeMSBuild(disk, { executable, trusted: true });
  t.after(() => engine.close());
  const restore = await engine.wait((await engine.start({ project: 'App/App.csproj', action: 'restore', trusted: true })).id);
  assert.equal(restore.status, 'succeeded', restore.error);
  const native = (await new DesignTimeBuildService(engine).context({ project: 'App/App.csproj', trusted: true })).context;
  const system = new ProjectSystem([...sources].map(([path, text]) => ({ path, text })));
  system.load('App/App.csproj');
  const portable = contextFromPortableEvaluation(system.projects.get('App/App.csproj'));
  const nativeInput = projectContextCompilationInput(native, sources);
  const portableInput = projectContextCompilationInput(portable, sources);
  assert.deepEqual(nativeInput.files.map(file => file.uri).sort(), portableInput.files.map(file => file.uri).sort());
  assert.deepEqual(nativeInput.options, portableInput.options);
  for (const input of [nativeInput, portableInput]) {
    const workspace = new Workspace({ compilationOptions: input.options });
    for (const file of input.files) workspace.update(file.uri, file.text, file.version);
    const result = workspace.compile();
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  }
  const generated = native.generatedSources.find(source => source.path.endsWith('GlobalUsings.g.cs'));
  assert(generated.readOnly);
  assert.match(generated.text, /global using (?:global::)?System\.Linq;/);
  assert(native.references.some(reference => reference.path.endsWith('System.Linq.dll')));
  await assert.rejects(readFile(join(root, `App/bin/Debug/${framework}/App.dll`)), { code: 'ENOENT' });
  t.diagnostic(JSON.stringify({ sdk, platform: process.platform, architecture: process.arch,
    sourceSetsEqual: true, compilerOptionsEqual: true, nativeGeneratedLinqUsing: true,
    note: 'Console/List bind through generated usings; Enumerable metadata binding is a separate IDE qualification.' }));
});
