import { peOptions } from '../pe/headers.js';
import { writePE } from '../pe.js';
import { CilError } from '../binary.js';
import { strongNameOptions, reserveStrongName } from '../pe/strong-name.js';
import { writeManagedResources } from '../pe/managed-resources.js';
import { linkAssemblyModules } from '../pe/module-linker.js';
import {sourceIdentityMetadata} from '../source-type-identities.js';

/** Canonical source-emitter PE options; method RVAs use the fixed .text address. */
export function emissionPEOptions(image, options, framework) {
  const requested = options.outputKind === 'module' ? 'netmodule' : options.outputKind;
  const outputKind = image.outputKind === 'library' ? (requested === 'netmodule' ? 'netmodule' : 'library') : requested ?? 'console';
  if (image.outputKind !== 'library' && ['library', 'netmodule'].includes(outputKind)) {
    throw new CilError('PE output kind must match the compiled image');
  }
  const value = { platform: options.platform ?? 'anycpu', outputKind,
    subsystem: options.subsystem ?? (outputKind === 'windows' ? 'windows' : 'console'),
    prefer32Bit: options.prefer32Bit ?? false, nativeEntryStub: framework === 'mscorlib4' && outputKind !== 'netmodule',
    strongName: strongNameOptions(options), deterministic: options.deterministic ?? true,
    managedResources: options.managedResources ?? [], win32Resources: options.win32Resources,
    linkedModules: options.linkedModules === undefined ? [] : options.linkedModules };
  peOptions(value);
  return value;
}

/** Serialize PE target choices only when they differ from the source profile defaults. */
export function debugPEOptions(options) {
  const result = {};
  if (!options.deterministic) result.deterministic = false;
  if (options.platform !== 'anycpu') result.platform = options.platform;
  if (options.prefer32Bit) result.prefer32Bit = true;
  if (options.subsystem !== 'console') result.subsystem = options.subsystem;
  if (['windows', 'netmodule'].includes(options.outputKind)) result.outputKind = options.outputKind;
  return Object.keys(result).length ? { peOptions: result } : {};
}

/** Finish metadata and PE sections after all method RVAs have been assigned. */
export function finishEmittedPE({ section, metadata, debug, includeDebug, entryToken, options }) {
  linkAssemblyModules(metadata, options.linkedModules);
  const resourceBytes = writeManagedResources(options.managedResources, metadata);
  let resources;
  if (resourceBytes.length) {
    section.pad(8);
    resources = { offset: section.length, size: resourceBytes.length };
    section.bytes(resourceBytes);
  }
  const strongNameSignature = reserveStrongName(section, metadata, options.strongName);
  section.pad();
  const metadataOffset = section.length;
  const bytes = metadata.finish(sourceIdentityMetadata(debug, includeDebug), section.finish());
  section.bytes(bytes);
  const image = writePE(section.finish(), metadataOffset, bytes.length, entryToken, { ...options, resources, strongNameSignature });
  return { bytes: image, metadataBytes: bytes.length };
}
