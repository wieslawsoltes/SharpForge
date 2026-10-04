import { decodeTypeSignature, formatSignatureType } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { metadataName } from './metadata-facts.js';

/** Per-load bounded metadata names and local signature displays; only owned strings escape. */
export function createMetadataTypeNames(metadata, label = 'Import') {
  const names = new Map(),
    active = new Set();
  let blobBytes = 0,
    nameChars = 0;
  const adapter = { ...metadata, string: (index) => metadataName(metadata, index, label + ' type') };
  function references(node, state) {
    if (!node || typeof node !== 'object') return;
    if (node.token) {
      state.characters += resolve(node.token, state.depth + 1).length;
      if (state.characters > 16384) fail(label + ' type expansion limit exceeded');
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) references(child, state);
      else if (value && typeof value === 'object') references(value, state);
    }
  }
  function resolve(token, depth = 0) {
    if (depth > 32 || active.has(token)) fail(label + ' type recursion limit exceeded');
    if (names.has(token)) return names.get(token);
    if (names.size + active.size >= 4096) fail(label + ' type count limit exceeded');
    active.add(token);
    let name;
    if (token >>> 24 === 27) {
      const bytes = metadata.blob(metadata.row(token)[0]);
      if (bytes.length > 4096 || (blobBytes += bytes.length) > 1024 * 1024)
        fail(label + ' TypeSpec byte limit exceeded');
      const type = decodeTypeSignature(bytes, { maxDepth: 32, maxNodes: 256 });
      references(type, { characters: 0, depth });
      name = formatSignatureType(type, { typeName: resolve }, { maxDepth: 32, maxNodes: 256, initialDepth: depth });
    } else {
      if (token >>> 24 !== 1 && token >>> 24 !== 2) fail('Invalid ' + label.toLowerCase() + ' type handle');
      if (token >>> 24 === 2 && (metadata.rows[41]?.length ?? 0) > 65536)
        fail(label + ' nested type count limit exceeded');
      name = metadata.typeName.call(adapter, token, depth);
    }
    if (name.length > 4096 || (nameChars += name.length) > 1024 * 1024) fail(label + ' type name limit exceeded');
    names.set(token, name);
    active.delete(token);
    return name;
  }
  adapter.typeName = resolve;
  const displays = new WeakMap();
  function format(type, formatType) {
    if (!formatType && displays.has(type)) return displays.get(type);
    references(type, { characters: 0, depth: 0 });
    const name = formatSignatureType(type, { typeName: resolve }, { maxDepth: 32, maxNodes: 256, formatType });
    if (name.length > 4096 || (nameChars += name.length) > 1024 * 1024) fail(label + ' type name limit exceeded');
    if (!formatType) displays.set(type, name);
    return name;
  }
  return { resolve, format };
}
