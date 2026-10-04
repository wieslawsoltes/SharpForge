import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeWorkspace, NativeMSBuild} from '@sharpforge/msbuild/node';
import {qualifyMSBuildCorpus} from '../../packages/msbuild/src/evaluation-differential.js';
import {msbuildDifferentialCorpus} from './corpus.js';
import {evaluatePortableFixture} from './portable.js';

/** Execute real native MSBuild queries for the committed corpus and retain exact version/command provenance. */
export async function runNativeEvaluationCorpus(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-evaluation-'));
  let engine;
  try {
    if (options.sdkVersion) await writeFile(join(root, 'global.json'), JSON.stringify({sdk: {version: options.sdkVersion, rollForward: 'disable'}}));
    const workspace = await NativeWorkspace.open(root);
    engine = new NativeMSBuild(workspace, {executable: options.executable ?? 'dotnet', trusted: true});
    const probe = await engine.probe();
    if (!probe.available) throw new Error(probe.error);
    const boundaryPath = fileURLToPath(new URL('../../packages/project-system/src/evaluation/boundary.json', import.meta.url));
    const boundary = JSON.parse(await readFile(boundaryPath, 'utf8'));
    return await qualifyMSBuildCorpus({corpus: options.corpus ?? msbuildDifferentialCorpus, boundary, signal: options.signal,
      reference: {tool: 'native dotnet msbuild', version: probe.version, sdk: options.sdkVersion ?? null,
        platform: process.platform, node: process.version, nativeQualification: true},
      evaluatePortable: evaluatePortableFixture,
      evaluateNative: async (fixture, {signal}) => {
        const directory = join(root, fixture.id);
        for (const file of fixture.files) {
          const path = join(directory, file.path);
          await mkdir(dirname(path), {recursive: true});
          await writeFile(path, file.text);
        }
        const project = fixture.id + '/Test.csproj';
        const propertyNames = [...new Set(['MSBuildProjectName', ...fixture.propertyNames])];
        const args = ['msbuild', project, '-nologo', '-verbosity:quiet', '-p:Configuration=Debug', '-getProperty:' + propertyNames.join(',')];
        if (fixture.itemNames.length) args.push('-getItem:' + fixture.itemNames.join(','));
        const output = await engine.runTool({arguments: args, project, trusted: true, timeoutMs: 60_000}, {signal});
        if (output.exitCode !== 0) throw new Error('Native evaluation failed: ' + output.stdout + output.stderr);
        const first = output.stdout.indexOf('{');
        const last = output.stdout.lastIndexOf('}');
        if (first < 0 || last < first) throw new Error('Native MSBuild returned no structured query output');
        return {result: JSON.parse(output.stdout.slice(first, last + 1)), workspaceRoot: directory,
          command: [engine.executable, ...args], version: probe.version};
      }});
  } finally {
    await engine?.close();
    await rm(root, {recursive: true, force: true});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const report = await runNativeEvaluationCorpus({executable: process.env.SHARPFORGE_DOTNET ?? 'dotnet', sdkVersion: process.env.SHARPFORGE_SDK});
  const text = JSON.stringify(report, null, 2) + '\n';
  const output = process.argv.indexOf('--output');
  if (output >= 0) await writeFile(process.argv[output + 1], text);
  else process.stdout.write(text);
  if (!report.success) process.exitCode = 1;
}
