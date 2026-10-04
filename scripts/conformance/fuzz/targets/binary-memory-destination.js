export const MEMORY_DESTINATION_ROOT = '/fuzz-destination';
const ceiling = Object.freeze({ maxEntries: 32, maxFileBytes: 65536, maxTotalBytes: 65536, maxDepth: 8, maxPathLength: 128 });

/** A writer that reaches a forbidden destination operation is a finding, not a malformed-archive rejection. */
export class BinaryDestinationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BinaryDestinationError';
  }
}

function destinationLimits(options) {
  const limits = {};
  for (const [key, maximum] of Object.entries(ceiling)) {
    const value = options[key] ?? maximum;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`Invalid destination ${key}`);
    limits[key] = value;
  }
  return Object.freeze(limits);
}

function childPath(parent, name, limits) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\x00-\x1f\x7f/\\:]/.test(name)) {
    throw new BinaryDestinationError('Writer attempted a non-child destination path');
  }
  const path = parent ? `${parent}/${name}` : name;
  if (path.length > limits.maxPathLength || path.split('/').length > limits.maxDepth) {
    throw new BinaryDestinationError('Writer exceeded destination path limits');
  }
  return path;
}

function writable(state, file) {
  if (file.open || file.written) throw new BinaryDestinationError('Writer attempted to overwrite an in-memory file');
  file.open = true;
  let pending = null;
  let closed = false;
  function requireOpen() {
    if (closed) throw new BinaryDestinationError('Writer reused a closed stream');
  }
  return Object.freeze({
    async write(value) {
      requireOpen();
      if (!(value instanceof Uint8Array) || pending !== null) {
        throw new BinaryDestinationError('Writer supplied unsupported or repeated stream data');
      }
      if (value.byteLength > state.limits.maxFileBytes ||
          state.bytes + state.pendingBytes + value.byteLength > state.limits.maxTotalBytes) {
        throw new BinaryDestinationError('Writer exceeded destination byte limits');
      }
      pending = value.slice();
      state.pendingBytes += pending.length;
    },
    async close() {
      requireOpen();
      if (pending === null) throw new BinaryDestinationError('Writer closed a stream without writing');
      state.pendingBytes -= pending.length;
      state.bytes += pending.length;
      file.bytes = pending;
      file.written = true;
      pending = null;
      file.open = false;
      closed = true;
    },
    async abort() {
      if (closed) return;
      state.pendingBytes -= pending?.length ?? 0;
      pending = null;
      file.open = false;
      closed = true;
    },
  });
}

function createFile(state, name, path) {
  if (state.files.size >= state.limits.maxEntries) throw new BinaryDestinationError('Writer exceeded destination file count');
  const file = { path, bytes: new Uint8Array(), written: false, open: false };
  state.files.set(path, file);
  return Object.freeze({ name, kind: 'file', async createWritable() { return writable(state, file); } });
}

function createDirectory(state, name, path) {
  const children = new Map();
  if (state.folders.size >= state.limits.maxEntries * state.limits.maxDepth) {
    throw new BinaryDestinationError('Writer exceeded destination directory count');
  }
  if (path) state.folders.add(path);
  function child(kind, childName, create) {
    const destination = childPath(path, childName, state.limits);
    const key = childName.normalize('NFC').toLowerCase();
    const existing = children.get(key);
    if (existing) {
      if (existing.name !== childName || existing.kind !== kind) {
        throw new BinaryDestinationError('Writer reached a colliding destination');
      }
      return existing;
    }
    if (!create) throw new DOMException('No such in-memory child', 'NotFoundError');
    const handle = kind === 'directory'
      ? createDirectory(state, childName, destination)
      : createFile(state, childName, destination);
    children.set(key, handle);
    return handle;
  }
  return Object.freeze({
    name,
    kind: 'directory',
    async queryPermission() { return 'granted'; },
    async *entries() { for (const handle of children.values()) yield [handle.name, handle]; },
    async getDirectoryHandle(childName, { create = false } = {}) { return child('directory', childName, create); },
    async getFileHandle(childName, { create = false } = {}) { return child('file', childName, create); },
  });
}

/** Fixed-root File System Access handles backed only by bounded Maps and Uint8Arrays; no host filesystem authority. */
export function createMemoryDestination(options = {}) {
  const state = { limits: destinationLimits(options), files: new Map(), folders: new Set(), bytes: 0, pendingBytes: 0 };
  const root = createDirectory(state, 'fuzz-destination', '');
  return Object.freeze({
    root,
    snapshot() {
      const files = [];
      for (const file of state.files.values()) {
        if (file.open) throw new BinaryDestinationError('Writer left a destination stream open');
        files.push({ path: `${MEMORY_DESTINATION_ROOT}/${file.path}`, bytes: file.bytes.slice() });
      }
      files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      return {
        files,
        folders: [...state.folders].sort().map(path => `${MEMORY_DESTINATION_ROOT}/${path}`),
        bytes: state.bytes,
      };
    },
  });
}
