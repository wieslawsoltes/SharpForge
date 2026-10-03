import { Reader, Writer, text, utf8 } from '@sharpforge/cil';
import { fail, guidBytes, guidString } from './contracts.js';

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

export function readDynamic(bytes, { maxRecords }) {
  if (bytes.length * 8 > maxRecords) fail('Custom debug record limit exceeded');
  const flags = [];
  for (const byte of bytes) for (let bit = 0; bit < 8; bit++) flags.push(Boolean(byte & (1 << bit)));
  return { flags };
}

export function writeDynamic({ flags }) {
  if (!Array.isArray(flags) || flags.some((flag) => typeof flag !== 'boolean')) fail('Dynamic flags must be booleans');
  const bytes = new Uint8Array(Math.ceil(flags.length / 8));
  flags.forEach((flag, index) => {
    if (flag) bytes[index >>> 3] |= 1 << (index & 7);
  });
  let length = bytes.length;
  while (length && bytes[length - 1] === 0) length--;
  return bytes.slice(0, length);
}

export function readTuple(bytes, { maxRecords }) {
  const reader = new Reader(bytes);
  const names = [];
  while (reader.position < reader.end) {
    if (names.length >= maxRecords) fail('Custom debug record limit exceeded');
    names.push(terminatedString(reader) || null);
  }
  return { names };
}

export function writeTuple({ names }) {
  const writer = new Writer();
  for (const name of names) writeString(writer, name ?? '');
  return writer.finish();
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

export function readReferences(bytes, { maxRecords }) {
  const reader = new Reader(bytes);
  const references = [];
  while (reader.position < reader.end) {
    if (references.length >= maxRecords) fail('Custom debug record limit exceeded');
    const fileName = terminatedString(reader);
    const aliases = terminatedString(reader);
    const flags = reader.u8();
    references.push({
      fileName,
      aliases: aliases ? aliases.split(',') : [],
      flags,
      timestamp: reader.u32(),
      fileSize: reader.u32(),
      mvid: guidString(reader.take(16)),
    });
  }
  return { references };
}

export function writeReferences({ references }) {
  const writer = new Writer();
  for (const reference of references) {
    writeString(writer, reference.fileName);
    if (
      !Array.isArray(reference.aliases) ||
      reference.aliases.some((alias) => typeof alias !== 'string' || alias.includes(','))
    ) {
      fail('Invalid compilation reference aliases');
    }
    writeString(writer, reference.aliases.join(','));
    const flags = reference.flags ?? 1;
    if (!Number.isInteger(flags) || flags < 0 || flags > 255) fail('Invalid compilation reference flags');
    for (const value of [reference.timestamp, reference.fileSize]) {
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
        fail('Invalid compilation reference size or timestamp');
    }
    writer.u8(flags).u32(reference.timestamp).u32(reference.fileSize).bytes(guidBytes(reference.mvid));
  }
  return writer.finish();
}

export function readTypeDocuments(bytes, { maxRecords }) {
  const reader = new Reader(bytes);
  const documents = [];
  while (reader.position < reader.end) {
    if (documents.length >= maxRecords) fail('Custom debug record limit exceeded');
    const document = reader.compressed();
    if (!document) fail('Invalid type definition document id');
    documents.push(document);
  }
  return { documents };
}

export function writeTypeDocuments({ documents }) {
  const writer = new Writer();
  for (const document of documents) {
    if (!document) fail('Invalid type definition document id');
    writer.compressed(document);
  }
  return writer.finish();
}

export function readPrimaryConstructor(bytes) {
  if (bytes.length) fail('Primary constructor information must be empty');
  return { primaryConstructor: true };
}

export function writePrimaryConstructor({ primaryConstructor }) {
  if (primaryConstructor !== true) fail('Primary constructor information must identify a primary constructor');
  return new Uint8Array();
}

export const readNamespace = (bytes) => ({ namespace: text(bytes) });
export const writeNamespace = (record) => {
  if (typeof record.namespace !== 'string') fail('Invalid default namespace');
  return utf8(record.namespace);
};
