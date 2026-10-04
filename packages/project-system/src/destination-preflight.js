import { portablePath, encodeWorkspaceFile, PathPolicy } from '@sharpforge/archive';

const policy = new PathPolicy({ caseSensitive: false });
const parentPath = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const leafName = path => path.slice(path.lastIndexOf('/') + 1);

export class DestinationError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'DestinationError'; this.code = code; }
}

export async function destinationPermission(handle, { signal, requestPermission = true } = {}) {
  signal?.throwIfAborted();
  if (!handle || handle.kind !== 'directory') throw new DestinationError('SFDST001', 'Select a destination folder');
  let permission = await handle.queryPermission?.({ mode: 'readwrite' });
  if (permission && permission !== 'granted' && requestPermission) permission = await handle.requestPermission?.({ mode: 'readwrite' });
  signal?.throwIfAborted();
  if (permission && permission !== 'granted') throw new DestinationError('SFDST002', 'Write permission denied');
}

export async function existingDirectory(root, path, cache = new Map([['', root]])) {
  if (cache.has(path)) return cache.get(path);
  const parent = await existingDirectory(root, parentPath(path), cache);
  if (!parent) { cache.set(path, null); return null; }
  try {
    const handle = await parent.getDirectoryHandle(leafName(path));
    cache.set(path, handle);
    return handle;
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
    cache.set(path, null);
    return null;
  }
}

export async function destinationEntries(handle) {
  const entries = [];
  for await (const [name, entry] of handle.entries()) entries.push({ name, handle: entry, directory: entry.kind === 'directory' });
  return entries;
}

function normalizePlan(plan, limits) {
  if (!Array.isArray(plan.records) || !Array.isArray(plan.folders ?? []) || !Array.isArray(plan.modifications ?? [])) {
    throw new DestinationError('SFDST001', 'Invalid destination plan');
  }
  if (plan.records.length + (plan.modifications?.length ?? 0) > limits.maxEntries || (plan.folders?.length ?? 0) > limits.maxEntries) {
    throw new DestinationError('SFDST004', 'Destination entry budget exceeded');
  }
  const records = [...plan.records, ...(plan.modifications ?? [])].map(record => ({
    ...record, path: portablePath(record.path ?? record.uri), bytes: encodeWorkspaceFile(record)
  }));
  const names = new Map();
  const directories = new Set((plan.folders ?? []).map(path => portablePath(path, { directory: true })));
  let bytes = 0;
  for (const record of records) {
    const key = policy.identity(record.path);
    if (names.has(key)) throw new DestinationError('SFDST003', 'Duplicate or colliding plan path: ' + record.path);
    names.set(key, record.path);
    bytes += record.bytes.length;
    if (record.bytes.length > limits.maxFileBytes || bytes > limits.maxTotalBytes) throw new DestinationError('SFDST004', 'Destination byte budget exceeded');
    for (let parent = parentPath(record.path); parent; parent = parentPath(parent)) directories.add(parent);
  }
  for (const path of [...directories]) for (let parent = parentPath(path); parent; parent = parentPath(parent)) directories.add(parent);
  if (directories.size > limits.maxEntries) throw new DestinationError('SFDST004', 'Destination directory budget exceeded');
  const spelling = new Map(names);
  for (const path of directories) {
    const key = policy.identity(path);
    if (spelling.has(key) && spelling.get(key) !== path || names.has(key)) throw new DestinationError('SFDST003', 'File/directory collision: ' + path);
    spelling.set(key, path);
  }
  return { records, directories: [...directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)), bytes };
}

/** Read-only preflight. Permission/quota failures and every overwrite conflict are reported before mutation. */
export async function preflightDestination(handle, plan, options = {}) {
  const limits = { maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024, maxEntries: 20000, ...options };
  for (const key of ['maxFileBytes', 'maxTotalBytes', 'maxEntries']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new DestinationError('SFDST001', 'Invalid destination limit: ' + key);
  }
  await destinationPermission(handle, limits);
  const normalized = normalizePlan(plan, limits);
  const cache = new Map([['', handle]]);
  const listings = new Map();
  const conflicts = [];
  const snapshots = new Map();
  for (const record of [...normalized.directories.map(path => ({ path, directory: true })), ...normalized.records]) {
    limits.signal?.throwIfAborted();
    let parent;
    try { parent = await existingDirectory(handle, parentPath(record.path), cache); }
    catch (error) {
      if (error.name !== 'TypeMismatchError') throw error;
      conflicts.push({ path: record.path, kind: 'parent-file', overwritable: false });
      continue;
    }
    if (!parent) continue;
    const parentKey = parentPath(record.path);
    if (!listings.has(parentKey)) {
      const index = new Map();
      for (const entry of await destinationEntries(parent)) {
        const identity = entry.name.normalize('NFC').toLowerCase();
        const matches = index.get(identity) ?? [];
        matches.push(entry);
        index.set(identity, matches);
      }
      listings.set(parentKey, index);
    }
    const matches = listings.get(parentKey).get(policy.identity(leafName(record.path))) ?? [];
    const match = matches[0];
    if (!match) continue;
    if (matches.length > 1 || match.name !== leafName(record.path)) {
      conflicts.push({ path: record.path, existingPath: [parentKey, match.name].filter(Boolean).join('/'), kind: 'case-collision', overwritable: false });
    } else if (record.directory !== !!match.directory && (record.directory || match.directory)) {
      conflicts.push({ path: record.path, kind: 'type-collision', overwritable: false });
    } else if (!record.directory) {
      const file = await match.handle.getFile();
      conflicts.push({ path: record.path, kind: 'exists', overwritable: true, size: file.size });
      snapshots.set(record.path, { size: file.size, lastModified: file.lastModified });
    }
  }
  const estimate = await options.estimateQuota?.();
  const availableBytes = options.availableBytes ?? (estimate ? estimate.quota - estimate.usage : null);
  if (availableBytes !== null && (!Number.isFinite(availableBytes) || availableBytes < normalized.bytes)) {
    throw new DestinationError('SFDST004', 'Insufficient destination quota');
  }
  limits.signal?.throwIfAborted();
  return { ...normalized, conflicts, snapshots, ok: conflicts.length === 0, destination: handle.name ?? 'Selected folder', availableBytes };
}
