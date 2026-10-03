import { patchStrongNameDirectory } from './strong-name.js';
import { finalizeDeterministicPE } from './determinism.js';
import { appendWin32ResourceSection } from './win32-section.js';
import { patchManagedResourceDirectory } from './managed-resources.js';
import { desktopEntryStub } from './entry-stub.js';
import { Writer, CilError, align, utf8 } from '../binary.js';
import { peOptions, writeOptionalHeader, PEDirectoryNames } from './headers.js';

const sectionKinds = Object.freeze({ '.text': 0x60000020, '.rsrc': 0x40000040, '.reloc': 0x42000040 });
const sectionOrder = Object.freeze({ '.text': 0, '.rsrc': 1, '.reloc': 2 });

function sectionLayout(input, options, headers) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 96) throw new CilError('Invalid PE section count');
  const seen = new Set();
  let offset = headers, rva = options.firstSectionRva;
  return [...input].sort((left, right) => (sectionOrder[left.name] ?? 3) - (sectionOrder[right.name] ?? 3)).map(section => {
    if (typeof section.name !== 'string' || !/^[\x21-\x7e]{1,8}$/.test(section.name) || seen.has(section.name)) {
      throw new CilError('Invalid or duplicate PE section name');
    }
    if (!(section.data instanceof Uint8Array)) throw new CilError('PE section data must be Uint8Array');
    seen.add(section.name);
    if (section.characteristics !== undefined && (!Number.isInteger(section.characteristics)
      || section.characteristics < 0 || section.characteristics > 0xffffffff)) throw new CilError('Invalid PE section characteristics');
    const size = align(section.data.length, options.fileAlignment);
    const record = { ...section, offset, rva, size, virtualSize: section.data.length,
      characteristics: section.characteristics ?? sectionKinds[section.name] ?? 0x40000040 };
    offset += size;
    rva += align(Math.max(section.data.length, 1), options.sectionAlignment);
    if (offset > 128 * 1024 * 1024 || rva > 0xffffffff) throw new CilError('PE section layout exceeds image limits');
    return record;
  });
}

function dataDirectories(sections, contributions) {
  const directories = PEDirectoryNames.map(name => ({ name, rva: 0, size: 0 }));
  const inferred = {};
  for (const [name, index] of [['.rsrc', 2], ['.reloc', 5]]) {
    const section = sections.find(item => item.name === name);
    if (section) inferred[index] = { section: name, offset: 0, size: section.virtualSize };
  }
  for (const [key, descriptor] of Object.entries({ ...inferred, ...contributions })) {
    const index = /^\d+$/.test(key) ? Number(key) : PEDirectoryNames.indexOf(key);
    if (index < 0 || index > 15) throw new CilError(`Invalid PE data directory: ${key}`);
    if (!descriptor) continue;
    const section = sections.find(item => item.name === descriptor.section);
    const offset = descriptor.offset ?? 0, size = descriptor.size;
    if (!section || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(size) || size < 0
      || offset + size > section.virtualSize) throw new CilError('PE directory exceeds its section');
    directories[index] = { name: PEDirectoryNames[index], rva: size ? section.rva + offset : 0, size };
  }
  return directories;
}

