import { EvaluationError } from './evaluation/errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

class Writer {
  constructor() { this.bytes = []; }
  byte(value) { this.bytes.push(value & 255); }
  int32(value) { for (let offset = 0; offset < 32; offset += 8) this.byte(value >>> offset); }
  data(bytes) { for (const byte of bytes) this.byte(byte); }
  length(value) {
    for (; value >= 128; value >>>= 7) this.byte(value | 128);
    this.byte(value);
  }
  string(value, unicode = false) {
    const bytes = unicode ? Uint8Array.from([...String(value)].flatMap(char => {
      const output = [];
      for (let index = 0; index < char.length; index++) output.push(char.charCodeAt(index) & 255, char.charCodeAt(index) >>> 8);
      return output;
    })) : encoder.encode(value);
    this.length(bytes.length);
    this.data(bytes);
  }
  result() { return Uint8Array.from(this.bytes); }
}

function hashName(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash, 33) ^ value.charCodeAt(index);
  return hash | 0;
}

const typeCodes = Object.freeze({ string: 1, boolean: 2, char: 3, byte: 4, sbyte: 5, int16: 6, uint16: 7,
  int32: 8, uint32: 9, int64: 10, uint64: 11, single: 12, double: 13, bytes: 32 });

function valueBytes(resource) {
  const output = new Writer();
  const code = typeCodes[resource.type ?? 'string'];
  if (code === undefined) throw new EvaluationError(`Resource type '${resource.type}' is unsupported.`, 'SFP1501');
  output.length(code);
  if (code === 1) output.string(String(resource.value));
  else if (code === 32) { output.int32(resource.value.length); output.data(resource.value); }
  else {
    const sizes = { 2: 1, 3: 2, 4: 1, 5: 1, 6: 2, 7: 2, 8: 4, 9: 4, 10: 8, 11: 8, 12: 4, 13: 8 };
    const buffer = new ArrayBuffer(sizes[code]);
    const view = new DataView(buffer);
    const value = resource.value;
    const writers = {
      2: () => view.setUint8(0, value ? 1 : 0), 3: () => view.setUint16(0, String(value).charCodeAt(0), true),
      4: () => view.setUint8(0, value), 5: () => view.setInt8(0, value), 6: () => view.setInt16(0, value, true),
      7: () => view.setUint16(0, value, true), 8: () => view.setInt32(0, value, true), 9: () => view.setUint32(0, value, true),
      10: () => view.setBigInt64(0, BigInt(value), true), 11: () => view.setBigUint64(0, BigInt(value), true),
      12: () => view.setFloat32(0, value, true), 13: () => view.setFloat64(0, value, true),
    };
    writers[code]();
    output.data(new Uint8Array(buffer));
  }
  return output.result();
}

/** Write the documented .resources v2 format using built-in value codes, never BinaryFormatter. */
export function writeResources(resources, { maxBytes = 16 * 1024 * 1024 } = {}) {
  if (resources.length > 20000) throw new EvaluationError('Resource count limit exceeded.', 'SFP1501');
  const entries = resources.map(resource => ({ ...resource, hash: hashName(resource.name) }))
    .sort((first, second) => first.hash - second.hash || first.name.localeCompare(second.name, 'en'));
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new EvaluationError('Duplicate resource name.', 'SFP1501');
  const header = new Writer();
  header.string('System.Resources.ResourceReader, mscorlib');
  header.string('System.Resources.RuntimeResourceSet');
  const output = new Writer();
  output.int32(0xbeefcace);
  output.int32(1);
  output.int32(header.bytes.length);
  output.data(header.result());
  output.int32(2);
  output.int32(entries.length);
  output.int32(0);
  while (output.bytes.length % 8) output.byte(0);
  const names = new Writer();
  const data = new Writer();
  for (const entry of entries) {
    entry.nameOffset = names.bytes.length;
    names.string(entry.name, true);
    names.int32(data.bytes.length);
    data.data(valueBytes(entry));
    if (data.bytes.length + names.bytes.length > maxBytes) throw new EvaluationError('Resource payload limit exceeded.', 'SFP1501');
  }
  for (const entry of entries) output.int32(entry.hash);
  for (const entry of entries) output.int32(entry.nameOffset);
  output.int32(output.bytes.length + 4 + names.bytes.length);
  output.data(names.result());
  output.data(data.result());
  return output.result();
}

/** Read built-in .resources v2 records with strict offset and allocation bounds. */
export function readResources(bytes, { maxBytes = 16 * 1024 * 1024 } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes) throw new EvaluationError('Invalid resources payload.', 'SFP1502');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = 0;
  const requireBytes = count => {
    if (position < 0 || count < 0 || position + count > bytes.length) throw new EvaluationError('Truncated resources payload.', 'SFP1502');
  };
  const int32 = () => { requireBytes(4); const value = view.getInt32(position, true); position += 4; return value; };
  const length = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      requireBytes(1);
      const part = bytes[position++];
      value |= (part & 127) << shift;
      if (!(part & 128)) return value;
    }
    throw new EvaluationError('Invalid resources length.', 'SFP1502');
  };
  const string = unicode => {
    const count = length();
    requireBytes(count);
    const value = unicode ? new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(position, position + count))
      : decoder.decode(bytes.subarray(position, position + count));
    position += count;
    return value;
  };
  if ((int32() >>> 0) !== 0xbeefcace || int32() !== 1) throw new EvaluationError('Unsupported resources header.', 'SFP1502');
  const headerLength = int32();
  requireBytes(headerLength);
  position += headerLength;
  if (int32() !== 2) throw new EvaluationError('Only resources v2 is supported.', 'SFP1502');
  const count = int32();
  const types = int32();
  if (count < 0 || count > 20000 || types !== 0) throw new EvaluationError('Unsupported resources type/count table.', 'SFP1502');
  position = (position + 7) & ~7;
  requireBytes(count * 8 + 4);
  position += count * 4;
  const offsets = Array.from({ length: count }, int32);
  const dataStart = int32();
  const namesStart = position;
  const resources = [];
  for (const offset of offsets) {
    position = namesStart + offset;
    const name = string(true);
    const dataOffset = int32();
    position = dataStart + dataOffset;
    const code = length();
    if (code === 1) resources.push({ name, type: 'string', value: string(false) });
    else if (code === 32) {
      const size = int32();
      requireBytes(size);
      resources.push({ name, type: 'bytes', value: bytes.slice(position, position + size) });
    } else {
      const formats = { 2: ['boolean', 1, 'getUint8'], 3: ['char', 2, 'getUint16'], 4: ['byte', 1, 'getUint8'],
        5: ['sbyte', 1, 'getInt8'], 6: ['int16', 2, 'getInt16'], 7: ['uint16', 2, 'getUint16'], 8: ['int32', 4, 'getInt32'],
        9: ['uint32', 4, 'getUint32'], 10: ['int64', 8, 'getBigInt64'], 11: ['uint64', 8, 'getBigUint64'],
        12: ['single', 4, 'getFloat32'], 13: ['double', 8, 'getFloat64'] };
      const format = formats[code];
      if (!format) throw new EvaluationError(`Unsupported resource value code '${code}'.`, 'SFP1502');
      requireBytes(format[1]);
      let value = view[format[2]](position, true);
      if (code === 2) value = value !== 0;
      if (code === 3) value = String.fromCharCode(value);
      resources.push({ name, type: format[0], value });
    }
  }
  return resources;
}
