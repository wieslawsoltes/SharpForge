import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { normalizeBudgets, validateInput, validateTargetId, validateUint32 } from './budgets.js';

export const inputDigest = input => createHash('sha256').update(input).digest('hex');
const recordDigest = record => inputDigest(JSON.stringify(record));
const digestPattern = /^[a-f0-9]{64}$/;

export function normalizeSourceIdentity(source = null) {
  if (source === null) return null;
  if (!source || !/^[a-f0-9]{40}$/.test(source.commit) || !/^[a-f0-9]{40}$/.test(source.tree)
    || typeof source.clean !== 'boolean') throw new TypeError('Invalid source identity');
  return { commit: source.commit, tree: source.tree, clean: source.clean };
}

async function corpusDirectory(directory, create = false) {
  if (typeof directory !== 'string' || !directory.length) throw new TypeError('An explicit corpus directory is required');
  const path = resolve(directory);
  if (create) await mkdir(path, { recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Corpus must be a real directory');
  return realpath(path);
}

async function inventory(directory, budgets) {
  const files = [];
  let bytes = 0;
  let inspected = 0;
  for await (const entry of await opendir(directory)) {
    if (++inspected > budgets.maxCorpusCases + 16) throw new RangeError('Corpus directory entry limit exceeded');
    if (entry.isSymbolicLink()) throw new Error('Corpus symlinks are forbidden');
    if (!entry.name.endsWith('.json')) continue;
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new Error('Invalid corpus filename');
    const info = await lstat(join(directory, entry.name));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Corpus entries must be regular files');
    bytes += info.size;
    files.push({ name: entry.name, bytes: info.size });
    if (files.length > budgets.maxCorpusCases || bytes > budgets.maxCorpusBytes) throw new RangeError('Corpus exceeds storage limits');
  }
  files.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return { files, bytes };
}

async function readBounded(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw new RangeError('Corpus record exceeds byte limit');
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximum) throw new RangeError('Corpus record grew beyond byte limit');
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function validateRecord(record, name, budgets) {
  if (!record || record.schemaVersion !== 1 || record.selfTest !== false) throw new Error('Invalid or tooling-only corpus record');
  const { recordSHA256, ...payload } = record;
  if (!digestPattern.test(recordSHA256) || recordDigest(payload) !== recordSHA256 || name !== `${recordSHA256}.json`) {
    throw new Error('Corpus record checksum mismatch');
  }
  validateTargetId(record.targetId);
  validateUint32(record.seed);
  validateUint32(record.caseIndex, 'caseIndex');
  normalizeSourceIdentity(record.sourceIdentity);
  const limits = normalizeBudgets(record.budgets);
  if (typeof record.inputBase64 !== 'string' || record.inputBase64.length > Math.ceil(budgets.maxInputBytes / 3) * 4) {
    throw new RangeError('Corpus encoded input exceeds byte limit');
  }
  const input = Buffer.from(record.inputBase64, 'base64');
  validateInput(input, Math.min(budgets.maxInputBytes, limits.maxInputBytes));
  if (input.toString('base64') !== record.inputBase64 || inputDigest(input) !== record.inputSHA256) {
    throw new Error('Corpus input checksum mismatch');
  }
  if (JSON.stringify(record.expectedStatuses) !== '["accepted","rejected"]') throw new Error('Corpus cannot allow findings or unsupported results');
  return { ...record, input: new Uint8Array(input), budgets: limits };
}

/** Read only flat, hash-named JSON records with capped count/bytes and verified literal inputs. */
export async function readCorpus({ directory, budgets = {} }) {
  const limits = normalizeBudgets(budgets);
  const path = await corpusDirectory(directory);
  const { files } = await inventory(path, limits);
  const records = [];
  let totalBytes = 0;
  for (const file of files) {
    const maximum = Math.min(limits.maxCorpusBytes - totalBytes, limits.maxInputBytes * 2 + 16384);
    const bytes = await readBounded(join(path, file.name), maximum);
    totalBytes += bytes.length;
    if (totalBytes > limits.maxCorpusBytes) throw new RangeError('Corpus actual bytes exceed storage limit');
    records.push(validateRecord(JSON.parse(bytes.toString('utf8')), file.name, limits));
  }
  return records;
}

/** Save a literal finding without overwriting another record or accepting a caller-provided filename. */
export async function writeFinding(directory, observation, input,
  { budgets = observation.budgets ?? {}, sourceIdentity = observation.sourceIdentity ?? null } = {}) {
  const limits = normalizeBudgets(budgets);
  if (Object.hasOwn(observation, 'budgets')
    && JSON.stringify(limits) !== JSON.stringify(normalizeBudgets(observation.budgets))) {
    throw new Error('Finding budget identity mismatch');
  }
  validateInput(input, limits.maxInputBytes);
  const selfTest = observation.qualification === 'harness-self-check';
  validateTargetId(observation.targetId, selfTest);
  if (observation.status !== 'finding' || !observation.finding) throw new TypeError('Only findings can enter the crash corpus');
  const digest = inputDigest(input);
  if (observation.inputSHA256 !== digest || observation.inputBytes !== input.length) throw new Error('Finding input identity mismatch');
  const source = normalizeSourceIdentity(sourceIdentity);
  if (Object.hasOwn(observation, 'sourceIdentity')
    && JSON.stringify(source) !== JSON.stringify(normalizeSourceIdentity(observation.sourceIdentity))) {
    throw new Error('Finding source identity mismatch');
  }
  const record = {
    schemaVersion: 1, targetId: observation.targetId, selfTest,
    seed: validateUint32(observation.seed), caseIndex: validateUint32(observation.caseIndex, 'caseIndex'),
    inputSHA256: digest, inputBase64: Buffer.from(input).toString('base64'),
    expectedStatuses: ['accepted', 'rejected'],
    originalFinding: { kind: String(observation.finding.kind).slice(0, 64), detail: String(observation.finding.detail).slice(0, 2048) },
    budgets: limits, sourceIdentity: source,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
  };
  record.recordSHA256 = recordDigest(record);
  const bytes = Buffer.from(JSON.stringify(record, null, 2) + '\n');
  const path = await corpusDirectory(directory, true);
  const lockPath = join(path, '.corpus.lock');
  const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    return await storeRecord(path, record.recordSHA256, bytes, limits);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function storeRecord(path, recordSHA256, bytes, limits) {
  const current = await inventory(path, limits);
  const name = `${recordSHA256}.json`;
  const existing = current.files.find(file => file.name === name);
  if (existing) {
    const retained = await readBounded(join(path, name), bytes.length);
    if (!retained.equals(bytes)) throw new Error('Existing corpus record changed');
    return join(path, name);
  }
  if (current.files.length >= limits.maxCorpusCases || current.bytes + bytes.length > limits.maxCorpusBytes) {
    throw new RangeError('Saving finding would exceed corpus storage limits');
  }
  const handle = await open(join(path, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
  return join(path, name);
}
