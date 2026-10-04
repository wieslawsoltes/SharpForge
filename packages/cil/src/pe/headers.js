import { CilError } from '../binary.js';

export const PEMachine = Object.freeze({ I386: 0x14c, AMD64: 0x8664, ARM64: 0xaa64 });
export const CorFlags = Object.freeze({ ILOnly: 1, Requires32Bit: 2, StrongNameSigned: 8,
  NativeEntryPoint: 16, TrackDebugData: 65536, Prefers32Bit: 131072 });
export const PEPlatforms = Object.freeze({
  anycpu: Object.freeze({ machine: PEMachine.I386, pe32Plus: false, flags: CorFlags.ILOnly }),
  x86: Object.freeze({ machine: PEMachine.I386, pe32Plus: false, flags: CorFlags.ILOnly | CorFlags.Requires32Bit }),
  x64: Object.freeze({ machine: PEMachine.AMD64, pe32Plus: true, flags: CorFlags.ILOnly }),
  arm64: Object.freeze({ machine: PEMachine.ARM64, pe32Plus: true, flags: CorFlags.ILOnly }),
});
export const PEDirectoryNames = Object.freeze(['export', 'import', 'resource', 'exception', 'certificate', 'baseRelocation',
  'debug', 'architecture', 'globalPointer', 'threadLocalStorage', 'loadConfiguration', 'boundImport',
  'importAddressTable', 'delayImport', 'cliHeader', 'reserved']);

function powerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

/** Normalize PE target options and reject combinations that cannot be represented faithfully. */
export function peOptions(options = {}) {
  if (options.deterministic !== undefined && typeof options.deterministic !== 'boolean') throw new CilError('Deterministic must be boolean');
  if (options.deterministic && (options.timestamp !== undefined || options.checksum !== undefined)) {
    throw new CilError('Deterministic PE computes its own timestamp and checksum');
  }
  const platform = options.platform ?? 'anycpu';
  const target = PEPlatforms[platform];
  if (!target) throw new CilError(`Unsupported PE platform: ${platform}`);
  const outputKind = options.outputKind ?? 'library';
  if (!['library', 'console', 'windows', 'exe', 'netmodule'].includes(outputKind)) throw new CilError('Invalid PE output kind');
  const subsystem = options.subsystem ?? (outputKind === 'windows' ? 'windows' : 'console');
  if (!['windows', 'console'].includes(subsystem)) throw new CilError('Invalid PE subsystem');
  const prefer32Bit = options.prefer32Bit ?? false;
  if (typeof prefer32Bit !== 'boolean') throw new CilError('Prefer32Bit must be boolean');
  if (prefer32Bit && (platform !== 'anycpu' || ['library', 'netmodule'].includes(outputKind))) {
    throw new CilError('Prefer32Bit requires an AnyCPU executable');
  }
  const fileAlignment = options.fileAlignment ?? 512;
  const sectionAlignment = options.sectionAlignment ?? 8192;
  if (!powerOfTwo(fileAlignment) || fileAlignment < 512 || fileAlignment > 65536) throw new CilError('Invalid PE file alignment');
  if (!powerOfTwo(sectionAlignment) || sectionAlignment < fileAlignment || sectionAlignment > 0x10000000) {
    throw new CilError('Invalid PE section alignment');
  }
  const firstSectionRva = options.firstSectionRva ?? Math.max(0x2000, sectionAlignment);
  if (!Number.isSafeInteger(firstSectionRva) || firstSectionRva < sectionAlignment || firstSectionRva % sectionAlignment) {
    throw new CilError('Invalid first PE section RVA');
  }
  const baseValue = options.imageBase ?? (target.pe32Plus ? 0x140000000n : 0x400000n);
  if (typeof baseValue !== 'bigint' && !Number.isSafeInteger(baseValue)) throw new CilError('Invalid PE image base');
  const imageBase = BigInt(baseValue);
  if (imageBase < 0n || imageBase % 65536n || imageBase > (target.pe32Plus ? 0xffffffffffffffffn : 0xffffffffn)) {
    throw new CilError('Invalid PE image base');
  }
  for (const value of [options.timestamp ?? 0, options.checksum ?? 0, options.nativeEntryPoint ?? 0]) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new CilError('Invalid PE header value');
  }
  return { ...options, ...target, platform, outputKind, subsystem, prefer32Bit, fileAlignment, sectionAlignment, firstSectionRva,
    imageBase, corFlags: target.flags | (prefer32Bit ? CorFlags.Requires32Bit | CorFlags.Prefers32Bit : 0) };
}

function u64(writer, value) {
  return writer.u32(Number(value & 0xffffffffn)).u32(Number(value >> 32n));
}

/** Write standard/Windows optional headers, retaining legacy bytes for default PE32 inputs. */
export function writeOptionalHeader(writer, layout, options) {
  const { sections, sizeOfHeaders, sizeOfImage, directories } = layout;
  const text = sections.find(section => section.name === '.text');
  const codeSize = sections.filter(section => section.characteristics & 0x20).reduce((sum, section) => sum + section.size, 0);
  const dataSize = sections.filter(section => !(section.characteristics & 0x20)).reduce((sum, section) => sum + section.size, 0);
  writer.u16(options.pe32Plus ? 0x20b : 0x10b).u8(1).u8(0).u32(codeSize).u32(dataSize).u32(0);
  writer.u32(options.nativeEntryPoint ?? 0).u32(text?.rva ?? 0);
  if (!options.pe32Plus) writer.u32(0).u32(Number(options.imageBase));
  else u64(writer, options.imageBase);
  writer.u32(options.sectionAlignment).u32(options.fileAlignment).u16(4).u16(0).u16(0).u16(0).u16(4).u16(0).u32(0);
  writer.u32(sizeOfImage).u32(sizeOfHeaders).u32(options.checksum ?? 0).u16(options.subsystem === 'windows' ? 2 : 3).u16(0x8540);
  if (options.pe32Plus) {
    for (const value of [0x100000n, 0x1000n, 0x100000n, 0x1000n]) u64(writer, value);
  } else writer.u32(0x100000).u32(0x1000).u32(0x100000).u32(0x1000);
  writer.u32(0).u32(16);
  for (const directory of directories) writer.u32(directory.rva).u32(directory.size);
}
