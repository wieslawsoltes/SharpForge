/** ZIP budgets use bytes and safe integer counts; metadata never bypasses them. */
export const ZIP_LIMITS = Object.freeze({
  maxEntries: 20000,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxArchiveBytes: 160 * 1024 * 1024,
  maxCentralBytes: 32 * 1024 * 1024,
  maxPathLength: 1024,
  maxDepth: 48,
  maxCompressionRatio: 1000,
  maxTotalCompressionRatio: 1000,
  chunkSize: 64 * 1024
});

export class ZipError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'ZipError';
    this.code = code;
  }
}

export function zipError(code, message) {
  throw new ZipError(code, message);
}

export function zipLimits(options = {}) {
  const limits = { ...ZIP_LIMITS, ...options };
  for (const key of Object.keys(ZIP_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) {
      zipError('SFZIP001', 'Invalid archive limit: ' + key);
    }
  }
  if (limits.chunkSize > 4 * 1024 * 1024) zipError('SFZIP001', 'ZIP chunk size exceeds 4 MiB');
  if (!['preserve', 'reject'].includes(options.nestedArchives ?? 'preserve')) zipError('SFZIP001', 'Invalid nested archive policy');
  return limits;
}

export function checkedAdd(left, right, label) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) zipError('SFZIP002', 'ZIP integer overflow: ' + label);
  return value;
}

/** Incremental metadata and actual-byte accounting, shared by readers and writers. */
export class ZipBudget {
  constructor(options) {
    this.limits = zipLimits(options);
    this.entries = 0;
    this.total = 0;
    this.compressed = 0;
    this.actual = 0;
  }
  entry(length, compressed, directory = false) {
    const limits = this.limits;
    if (++this.entries > limits.maxEntries) zipError('SFZIP003', 'Archive entry limit exceeded');
    for (const value of [length, compressed]) {
      if (!Number.isSafeInteger(value) || value < 0) zipError('SFZIP002', 'Invalid ZIP entry size');
    }
    if (length > limits.maxFileBytes || directory && length !== 0) {
      zipError('SFZIP004', 'Uncompressed archive size limit exceeded or nonempty directory');
    }
    this.total = checkedAdd(this.total, length, 'uncompressed total');
    this.compressed = checkedAdd(this.compressed, compressed, 'compressed total');
    if (this.total > limits.maxTotalBytes) zipError('SFZIP004', 'Uncompressed archive size limit exceeded');
    if (length / Math.max(1, compressed) > limits.maxCompressionRatio) {
      zipError('SFZIP005', 'ZIP entry compression ratio limit exceeded');
    }
  }
  finish() {
    if (this.total / Math.max(1, this.compressed) > this.limits.maxTotalCompressionRatio) {
      zipError('SFZIP005', 'ZIP total compression ratio limit exceeded');
    }
  }
  consume(count) {
    this.actual = checkedAdd(this.actual, count, 'streamed output');
    if (this.actual > this.limits.maxTotalBytes) zipError('SFZIP004', 'ZIP streaming byte budget exceeded');
  }
}

export function verifyZipNames(entries, limits) {
  const paths = new Map();
  const identities = new Map();
  for (const entry of entries) {
    const key = entry.path.normalize('NFC').toLowerCase();
    if (paths.has(key)) zipError('SFZIP006', 'Duplicate or case-colliding path: ' + entry.path);
    paths.set(key, entry.directory);
  }
  for (const entry of entries) {
    let spelling = entry.path;
    let child = false;
    while (spelling) {
      const key = spelling.normalize('NFC').toLowerCase();
      const old = identities.get(key);
      if (old && old !== spelling) zipError('SFZIP006', 'Case-colliding parent path: ' + spelling);
      if (child && paths.get(key) === false) zipError('SFZIP006', 'File/directory path collision: ' + entry.path);
      identities.set(key, spelling);
      spelling = spelling.includes('/') ? spelling.slice(0, spelling.lastIndexOf('/')) : '';
      child = true;
    }
  }
  if (entries.length > limits.maxEntries) zipError('SFZIP003', 'Archive entry limit exceeded');
}

export function verifyZipRanges(ranges, centralStart) {
  const ordered = [...ranges].sort((left, right) => left[0] - right[0]);
  let end = 0;
  for (const [start, last] of ordered) {
    if (start < end || last > centralStart || last < start) zipError('SFZIP007', 'Overlapping ZIP entries');
    end = last;
  }
}
