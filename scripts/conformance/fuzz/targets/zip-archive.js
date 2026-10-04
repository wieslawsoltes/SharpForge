import { crc32, deflateStored, writeZip } from '@sharpforge/archive';
import { Writer, utf8 } from '@sharpforge/cil';
import { binaryAdmission, binaryLimits } from './binary-guards.js';
import { importZipIntoMemory } from './binary-workspace-import.js';
import { workspaceArchiveSeeds } from './binary-workspace-seeds.js';

function compressedSeed() {
  const name = utf8('note.txt');
  const source = utf8('small archive\n');
  const compressed = deflateStored(source);
  const checksum = crc32(source);
  const local = new Writer().u32(0x04034b50).u16(20).u16(0x800).u16(8).u32(0)
    .u32(checksum).u32(compressed.length).u32(source.length).u16(name.length).u16(0)
    .bytes(name).bytes(compressed).finish();
  const directory = new Writer().u32(0x02014b50).u16(20).u16(20).u16(0x800).u16(8).u32(0)
    .u32(checksum).u32(compressed.length).u32(source.length).u16(name.length).u16(0).u16(0)
    .u16(0).u16(0).u32(0).u32(0).bytes(name).finish();
  const bytes = new Writer().bytes(local).bytes(directory).u32(0x06054b50).u16(0).u16(0).u16(1).u16(1)
    .u32(directory.length).u32(local.length).u16(0).finish();
  return { name: 'small-deflate', input: bytes };
}

/** Import bounded archives through the real workspace APIs into fixed memory-only destination handles. */
export const target = Object.freeze({
  id: 'zip-archive',
  createSeeds() {
    return [
      { name: 'empty-archive', input: writeZip([]) },
      { name: 'single-file', input: writeZip([{ path: 'note.txt', text: 'small archive\n' }]) },
      { name: 'directory-and-file', input: writeZip([
        { path: 'docs', directory: true }, { path: 'docs/note.txt', text: 'bounded\n' },
      ]) },
      compressedSeed(),
      ...workspaceArchiveSeeds(),
    ];
  },
  async run(input, context) {
    const limits = binaryLimits(input, context);
    const admission = binaryAdmission(input, limits);
    if (admission) return admission;
    const { failure } = await importZipIntoMemory(input, {
      maxArchiveBytes: limits.maxInputBytes,
      maxEntries: 32,
      maxFileBytes: limits.maxOutputBytes,
      maxTotalBytes: limits.maxOutputBytes,
      maxPathLength: 128,
      maxDepth: 8,
    }, limits.signal);
    return failure ?? { status: 'accepted', code: 'ZIP_WORKSPACE_IMPORTED_IN_MEMORY' };
  },
});
