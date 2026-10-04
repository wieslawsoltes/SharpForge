import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeWorkspace, NativeMSBuild, NativeTestAdapter} from '@sharpforge/msbuild/node';
import {discoverPortableTests, runPortableTests} from '@sharpforge/msbuild';
import {frameworkFixtures, nativeFixtureProject} from './framework-fixtures.js';

/** Compare real native names and TRX outcomes against both portable execution engines, without fabricating missing reference results. */
export async function qualifyFrameworkFixtures(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-test-parity-'));
  let engine;
  let adapter;
  const cases = [];
  try {
    if (options.sdkVersion) await writeFile(join(root, 'global.json'), JSON.stringify({sdk: {version: options.sdkVersion, rollForward: 'disable'}}));
    const workspace = await NativeWorkspace.open(root);
    engine = new NativeMSBuild(workspace, {executable: options.executable ?? 'dotnet', trusted: true});
    adapter = new NativeTestAdapter({host: engine, workspace});
    const probe = options.nativeUnavailable ? null : await engine.probe();
    for (const fixture of frameworkFixtures) {
      const project = fixture.framework + '/Tests.csproj';
      const source = {uri: fixture.framework + '/Tests.cs', text: fixture.source};
      await mkdir(join(root, fixture.framework));
      await writeFile(join(root, project), nativeFixtureProject(fixture, options.targetFramework));
      await writeFile(join(root, source.uri), fixture.source);
      const discovery = await discoverPortableTests([source], {project});
      const portable = {};
      for (const backend of ['source', 'cil']) portable[backend] = await runPortableTests(discovery, {backend});
      if (options.nativeUnavailable) {
        cases.push({framework: fixture.framework, packages: fixture.packages, nativeExecuted: false,
          status: 'native-unavailable', error: options.nativeUnavailable, portable, success: false});
        continue;
      }
      try {
        const nativeDiscovery = await adapter.discover({project, trusted: true, timeoutMs: 120_000}, {sourceTests: discovery.tests});
        const run = await adapter.run({project, trusted: true, noBuild: true, coverage: true, timeoutMs: 120_000}, {sourceTests: discovery.tests});
        const nativeNames = nativeDiscovery.tests.map(test => test.displayName).sort();
        const portableNames = discovery.tests.map(test => test.displayName).sort();
        const differences = [];
        if (JSON.stringify(nativeNames) !== JSON.stringify(portableNames)) differences.push({kind: 'discovery', nativeNames, portableNames});
        const nativeOutcomes = new Map(run.results.map(result => [result.testId, result.outcome]));
        for (const [backend, result] of Object.entries(portable)) for (const test of result.results) {
          if (nativeOutcomes.get(test.testId) !== test.outcome) differences.push({kind: 'outcome', backend, testId: test.testId,
            fqn: test.fqn, displayName: test.displayName, portable: test.outcome, native: nativeOutcomes.get(test.testId) ?? 'missing'});
        }
        cases.push({framework: fixture.framework, packages: fixture.packages, nativeExecuted: true, differences,
          discovery: {nativeNames, portableNames}, portable, native: run, success: !differences.length && !run.diagnostics.length});
      } catch (error) {
        cases.push({framework: fixture.framework, packages: fixture.packages, nativeExecuted: false,
          status: 'native-unavailable', error: error.message, output: error.output, portable, success: false});
      }
    }
    return {schemaVersion: 1, reference: {sdk: options.sdkVersion ?? null, msbuild: probe?.version ?? null, node: process.version,
      platform: process.platform}, cases, success: cases.every(value => value.success)};
  } finally {
    await adapter?.close();
    await engine?.close();
    await rm(root, {recursive: true, force: true});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await qualifyFrameworkFixtures({executable: process.env.SHARPFORGE_DOTNET ?? 'dotnet', sdkVersion: process.env.SHARPFORGE_SDK,
    nativeUnavailable: process.env.SHARPFORGE_NATIVE_TESTS_UNAVAILABLE});
  const text = JSON.stringify(result, null, 2) + '\n';
  const output = process.argv.indexOf('--output');
  if (output >= 0) await writeFile(process.argv[output + 1], text);
  else process.stdout.write(text);
  if (!result.success) process.exitCode = 1;
}
