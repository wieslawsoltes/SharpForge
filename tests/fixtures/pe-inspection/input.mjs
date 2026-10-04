import { CorFlags, readPE, writePE, Writer } from '@sharpforge/cil';
import { managedFixture } from '../../managed-fixtures.js';

export const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Authored structural/admission cases, not evidence of native or ReadyToRun code generation. */
export function peFixture(options = {}) {
  const methods = options.methods ?? [{ name: 'Managed', implFlags: 0 }];
  const original = managedFixture({ name: 'PEInspectionFixture', entry: null,
    methods: methods.map(method => ({ ...method, result: 'void', body: writer => writer.op('ret') })),
    decorate({ md }) {
      methods.forEach((method, index) => {
        md.rows[6][index][1] = method.implFlags ?? 0;
        if (method.rva !== undefined) md.rows[6][index][0] = method.rva;
      });
      if (options.publicKey) {
        md.rows[32][0][5] |= 1;
        md.rows[32][0][6] = md.blob(options.publicKey);
      }
    } });
  const source = readPE(original, { inspection: true });
  const section = source.sections[0];
  const writer = new Writer().bytes(original.subarray(section.offset, section.offset + section.virtualSize)).pad();
  const signatureOffset = writer.length;
  writer.bytes(options.signature ?? new Uint8Array()).pad();
  const nativeOffset = writer.length;
  const nativeHeader = options.imageKind === 'ReadyToRun' || options.imageKind === 'ManagedNative';
  if (nativeHeader) writer.u32(options.imageKind === 'ReadyToRun' ? 0x00525452 : 0x12345678).u16(1).u16(0).zero(8);
  const debugOffset = writer.length;
  const debug = options.debug ?? [];
  writer.zero(debug.length * 28);
  const output = writePE(writer.finish(), source.metadataOffset - section.offset, source.metadataDirectory.size,
    options.entryPoint ?? 0, { platform: options.platform ?? 'anycpu',
      sections: [{ name: '.data', data: new Uint8Array([11, 22, 33, 44]), characteristics: 0x40000040 }],
      directories: { debug: { section: '.text', offset: debugOffset, size: debug.length * 28 } } });
  const extra = debug.reduce((size, entry) => size + entry.bytes.length, options.certificate?.length ?? 0);
  const bytes = new Uint8Array(output.length + extra);
  bytes.set(output);
  const pe = readPE(bytes, { inspection: true });
  const view = viewOf(bytes);
  const cliOffset = pe.offsetOf(pe.directories.cliHeader.rva, 72);
  view.setUint32(cliOffset + 16, options.corFlags ?? (options.imageKind && options.imageKind !== 'ILOnly' ? 0 : CorFlags.ILOnly), true);
  if (options.signature?.length) {
    view.setUint32(cliOffset + 32, section.rva + signatureOffset, true);
    view.setUint32(cliOffset + 36, options.signature.length, true);
  }
  if (nativeHeader) {
    view.setUint32(cliOffset + 64, section.rva + nativeOffset, true);
    view.setUint32(cliOffset + 68, 16, true);
  }
  let payloadOffset = output.length;
  const debugRecords = [];
  debug.forEach((entry, index) => {
    const recordOffset = pe.offsetOf(section.rva + debugOffset + index * 28, 28);
    view.setUint32(recordOffset, entry.characteristics ?? 0, true);
    view.setUint32(recordOffset + 4, entry.stamp ?? 0x12345678, true);
    view.setUint16(recordOffset + 8, entry.major ?? 1, true);
    view.setUint16(recordOffset + 10, entry.minor ?? 0, true);
    view.setUint32(recordOffset + 12, entry.kind ?? 42, true);
    view.setUint32(recordOffset + 16, entry.bytes.length, true);
    view.setUint32(recordOffset + 20, entry.dataRva ?? 0, true);
    view.setUint32(recordOffset + 24, payloadOffset, true);
    bytes.set(entry.bytes, payloadOffset);
    debugRecords.push({ recordOffset, payloadOffset });
    payloadOffset += entry.bytes.length;
  });
  const certificateOffset = payloadOffset;
  if (options.certificate?.length) {
    bytes.set(options.certificate, certificateOffset);
    const entry = pe.optionalStart + (pe.pe32Plus ? 112 : 96) + 4 * 8;
    view.setUint32(entry, certificateOffset, true);
    view.setUint32(entry + 4, options.certificate.length, true);
  }
  return { bytes, cliOffset, debugRecords, certificateOffset,
    tokens: Object.fromEntries(methods.map((method, index) => [method.name, 0x06000001 + index])) };
}

export function extraDirectoryFixture() {
  const fixture = peFixture();
  const pe = readPE(fixture.bytes, { inspection: true });
  const view = viewOf(fixture.bytes);
  const sectionStart = pe.optionalStart + pe.optionalSize;
  // The authored image reserves enough header padding to move its section table by one directory slot.
  fixture.bytes.copyWithin(sectionStart + 8, sectionStart, sectionStart + pe.sectionCount * 40);
  view.setUint16(pe.peHeaderOffset + 20, pe.optionalSize + 8, true);
  view.setUint32(pe.optionalStart + 92, 17, true);
  view.setUint32(sectionStart, pe.sections[1].rva, true);
  view.setUint32(sectionStart + 4, 4, true);
  return fixture;
}

export function codeView(path = 'fixture.pdb') {
  return new Writer().u32(0x53445352).bytes(Uint8Array.from({ length: 16 }, (_, index) => index))
    .u32(1).bytes(new TextEncoder().encode(path)).u8(0).finish();
}
