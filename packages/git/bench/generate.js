import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { checkCancelled } from '@sharpforge/git';
import { benchmarkGit } from './native.js';

const binaryChunkBytes = 32 * 1024 * 1024;

export function benchmarkTextPath(index) {
  return `text/${String(Math.floor(index / 1000)).padStart(3, '0')}/file-${String(index).padStart(6, '0')}.txt`;
}

function textContents(index, revision = 0) {
  return `file ${index}\nrevision ${revision}\nalpha ${index}\nbeta ${index}\ngamma ${index}\ndelta ${index}\nstable line\nlast line\n`;
}

async function textFiles(directory, files, { onProgress, signal }) {
  for (let begin = 0; begin < files; begin += 32) {
    checkCancelled(signal);
    const writes = await Promise.allSettled(Array.from({ length: Math.min(32, files - begin) }, async (_, offset) => {
      const index = begin + offset;
      const path = join(directory, benchmarkTextPath(index));
      await mkdir(dirname(path), { recursive: true });
      checkCancelled(signal);
      await writeFile(path, textContents(index), { signal });
    }));
    checkCancelled(signal);
    const failed = writes.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    if (begin % 1024 === 0) onProgress?.({ phase: 'generate-files', completed: Math.min(begin + 32, files), total: files });
    checkCancelled(signal);
  }
}

function fillDeterministicBinary(bytes, state) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  for (; offset + 4 <= bytes.length; offset += 4) {
    let value = state.value;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    state.value = value >>> 0;
    view.setUint32(offset, state.value, true);
  }
  for (; offset < bytes.length; offset++) bytes[offset] = state.value >>> ((offset % 4) * 8) & 255;
}

async function binaryFiles(directory, total, { onProgress, signal }) {
  checkCancelled(signal);
  if (!total) return 0;
  await mkdir(join(directory, 'binary'));
  const chunk = new Uint8Array(1024 * 1024);
  const state = { value: 0x0a250c0d };
  let completed = 0;
  let files = 0;
  while (completed < total) {
    checkCancelled(signal);
    const size = Math.min(binaryChunkBytes, total - completed);
    const handle = await open(join(directory, 'binary', `part-${String(files++).padStart(4, '0')}.bin`), 'wx');
    try {
      for (let written = 0; written < size;) {
        checkCancelled(signal);
        const bytes = chunk.subarray(0, Math.min(chunk.length, size - written));
        fillDeterministicBinary(bytes, state);
        await handle.writeFile(bytes, { signal });
        written += bytes.length;
      }
    } finally { await handle.close(); }
    completed += size;
    onProgress?.({ phase: 'generate-binary', completed, total });
    checkCancelled(signal);
  }
  return files;
}

/** Default fixture is 100,000 text files plus 1 GiB of reproducible high-entropy binary content. */
export async function generateBenchmarkRepository(root, profile, { onProgress, signal, runGit = benchmarkGit } = {}) {
  checkCancelled(signal);
  const directory = join(root, 'source');
  await mkdir(directory);
  const env = {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'global-config'), GIT_CONFIG_SYSTEM: join(root, 'system-config'),
    GIT_AUTHOR_NAME: 'Benchmark', GIT_AUTHOR_EMAIL: 'benchmark@example.test',
    GIT_COMMITTER_NAME: 'Benchmark', GIT_COMMITTER_EMAIL: 'benchmark@example.test',
    GIT_AUTHOR_DATE: '1700000000 +0000', GIT_COMMITTER_DATE: '1700000000 +0000', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C'
  };
  const git = (args, overrides) => {
    checkCancelled(signal);
    return runGit(args, { cwd: directory, env: { ...env, ...overrides }, signal });
  };
  const version = await git(['--version']);
  await git(['init', '-q', '--initial-branch=main', `--object-format=${profile.algorithm}`]);
  await git(['config', 'pack.threads', '1']);
  await git(['config', 'core.bigFileThreshold', '1m']);
  await textFiles(directory, profile.files, { onProgress, signal });
  const binaryFilesCount = await binaryFiles(directory, profile.binaryBytes, { onProgress, signal });
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'large repository base']);
  for (let revision = 1; revision < profile.history; revision++) {
    checkCancelled(signal);
    await writeFile(join(directory, benchmarkTextPath(0)), textContents(0, revision), { signal });
    await git(['add', benchmarkTextPath(0)]);
    await git(['commit', '-q', '-m', `history ${revision}`], {
      GIT_AUTHOR_DATE: `${1700000000 + revision * 60} +0000`, GIT_COMMITTER_DATE: `${1700000000 + revision * 60} +0000`
    });
  }
  onProgress?.({ phase: 'prepare-native-pack' });
  await git(['repack', '-adq', '--window=0', '--depth=0']);
  await git(['clone', '-q', '--bare', directory, join(root, 'repository.git')]);
  return { directory, env, version, head: await git(['rev-parse', 'HEAD']), textFiles: profile.files, binaryFiles: binaryFilesCount };
}
