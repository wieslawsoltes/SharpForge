import { Reader, CilError } from '../binary.js';

/** Read owned scalar tiny/fat CIL header facts without decoding IL or exception sections; absent RVA returns null. */
export function readMethodHeader(pe, methodToken) {
  if (
    !Number.isInteger(methodToken) ||
    methodToken < 0x06000001 ||
    methodToken > 0x06000000 + (pe.metadata.counts[6] ?? 0)
  )
    throw new CilError('Expected MethodDef token');
  const row = pe.metadata.row(methodToken);
  const rva = row[0];
  if (!Number.isInteger(rva) || rva < 0 || rva > 0xffffffff) throw new CilError('Invalid method RVA');
  if (!rva) return null;
  const fileOffset = pe.offsetOf(rva, 1);
  const section = pe.sections.find((item) => fileOffset >= item.offset && fileOffset < item.offset + item.size);
  if (!section) throw new CilError('Method header is outside a section');
  const sectionEnd = section.offset + section.size;
  const reader = new Reader(pe.bytes, fileOffset, sectionEnd - fileOffset);
  const first = reader.u8();
  let codeSize, maxStack, headerSize;
  let localSignature = 0,
    moreSections = false,
    initLocals = false;
  if ((first & 3) === 2) {
    codeSize = first >>> 2;
    maxStack = 8;
    headerSize = 1;
  } else if ((first & 3) === 3) {
    reader.position = fileOffset;
    const header = reader.u16();
    headerSize = (header >>> 12) * 4;
    if (headerSize < 12) throw new CilError('Invalid fat method header');
    moreSections = !!(header & 8);
    initLocals = !!(header & 0x10);
    maxStack = reader.u16();
    codeSize = reader.u32();
    localSignature = reader.u32();
    reader.need(headerSize - 12);
  } else throw new CilError('Unsupported method header');
  pe.offsetOf(rva, headerSize + codeSize);
  return {
    fileOffset,
    headerSize,
    codeOffset: fileOffset + headerSize,
    codeSize,
    sectionEnd,
    maxStack,
    localSignature,
    moreSections,
    initLocals,
  };
}
