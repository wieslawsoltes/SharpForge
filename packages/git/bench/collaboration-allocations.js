import { Session } from 'node:inspector';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SequenceCrdt } from '../src/collab/crdt.js';
import { encodeCollaborationSnapshot } from '../src/collab/encoding.js';

export const COLLABORATION_ALLOCATION_SETTINGS = Object.freeze({
  samplingInterval: 32 * 1024,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true
});

/** These backend behaviors are source-verified for this exact upstream Node/V8 pair, not RPC options. */
export function collaborationAllocationBackend(node = process.version, v8 = process.versions.v8) {
  const runtimeMatchesSource = node === 'v24.19.0' && v8 === '13.6.233.17-node.51';
  const base = 'https://github.com/nodejs/node/blob/v24.19.0/deps/v8/';
  return {
    sourceRuntime: { node: 'v24.19.0', v8: '13.6.233.17-node.51' }, sourceTag: 'v24.19.0', runtimeMatchesSource,
    effectiveStackDepth: runtimeMatchesSource ? 128 : null,
    forcedCollectionAtStop: runtimeMatchesSource ? true : null,
    verification: 'Tagged upstream source; these behaviors cannot be queried through HeapProfiler.startSampling',
    otherRuntimeCaveat: 'Effective depth and implicit collection behavior are unverified for other Node/V8 versions',
    sources: [
      { url: base + 'src/inspector/v8-heap-profiler-agent-impl.cc', gitBlob: '7b7a4893be83684e7d9e9c8d4aa4435953733d19' },
      { url: base + 'include/js_protocol.pdl', gitBlob: 'e33cdae701a1282bb3d6c026cf8cb285caf479b5' },
      { url: base + 'src/profiler/sampling-heap-profiler.cc', gitBlob: 'f6ead73a0b83d5ebe83d07c23c967bf4932d925e' }
    ]
  };
}

const sourceUrl = new URL('../src/collab/', import.meta.url);
const make = actorId => new SequenceCrdt({ actorId, workspaceId: 'benchmark', documentId: 'Program.cs' });
const post = (session, method, params = {}) => new Promise((resolve, reject) =>
  session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));

/** Sum native sampling estimates once per node; sample records are not an exact allocation count. */
export function summarizeCollaborationAllocations(profile, prefixes = [sourceUrl.href, fileURLToPath(sourceUrl)]) {
  if (!profile?.head || !Array.isArray(profile.samples)) throw new TypeError('Native allocation profile is missing');
  const pending = [{ node: profile.head, collaboration: false }];
  const nodes = new Map();
  let estimatedV8AllocatedBytes = 0;
  let estimatedCollaborationStackBytes = 0;
  while (pending.length) {
    const { node, collaboration: inherited } = pending.pop();
    if (!Number.isInteger(node.id) || nodes.has(node.id) || !Number.isFinite(node.selfSize) || node.selfSize < 0
      || !Array.isArray(node.children) || typeof node.callFrame?.url !== 'string') {
      throw new TypeError('Malformed native allocation profile node');
    }
    const collaboration = inherited || prefixes.some(prefix => node.callFrame.url.startsWith(prefix));
    nodes.set(node.id, collaboration);
    estimatedV8AllocatedBytes += node.selfSize;
    if (collaboration) estimatedCollaborationStackBytes += node.selfSize;
    for (const child of node.children) pending.push({ node: child, collaboration });
  }
  let collaborationSampleRecords = 0;
  for (const sample of profile.samples) {
    if (!nodes.has(sample.nodeId) || !Number.isFinite(sample.size) || sample.size < 0) {
      throw new TypeError('Malformed native allocation profile sample');
    }
    if (nodes.get(sample.nodeId)) collaborationSampleRecords++;
  }
  return {
    estimatedV8AllocatedBytes, estimatedCollaborationStackBytes,
    sampleRecords: profile.samples.length, collaborationSampleRecords, profileNodes: nodes.size
  };
}

