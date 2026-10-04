import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readZip, writeZip } from '@sharpforge/archive';
import { exportWorkspaceZipTo } from '../src/archive-stream.js';

const directory = await mkdtemp(join(tmpdir(), 'sharpforge-archive-benchmark-'));
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const percentile = (samples, fraction) => [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * fraction) - 1];

function measure(operation, count = 25) {
  for (let index = 0; index < 5; index++) operation();
  const samples = [];
  for (let index = 0; index < count; index++) {
    const start = performance.now();
    operation();
    samples.push(performance.now() - start);
  }
  return { runs: count, medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) };
}

async function baseline() {
  const revision = process.argv.find(value => value.startsWith('--baseline='))?.slice('--baseline='.length);
  if (!revision) return null;
  let source = execFileSync('git', ['show', revision + ':packages/archive/src/index.js'], { cwd: repository, encoding: 'utf8' });
  source = source.replace(/(from\s*|import\s*)(['"])(\.\/[^'"]+)\2/g, (_match, prefix, quote, path) =>
    prefix + quote + new URL(path, new URL('../../archive/src/index.js', import.meta.url)).href + quote);
  const path = join(directory, 'baseline.mjs');
  await writeFile(path, source);
  return { revision, archive: await import(pathToFileURL(path)) };
}

try {
  const reference = await baseline();
  const files = Array.from({ length: 200 }, (_, index) => ({ path: 'src/File' + index + '.cs', text: 'public class Example { }\n'.repeat(80) }));
  const stored = writeZip(files);
  const timings = { after: { writeZip: measure(() => writeZip(files)), readZip: measure(() => readZip(stored)) } };
  if (reference) {
    const original = reference.archive.writeZip(files);
    timings.before = { revision: reference.revision, writeZip: measure(() => reference.archive.writeZip(files)),
      readZip: measure(() => reference.archive.readZip(original)) };
  }
  const block = Uint8Array.from({ length: 64 * 1024 }, (_value, index) => index % 251);
  const fileCount = 1000;
  const fileBytes = 512 * 1024;
  const records = Array.from({ length: fileCount }, (_value, index) => ({
    path: 'assets/part-' + String(index).padStart(4, '0') + '.dat', stream: async function* () {
      for (let chunk = 0; chunk < fileBytes / block.length; chunk++) yield block;
    }
  }));
  const zipPath = join(directory, 'workspace-500MiB.zip');
  const memoryStart = process.memoryUsage();
  let peakRss = memoryStart.rss;
  let peakExternal = memoryStart.external;
  let peakHeap = memoryStart.heapUsed;
  const start = performance.now();
  const limits = { compression: 'deflate', level: 'fast', maxFileBytes: fileBytes, maxTotalBytes: fileCount * fileBytes + 1024 * 1024,
    maxArchiveBytes: 600 * 1024 * 1024, onProgress: () => {
      const memory = process.memoryUsage();
      peakRss = Math.max(peakRss, memory.rss);
      peakExternal = Math.max(peakExternal, memory.external);
      peakHeap = Math.max(peakHeap, memory.heapUsed);
    } };
  const streaming = await exportWorkspaceZipTo({ records, settings: { name: 'Streaming500MiB', mode: 'folder' } },
    Writable.toWeb(createWriteStream(zipPath)), limits);
  const seconds = (performance.now() - start) / 1000;
  // The bounded writer measurement ends here. readZip intentionally materializes the complete output corpus.
  const reread = readZip(new Uint8Array(await readFile(zipPath)), limits);
  if (reread.length !== fileCount + 1 || reread.filter(file => file.path.startsWith('assets/')).some(file =>
    file.bytes.length !== fileBytes || file.bytes[0] !== 0 ||
      file.bytes[fileBytes - 1] !== block[block.length - 1])) throw new Error('Streaming reread corpus mismatch');
  const python = execFileSync('python', ['-c',
    'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; ' +
    'print(json.dumps({"version":sys.version.split()[0],"entries":len(z.infolist()),"bytes":sum(i.file_size for i in z.infolist())}))', zipPath],
  { encoding: 'utf8' });
  process.stdout.write(JSON.stringify({ machine: { node: process.version, platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemory: totalmem() }, timings, streaming: {
    ...streaming, seconds, sourceBytes: fileCount * fileBytes, peakRss, rssIncrease: peakRss - memoryStart.rss,
    externalIncrease: peakExternal - memoryStart.external, heapIncrease: peakHeap - memoryStart.heapUsed,
    reference: JSON.parse(python), readZipValidated: true,
    memoryScope: 'writer only; input generated in 64KiB chunks; validation materialization excluded'
  } }, null, 2) + '\n');
} finally { await rm(directory, { recursive: true, force: true }); }
