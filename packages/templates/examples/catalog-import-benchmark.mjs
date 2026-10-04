import { mkdtemp, symlink, rm, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir, cpus, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice(11) ?? '4b0c8a7e';
const temp = await mkdtemp(join(tmpdir(), 'sf-catalog-bench-'));

async function sourceSize(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const child = await sourceSize(path);
      bytes += child.bytes;
      files += child.files;
    } else if (entry.name.endsWith('.js')) {
      bytes += (await stat(path)).size;
      files++;
    }
  }
  return { bytes, files };
}

function summarize(rows) {
  const times = rows.map(row => row.ms).sort((left, right) => left - right);
  const heap = rows.map(row => row.heap).sort((left, right) => left - right);
  return { medianMs: times[12], p95Ms: times[23], medianHeapBytes: heap[12] };
}

try {
  const archive = execFileSync('git', ['archive', baseline, 'packages/templates'], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', temp], { input: archive });
  await symlink(resolve(root, 'node_modules'), resolve(temp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const paths = [resolve(temp, 'packages/templates/src/index.js'), resolve(root, 'packages/templates/src/index.js')];
  const samples = [[], []];
  for (let trial = 0; trial < 25; trial++) {
    for (const which of trial % 2 ? [1, 0] : [0, 1]) {
      const code = 'const start=performance.now();const before=process.memoryUsage();await import(' +
        JSON.stringify(pathToFileURL(paths[which]).href) + ');' +
        'console.log(JSON.stringify({ms:performance.now()-start,heap:process.memoryUsage().heapUsed-before.heapUsed}));';
      samples[which].push(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
        encoding: 'utf8', timeout: 30000
      })));
    }
  }
  console.log(JSON.stringify({
    platform: process.platform, node: process.version, cpu: cpus()[0].model, logicalCpus: cpus().length, totalMemory: totalmem(),
    sharedMachine: true, baseline, trials: 25,
    scope: 'Fresh Node processes, warm filesystem, alternating baseline/current catalog imports; not HTTP first-paint measurements',
    before: summarize(samples[0]), after: summarize(samples[1]),
    beforeSource: await sourceSize(resolve(temp, 'packages/templates/src')),
    afterSource: await sourceSize(resolve(root, 'packages/templates/src')), samples
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