async function allocationWorkload(iterations) {
  let encodedSnapshotBytes = 0;
  let actualDocumentOperations = 0;
  let finalText = '';
  for (let iteration = 0; iteration < iterations; iteration++) {
    const document = make('actor');
    let receiver;
    try {
      document.insert(0, '0123456789'.repeat(100));
      let reference = document.text;
      // Match the latency workload, including its independent reference-string maintenance.
      for (let operation = 0; operation < 1000; operation++) {
        const offset = (operation * 7919) % (document.length + 1);
        const deleteCount = operation % 3 === 0 && offset < document.length ? 1 : 0;
        const text = operation % 3 === 0 ? '' : String.fromCharCode(97 + operation % 26);
        document.replace(offset, deleteCount, text);
        document.anchorAt(Math.min(offset, document.length));
        reference = reference.slice(0, offset) + text + reference.slice(offset + deleteCount);
      }
      if (document.text !== reference) throw new Error('Allocation benchmark reference correctness gate failed');
      receiver = make('receiver');
      await receiver.mergeSnapshot(document.snapshot());
      if (receiver.text !== reference) throw new Error('Allocation benchmark snapshot correctness gate failed');
      encodedSnapshotBytes = encodeCollaborationSnapshot(document.snapshot()).byteLength;
      actualDocumentOperations += document.stats.operations;
      finalText = reference;
    } finally {
      document.dispose();
      receiver?.dispose();
    }
  }
  return { referenceChecks: iterations, snapshotChecks: iterations, actualDocumentOperations,
    encodedSnapshotBytes, finalText };
}

/** Actual in-process V8 sampling, invoked only after the unprofiled latency pass is complete. */
export async function profileCollaborationAllocations(iterations) {
  if (!Number.isInteger(iterations) || iterations < 3 || iterations > 1000) {
    throw new RangeError('Use 3 through 1000 allocation benchmark iterations');
  }
  const session = new Session();
  session.connect();
  let correctness;
  let profile;
  try {
    await post(session, 'HeapProfiler.enable');
    await post(session, 'HeapProfiler.collectGarbage');
    await post(session, 'HeapProfiler.startSampling', COLLABORATION_ALLOCATION_SETTINGS);
    try {
      correctness = await allocationWorkload(iterations);
    } finally {
      ({ profile } = await post(session, 'HeapProfiler.stopSampling'));
    }
  } finally {
    session.disconnect();
  }
  const summary = summarizeCollaborationAllocations(profile);
  if (!summary.sampleRecords || !summary.estimatedCollaborationStackBytes) {
    throw new Error('Native allocation sampling did not observe the collaboration workload');
  }
  const { finalText, ...checks } = correctness;
  const serializedProfile = JSON.stringify(profile);
  const backend = collaborationAllocationBackend();
  return {
    schema: 'sharpforge.git.collaboration-allocations.v1', status: 'measured',
    method: 'Node V8 HeapProfiler.startSampling/stopSampling',
    measurement: 'Poisson-sampled estimates of V8 allocation traffic, including collected objects; not exact totals or allocation counts',
    settings: { ...COLLABORATION_ALLOCATION_SETTINGS }, backend,
    pass: { position: 'after all latency samples; same isolate, separate workload repetition', iterations,
      initialUtf16Units: 1000, editAttemptsPerIteration: 1000, snapshotMergesPerIteration: 1,
      includes: ['creation', 'edits and anchors', 'snapshot merge and encoding', 'correctness reference strings', 'disposal'] },
    gc: { method: 'HeapProfiler.collectGarbage', explicitCollectionsBeforeSampling: 1, explicitCollectionsDuringSampling: 0,
      majorCollectedObjectsIncluded: true, minorCollectedObjectsIncluded: true,
      backendForcedCollectionAtStop: backend.forcedCollectionAtStop,
      backendCollectionReason: 'The verified backend sets kSamplingForceGC; stopSampling retrieves the allocation profile before stopping the sampler' },
    attribution: { sourcePrefixes: [sourceUrl.href, fileURLToPath(sourceUrl)],
      rule: 'Sum selfSize once for nodes at or below a packages/git/src/collab frame',
      boundary: 'Whole-isolate estimates also include harness, inspector and scheduling allocations. Source attribution follows recorded stacks.' },
    excludes: ['native allocations', 'external memory', 'ArrayBuffer backing stores', 'exact object counts', 'browser or network latency'],
    summary, correctness: { ...checks, finalTextSha256: createHash('sha256').update(finalText).digest('hex') },
    runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, architecture: process.arch,
      execArgv: [...process.execArgv], exposedGc: typeof globalThis.gc === 'function' },
    profileIdentity: { algorithm: 'sha256', serialization: 'UTF-8 JSON.stringify(samplingProfile)',
      digest: createHash('sha256').update(serializedProfile).digest('hex'), bytes: Buffer.byteLength(serializedProfile) },
    samplingProfile: profile
  };
}
