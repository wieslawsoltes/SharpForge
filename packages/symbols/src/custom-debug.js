import { PdbGuids, fail } from './contracts.js';
import { readSlots, writeSlots, readLambdas, writeLambdas, readStates, writeStates } from './cdi-enc.js';
import {
  readDynamic,
  writeDynamic,
  readTuple,
  writeTuple,
  readNamespace,
  writeNamespace,
  readOptions,
  writeOptions,
  readReferences,
  writeReferences,
  readTypeDocuments,
  writeTypeDocuments,
  readPrimaryConstructor,
  writePrimaryConstructor,
} from './cdi-compilation.js';
import {
  readEmbeddedSource,
  writeEmbeddedSource,
  readSourceLink,
  writeSourceLink,
  readAsync,
  writeAsync,
  readHoisted,
  writeHoisted,
} from './cdi-core.js';

const codecs = new Map([
  [PdbGuids.encSlots, [readSlots, writeSlots]],
  [PdbGuids.encLambdas, [readLambdas, writeLambdas]],
  [PdbGuids.encStates, [readStates, writeStates]],
  [PdbGuids.dynamicLocals, [readDynamic, writeDynamic]],
  [PdbGuids.tupleNames, [readTuple, writeTuple]],
  [PdbGuids.defaultNamespace, [readNamespace, writeNamespace]],
  [PdbGuids.compilationOptions, [readOptions, writeOptions]],
  [PdbGuids.compilationReferences, [readReferences, writeReferences]],
  [PdbGuids.typeDocuments, [readTypeDocuments, writeTypeDocuments]],
  [PdbGuids.primaryConstructor, [readPrimaryConstructor, writePrimaryConstructor]],
  [PdbGuids.embeddedSource, [readEmbeddedSource, writeEmbeddedSource]],
  [PdbGuids.sourceLink, [readSourceLink, writeSourceLink]],
  [PdbGuids.asyncSteps, [readAsync, writeAsync]],
  [PdbGuids.hoistedScopes, [readHoisted, writeHoisted]],
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
  return codec ? codec[0](bytes, limits) : { bytes: new Uint8Array(bytes) };
}

/** Encode structured CDI, or preserve an explicitly supplied raw payload byte-for-byte. */
export function writeCustomDebugInformation(kind, record, options = {}) {
  if (record.bytes instanceof Uint8Array) return new Uint8Array(record.bytes);
  const codec = codecs.get(kind?.toLowerCase());
  if (!codec) fail('Unknown custom debug kind requires raw bytes');
  const bytes = codec[1](record);
  readCustomDebugInformation(kind, bytes, options);
  return bytes;
}
