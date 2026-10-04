import { CilError, align } from '../binary.js';
import { readMethodHeaderCore } from './method-header.js';

function exceptionSection(reader, codeSize, inspection) {
  const kind = reader.u8();
  const fat = !!(kind & 0x40);
  const size = fat ? reader.u8() | (reader.u8() << 8) | (reader.u8() << 16) : reader.u8();
  if (!fat) reader.u16();
  const rowSize = fat ? 24 : 12;
  if ((kind & 0x3f) !== 1) throw new CilError('Unsupported method data section');
  if (size < 4 || (size - 4) % rowSize) throw new CilError('Malformed EH section');
  reader.need(size - 4);
  const handlers = [];
  for (let index = 0; index < (size - 4) / rowSize; index++) {
    const flags = fat ? reader.u32() : reader.u16();
    const start = fat ? reader.u32() : reader.u16();
    const length = fat ? reader.u32() : reader.u8();
    const target = fat ? reader.u32() : reader.u16();
    const handlerLength = fat ? reader.u32() : reader.u8();
    const catchType = reader.u32();
    if (![0, 1, 2, 4].includes(flags)) throw new CilError('Invalid EH flags');
    if (!length || !handlerLength || start + length > codeSize || target + handlerLength > codeSize) throw new CilError('Invalid EH range');
    if (flags === 1 && catchType >= codeSize) throw new CilError('Invalid filter offset');
    handlers.push({ start, end: start + length, target, handlerEnd: target + handlerLength, catchType,
      ...(inspection || flags !== 0 ? { flags, kind: { 0: 'catch', 1: 'filter', 2: 'finally', 4: 'fault' }[flags] } : {}) });
  }
  return { handlers, more: !!(kind & 0x80) };
}

/** Read one bounded tiny/fat CIL method body and its exception sections. */
export function readMethodBody(pe, methodToken, inspection) {
  const header = readMethodHeaderCore(pe, methodToken, true);
  if (!header) throw new CilError('Method has no body');
  const { codeSize, maxStack, localSignature, fileOffset: at, headerSize, initLocals } = header;
  const reader = header.reader;
  reader.position = header.codeOffset;
  let more = header.moreSections;
  const code = reader.take(codeSize), handlers = [];
  let sectionsRead = 0;
  while (more) {
    if (++sectionsRead > 32) throw new CilError('Too many method sections');
    reader.position = align(reader.position);
    const section = exceptionSection(reader, codeSize, inspection);
    handlers.push(...section.handlers);
    more = section.more;
  }
  return { code, maxStack, localSignature, handlers, fileOffset: at, headerSize, initLocals };
}
