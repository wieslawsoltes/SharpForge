import { Reader, CilError } from '../binary.js';
import { readMetadata } from '../metadata.js';
import { CorFlags } from './headers.js';
import { readOptionalHeader } from './optional-header.js';
import { readMethodBody } from './method-body.js';

function readSections(reader, sectionCount) {
  const sections = [];
  reader.need(sectionCount * 40);
  for (let index = 0; index < sectionCount; index++) {
    const headerOffset = reader.position;
    const name = String.fromCharCode(...reader.take(8)).replace(/\0.*$/, '');
    const virtualSize = reader.u32(), rva = reader.u32(), size = reader.u32(), offset = reader.u32();
    const pointerToRelocations = reader.u32(), pointerToLineNumbers = reader.u32();
    const numberOfRelocations = reader.u16(), numberOfLineNumbers = reader.u16();
    const characteristics = reader.u32();
    if (offset + size > reader.end || rva + Math.max(size, virtualSize) > 0x100000000) throw new CilError('Truncated PE section');
    sections.push({ name, rva, virtualSize, size, offset, headerOffset, characteristics,
      pointerToRelocations, pointerToLineNumbers, numberOfRelocations, numberOfLineNumbers });
  }
  return sections;
}

function readHeaders(bytes) {
  const reader = new Reader(bytes);
  if (reader.u16() !== 0x5a4d) throw new CilError('Not a PE assembly (missing MZ header)');
  reader.position = 0x3c;
  const peHeaderOffset = reader.u32();
  reader.position = peHeaderOffset;
  if (reader.u32() !== 0x4550) throw new CilError('Invalid PE signature');
  const machine = reader.u16(), sectionCount = reader.u16(), timestamp = reader.u32();
  const pointerToSymbolTable = reader.u32(), numberOfSymbols = reader.u32();
  const optionalSize = reader.u16(), characteristics = reader.u16(), optionalStart = reader.position;
  if (sectionCount < 1 || sectionCount > 96) throw new CilError('Invalid PE section count');
  const optional = readOptionalHeader(bytes, optionalStart, optionalSize);
  reader.position = optionalStart + optionalSize;
  const sections = readSections(reader, sectionCount);
  return { peHeaderOffset, machine, sectionCount, timestamp, pointerToSymbolTable, numberOfSymbols, characteristics,
    ...optional, sections };
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
  const cliHeaderSize = reader.u32();
  if (cliHeaderSize < 72) throw new CilError('Invalid CLI header');
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
  return { cliHeaderSize, cliVersion, metadataDirectory, flags, corFlags: flags, entryPoint, resources, strongNameSignature, codeManagerTable,
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
