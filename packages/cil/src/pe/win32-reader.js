import { Reader, CilError } from '../binary.js';

/** Read bounded Win32 resource trees without loading icons, manifests or executable code. */
export function readWin32Resources(pe, { includeBytes = false } = {}) {
  const directory = pe.directories.resource;
  if (!directory.size) return [];
  if (directory.size > 16 * 1024 * 1024) throw new CilError('Win32 resources exceed size limit');
  const start = pe.offsetOf(directory.rva, directory.size);
  const seen = new Set(), resources = [];
  const readerAt = (offset, length) => {
    if (offset + length > directory.size) throw new CilError('Win32 resource range exceeds directory');
    return new Reader(pe.bytes, start + offset, length);
  };
  function key(value) {
    if (!(value & 0x80000000)) return value;
    const offset = value & 0x7fffffff, count = readerAt(offset, 2).u16();
    if (count > 1024) throw new CilError('Win32 resource name exceeds size limit');
    const reader = readerAt(offset + 2, count * 2);
    let result = '';
    for (let index = 0; index < count; index++) result += String.fromCharCode(reader.u16());
    return result;
  }
  function visit(offset, path) {
    if (seen.has(offset)) throw new CilError('Cyclic or shared Win32 resource directory');
    seen.add(offset);
    const header = readerAt(offset, 16);
    header.take(12);
    const count = header.u16() + header.u16();
    const entries = readerAt(offset + 16, count * 8);
    for (let index = 0; index < count; index++) {
      const name = key(entries.u32()), target = entries.u32();
      if (path.length < 2) {
        if (!(target & 0x80000000)) throw new CilError('Win32 resource directory ends before language level');
        visit(target & 0x7fffffff, [...path, name]);
      } else {
        if (target & 0x80000000 || typeof name !== 'number' || name > 65535) throw new CilError('Invalid Win32 resource leaf');
        const data = readerAt(target, 16), rva = data.u32(), size = data.u32(), codePage = data.u32();
        const payload = rva - directory.rva;
        if (payload < 0) throw new CilError('Win32 resource payload precedes directory');
        const bytes = readerAt(payload, size);
        const resource = { type: path[0], name: path[1], language: name, codePage, size };
        if (includeBytes) resource.bytes = new Uint8Array(bytes.take(size));
        resources.push(resource);
        if (resources.length > 65535) throw new CilError('Win32 resource count exceeds limit');
      }
    }
  }
  visit(0, []);
  return resources;
}
