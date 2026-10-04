import { Reader, CilError } from '../binary.js';
import { readMetadata } from '../metadata.js';
import { CorFlags, PEDirectoryNames } from './headers.js';
import { readMethodBody } from './method-body.js';

function readSections(reader, sectionCount) {
  const sections = [];
  reader.need(sectionCount * 40);
  for (let index = 0; index < sectionCount; index++) {
    const headerOffset = reader.position;
    const name = String.fromCharCode(...reader.take(8)).replace(/\0.*$/, '');
    const virtualSize = reader.u32(), rva = reader.u32(), size = reader.u32(), offset = reader.u32();
    reader.take(12);
    const characteristics = reader.u32();
    if (offset + size > reader.end || rva + Math.max(size, virtualSize) > 0x100000000) throw new CilError('Truncated PE section');
    sections.push({ name, rva, virtualSize, size, offset, headerOffset, characteristics });
  }
  return sections;
}

function readHeaders(bytes) {
  const reader = new Reader(bytes);
  if (reader.u16() !== 0x5a4d) throw new CilError('Not a PE assembly (missing MZ header)');
  reader.position = 0x3c;
  reader.position = reader.u32();
  if (reader.u32() !== 0x4550) throw new CilError('Invalid PE signature');
  const machine = reader.u16(), sectionCount = reader.u16(), timestamp = reader.u32();
  reader.u32();
  reader.u32();
  const optionalSize = reader.u16(), characteristics = reader.u16(), optionalStart = reader.position;
  const optional = new Reader(bytes, optionalStart, optionalSize);
  const magic = optional.u16();
  if (magic !== 0x10b && magic !== 0x20b) throw new CilError('Invalid optional PE header');
  if (sectionCount < 1 || sectionCount > 96) throw new CilError('Invalid PE section count');
  const pe32Plus = magic === 0x20b;
  optional.position = optionalStart + 16;
  const addressOfEntryPoint = optional.u32();
  optional.position = optionalStart + (pe32Plus ? 24 : 28);
  const imageBaseLow = optional.u32();
  const imageBase = BigInt(imageBaseLow) | (pe32Plus ? BigInt(optional.u32()) << 32n : 0n);
  const sectionAlignment = optional.u32(), fileAlignment = optional.u32();
  optional.position = optionalStart + 56;
  const sizeOfImage = optional.u32(), sizeOfHeaders = optional.u32(), checksum = optional.u32(), subsystem = optional.u16();
  const dllCharacteristics = optional.u16();
  optional.position = optionalStart + (pe32Plus ? 108 : 92);
  const directoryCount = optional.u32();
  if (directoryCount < 15) throw new CilError('Missing CLI data directory');
  if (directoryCount > 64) throw new CilError('Too many PE data directories');
  optional.need(directoryCount * 8);
  const dataDirectories = PEDirectoryNames.map(name => ({ name, rva: 0, size: 0 }));
  for (let index = 0; index < directoryCount; index++) {
    const rva = optional.u32(), size = optional.u32();
    if (index < 16) dataDirectories[index] = { name: PEDirectoryNames[index], rva, size };
  }
  reader.position = optionalStart + optionalSize;
  const sections = readSections(reader, sectionCount);
  const directories = Object.fromEntries(dataDirectories.map(directory => [directory.name, directory]));
  return { machine, timestamp, characteristics, optionalStart, magic, pe32Plus, addressOfEntryPoint, imageBase,
    sectionAlignment, fileAlignment, sizeOfImage, sizeOfHeaders, checksum, subsystem, dllCharacteristics,
    directoryCount, dataDirectories, directories, sections };
}

function createOffsetResolver(sections) {
  return (rva, length = 1) => {
    if (!Number.isInteger(rva) || rva < 0 || !Number.isInteger(length) || length < 0 || rva + length > 0x100000000) {
      throw new CilError('Invalid RVA range', rva);
    }
    let result = -1;
    for (const section of sections) {
      if (rva < section.rva || rva - section.rva + length > section.size) continue;
      if (result !== -1) throw new CilError('Invalid or ambiguous RVA', rva);
      result = section.offset + rva - section.rva;
    }
    if (result === -1) throw new CilError('Invalid or ambiguous RVA', rva);
    return result;
  };
}

function cliDirectory(reader) {
  return { rva: reader.u32(), size: reader.u32() };
}

function readCliHeader(bytes, headers, offsetOf) {
  const cli = headers.directories.cliHeader;
  if (cli.size < 72) throw new CilError('Not a managed CLI image');
  const reader = new Reader(bytes, offsetOf(cli.rva, 72), 72);
  if (reader.u32() < 72) throw new CilError('Invalid CLI header');
  const cliVersion = [reader.u16(), reader.u16()];
  const metadataDirectory = cliDirectory(reader);
  const flags = reader.u32(), entryPoint = reader.u32();
  const resources = cliDirectory(reader), strongNameSignature = cliDirectory(reader), codeManagerTable = cliDirectory(reader);
  const vtableFixups = cliDirectory(reader), exportAddressTableJumps = cliDirectory(reader), managedNativeHeader = cliDirectory(reader);
  let imageKind = flags & CorFlags.ILOnly ? 'ILOnly' : 'MixedMode';
  if (managedNativeHeader.size) {
    const at = offsetOf(managedNativeHeader.rva, managedNativeHeader.size);
    const signature = new Reader(bytes, at, managedNativeHeader.size).u32();
    imageKind = signature === 0x00525452 ? 'ReadyToRun' : 'ManagedNative';
  }
  return { cliVersion, metadataDirectory, flags, corFlags: flags, entryPoint, resources, strongNameSignature, codeManagerTable,
    vtableFixups, exportAddressTableJumps, managedNativeHeader, imageKind, nativeEntryPoint: !!(flags & CorFlags.NativeEntryPoint) };
}

/** Read PE/CLI binary structure; inspection never executes managed or native code. */
export function readPortableExecutable(input, {
  maxBytes = 64 * 1024 * 1024, inspection = false, metadataOptions,
} = {}) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes) throw new CilError('Invalid PE input or assembly exceeds size limit');
  const headers = readHeaders(bytes);
  const offsetOf = createOffsetResolver(headers.sections);
  const cli = readCliHeader(bytes, headers, offsetOf);
  if (!inspection && (!(cli.flags & CorFlags.ILOnly) || cli.nativeEntryPoint)) {
    throw new CilError('Only IL-only managed entry points are supported');
  }
  const metadataOffset = offsetOf(cli.metadataDirectory.rva, cli.metadataDirectory.size);
  const metadata = readMetadata(bytes.subarray(metadataOffset, metadataOffset + cli.metadataDirectory.size), metadataOptions);
  const result = { bytes, ...headers, ...cli, metadataOffset, metadata, offsetOf,
    isLibrary: !!(headers.characteristics & 0x2000) };
  result.methodBody = methodToken => readMethodBody(result, methodToken, inspection);
  return result;
}
