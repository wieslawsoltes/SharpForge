import { Writer, CilError } from './binary.js';
export const TEXT_RVA=0x2000;
export function writeMethodBody(code,localToken,maxStack,handlers=[]) {
  if(maxStack>65535)throw new CilError('Evaluation stack exceeds CLI limit');const w=new Writer().u16(0x3013|(handlers.length?8:0)).u16(Math.max(1,maxStack)).u32(code.length).u32(localToken).bytes(code);
  if(handlers.length){w.pad();const size=4+24*handlers.length;if(size>0xffffff)throw new CilError('Exception table exceeds CLI limit');w.u8(0x41).u8(size).u8(size>>>8).u8(size>>>16);for(const h of handlers)w.u32(h.flags??0).u32(h.start).u32(h.end-h.start).u32(h.target).u32(h.handlerEnd-h.target).u32(h.catchType);}
  return w.finish();
}
export { writePortableExecutable } from './pe/writer.js';
export { PEMachine, CorFlags, PEPlatforms, PEDirectoryNames } from './pe/headers.js';
export { writeManagedPE as writePE } from './pe/writer.js';
export { readPortableExecutable as readPE } from './pe/reader.js';
export { peChecksum } from './pe/checksum.js';
export { deterministicContentId, finalizeDeterministicPE } from './pe/determinism.js';
export { readManagedResources, writeManagedResources, ManifestResourceVisibility } from './pe/managed-resources.js';
export { writeWin32Resources } from './pe/win32-resources.js';
export { readWin32Resources } from './pe/win32-reader.js';
