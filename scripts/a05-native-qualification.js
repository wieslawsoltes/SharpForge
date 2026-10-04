import {spawnSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeQualificationPlan} from './a05/native-plan.js';
import {runNativePlan} from './a05/native-run.js';
import {nativeCheckoutProvenance, requireNativeCheckout} from './a05/native-provenance.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const usage = `Usage: node scripts/a05-native-qualification.js [options]
  --output directory       Evidence root (default artifacts/a05-native).
  --sdk version            Require this exact installed SDK; CI also pins global.json.
  --framework net8.0       Target framework (default the selected SDK major).
  --list                   Print the serial plan without starting native processes.
  --finalize               Record an explicit setup/interruption failure if no completed report exists.
Run with node scripts/limited.js outside CI. Unsupported SDK policies are recorded, never counted as passes.`;
const options = {output: resolve(root, 'artifacts/a05-native'), sdk: process.env.SHARPFORGE_A05_SDK,
  framework: process.env.DOTNET_TARGET_FRAMEWORK, list: false, finalize: false};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === '--help') { console.log(usage); process.exit(0); }
  if (argument === '--list' || argument === '--finalize') { options[argument.slice(2)] = true; continue; }
  if (!['--output', '--sdk', '--framework'].includes(argument) || !args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error(usage);
  options[argument.slice(2)] = argument === '--output' ? resolve(args[++index]) : args[++index];
}
if (options.sdk && !/^\d+\.\d+\.\d+$/.test(options.sdk)) throw new Error('--sdk must be an exact SDK version');
if (options.framework && !/^net(?:8|10)\.0$/.test(options.framework)) throw new Error('Only net8.0 and net10.0 are qualified');

async function finalize() {
  await mkdir(options.output, {recursive: true});
  const path = join(options.output, 'qualification.json');
  let report;
  try { report = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (report?.finishedAt) return;
  report ??= {format: 'SharpForge.A05NativeQualification/1', task: 'SF-A05', cases: [], requestedSdk: options.sdk};
  if (!report.tree) {
    try { Object.assign(report, await nativeCheckoutProvenance({root})); }
    catch (error) { report.provenanceError = error.message; }
  }
  report.status = 'failed';
  report.passed = false;
  report.setupError = 'Qualification did not finish; inspect the workflow setup or interrupted process logs.';
  report.finishedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  process.exitCode = 1;
}

if (options.finalize) await finalize();
else if (options.list) {
  const framework = options.framework ?? `net${options.sdk?.split('.')[0] ?? 10}.0`;
  console.log(JSON.stringify(nativeQualificationPlan({...options, framework}), null, 2));
} else {
  const environment = {...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1'};
  const probes = [];
  const probe = (command, arguments_) => {
    const result = spawnSync(command, arguments_, {cwd: root, env: environment, encoding: 'utf8', timeout: 30000});
    probes.push({command, arguments: arguments_, exitCode: result.status, signal: result.signal,
      stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message});
    if (result.error || result.status !== 0 || result.signal) throw new Error('Environment probe failed: ' + command + ' ' + arguments_.join(' '));
    return result.stdout.trim();
  };
  const provenance = {revision: null, platform: process.platform, architecture: process.arch, node: process.version,
    requestedSdk: options.sdk ?? null, dotnetSdk: null, dotnetRuntimes: null,
    requestedSdkChannel: process.env.SHARPFORGE_A05_SDK_CHANNEL ?? null,
    resources: {nodeOptions: process.env.NODE_OPTIONS ?? null, concurrentCases: 1},
    runnerImage: {os: process.env.ImageOS ?? null, version: process.env.ImageVersion ?? null}, probes};
  let setupError = null;
  try {
    Object.assign(provenance, await nativeCheckoutProvenance({root, environment, probe}));
    requireNativeCheckout(provenance);
    provenance.dotnetSdk = probe(process.env.DOTNET_PATH ?? 'dotnet', ['--version']);
    provenance.dotnetRuntimes = probe(process.env.DOTNET_PATH ?? 'dotnet', ['--list-runtimes']);
    if (options.sdk && provenance.dotnetSdk !== options.sdk) throw new Error('SDK selection differs from requested version');
    if (![8, 10].includes(Number(provenance.dotnetSdk.split('.')[0]))) throw new Error('Only .NET SDK 8 and 10 are qualified');
  } catch (error) { setupError = error.message; }
  const framework = options.framework ?? `net${(options.sdk ?? provenance.dotnetSdk)?.split('.')[0] ?? 10}.0`;
  if (!setupError && Number(framework.slice(3).split('.')[0]) !== Number(provenance.dotnetSdk.split('.')[0]))
    setupError = 'The target framework must match the selected SDK major';
  provenance.targetFramework = framework;
  environment.DOTNET_TARGET_FRAMEWORK = framework;
  const summary = await runNativePlan(nativeQualificationPlan({...options, framework}), {
    output: options.output, root, environment, provenance, setupError
  });
  if (summary.status === 'failed') process.exitCode = 1;
}
