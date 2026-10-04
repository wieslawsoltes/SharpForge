import { Reader, align } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';
import { invalidResource, resourceLimit, resourceNameHash } from './resource-codec.js';

function count(reader, maximum, label) {
  const value = reader.i32();
  if (value < 0) throw invalidResource(`Negative resource ${label} count`);
  if (value > maximum) throw resourceLimit(`Resource ${label} count limit exceeded`);
  return value;
}

function header(reader, codec, limits, budget) {
  if (reader.u32() !== 0xbeefcace) throw invalidResource('Invalid ResourceManager magic number');
  const managerVersion = reader.i32();
  const headerBytes = reader.i32();
  if (managerVersion < 0 || headerBytes < 0) throw invalidResource('Invalid ResourceManager header');
  if (headerBytes > limits.maxHeaderBytes) throw resourceLimit('ResourceManager header byte limit exceeded');
  reader.need(headerBytes);
  let readerType = null;
  let resourceSetType = null;
  if (managerVersion <= 1) {
    const start = reader.position;
    readerType = codec.string(reader, false, limits.maxHeaderBytes, budget);
    resourceSetType = codec.string(reader, false, limits.maxHeaderBytes, budget);
    if (reader.position - start > limits.maxHeaderBytes) throw resourceLimit('ResourceManager header byte limit exceeded');
    const comma = readerType.indexOf(',');
    const typeName = (comma < 0 ? readerType : readerType.slice(0, comma)).trim();
    if (!['System.Resources.ResourceReader', 'System.Resources.Extensions.DeserializingResourceReader'].includes(typeName)) {
      throw loadError(LoadErrorCode.UnsupportedFeature, `Unsupported resource reader ${readerType}`);
    }
  } else reader.position += headerBytes;
  const version = reader.i32();
  if (version !== 2) throw loadError(LoadErrorCode.UnsupportedFeature, `Resource format version ${version} is unsupported; expected 2`);
  return Object.freeze({ managerVersion, readerType, resourceSetType, version });
}

function typeNames(reader, codec, limits, budget, signal) {
  const size = count(reader, limits.maxTypes, 'type');
  const names = [];
  for (let index = 0; index < size; index++) {
    checkCancellation(signal);
    const name = codec.string(reader, false, limits.maxNameBytes, budget);
    if (!name) throw invalidResource('Empty resource user type name');
    names.push(name);
  }
  return Object.freeze(names);
}

function nameRecords(reader, total, codec, limits, budget, signal) {
  const aligned = align(reader.position, 8);
  reader.need(aligned - reader.position + total * 8 + 4);
  reader.position = aligned;
  const hashes = new Int32Array(total);
  for (let index = 0; index < total; index++) {
    hashes[index] = reader.i32();
    if (index && hashes[index] < hashes[index - 1]) throw invalidResource('Resource name hashes are not sorted');
  }
  const positions = new Uint32Array(total);
  for (let index = 0; index < total; index++) {
    const position = reader.i32();
    if (position < 0) throw invalidResource('Negative resource name offset');
    positions[index] = position;
  }
  const dataStart = reader.i32();
  const namesStart = reader.position;
  if (dataStart < namesStart || dataStart > reader.end) throw invalidResource('Resource data section offset is out of range');
  const records = new Map();
  for (let index = 0; index < total; index++) {
    checkCancellation(signal);
    const position = namesStart + positions[index];
    if (position >= dataStart) throw invalidResource('Resource name offset is outside the name section');
    const entry = new Reader(reader.bytes, position, dataStart - position);
    const name = codec.string(entry, true, limits.maxNameBytes, budget);
    if (resourceNameHash(name) !== hashes[index]) throw invalidResource(`Resource name hash mismatch for ${name}`);
    if (records.has(name)) throw invalidResource(`Duplicate resource name ${name}`);
    const offset = entry.i32();
    if (offset < 0 || offset >= reader.end - dataStart) throw invalidResource(`Resource data offset is out of range for ${name}`);
    records.set(name, dataStart + offset);
  }
  return records;
}

/** Parse bounded names and non-overlapping value extents; value decoding and user type materialization are not performed here. */
export function readResourceIndex(bytes, codec, limits, signal) {
  const reader = new Reader(bytes);
  const budget = { remaining: limits.maxMetadataBytes };
  const descriptor = header(reader, codec, limits, budget);
  const total = count(reader, limits.maxEntries, 'entry');
  const types = typeNames(reader, codec, limits, budget, signal);
  const records = nameRecords(reader, total, codec, limits, budget, signal);
  const positions = [...new Set(records.values())].sort((left, right) => left - right);
  const ends = new Map();
  for (let index = 0; index < positions.length; index++) ends.set(positions[index], positions[index + 1] ?? bytes.length);
  return { header: descriptor, types, records, ends, names: Object.freeze([...records.keys()]) };
}
