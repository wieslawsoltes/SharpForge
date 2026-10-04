import { Writer, CilError } from '../binary.js';
import { win32ResourceEntries } from './win32-input.js';

import { maximumWin32ResourceBytes } from './win32-limits.js';
function validKey(key) {
  return Number.isInteger(key) && key >= 0 && key <= 65535
    || typeof key === 'string' && key.length > 0 && key.length <= 1024 && !key.includes('\0');
}
function compareKeys(left, right) {
  if (typeof left !== typeof right) return typeof left === 'string' ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}
function resourceTree(entries) {
  if (!Array.isArray(entries) || entries.length > 65535) throw new CilError('Invalid Win32 resource count');
  const root = new Map();
  let bytes = 0;
  const names = new Set();
  for (const entry of entries) {
    if (!entry || !validKey(entry.type) || !validKey(entry.name) || !Number.isInteger(entry.language)
      || entry.language < 0 || entry.language > 65535) throw new CilError('Invalid Win32 resource key');
    if (!(entry.bytes instanceof Uint8Array)) throw new CilError('Win32 resource data must be Uint8Array');
    if (!Number.isInteger(entry.codePage ?? 0) || (entry.codePage ?? 0) < 0 || (entry.codePage ?? 0) > 0xffffffff) {
      throw new CilError('Invalid Win32 resource code page');
    }
    bytes += entry.bytes.length + 88;
    for (const key of [entry.type, entry.name]) if (typeof key === 'string' && !names.has(key)) {
      names.add(key);
      bytes += 2 + key.length * 2;
    }
    if (bytes > maximumWin32ResourceBytes) throw new CilError('Win32 resources exceed size limit');
    if (!root.has(entry.type)) root.set(entry.type, new Map());
    const type = root.get(entry.type);
    if (!type.has(entry.name)) type.set(entry.name, new Map());
    const name = type.get(entry.name);
    if (name.has(entry.language)) throw new CilError('Duplicate Win32 resource key');
    name.set(entry.language, { bytes: entry.bytes, codePage: entry.codePage });
  }
  return root;
}
function allocateNodes(tree, writer, nodes) {
  const entries = [...tree].sort(([left], [right]) => compareKeys(left, right));
  const node = { offset: writer.length, entries };
  nodes.push(node);
  writer.zero(16 + entries.length * 8);
  for (const entry of entries) if (entry[1] instanceof Map) entry[1] = allocateNodes(entry[1], writer, nodes);
  return node;
}
function nameHandle(key, writer, names) {
  if (typeof key === 'number') return key;
  if (!names.has(key)) {
    const offset = writer.length;
    writer.u16(key.length);
    for (let index = 0; index < key.length; index++) writer.u16(key.charCodeAt(index));
    names.set(key, (offset | 0x80000000) >>> 0);
  }
  return names.get(key);
}

/** Build a deterministic three-level .rsrc directory for its final section RVA. */
export function writeWin32Resources(options, { sectionRva, library = false } = {}) {
  if (!Number.isInteger(sectionRva) || sectionRva < 0 || sectionRva > 0xffffffff - maximumWin32ResourceBytes) {
    throw new CilError('Invalid Win32 resource section RVA');
  }
  const tree = resourceTree(win32ResourceEntries(options, { library }));
  const writer = new Writer(), nodes = [], names = new Map();
  allocateNodes(tree, writer, nodes);
  for (const node of nodes) {
    const named = node.entries.filter(([key]) => typeof key === 'string').length;
    writer.view.setUint16(node.offset + 12, named, true);
    writer.view.setUint16(node.offset + 14, node.entries.length - named, true);
    for (const [index, [key, value]] of node.entries.entries()) {
      const at = node.offset + 16 + index * 8;
      writer.patch32(at, nameHandle(key, writer, names));
      if (value.entries) writer.patch32(at + 4, value.offset | 0x80000000);
      else {
        writer.pad();
        writer.patch32(at + 4, writer.length);
        writer.u32(sectionRva + writer.length + 16).u32(value.bytes.length).u32(value.codePage ?? 0).u32(0).bytes(value.bytes).pad();
      }
      if (writer.length > maximumWin32ResourceBytes) throw new CilError('Win32 resources exceed size limit');
    }
  }
  return writer.finish();
}
