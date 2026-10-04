import { CilError, Reader } from '../binary.js';

function moduleId(metadata) {
  const index = metadata.rows[0]?.[0]?.[2];
  if (!index) throw new CilError('Module MVID is unavailable');
  const bytes = metadata.guid(index);
  if (!bytes.some((value) => value !== 0)) throw new CilError('Module MVID is unavailable');
  const order = [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15];
  const value = order.map((index) => bytes[index].toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function checkedToken(metadata, token) {
  if (!Number.isInteger(token) || token < 1 || token > 0xffffffff || !(token & 0xffffff))
    throw new CilError('Invalid navigation token');
  if (token >>> 24 !== 0x70) {
    metadata.row(token);
  } else {
    const heap = metadata.streams.get('#US');
    if (!heap) throw new CilError('User-string heap is unavailable');
    const reader = new Reader(heap, token & 0xffffff);
    const size = reader.compressed();
    if (!size || !(size & 1)) throw new CilError('Invalid UTF-16 user string');
    reader.need(size);
  }
  return token;
}

/** A module MVID plus validated CLI token; generating a URI never decodes a method or string value. */
export function metadataTokenUri(metadata, token) {
  checkedToken(metadata, token);
  return `sf-metadata://${moduleId(metadata)}/0x${token.toString(16).padStart(8, '0')}`;
}

/** Resolve only identities belonging to this exact module; no assembly loading or body decoding occurs. */
export function resolveMetadataUri(metadata, uri) {
  if (typeof uri !== 'string' || uri.length !== 61) throw new CilError('Invalid metadata URI');
  const match = /^sf-metadata:\/\/([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})\/0x([\da-f]{8})$/i.exec(uri);
  if (!match) throw new CilError('Invalid metadata URI');
  const mvid = moduleId(metadata);
  if (match[1].toLowerCase() !== mvid) throw new CilError('Metadata URI belongs to a different module');
  return { mvid, token: checkedToken(metadata, Number.parseInt(match[2], 16)) };
}
