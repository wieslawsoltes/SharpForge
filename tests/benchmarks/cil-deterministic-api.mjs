import { writePE as writeManagedPE } from '@sharpforge/cil';
export { readPE } from '@sharpforge/cil';

/** Adapt the existing 64 KiB PE benchmark to exercise deterministic finalization. */
export function writePE(section, metadataOffset, metadataLength, entryToken) {
  return writeManagedPE(section, metadataOffset, metadataLength, entryToken, { deterministic: true });
}
