import { Reader, CilError } from '../binary.js';
import { PEDirectoryNames } from './headers.js';

function address(reader, wide) {
  const low = BigInt(reader.u32());
  return wide ? low | BigInt(reader.u32()) << 32n : low;
}

/** Shared PE optional-header decoder; all integer widths and directory extents are checked by Reader. */
export function readOptionalHeader(bytes, optionalStart, optionalSize) {
  const reader = new Reader(bytes, optionalStart, optionalSize);
  const magic = reader.u16();
  if (magic !== 0x10b && magic !== 0x20b) throw new CilError('Invalid optional PE header');
  const pe32Plus = magic === 0x20b;
  const majorLinkerVersion = reader.u8(), minorLinkerVersion = reader.u8();
  const sizeOfCode = reader.u32(), sizeOfInitializedData = reader.u32(), sizeOfUninitializedData = reader.u32();
  const addressOfEntryPoint = reader.u32(), baseOfCode = reader.u32();
  const baseOfData = pe32Plus ? null : reader.u32();
  const imageBase = address(reader, pe32Plus);
  const sectionAlignment = reader.u32(), fileAlignment = reader.u32();
  const majorOperatingSystemVersion = reader.u16(), minorOperatingSystemVersion = reader.u16();
  const majorImageVersion = reader.u16(), minorImageVersion = reader.u16();
  const majorSubsystemVersion = reader.u16(), minorSubsystemVersion = reader.u16();
  const win32VersionValue = reader.u32();
  const sizeOfImage = reader.u32(), sizeOfHeaders = reader.u32(), checksum = reader.u32();
  const subsystem = reader.u16(), dllCharacteristics = reader.u16();
  const sizeOfStackReserve = address(reader, pe32Plus), sizeOfStackCommit = address(reader, pe32Plus);
  const sizeOfHeapReserve = address(reader, pe32Plus), sizeOfHeapCommit = address(reader, pe32Plus);
  const loaderFlags = reader.u32(), directoryCount = reader.u32();
  if (directoryCount < 15) throw new CilError('Missing CLI data directory');
  if (directoryCount > 64) throw new CilError('Too many PE data directories');
  reader.need(directoryCount * 8);
  const dataDirectories = PEDirectoryNames.map(name => ({ name, rva: 0, size: 0 }));
  const additionalDataDirectories = [];
  for (let index = 0; index < directoryCount; index++) {
    const directory = { name: PEDirectoryNames[index] ?? `directory${index}`, rva: reader.u32(), size: reader.u32() };
    if (index < 16) dataDirectories[index] = directory;
    else additionalDataDirectories.push(directory);
  }
  const directories = Object.fromEntries(dataDirectories.map(directory => [directory.name, directory]));
  return { optionalStart, optionalSize, magic, pe32Plus, majorLinkerVersion, minorLinkerVersion, sizeOfCode,
    sizeOfInitializedData, sizeOfUninitializedData, addressOfEntryPoint, baseOfCode, baseOfData, imageBase,
    sectionAlignment, fileAlignment, majorOperatingSystemVersion, minorOperatingSystemVersion, majorImageVersion,
    minorImageVersion, majorSubsystemVersion, minorSubsystemVersion, win32VersionValue, sizeOfImage, sizeOfHeaders,
    checksum, subsystem, dllCharacteristics, sizeOfStackReserve, sizeOfStackCommit, sizeOfHeapReserve, sizeOfHeapCommit,
    loaderFlags, directoryCount, dataDirectories, additionalDataDirectories, directories };
}
