import { PdbGuids, fail } from './contracts.js';
import * as enc from './cdi-enc.js';
import * as compilation from './cdi-compilation.js';
import * as core from './cdi-core.js';

const codecs = new Map([
  [PdbGuids.encSlots, [enc.readSlots, enc.writeSlots]],
  [PdbGuids.encLambdas, [enc.readLambdas, enc.writeLambdas]],
  [PdbGuids.encStates, [enc.readStates, enc.writeStates]],
  [PdbGuids.defaultNamespace, [compilation.readNamespace, compilation.writeNamespace]],
  [PdbGuids.compilationOptions, [compilation.readOptions, compilation.writeOptions]],
  [PdbGuids.embeddedSource, [core.readEmbeddedSource, core.writeEmbeddedSource]],
  [PdbGuids.sourceLink, [core.readSourceLink, core.writeSourceLink]],
  [PdbGuids.asyncSteps, [core.readAsync, core.writeAsync]],
  [PdbGuids.hoistedScopes, [core.readHoisted, core.writeHoisted]],
]);

/** Decode standard Roslyn CDI fields; unknown kinds retain independent raw bytes. */
export function readCustomDebugInformation(kind, bytes, options = {}) {
  const limits = { maxBytes: 64 * 1024 * 1024, maxSourceBytes: 16 * 1024 * 1024, maxRecords: 1_000_000, ...options };
  for (const name of ['maxBytes', 'maxSourceBytes', 'maxRecords']) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 0) fail('Invalid custom debug budget');
  }
  if (!(bytes instanceof Uint8Array) || bytes.length > limits.maxBytes)
    fail('Invalid or oversized custom debug information');
  const codec = codecs.get(kind?.toLowerCase());
  return codec ? codec[0](bytes, limits) : { bytes: bytes.slice() };
}

/** Encode structured CDI, or preserve an explicitly supplied raw payload byte-for-byte. */
export function writeCustomDebugInformation(kind, record, options = {}) {
  if (record.bytes instanceof Uint8Array) return record.bytes.slice();
  const codec = codecs.get(kind?.toLowerCase());
  if (!codec) fail('Unknown custom debug kind requires raw bytes');
  const bytes = codec[1](record);
  readCustomDebugInformation(kind, bytes, options);
  return bytes;
}
