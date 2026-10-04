import { Reader, Writer, token, text, utf8 } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { inflateRaw, deflateRaw } from './deflate.js';

export function readEmbeddedSource(bytes, { maxSourceBytes }) {
  const reader = new Reader(bytes);
  const size = reader.i32();
  if (size < 0 || size > maxSourceBytes) fail('Invalid embedded source size');
  const content = reader.take(reader.end - reader.position);
  if (content.length > maxSourceBytes) fail('Embedded source size exceeds budget');
  return { source: size ? inflateRaw(content, size, maxSourceBytes) : content.slice() };
}
export function writeEmbeddedSource({ source }) {
  if (!(source instanceof Uint8Array)) fail('Embedded source must be bytes');
  if (source.length >= 200) {
    const compressed = deflateRaw(source, { maxBytes: 16 * 1024 * 1024 });
    if (compressed.length < source.length) return new Writer().u32(source.length).bytes(compressed).finish();
  }
  return new Writer().u32(0).bytes(source).finish();
}
export function readSourceLink(bytes) {
  let sourceLink;
  try {
    sourceLink = JSON.parse(text(bytes));
  } catch {
    fail('Invalid Source Link JSON');
  }
  if (
    !sourceLink ||
    typeof sourceLink.documents !== 'object' ||
    Array.isArray(sourceLink.documents) ||
    !sourceLink.documents
  ) {
    fail('Invalid Source Link document map');
  }
  for (const [pattern, url] of Object.entries(sourceLink.documents)) {
    if (typeof url !== 'string' || pattern.split('*').length > 2 || url.split('*').length > 2)
      fail('Invalid Source Link mapping');
  }
  return { sourceLink };
}
export function writeSourceLink({ sourceLink }) {
  const bytes = utf8(JSON.stringify(sourceLink));
  readSourceLink(bytes);
  return bytes;
}
export function readAsync(bytes, { maxRecords }) {
  const reader = new Reader(bytes);
  const catchHandlerOffset = reader.u32() - 1;
  const awaits = [];
  while (reader.position < reader.end) {
    if (awaits.length >= maxRecords) fail('Custom debug record limit exceeded');
    const yieldOffset = reader.u32();
    const resumeOffset = reader.u32();
    const row = reader.compressed();
    if (!row || row > 0xffffff) fail('Invalid async resume method');
    awaits.push({ yieldOffset, resumeOffset, resumeMethod: token(6, row) });
  }
  return { catchHandlerOffset, awaits };
}
export function writeAsync(record) {
  const catchOffset = record.catchHandlerOffset ?? -1;
  if (!Number.isInteger(catchOffset) || catchOffset < -1 || catchOffset >= 0xffffffff)
    fail('Invalid async catch offset');
  const writer = new Writer().u32(catchOffset + 1);
  for (const item of record.awaits ?? []) {
    if (item.resumeMethod >>> 24 !== 6 || !(item.resumeMethod & 0xffffff)) fail('Invalid async resume method');
    for (const offset of [item.yieldOffset, item.resumeOffset]) {
      if (!Number.isInteger(offset) || offset < 0 || offset > 0xffffffff) fail('Invalid async stepping offset');
    }
    writer
      .u32(item.yieldOffset)
      .u32(item.resumeOffset)
      .compressed(item.resumeMethod & 0xffffff);
  }
  return writer.finish();
}
export function readHoisted(bytes, { maxRecords }) {
  if (bytes.length % 8) fail('Malformed hoisted scopes');
  if (bytes.length / 8 > maxRecords) fail('Custom debug record limit exceeded');
  const reader = new Reader(bytes);
  const scopes = [];
  while (reader.position < reader.end) {
    const start = reader.u32();
    scopes.push({ start, end: start + reader.u32() });
  }
  return { scopes };
}
export function writeHoisted({ scopes }) {
  const writer = new Writer();
  for (const scope of scopes) {
    if (
      !Number.isInteger(scope.start) ||
      !Number.isInteger(scope.end) ||
      scope.start < 0 ||
      scope.end < scope.start ||
      scope.end >= 0x80000000
    ) {
      fail('Invalid hoisted scope');
    }
    writer.u32(scope.start).u32(scope.end - scope.start);
  }
  return writer.finish();
}
