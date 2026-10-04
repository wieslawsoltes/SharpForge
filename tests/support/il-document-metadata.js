import { readPE, Writer, utf8, writePE } from '@sharpforge/cil';

// Independent fixture builder: replace only the metadata root of a one-section test PE.
export function withMetadataStreams(bytes, edit) {
  const pe = readPE(bytes), streams = new Map(pe.metadata.streams);
  edit(streams);
  const version = utf8('v4.0.30319\0');
  const root = new Writer().u32(0x424a5342).u16(1).u16(1).u32(0).u32(12).bytes(version).pad().u16(0).u16(streams.size);
  const headers = [];
  for (const [name, value] of streams) {
    headers.push(root.length);
    root.u32(0).u32(value.length).bytes(utf8(name)).u8(0).pad();
  }
  let index = 0;
  for (const value of streams.values()) {
    root.pad();
    root.patch32(headers[index++], root.length);
    root.bytes(value);
  }
  const section = pe.sections[0], data = new Writer().bytes(bytes.subarray(section.offset, pe.metadataOffset)).pad();
  const offset = data.length, metadata = root.finish();
  data.bytes(metadata);
  return writePE(data.finish(), offset, metadata.length, pe.entryPoint);
}
