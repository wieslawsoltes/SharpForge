import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { readPack } from '@sharpforge/git';
import { initNodeRepository } from '@sharpforge/git/node';
import { directoryStatistics } from './metrics.js';
import { IndependentPackSource } from './pack-memory-source.js';
import { packMemoryProfile, PACK_MEMORY_HEAP_LIMIT_BYTES } from './pack-memory-profile.js';

function memorySample() {
  const memory = process.memoryUsage();
  return { heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal, externalBytes: memory.external,
    arrayBufferBytes: memory.arrayBuffers, rssBytes: memory.rss };
}

function memoryMonitor() {
  const baseline = memorySample();
  const peak = { ...baseline };
  let samples = 1;
  const sample = () => {
    const current = memorySample();
    for (const name of Object.keys(peak)) peak[name] = Math.max(peak[name], current[name]);
    samples++;
  };
  const timer = setInterval(sample, 1);
  return {
    sample,
    finish: () => {
      sample();
      clearInterval(timer);
      return { baseline, peak, samples, sampleIntervalMs: 1, processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
        v8HeapSizeLimitBytes: getHeapStatistics().heap_size_limit };
    },
    close: () => clearInterval(timer)
  };
}

async function decodeFixture(options, descriptor, file, monitor) {
  const profile = packMemoryProfile(options.profile);
  const source = new IndependentPackSource(profile, file, monitor.sample);
  let objects = 0;
  let expandedBytes = 0;
  const pack = await readPack(source, {
    odb: descriptor.odb, staging: descriptor.store, algorithm: profile.algorithm,
    maxObjects: profile.objects, maxObjectBytes: profile.objectBytes, maxBufferedBytes: 4 * 1024 * 1024,
    maxMemoryBytes: 8 * 1024 * 1024, maxPackBytes: 1100 * 1024 * 1024,
    onObject: object => {
      assert.equal(object.type, 'blob');
      assert.equal(object.size, profile.objectBytes);
      assert.equal(object.oid, source.expectedOids[objects], 'Decoded object must match independent native-crypto address');
      objects++;
      expandedBytes += object.size;
      monitor.sample();
      if (objects % 16 === 0 || objects === profile.objects) {
        options.onProgress?.({ phase: 'decoded', completed: objects, total: profile.objects, expandedBytes });
      }
    }
  });
  await file.sync();
  assert.equal(pack.count, profile.objects);
  assert.equal(pack.checksum, source.checksum);
  assert.equal(pack.bytes, source.bytes);
  assert.deepEqual((await descriptor.odb.list()).sort(), [...source.expectedOids].sort());
  monitor.sample();
  return { bytes: pack.bytes, checksum: pack.checksum, objects, expandedBytes, maximumSourceChunkBytes: 65535 };
}

/** Isolated measured decode through the production streaming reader and native loose-object store. */
export async function measurePackDecode(options) {
  const profile = packMemoryProfile(options.profile);
  const descriptor = await initNodeRepository({ directory: join(options.root, 'repo.git'), bare: true, algorithm: profile.algorithm });
  let file;
  let monitor;
  try {
    file = await open(join(options.root, 'input.pack'), 'wx');
    monitor = memoryMonitor();
    const start = performance.now();
    const pack = await decodeFixture(options, descriptor, file, monitor);
    const milliseconds = performance.now() - start;
    const memory = monitor.finish();
    const storage = await directoryStatistics(descriptor.gitDirectory);
    return { profile, pack, milliseconds, memory, storage: { ...storage, backend: descriptor.capabilities.backend },
      heapLimitBytes: PACK_MEMORY_HEAP_LIMIT_BYTES, heapWithinLimit: memory.peak.heapUsedBytes < PACK_MEMORY_HEAP_LIMIT_BYTES,
      runtime: { node: process.version, platform: process.platform, architecture: process.arch, execArgv: process.execArgv } };
  } finally {
    monitor?.close();
    await file?.close();
    await descriptor.store.close();
  }
}

async function workerMain() {
  if (typeof process.send !== 'function') throw new Error('The pack memory worker requires its isolated-process coordinator');
  const options = await new Promise(resolveMessage => process.once('message', resolveMessage));
  let message;
  try {
    const result = await measurePackDecode({ ...options, onProgress: value => process.send({ type: 'progress', value }) });
    message = { type: 'result', result };
  } catch (error) {
    message = { type: 'failure', code: typeof error.code === 'string' ? error.code : 'FixtureFailure', message: error.message.slice(0, 2000) };
  }
  await new Promise((resolveMessage, reject) => process.send(message, error => error ? reject(error) : resolveMessage()));
  process.disconnect();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await workerMain();
