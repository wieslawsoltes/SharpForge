import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeWorkspace, NativeMSBuild, createDesignTimeRequest } from '@sharpforge/msbuild/node';
import { parseCscArguments } from '@sharpforge/msbuild';

test('ten independently recorded SDK Csc command lines preserve expected compiler option objects', {
  skip: process.env.SHARPFORGE_DOTNET ? false : 'Set SHARPFORGE_DOTNET to record the SDK compiler command-line corpus',
  timeout: 90000
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf-csc-corpus-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = process.env.SHARPFORGE_NATIVE_SDK ?? '10.0.201';
  const framework = 'net' + sdk.split('.')[0] + '.0';
  await mkdir(join(root, 'Library'));
  await mkdir(join(root, 'App'));
  await writeFile(join(root, 'global.json'), JSON.stringify({ sdk: { version: sdk, rollForward: 'disable' } }));
  await writeFile(join(root, 'NuGet.Config'), '<configuration><packageSources><clear/></packageSources></configuration>');
  await writeFile(join(root, 'Library/Library.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
    + `<TargetFramework>${framework}</TargetFramework></PropertyGroup></Project>`);
  await writeFile(join(root, 'Library/Library.cs'), 'public class Library { public static int Answer() => 42; }');
  await writeFile(join(root, 'App/App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
    + `<TargetFramework>${framework}</TargetFramework><EnableNETAnalyzers>false</EnableNETAnalyzers>`
    + '</PropertyGroup><ItemGroup><Reference Include="Library">'
    + `<HintPath>../Library/bin/Debug/${framework}/Library.dll</HintPath><Aliases>oracle</Aliases></Reference>`
    + '<AdditionalFiles Include="data.json"/><EditorConfigFiles Include=".editorconfig"/>'
    + '<Analyzer Include="$(MSBuildSDKsPath)/Microsoft.NET.Sdk/analyzers/Microsoft.CodeAnalysis.CSharp.NetAnalyzers.dll"/>'
    + '</ItemGroup></Project>');
  await writeFile(join(root, 'App/Program.cs'), 'class Program { static void Main() { } }');
  await writeFile(join(root, 'App/data.json'), '{}');
  await writeFile(join(root, 'App/.editorconfig'), 'root = true\n');
  const workspace = await NativeWorkspace.open(root);
  const engine = new NativeMSBuild(workspace, { executable: process.env.SHARPFORGE_DOTNET, trusted: true });
  t.after(() => engine.close());
  for (const [project, action] of [['Library/Library.csproj', 'build'], ['App/App.csproj', 'restore']]) {
    const result = await engine.wait((await engine.start({ project, action, restore: action === 'build', trusted: true })).id);
    assert.equal(result.status, 'succeeded', result.error);
  }
  const records = [];
  for (let index = 0; index < 10; index++) {
    const expected = { langVersion: index % 2 ? '12.0' : 'preview', nullable: index % 2 ? 'enable' : 'disable',
      unsafe: index % 3 === 0, checked: index % 3 === 1, target: index % 2 ? 'exe' : 'library',
      allWarningsAsErrors: index % 3 === 2, define: 'RECORDED_' + index, warning: String(1600 + index) };
    const request = createDesignTimeRequest({ project: 'App/App.csproj', trusted: true, properties: {
      DefineConstants: expected.define, LangVersion: expected.langVersion, Nullable: expected.nullable,
      AllowUnsafeBlocks: String(expected.unsafe), CheckForOverflowUnderflow: String(expected.checked),
      OutputType: expected.target === 'exe' ? 'Exe' : 'Library', TreatWarningsAsErrors: String(expected.allWarningsAsErrors),
      NoWarn: expected.warning, WarningsAsErrors: '0168', WarningsNotAsErrors: '0618'
    } });
    const job = await engine.wait((await engine.start(request)).id);
    assert.equal(job.status, 'succeeded', job.error);
    const arguments_ = job.result.Items.CscCommandLineArgs.map(item => item.Identity);
    assert(arguments_.length > 20);
    const parsed = parseCscArguments(arguments_);
    for (const key of ['langVersion', 'nullable', 'unsafe', 'checked', 'target', 'allWarningsAsErrors']) {
      assert.equal(parsed[key], expected[key], 'Case ' + index + ': ' + key);
    }
    assert(parsed.defines.includes(expected.define));
    assert(parsed.noWarn.includes(expected.warning));
    assert(parsed.warningsAsErrors.includes('0168'));
    assert(parsed.warningsNotAsErrors.includes('0618'));
    assert(parsed.references.some(reference => reference.path.endsWith('Library.dll') && reference.aliases.includes('oracle')));
    assert(parsed.additionalFiles.some(path => path.endsWith('data.json')));
    assert(parsed.analyzerConfigFiles.some(path => path.endsWith('.editorconfig')));
    assert(parsed.analyzers.some(path => path.endsWith('Microsoft.CodeAnalysis.CSharp.NetAnalyzers.dll')));
    assert(parsed.output.endsWith('App.dll'));
    assert(parsed.sources.some(path => path.endsWith('Program.cs')));
    assert(parsed.unknown.includes('/noconfig'), 'Unmodeled compiler switches must survive parsing');
    records.push({ expected, arguments: arguments_, parsed });
  }
  assert.equal(new Set(records.map(record => JSON.stringify(record.arguments))).size, 10);
  const corpus = { sdk, node: process.version, platform: process.platform, architecture: process.arch, records };
  if (process.env.SHARPFORGE_CSC_CORPUS) await writeFile(process.env.SHARPFORGE_CSC_CORPUS, JSON.stringify(corpus, null, 2) + '\n');
  t.diagnostic(JSON.stringify({ sdk, node: process.version, recordedCommands: records.length, expectedOptionsVerified: true,
    unknownSwitchesPreserved: true, artifact: process.env.SHARPFORGE_CSC_CORPUS ?? null }));
});