/** Serialize ordered sections with computed directory RVAs and header/file alignment. */
export function writePortableExecutable(input, inputOptions = {}) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 96) throw new CilError('Invalid PE section count');
  const options = peOptions(inputOptions);
  const optionalSize = options.pe32Plus ? 240 : 224;
  const sizeOfHeaders = align(0x80 + 24 + optionalSize + input.length * 40, options.fileAlignment);
  if (options.firstSectionRva < align(sizeOfHeaders, options.sectionAlignment)) throw new CilError('PE sections overlap image headers');
  const sections = sectionLayout(input, options, sizeOfHeaders);
  const directories = dataDirectories(sections, options.directories ?? {});
  const sizeOfImage = align(sections.at(-1).rva + sections.at(-1).virtualSize, options.sectionAlignment);
  const addressLimit = options.pe32Plus ? 0x10000000000000000n : 0x100000000n;
  if (options.imageBase + BigInt(sizeOfImage) > addressLimit) throw new CilError('PE image exceeds platform address space');
  const library = ['library', 'netmodule'].includes(options.outputKind);
  const characteristics = 2 | (options.platform === 'x86' ? 0x100 : 0x20) | (library ? 0x2000 : 0);
  const writer = new Writer(sizeOfHeaders + sections.reduce((size, section) => size + section.size, 0));
  writer.u16(0x5a4d).zero(58).u32(0x80).zero(64).u32(0x4550);
  writer.u16(options.machine).u16(sections.length).u32(options.timestamp ?? 0).u32(0).u32(0).u16(optionalSize).u16(characteristics);
  const optionalStart = writer.length;
  writeOptionalHeader(writer, { sections, directories, sizeOfHeaders, sizeOfImage }, options);
  if (writer.length - optionalStart !== optionalSize) throw new CilError('Invalid optional PE header');
  for (const section of sections) {
    const name = utf8(section.name);
    writer.bytes(name).zero(8 - name.length).u32(section.virtualSize).u32(section.rva).u32(section.size).u32(section.offset);
    writer.u32(0).u32(0).u16(0).u16(0).u32(section.characteristics);
  }
  writer.zero(sizeOfHeaders - writer.length);
  for (const section of sections) writer.bytes(section.data).zero(section.size - section.data.length);
  const bytes = writer.finish();
  return options.deterministic ? finalizeDeterministicPE(bytes) : bytes;
}

/** Fill a CLI header in the first section, then emit an IL-only image. */
export function writeManagedPE(sectionBytes, metadataOffset, metadataLength, entryToken, inputOptions = {}) {
  const options = peOptions(inputOptions);
  if (!Number.isInteger(entryToken) || entryToken < 0 || entryToken > 0xffffffff) throw new CilError('Invalid CLI entry point');
  if (!(sectionBytes instanceof Uint8Array) || sectionBytes.length < 72) throw new CilError('Missing CLI header reservation');
  if (!Number.isInteger(metadataOffset) || metadataOffset < 72 || !Number.isInteger(metadataLength) || metadataLength < 1
    || metadataOffset + metadataLength > sectionBytes.length) throw new CilError('Invalid CLI metadata range');
  let section = new Uint8Array(sectionBytes);
  let additionalSections = options.sections ?? [];
  if (options.nativeEntryStub) {
    const stub = desktopEntryStub(section, options);
    section = stub.section;
    options.nativeEntryPoint = stub.nativeEntryPoint;
    options.directories = { ...options.directories, ...stub.directories };
    additionalSections = [...additionalSections, { name: '.reloc', data: stub.relocation }];
  }
  additionalSections = appendWin32ResourceSection(section, additionalSections, options);
  const cli = new DataView(section.buffer);
  cli.setUint32(0, 72, true);
  cli.setUint16(4, 2, true);
  cli.setUint16(6, 5, true);
  cli.setUint32(8, options.firstSectionRva + metadataOffset, true);
  cli.setUint32(12, metadataLength, true);
  cli.setUint32(16, options.corFlags, true);
  cli.setUint32(20, entryToken, true);
  patchManagedResourceDirectory(cli, options, sectionBytes.length, metadataOffset, metadataLength);
  patchStrongNameDirectory(cli, options, sectionBytes.length, metadataOffset, metadataLength);
  const bytes = writePortableExecutable([{ name: '.text', data: section }, ...additionalSections], {
    ...options, deterministic: false, directories: { ...options.directories, cliHeader: { section: '.text', offset: 0, size: 72 } },
  });
  return options.deterministic ? finalizeDeterministicPE(bytes) : bytes;
}
