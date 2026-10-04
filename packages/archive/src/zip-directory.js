import { portablePath } from './path-policy.js';
import { crc32 } from './zip-crc.js';
import { zipError, ZipBudget, verifyZipNames } from './zip-budgets.js';
import { zipView, parseExtraFields, resolveZip64, readUint64 } from './zip64.js';
import { readZipMetadata } from './zip-metadata.js';

const decoder = new TextDecoder('utf-8', { fatal: true });
const ibm437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function pathName(raw, fields, flags) {
  let name;
  try {
    name = flags & 0x800 ? decoder.decode(raw) : Array.from(raw, byte => byte < 128 ? String.fromCharCode(byte) : ibm437[byte - 128]).join('');
  }
  catch { zipError('SFZIP008', 'Invalid ZIP path encoding'); }
  const unicode = fields.get(0x7075);
  if (unicode) {
    if (unicode.length < 5 || unicode[0] !== 1 || zipView(unicode).getUint32(1, true) !== crc32(raw)) {
      zipError('SFZIP008', 'Invalid Unicode ZIP path field');
    }
    let decoded;
    try { decoded = decoder.decode(unicode.subarray(5)); }
    catch { zipError('SFZIP008', 'Invalid ZIP Unicode path encoding'); }
    if (flags & 0x800 && decoded !== name) zipError('SFZIP006', 'Conflicting ZIP Unicode names');
    name = decoded;
  }
  return name;
}

function centralEntry(bytes, offset, limits) {
  const view = zipView(bytes);
  if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
    zipError('SFZIP008', 'Invalid ZIP central entry');
  }
  const nameLength = view.getUint16(offset + 28, true);
  const extraLength = view.getUint16(offset + 30, true);
  const commentLength = view.getUint16(offset + 32, true);
  const end = offset + 46 + nameLength + extraLength + commentLength;
  if (!nameLength || end > bytes.length) zipError('SFZIP008', 'Truncated ZIP central entry');
  const made = view.getUint16(offset + 4, true);
  const version = view.getUint16(offset + 6, true);
  const flags = view.getUint16(offset + 8, true);
  const method = view.getUint16(offset + 10, true);
  if (version > 45 || flags & ~(0x800 | 8 | 6) || flags & 1) zipError('SFZIP009', 'Encrypted or unsupported ZIP features');
  if (![0, 8].includes(method)) zipError('SFZIP009', 'Unsupported ZIP compression method ' + method);
  const rawName = bytes.slice(offset + 46, offset + 46 + nameLength);
  const fields = parseExtraFields(bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));
  const name = pathName(rawName, fields, flags);
  const attrs = view.getUint32(offset + 38, true);
  const directory = /[\\/]$/.test(name) || made >>> 8 === 3 && (attrs >>> 16 & 0xf000) === 0x4000 || !!(attrs & 16);
  const resolved = resolveZip64(fields, {
    length: view.getUint32(offset + 24, true),
    compressed: view.getUint32(offset + 20, true),
    local: view.getUint32(offset + 42, true),
    disk: view.getUint16(offset + 34, true)
  });
  if (resolved.disk) zipError('SFZIP009', 'Multi-disk ZIP entry is unsupported');
  if (method === 0 && resolved.length !== resolved.compressed) zipError('SFZIP008', 'Stored ZIP size mismatch');
  const metadata = readZipMetadata({
    made, attrs, directory, fields,
    dosTime: view.getUint16(offset + 12, true), dosDate: view.getUint16(offset + 14, true)
  });
  let path;
  try { path = portablePath(name, { ...limits, directory }); }
  catch (error) { zipError('SFZIP006', error.message); }
  return {
    end,
    entry: {
      path, directory, rawName, flags, method,
      crc: view.getUint32(offset + 16, true), ...resolved, ...metadata
    }
  };
}

/** Parse only the central directory; payload bytes are never retained here. */
export function parseZipDirectory(bytes, end, limits) {
  if (end.count > limits.maxEntries || end.size > limits.maxCentralBytes || end.start + end.size !== end.offset) {
    zipError('SFZIP008', 'Invalid ZIP central directory or entry limit');
  }
  if (bytes.length !== end.size || end.start < 0) zipError('SFZIP008', 'ZIP central-directory length mismatch');
  const budget = new ZipBudget(limits);
  const entries = [];
  let offset = 0;
  for (let index = 0; index < end.count; index++) {
    limits.signal?.throwIfAborted();
    const item = centralEntry(bytes, offset, limits);
    const entry = item.entry;
    budget.entry(entry.length, entry.compressed, entry.directory);
    if (entry.local + 30 + entry.compressed > end.start) zipError('SFZIP007', 'ZIP payload overlaps central directory');
    entries.push(entry);
    offset = item.end;
  }
  if (offset !== bytes.length) zipError('SFZIP008', 'ZIP central-directory length mismatch');
  budget.finish();
  verifyZipNames(entries, limits);
  return entries;
}

/** Compare local and central names, flags and declared sizes before any payload escapes. */
export function parseZipLocal(bytes, entry, centralStart) {
  const view = zipView(bytes);
  if (bytes.length < 30 || view.getUint32(0, true) !== 0x04034b50) zipError('SFZIP008', 'Invalid ZIP local header');
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const length = 30 + nameLength + extraLength;
  const data = entry.local + length;
  if (bytes.length < length || data + entry.compressed > centralStart || nameLength !== entry.rawName.length) {
    zipError('SFZIP008', 'Truncated or overlapping ZIP local header');
  }
  if (view.getUint16(6, true) !== entry.flags || view.getUint16(8, true) !== entry.method ||
      !entry.rawName.every((byte, index) => bytes[30 + index] === byte)) {
    zipError('SFZIP008', 'Central/local ZIP header mismatch');
  }
  const fields = parseExtraFields(bytes.subarray(30 + nameLength, length));
  const local = resolveZip64(fields, { length: view.getUint32(22, true), compressed: view.getUint32(18, true) });
  if (!(entry.flags & 8) && (view.getUint32(14, true) !== entry.crc || local.length !== entry.length || local.compressed !== entry.compressed)) {
    zipError('SFZIP008', 'Central/local ZIP size or CRC mismatch');
  }
  return { data, descriptorZip64: !!local.zip64 || entry.length >= 0xffffffff || entry.compressed >= 0xffffffff };
}

export function zipDescriptorLength(bytes, entry, zip64 = false) {
  const view = zipView(bytes);
  const width = zip64 ? 20 : 12;
  const valid = offset => {
    if (offset + width > bytes.length || view.getUint32(offset, true) !== entry.crc) return false;
    const compressed = zip64 ? readUint64(view, offset + 4) : view.getUint32(offset + 4, true);
    const length = zip64 ? readUint64(view, offset + 12) : view.getUint32(offset + 8, true);
    return compressed === entry.compressed && length === entry.length;
  };
  if (valid(0)) return width;
  if (bytes.length >= 4 && view.getUint32(0, true) === 0x08074b50 && valid(4)) return width + 4;
  zipError('SFZIP008', 'Invalid ZIP data descriptor');
}
