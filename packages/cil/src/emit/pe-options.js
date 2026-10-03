import { peOptions } from '../pe/headers.js';
import { writePE } from '../pe.js';
import { CilError } from '../binary.js';
import { writeManagedResources } from '../pe/managed-resources.js';

/** Canonical source-emitter PE options; method RVAs use the fixed .text address. */
export function emissionPEOptions(image, options, framework) {
  const outputKind = image.outputKind === 'library' ? 'library' : options.outputKind ?? 'console';
  if (image.outputKind !== 'library' && ['library', 'netmodule'].includes(outputKind)) {
    throw new CilError('PE output kind must match the compiled image');
  }
  const value = { platform: options.platform ?? 'anycpu', outputKind,
    subsystem: options.subsystem ?? (outputKind === 'windows' ? 'windows' : 'console'),
    prefer32Bit: options.prefer32Bit ?? false, nativeEntryStub: framework === 'mscorlib4',
    managedResources: options.managedResources ?? [] };
  peOptions(value);
  return value;
}

/** Serialize PE target choices only when they differ from the source profile defaults. */
export function debugPEOptions(options) {
  const result = {};
  if (options.platform !== 'anycpu') result.platform = options.platform;
  if (options.prefer32Bit) result.prefer32Bit = true;
  if (options.subsystem !== 'console') result.subsystem = options.subsystem;
  if (options.outputKind === 'windows') result.outputKind = 'windows';
  return Object.keys(result).length ? { peOptions: result } : {};
}

/** Finish metadata and PE sections after all method RVAs have been assigned. */
export function finishEmittedPE({ section, metadata, debug, includeDebug, entryToken, options }) {
  const resourceBytes = writeManagedResources(options.managedResources, metadata);
  let resources;
  if (resourceBytes.length) {
    section.pad(8);
    resources = { offset: section.length, size: resourceBytes.length };
    section.bytes(resourceBytes);
  }
  section.pad();
  const metadataOffset = section.length;
  const bytes = metadata.finish(includeDebug ? debug : null, section.finish());
  section.bytes(bytes);
  const image = writePE(section.finish(), metadataOffset, bytes.length, entryToken, { ...options, resources });
  return { bytes: image, metadataBytes: bytes.length };
}
