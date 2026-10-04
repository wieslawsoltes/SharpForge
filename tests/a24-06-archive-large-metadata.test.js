import test from 'node:test';
import assert from 'node:assert/strict';
import { openZip } from '@sharpforge/archive';
import { localHeader, centralHeader } from '../packages/archive/src/zip-headers.js';
import { writeZipEnd, resolveZip64, zip64Extra, parseExtraFields } from '../packages/archive/src/zip64.js';

class SparseBlob {
  constructor(size, segments) { this.size = size; this.segments = segments; this.largestRead = 0; this.totalRead = 0; }
  slice(start, end) {
    const length = end - start;
    this.largestRead = Math.max(this.largestRead, length);
    this.totalRead += length;
    return { arrayBuffer: async () => {
      const output = new Uint8Array(length);
      for (const [offset, bytes] of this.segments) {
        const first = Math.max(start, offset);
        const last = Math.min(end, offset + bytes.length);
        if (first < last) output.set(bytes.subarray(first - offset, last - offset), first - start);
      }
      return output.buffer;
    } };
  }
}

test('ZIP64 lists a synthetic 5 GiB stored entry with bounded tail/directory reads', async () => {
  const length = 5 * 1024 ** 3;
  const entry = { path: 'huge.bin', name: new TextEncoder().encode('huge.bin'), directory: false, length, compressed: length,
    local: 0, method: 0, crc: 0, mode: 0o100644, dosDate: 33, dosTime: 0, extra: new Uint8Array() };
  const local = localHeader(entry);
  const central = centralHeader(entry);
  const start = local.length + length;
  const end = writeZipEnd({ count: 1, size: central.length, start });
  const blob = new SparseBlob(start + central.length + end.length, [[0, local], [start, central], [start + central.length, end]]);
  const archive = await openZip(blob, { maxFileBytes: length, maxTotalBytes: length, maxArchiveBytes: blob.size });
  assert.equal(archive.entries[0].length, length);
  assert(blob.largestRead <= 65557);
  assert(blob.totalRead < 131072);
  archive.close();
  await assert.rejects(() => openZip(blob), /oversized/);
});

test('ZIP64 saturated fields must have the exact required extra metadata', () => {
  const fields = parseExtraFields(zip64Extra([0x100000000, 0x100000001, 0x100000002]));
  const result = resolveZip64(fields, { length: 0xffffffff, compressed: 0xffffffff, local: 0xffffffff, disk: 0 });
  assert.equal(result.length, 0x100000000);
  assert.equal(result.local, 0x100000002);
  assert.throws(() => resolveZip64(new Map(), { length: 0xffffffff }), /Missing/);
  assert.throws(() => resolveZip64(fields, { length: 0xffffffff, compressed: 0, local: 0, disk: 0 }), /malformed/);
});
