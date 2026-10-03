import { Writer, CilError, utf8 } from '../binary.js';

/** Add the desktop CLR import thunk and its required x86 absolute-address relocation. */
export function desktopEntryStub(sectionBytes, options) {
  if (options.platform === 'arm64') throw new CilError('The mscorlib4 native entry stub does not support ARM64');
  const is64 = options.pe32Plus;
  const pointerSize = is64 ? 8 : 4;
  const section = new Writer(sectionBytes.length + 160).bytes(sectionBytes).pad(pointerSize);
  const importOffset = section.length;
  section.zero(40);
  const lookupOffset = section.length;
  section.zero(pointerSize * 2);
  const addressOffset = section.length;
  section.zero(pointerSize * 2);
  const hintOffset = section.length;
  const entryName = ['library', 'netmodule'].includes(options.outputKind) ? '_CorDllMain' : '_CorExeMain';
  section.u16(0).bytes(utf8(entryName)).u8(0);
  const libraryOffset = section.length;
  section.bytes(utf8('mscoree.dll')).u8(0).pad(4);
  const stubOffset = section.length;
  section.u8(0xff).u8(0x25);
  if (is64) section.u32(addressOffset - (stubOffset + 6));
  else section.u32(Number(options.imageBase) + options.firstSectionRva + addressOffset);
  const rva = offset => options.firstSectionRva + offset;
  section.patch32(importOffset, rva(lookupOffset));
  section.patch32(importOffset + 12, rva(libraryOffset));
  section.patch32(importOffset + 16, rva(addressOffset));
  section.patch32(lookupOffset, rva(hintOffset));
  section.patch32(addressOffset, rva(hintOffset));
  const relocation = new Writer();
  if (!is64) {
    const addressRva = rva(stubOffset + 2);
    relocation.u32(addressRva & ~0xfff).u32(12).u16(0x3000 | (addressRva & 0xfff)).u16(0);
  } else {
    // RIP-relative AMD64 code needs no fixup; an ABSOLUTE padding block keeps the relocation directory explicit.
    relocation.u32(rva(stubOffset) & ~0xfff).u32(12).u16(0).u16(0);
  }
  return { section: section.finish(), relocation: relocation.finish(), nativeEntryPoint: rva(stubOffset),
    directories: { import: { section: '.text', offset: importOffset, size: 40 },
      importAddressTable: { section: '.text', offset: addressOffset, size: pointerSize * 2 } } };
}
