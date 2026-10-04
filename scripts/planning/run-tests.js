import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {discoverManifests, selectManifests, parseTestArgs, isMain} from './test-manifests.js';
import {acquireRunSlot, limitedEnv} from './lib/resource-limits.js';
export function serialTestArgs(args) {
  if (args[0] !== '--test') return args;
  const result = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--test-concurrency' || arg.startsWith('--test-concurrency=')) {
      const value = arg === '--test-concurrency' ? args[++index] : arg.slice('--test-concurrency='.length);
      if (value !== '1') throw new Error('Validation runs serially; --test-concurrency must be 1');
    } else result.push(arg);
  }
  result.splice(result.indexOf('--test') + 1, 0, '--test-concurrency=1');
  return result;
}
export function runProcess(command, args, {cwd, timeout}) {
  return new Promise((resolve, reject) => {
    if (timeout != null && (!Number.isInteger(timeout) || timeout < 0)) {
      const error = new RangeError('timeout must be an unsigned integer');
      error.code = 'ERR_OUT_OF_RANGE';
      throw error;
    }
    const child = spawn(command, args, {cwd, stdio: 'inherit', shell: false, env: limitedEnv()});
    let cancellationStatus, timer;
    const forward = (signal, status) => {
      // A child may exit zero after graceful cleanup. Cancellation must still stop the caller's next task.
      cancellationStatus ??= status;
      try {child.kill(signal);} catch (error) {child.emit('error', error);}
    };
    const interrupt = () => forward('SIGINT', 130), terminate = () => forward('SIGTERM', 143);
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    const cleanup = () => {
      clearTimeout(timer);
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    };
    child.once('error', error => {cleanup(); reject(error);});
    child.once('exit', (code, signal) => {cleanup(); resolve(cancellationStatus ?? code ?? (signal === 'SIGINT' ? 130 : 1));});
    if (timeout > 0) timer = setTimeout(() => forward('SIGTERM', 124), timeout);
  });
}
function areaNodeArgs(args, area, multipleAreas, root, destinations) {
  const result = [...args], flag = '--test-reporter-destination';
  for (let index = 0; index < result.length; index++) {
    const inline = result[index].startsWith(flag + '=');
    if (!inline && result[index] !== flag) continue;
    const destination = inline ? result[index].slice(flag.length + 1) : result[++index];
    if (!destination) throw new Error('Missing value for ' + flag);
    // Node opens reporter files with truncation, so sharing one path across invocations loses earlier results.
    if (multipleAreas && !['stdout', 'stderr'].includes(destination) && !destination.includes('{area}')) {
      throw new Error('Reporter file destinations for multiple areas must include {area}; use --area for one combined destination');
    }
    const expanded = destination.replaceAll('{area}', area);
    if (multipleAreas && !['stdout', 'stderr'].includes(expanded)) {
      const path = resolve(root, expanded), previous = destinations.get(path);
      if (previous && previous !== area) throw new Error(`Reporter destination is shared by ${previous} and ${area}: ${path}`);
      destinations.set(path, area);
    }
    result[index] = (inline ? flag + '=' : '') + expanded;
  }
  return result;
}
export async function runTests(options) {
  const manifests = selectManifests(await discoverManifests(options.root), options.area);
  if (options.list) {console.log(JSON.stringify(manifests, null, 2)); return 0;}
  const nodeFiles = manifests.flatMap(manifest => manifest.nodeFiles);
  console.error(`Discovered ${nodeFiles.length} Node test files and ${manifests.reduce((n, m) => n + m.browserScripts.length, 0)} Python suites in ${manifests.length} area manifests. Node reports executed test counts below.`);
  const nodeManifests = manifests.filter(manifest => manifest.nodeFiles.length);
  const destinations = new Map();
  // Prepare every command before execution so an invalid reporter destination cannot truncate an earlier report.
  const commands = nodeManifests.map(manifest => ({area: manifest.area, args: serialTestArgs([
    '--test', '--test-timeout=' + manifest.timeout,
    ...areaNodeArgs(options.nodeArgs, manifest.area, nodeManifests.length > 1, options.root, destinations), ...manifest.nodeFiles,
  ])}));
  // Areas and their files execute serially, each with its own declared timeout. Node reports per-area counts.
  // Locally, the run also waits for a machine-wide slot and caps each process's heap (lib/resource-limits.js).
  const release = await acquireRunSlot();
  try {
    for (const {area, args} of commands) {
      console.error(`Running Node tests for ${area}.`);
      const status = await runProcess(process.execPath, args, {cwd: options.root});
      if (status) return status;
    }
    if (options.browser) for (const manifest of manifests) for (const script of manifest.browserScripts) {
      const status = await runProcess(process.env.PYTHON || 'python', [script], {cwd: options.root, timeout: manifest.timeout});
      if (status) return status;
    }
    return 0;
  } finally {
    release();
  }
}
if (isMain(import.meta.url)) {
  try {process.exitCode = await runTests(parseTestArgs(process.argv.slice(2)));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
