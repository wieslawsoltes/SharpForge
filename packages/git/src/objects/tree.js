import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { getObjectFormat, bytesToHex, hexToBytes, validateObjectId } from '../object-format.js';
import { asBytes } from '../hash/bytes.js';
import { MAX_OBJECT_BYTES } from './framing.js';

export const GitTreeMode = Object.freeze({ File: 0o100644, Executable: 0o100755, Symlink: 0o120000, Gitlink: 0o160000, Tree: 0o40000 });
const modes = new Set(Object.values(GitTreeMode));
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function treeMode(value) {
  const mode = typeof value === 'string' && /^(100644|100755|120000|160000|40000)$/.test(value) ? parseInt(value, 8) : value;
  if (!modes.has(mode)) throw new GitError('Corrupt', 'Invalid tree entry mode', { mode: value });
  return mode;
}

function validateName(bytes) {
  if (!bytes.length || bytes.includes(0) || bytes.includes(47)
    || bytes.length === 1 && bytes[0] === 46 || bytes.length === 2 && bytes[0] === 46 && bytes[1] === 46) {
    throw new GitError('Corrupt', 'Invalid tree entry path');
  }
  return bytes;
}

function decodeName(bytes) {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // Git names are arbitrary non-NUL bytes; null prevents consumers from treating replacement text as a real path.
    return null;
  }
}

function nameBytes(entry) {
  if (entry.nameBytes !== undefined) {
    const raw = asBytes(entry.nameBytes);
    if (entry.name === undefined || entry.name === null || entry.name === decodeName(raw)) return validateName(raw);
  }
  if (typeof entry.name !== 'string') throw new GitError('Corrupt', 'Tree entry needs a name or nameBytes');
  return validateName(encoder.encode(entry.name));
}

/** Git compares tree names as raw bytes and appends an implicit slash to directory names. */
export function compareTreeEntries(left, right) {
  const leftBytes = left.nameBytes ?? nameBytes(left);
  const rightBytes = right.nameBytes ?? nameBytes(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  const leftNext = leftBytes[length] ?? (treeMode(left.mode) === GitTreeMode.Tree ? 47 : 0);
  const rightNext = rightBytes[length] ?? (treeMode(right.mode) === GitTreeMode.Tree ? 47 : 0);
  return leftNext - rightNext;
}

function normalizedEntries(entries, format, options) {
  if (!Array.isArray(entries)) throw new TypeError('Tree entries must be an array');
  checkLimit(entries.length, options.maxEntries ?? 1_000_000, 'Tree entry count');
  const seen = new Set();
  let size = 0;
  const normalized = entries.map(entry => {
    const mode = treeMode(entry.mode);
    const name = nameBytes(entry);
    checkLimit(name.length, options.maxNameBytes ?? 4096, 'Tree entry name size');
    size += mode.toString(8).length + 1 + name.length + 1 + format.oidBytes;
    checkLimit(size, options.maxObjectBytes ?? MAX_OBJECT_BYTES, 'Tree byte size');
    const identity = bytesToHex(name);
    if (seen.has(identity)) throw new GitError('Corrupt', 'Duplicate tree entry name');
    seen.add(identity);
    const oid = validateObjectId(entry.oid, format, { allowZero: false });
    return { mode, nameBytes: name, oid };
  });
  return { normalized, size };
}

/** Encode a tree in canonical order, rejecting duplicate/path/mode errors before allocation. */
export function encodeTree(entries, options = {}) {
  checkCancelled(options.signal);
  const format = getObjectFormat(options.algorithm);
  const { normalized, size } = normalizedEntries(entries, format, options);
  normalized.sort(compareTreeEntries);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const entry of normalized) {
    const mode = encoder.encode(`${entry.mode.toString(8)} `);
    output.set(mode, offset);
    offset += mode.length;
    output.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length + 1;
    output.set(hexToBytes(entry.oid), offset);
    offset += format.oidBytes;
  }
  checkCancelled(options.signal);
  return output;
}

/** Decode strict tree ordering, raw filename bytes and format-specific IDs. Unsupported UTF-8 names have name=null. */
export function decodeTree(input, options = {}) {
  const data = asBytes(input);
  const format = getObjectFormat(options.algorithm);
  checkLimit(data.length, options.maxObjectBytes ?? MAX_OBJECT_BYTES, 'Tree byte size');
  const entries = [];
  const seen = new Set();
  let offset = 0;
  while (offset < data.length) {
    if (!(entries.length & 4095)) checkCancelled(options.signal);
    checkLimit(entries.length + 1, options.maxEntries ?? 1_000_000, 'Tree entry count');
    const space = data.indexOf(32, offset);
    if (space < 0 || space - offset > 6) throw new GitError('Corrupt', 'Malformed tree mode');
    const spelling = String.fromCharCode(...data.subarray(offset, space));
    const mode = treeMode(spelling);
    const zero = data.indexOf(0, space + 1);
    if (zero < 0 || zero + 1 + format.oidBytes > data.length) throw new GitError('Corrupt', 'Truncated tree entry');
    checkLimit(zero - space - 1, options.maxNameBytes ?? 4096, 'Tree entry name size');
    const rawName = validateName(data.slice(space + 1, zero));
    const key = bytesToHex(rawName);
    if (seen.has(key)) throw new GitError('Corrupt', 'Duplicate tree entry name');
    seen.add(key);
    const oid = validateObjectId(bytesToHex(data.subarray(zero + 1, zero + 1 + format.oidBytes)), format, { allowZero: false });
    const entry = { mode, name: decodeName(rawName), nameBytes: rawName, oid };
    if (entries.length && compareTreeEntries(entries.at(-1), entry) >= 0) throw new GitError('Corrupt', 'Unsorted tree entries');
    entries.push(entry);
    offset = zero + 1 + format.oidBytes;
  }
  return entries;
}
