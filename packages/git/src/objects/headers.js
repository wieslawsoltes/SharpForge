import { GitError, checkLimit } from '../errors.js';
import { asBytes, concatenateBytes } from '../hash/bytes.js';
import { MAX_OBJECT_BYTES } from './framing.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function headerValues(headers, key) {
  return headers.filter(header => header.key === key).map(header => header.value);
}

export function singleHeader(headers, key, { required = true } = {}) {
  const values = headerValues(headers, key);
  if (values.length > 1 || required && values.length !== 1) throw new GitError('Corrupt', 'Invalid Git object header count', { key });
  return values[0];
}

function validateKey(key) {
  if (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key)) throw new GitError('Corrupt', 'Invalid object header key');
  return key;
}

/** Parse continued headers while retaining their exact byte spelling and message bytes. */
export function decodeHeaders(input, options = {}) {
  const data = asBytes(input);
  checkLimit(data.length, options.maxObjectBytes ?? MAX_OBJECT_BYTES, 'Git object size');
  const headers = [];
  let offset = 0;
  let messageOffset = -1;
  while (offset < data.length) {
    const lineEnd = data.indexOf(10, offset);
    if (lineEnd < 0) throw new GitError('Corrupt', 'Git object lacks a header/message separator');
    checkLimit(lineEnd + 1, options.maxHeaderBytes ?? 1024 * 1024, 'Git header bytes');
    if (lineEnd === offset) {
      messageOffset = lineEnd + 1;
      break;
    }
    const start = offset;
    const space = data.indexOf(32, offset);
    if (space <= offset || space > lineEnd || space - offset > 128) throw new GitError('Corrupt', 'Malformed Git object header');
    const key = validateKey(String.fromCharCode(...data.subarray(offset, space)));
    const chunks = [data.subarray(space + 1, lineEnd)];
    offset = lineEnd + 1;
    while (data[offset] === 32) {
      const end = data.indexOf(10, offset);
      if (end < 0) throw new GitError('Corrupt', 'Unterminated continued Git header');
      checkLimit(end + 1, options.maxHeaderBytes ?? 1024 * 1024, 'Git header bytes');
      chunks.push(new Uint8Array([10]), data.subarray(offset + 1, end));
      offset = end + 1;
    }
    const valueBytes = concatenateBytes(chunks);
    if (valueBytes.includes(0)) throw new GitError('Corrupt', 'NUL in Git object header');
    checkLimit(headers.length + 1, options.maxHeaders ?? 4096, 'Git header count');
    headers.push({ key, value: decoder.decode(valueBytes), valueBytes, raw: data.slice(start, offset) });
  }
  if (messageOffset < 0) throw new GitError('Corrupt', 'Git object lacks a header/message separator');
  return { headers, messageBytes: data.slice(messageOffset), raw: data.slice() };
}

export function normalizeHeader(header) {
  if (Array.isArray(header)) header = { key: header[0], value: header[1] };
  const key = validateKey(header?.key ?? header?.name);
  const value = header.value ?? (header.valueBytes === undefined ? '' : decoder.decode(asBytes(header.valueBytes)));
  if (typeof value !== 'string' || value.includes('\0')) throw new GitError('Corrupt', 'Invalid Git header value');
  return { ...header, key, value };
}

/** Rewrite one semantic header family while preserving unrelated headers and their relative order. */
export function setHeaderValues(headers, key, values) {
  const old = headerValues(headers, key);
  if (old.length === values.length && old.every((value, index) => value === values[index])) return headers;
  const first = headers.findIndex(header => header.key === key);
  const filtered = headers.filter(header => header.key !== key);
  filtered.splice(first < 0 ? filtered.length : first, 0, ...values.map(value => ({ key, value })));
  return filtered;
}

export function encodeHeaders(headers, messageBytes, options = {}) {
  const chunks = [];
  let headerBytes = 0;
  checkLimit(headers.length, options.maxHeaders ?? 4096, 'Git header count');
  for (const record of headers) {
    const header = normalizeHeader(record);
    const original = header.valueBytes === undefined ? null : asBytes(header.valueBytes);
    const value = original && decoder.decode(original) === header.value ? original : encoder.encode(header.value);
    if (value.includes(0)) throw new GitError('Corrupt', 'NUL in Git object header');
    const prefix = encoder.encode(`${header.key} `);
    const pieces = [prefix];
    let offset = 0;
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== 10) continue;
      pieces.push(value.subarray(offset, index + 1), new Uint8Array([32]));
      offset = index + 1;
    }
    pieces.push(value.subarray(offset), new Uint8Array([10]));
    for (const piece of pieces) {
      headerBytes += piece.length;
      checkLimit(headerBytes, options.maxHeaderBytes ?? 1024 * 1024, 'Git header bytes');
      chunks.push(piece);
    }
  }
  chunks.push(new Uint8Array([10]), messageBytes);
  const size = headerBytes + 1 + messageBytes.length;
  checkLimit(size, options.maxObjectBytes ?? MAX_OBJECT_BYTES, 'Git object size');
  return concatenateBytes(chunks, size);
}

export function decodeMessage(bytes, encoding = 'UTF-8') {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return null;
  }
}

/** Preserve source encoding exactly; edited non-UTF-8 messages require explicit messageBytes. */
export function encodeMessage(record, encoding = 'UTF-8') {
  const original = record.messageBytes === undefined ? null : asBytes(record.messageBytes);
  if (original && (record.message === undefined || record.message === null || record.message === decodeMessage(original, encoding))) {
    return original;
  }
  const message = record.message ?? '';
  if (typeof message !== 'string') throw new GitError('Corrupt', 'Git object message must be text or bytes');
  if (!/^utf-?8$/i.test(encoding)) throw new GitError('Unsupported', 'Provide messageBytes to write this Git message encoding', { encoding });
  return encoder.encode(message);
}
