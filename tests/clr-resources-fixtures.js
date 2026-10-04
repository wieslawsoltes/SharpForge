import { Writer } from '@sharpforge/cil';

export function resourceVarint(writer, value) {
  while (value >= 128) {
    writer.u8((value % 128) | 128);
    value = Math.floor(value / 128);
  }
  return writer.u8(value);
}

function encodedString(text, utf16 = false) {
  if (!utf16) return new TextEncoder().encode(text);
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < text.length; index++) view.setUint16(index * 2, text.charCodeAt(index), true);
  return bytes;
}

export function resourceString(text, utf16 = false) {
  const bytes = encodedString(text, utf16);
  return resourceVarint(new Writer(), bytes.length).bytes(bytes).finish();
}

function nameHash(name) {
  let result = 5381;
  for (const character of Array.from({ length: name.length }, (_, index) => name.charCodeAt(index))) {
    result = Math.imul(result, 33) ^ character;
  }
  return result;
}

/** Independent minimal format writer with recorded corruption offsets; product code provides no resource writer. */
export function resourceImage(entries, { types = [], managerVersion = 1, version = 2,
  readerType = 'System.Resources.ResourceReader, mscorlib', resourceSetType = 'System.Resources.RuntimeResourceSet' } = {}) {
  const header = new Writer().bytes(resourceString(readerType)).bytes(resourceString(resourceSetType)).finish();
  const writer = new Writer().u32(0xbeefcace).u32(managerVersion).u32(header.length).bytes(header);
  const formatOffset = writer.length;
  writer.u32(version).u32(entries.length).u32(types.length);
  for (const name of types) writer.bytes(resourceString(name));
  writer.pad(8);
  const hashStart = writer.length;
  const names = new Writer();
  const data = new Writer();
  const records = [];
  for (const entry of entries) {
    const namePosition = names.length;
    names.bytes(resourceString(entry.name, true));
    const dataField = names.length;
    names.u32(entry.alias ?? data.length);
    const dataPosition = entry.alias ?? data.length;
    if (entry.alias === undefined) resourceVarint(data, entry.type).bytes(entry.data ?? new Uint8Array());
    records.push({ name: entry.name, hash: nameHash(entry.name), namePosition, dataField, dataPosition });
  }
  const sorted = [...records].sort((left, right) => left.hash - right.hash);
  for (const record of sorted) writer.u32(record.hash);
  const positionsStart = writer.length;
  for (const record of sorted) writer.u32(record.namePosition);
  const dataOffsetField = writer.length;
  writer.u32(0);
  const namesStart = writer.length;
  writer.bytes(names.finish());
  const dataStart = writer.length;
  writer.bytes(data.finish()).patch32(dataOffsetField, dataStart);
  return { bytes: writer.finish(), headerBytes: header.length, formatOffset, hashStart, positionsStart, dataOffsetField, namesStart, dataStart,
    records: records.map(record => ({ ...record, dataField: namesStart + record.dataField, dataPosition: dataStart + record.dataPosition })),
    metadataBytes: encodedString(readerType).length + encodedString(resourceSetType).length
      + types.reduce((sum, name) => sum + encodedString(name).length, 0)
      + entries.reduce((sum, entry) => sum + encodedString(entry.name, true).length, 0) };
}

export function primitiveResourceImage() {
  return resourceImage([
    { name: 'answer', type: 8, data: new Writer().u32(42).finish() },
    { name: 'text', type: 1, data: resourceString('\ufeffZażółć\0😃') },
    { name: 'bytes', type: 32, data: new Writer().u32(3).bytes(Uint8Array.of(1, 2, 3)).finish() },
    { name: 'stream', type: 33, data: new Writer().u32(2).bytes(Uint8Array.of(4, 5)).finish() },
    { name: '', type: 0 },
    { name: 'opaque', type: 64, data: Uint8Array.of(0xde, 0xad, 0xbe, 0xef) },
  ], { types: ['Fixture.Serialized, Fixture'] });
}
