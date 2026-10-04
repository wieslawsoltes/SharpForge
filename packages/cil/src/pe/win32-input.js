import { Reader, Writer, CilError, utf8 } from '../binary.js';
import { maximumWin32ResourceBytes } from './win32-limits.js';
import { writeWin32Version } from './win32-version.js';

function iconEntries(bytes, language) {
  if (!(bytes instanceof Uint8Array)) throw new CilError('Win32 icon must be an ICO Uint8Array');
  const reader = new Reader(bytes);
  if (reader.u16() !== 0 || reader.u16() !== 1) throw new CilError('Invalid Win32 ICO header');
  const count = reader.u16();
  if (count < 1 || count > 256) throw new CilError('Invalid Win32 ICO image count');
  reader.need(count * 16);
  const group = new Writer().u16(0).u16(1).u16(count), entries = [];
  for (let index = 0; index < count; index++) {
    const description = reader.take(12), offset = reader.u32();
    const size = new DataView(description.buffer, description.byteOffset, 12).getUint32(8, true);
    if (!size || offset < 6 + count * 16 || offset + size > bytes.length) throw new CilError('Invalid Win32 ICO image range');
    group.bytes(description).u16(index + 1);
    entries.push({ type: 3, name: index + 1, language, bytes: bytes.subarray(offset, offset + size) });
  }
  entries.push({ type: 14, name: 1, language, bytes: group.finish() });
  return entries;
}

/** Normalize explicit Win32 inputs; raw entries allow lossless replay without interpreting application data. */
export function win32ResourceEntries(options, { library = false } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new CilError('Invalid Win32 resource options');
  const language = options.language ?? 0x409;
  if (!Number.isInteger(language) || language < 0 || language > 65535) throw new CilError('Invalid Win32 resource language');
  if (options.entries !== undefined) {
    if (Object.keys(options).some(key => key !== 'entries')) throw new CilError('Raw Win32 entries cannot be combined with resource options');
    return options.entries;
  }
  for (const key of Object.keys(options)) {
    if (!['language', 'version', 'manifest', 'icon'].includes(key)) throw new CilError(`Unknown Win32 resource option: ${key}`);
  }
  const entries = [];
  if (options.version !== undefined) entries.push({ type: 16, name: 1, language,
    bytes: writeWin32Version(options.version, { language, library }) });
  if (options.manifest !== undefined) {
    if (typeof options.manifest === 'string' && options.manifest.length > maximumWin32ResourceBytes) {
      throw new CilError('Win32 application manifest exceeds size limit before UTF-8 encoding');
    }
    if (typeof options.manifest !== 'string' || !options.manifest || options.manifest.includes('\0')) {
      throw new CilError('Win32 application manifest must be nonempty XML text without NUL');
    }
    entries.push({ type: 24, name: library ? 2 : 1, language, bytes: utf8(options.manifest) });
  }
  if (options.icon !== undefined) entries.push(...iconEntries(options.icon, language));
  return entries;
}
