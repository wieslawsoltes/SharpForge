import { CilError } from './binary.js';
import { MetadataHeaps } from './metadata/heaps.js';

const tokenHeapLimit = 0x1000000;

function preflightLiteral(source, maxBytes) {
  const maxUnits = Math.floor((maxBytes - 3) / 2);
  if (source.length > maxUnits * 6 + 2) throw new CilError('IL user-string heap limit exceeded');
  let units = 0;
  for (let index = 1; index < source.length - 1; index++) {
    if (++units > maxUnits) throw new CilError('IL user-string heap limit exceeded');
    // JSON.parse validates escapes; this pass bounds decoded storage before it allocates.
    if (source[index] === '\\') index += source[index + 1] === 'u' ? 5 : 1;
  }
}

/** Strip a trailing comment without treating // inside a JSON string as a comment. */
export function stripILComment(line) {
  const comment = line.indexOf('//');
  if (comment < 0) return line;
  const quote = line.indexOf('"');
  if (quote < 0 || quote > comment) return line.slice(0, comment).trimEnd();
  let quoted = false;
  for (let index = quote; index < line.length; index++) {
    if (quoted && line[index] === '\\') index++;
    else if (line[index] === '"') quoted = !quoted;
    else if (!quoted && line[index] === '/' && line[index + 1] === '/') return line.slice(0, index).trimEnd();
  }
  return line;
}

/** Lazy append-only #US builder; original token offsets and bytes remain unchanged. */
export class DocumentUserStrings {
  constructor(metadata, maxBytes = tokenHeapLimit) {
    if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > tokenHeapLimit) {
      throw new CilError('Invalid IL user-string heap limit');
    }
    this.original = metadata.streams.get('#US');
    this.canAddStream = this.original !== undefined || metadata.streams.size < 32;
    this.maxBytes = maxBytes;
    this.heaps = null;
  }

  literalToken(source) {
    if (!this.canAddStream) throw new CilError('Too many metadata streams for a new #US heap');
    preflightLiteral(source, this.maxBytes);
    let value;
    try { value = JSON.parse(source); } catch { throw new CilError('Invalid JSON ldstr literal'); }
    if (typeof value !== 'string') throw new CilError('Expected a JSON ldstr string literal');
    const existing = this.heaps?.userStringMap.get(value);
    if (existing !== undefined) return 0x70000000 + existing;
    const currentSize = this.heaps?.userStrings.length ?? Math.max(1, this.original?.length ?? 0);
    const payload = value.length * 2 + 1;
    const prefix = payload < 128 ? 1 : payload < 16384 ? 2 : 4;
    if (currentSize + prefix + payload > this.maxBytes) throw new CilError('IL user-string heap limit exceeded');
    if ((this.heaps?.userStringMap.size ?? 0) >= 100000) throw new CilError('IL user-string count limit exceeded');
    if (!this.heaps) {
      if (this.original?.length && this.original[0] !== 0) throw new CilError('Invalid original #US heap prefix');
      this.heaps = new MetadataHeaps();
      if (this.original?.length) this.heaps.userStrings.bytes(this.original.subarray(1));
    }
    return 0x70000000 + this.heaps.userString(value);
  }

  finish() { return this.heaps?.userStrings.finish() ?? null; }
}
