import { Writer, CilError } from '../binary.js';

function wide(writer, value) {
  for (let index = 0; index < value.length; index++) writer.u16(value.charCodeAt(index));
  return writer.u16(0);
}
function block(key, value, valueLength, type, children = []) {
  const writer = new Writer().u16(0).u16(valueLength).u16(type);
  wide(writer, key).pad();
  writer.bytes(value);
  for (const child of children) writer.pad().bytes(child);
  if (writer.length > 65535) throw new CilError('Win32 version block exceeds size limit');
  writer.view.setUint16(0, writer.length, true);
  return writer.finish();
}
function versionParts(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(value)) throw new CilError('Invalid Win32 file version');
  const parts = value.split('.').map(Number);
  if (parts.some(part => part > 65535)) throw new CilError('Win32 version component exceeds UInt16');
  return parts;
}
const stringKeys = Object.freeze({ companyName: 'CompanyName', fileDescription: 'FileDescription', productName: 'ProductName',
  originalFilename: 'OriginalFilename', internalName: 'InternalName', legalCopyright: 'LegalCopyright', comments: 'Comments' });

/** Encode VS_VERSIONINFO with fixed numeric versions, Unicode string table and translation. */
export function writeWin32Version(options, { language = 0x409, library = false } = {}) {
  if (!options || typeof options !== 'object') throw new CilError('Invalid Win32 version options');
  for (const key of Object.keys(options)) {
    if (!['fileVersion', 'productVersion', ...Object.keys(stringKeys)].includes(key)) throw new CilError(`Unknown Win32 version field: ${key}`);
  }
  const file = versionParts(options.fileVersion), product = versionParts(options.productVersion ?? options.fileVersion);
  const fixed = new Writer().u32(0xfeef04bd).u32(0x10000).u32(file[0] * 65536 + file[1]).u32(file[2] * 65536 + file[3]);
  fixed.u32(product[0] * 65536 + product[1]).u32(product[2] * 65536 + product[3]);
  fixed.u32(0x3f).u32(0).u32(0x40004).u32(library ? 2 : 1).u32(0).u32(0).u32(0);
  const values = { FileVersion: file.join('.'), ProductVersion: product.join('.') };
  for (const [option, key] of Object.entries(stringKeys)) if (options[option] !== undefined) values[key] = options[option];
  const strings = Object.entries(values).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, value]) => {
    if (typeof value !== 'string' || value.includes('\0') || value.length > 8192) throw new CilError('Invalid Win32 version string');
    return block(key, wide(new Writer(), value).finish(), value.length + 1, 1);
  });
  const table = block(language.toString(16).padStart(4, '0') + '04b0', new Uint8Array(), 0, 1, strings);
  const stringInfo = block('StringFileInfo', new Uint8Array(), 0, 1, [table]);
  const translation = block('Translation', new Writer().u16(language).u16(1200).finish(), 4, 0);
  const variables = block('VarFileInfo', new Uint8Array(), 0, 1, [translation]);
  return block('VS_VERSION_INFO', fixed.finish(), 52, 0, [stringInfo, variables]);
}
