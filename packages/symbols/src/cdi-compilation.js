import { Reader, Writer, text, utf8 } from '@sharpforge/cil';
import { fail } from './contracts.js';

function terminatedString(reader) {
  const start = reader.position;
  while (reader.position < reader.end && reader.bytes[reader.position] !== 0) reader.position++;
  if (reader.position === reader.end) fail('Unterminated custom debug string');
  const value = text(reader.bytes.subarray(start, reader.position));
  reader.position++;
  return value;
}

function writeString(writer, value) {
  if (typeof value !== 'string' || value.includes('\0')) fail('Invalid custom debug string');
  writer.bytes(utf8(value)).u8(0);
}

export function readOptions(bytes, { maxRecords }) {
  const reader = new Reader(bytes);
  const entries = [];
  const names = new Set();
  while (reader.position < reader.end) {
    if (entries.length >= maxRecords) fail('Custom debug record limit exceeded');
    const name = terminatedString(reader);
    if (names.has(name)) fail('Duplicate compilation option');
    names.add(name);
    entries.push([name, terminatedString(reader)]);
  }
  return { options: Object.fromEntries(entries) };
}

export function writeOptions({ options }) {
  const writer = new Writer();
  for (const [name, value] of Object.entries(options)) {
    writeString(writer, name);
    writeString(writer, value);
  }
  return writer.finish();
}

export const readNamespace = (bytes) => ({ namespace: text(bytes) });
export const writeNamespace = (record) => {
  if (typeof record.namespace !== 'string') fail('Invalid default namespace');
  return utf8(record.namespace);
};
