import {spawn} from 'node:child_process';
import {discoverManifests, selectManifests, parseTestArgs, isMain} from './test-manifests.js';
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
    const child = spawn(command, args, {cwd, stdio: 'inherit', timeout, shell: false});
    const forward = signal => child.kill(signal);
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    const cleanup = () => {process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);};
    child.once('error', error => {cleanup(); reject(error);});
    child.once('exit', (code, signal) => {cleanup(); resolve(code ?? (signal === 'SIGINT' ? 130 : 1));});
  });
}
export async function runTests(options) {
  const manifests = selectManifests(await discoverManifests(options.root), options.area);
  if (options.list) {console.log(JSON.stringify(manifests, null, 2)); return 0;}
  const nodeFiles = manifests.flatMap(manifest => manifest.nodeFiles);
  console.error(`Discovered ${nodeFiles.length} Node test files and ${manifests.reduce((n, m) => n + m.browserScripts.length, 0)} Python suites in ${manifests.length} area manifests. Node reports executed test counts below.`);
  // One serial Node runner retains aggregate counts without overlapping test files.
  if (nodeFiles.length) {
    const args = serialTestArgs(['--test', '--test-timeout=' + Math.max(...manifests.map(m => m.timeout)), ...options.nodeArgs, ...nodeFiles]);
    const status = await runProcess(process.execPath, args, {cwd: options.root});
    if (status) return status;
  }
  if (options.browser) for (const manifest of manifests) for (const script of manifest.browserScripts) {
    const status = await runProcess(process.env.PYTHON || 'python', [script], {cwd: options.root, timeout: manifest.timeout});
    if (status) return status;
  }
  return 0;
}
if (isMain(import.meta.url)) {
  try {process.exitCode = await runTests(parseTestArgs(process.argv.slice(2)));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
