import { CilError, text } from './binary.js';
import { readPE, CorFlags, readPEDebugDirectory } from './pe.js';

const optionalFields = Object.freeze([
  'magic', 'majorLinkerVersion', 'minorLinkerVersion', 'sizeOfCode', 'sizeOfInitializedData', 'sizeOfUninitializedData',
  'addressOfEntryPoint', 'baseOfCode', 'baseOfData', 'imageBase', 'sectionAlignment', 'fileAlignment',
  'majorOperatingSystemVersion', 'minorOperatingSystemVersion', 'majorImageVersion', 'minorImageVersion',
  'majorSubsystemVersion', 'minorSubsystemVersion', 'win32VersionValue', 'sizeOfImage', 'sizeOfHeaders', 'checksum',
  'subsystem', 'dllCharacteristics', 'sizeOfStackReserve', 'sizeOfStackCommit', 'sizeOfHeapReserve', 'sizeOfHeapCommit',
  'loaderFlags', 'directoryCount',
]);
const cliDirectories = Object.freeze([
  'metadataDirectory', 'resources', 'strongNameSignature', 'codeManagerTable', 'vtableFixups',
  'exportAddressTableJumps', 'managedNativeHeader',
]);
const debugKinds = Object.freeze({
  0: 'Unknown', 1: 'COFF', 2: 'CodeView', 3: 'FPO', 4: 'Misc', 5: 'Exception', 6: 'Fixup', 7: 'OmapToSource',
  8: 'OmapFromSource', 9: 'Borland', 10: 'Reserved10', 11: 'CLSID', 12: 'VCFeature', 13: 'POGO', 14: 'ILTCG',
  15: 'MPX', 16: 'Reproducible', 17: 'EmbeddedPortablePdb', 19: 'PdbChecksum', 20: 'ExtendedDllCharacteristics',
});

function check(signal) {
  if (signal?.aborted) throw new CilError('PE inspection cancelled');
}

function bound(value, fallback, maximum, name) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new CilError(`Invalid PE inspection ${name} limit`);
  return value;
}

function settings(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new CilError('Invalid PE inspection options');
  check(options.signal);
  return { signal: options.signal,
    maxBytes: bound(options.maxBytes, 64 * 1024 * 1024, 256 * 1024 * 1024, 'input byte'),
    maxDebugEntries: bound(options.maxDebugEntries, 1024, 65536, 'debug entry'),
    maxDebugBytes: bound(options.maxDebugBytes, 1024 * 1024, 64 * 1024 * 1024, 'debug byte'),
    maxStrongNameBytes: bound(options.maxStrongNameBytes, 8192, 1024 * 1024, 'strong-name byte') };
}

function hexBytes(bytes, signal) {
  const digits = '0123456789abcdef';
  const characters = new Uint8Array(bytes.length * 2);
  for (let index = 0; index < bytes.length; index++) {
    if (!(index & 4095)) check(signal);
    characters[index * 2] = digits.charCodeAt(bytes[index] >>> 4);
    characters[index * 2 + 1] = digits.charCodeAt(bytes[index] & 15);
  }
  check(signal);
  return text(characters);
}

function isZero(bytes, signal) {
  for (let index = 0; index < bytes.length; index++) {
    if (!(index & 4095)) check(signal);
    if (bytes[index]) return false;
  }
  return true;
}

function directory(pe, source, name = source.name) {
  const { rva, size } = source;
  const addressKind = name === 'certificate' ? 'file-offset' : 'rva';
  if (!rva && !size) return { name, address: 0, addressKind, size: 0, fileOffset: null, status: 'empty' };
  let fileOffset = null;
  try {
    if (addressKind === 'file-offset') {
      if (rva > pe.bytes.length || size > pe.bytes.length - rva) throw new CilError('Invalid certificate range');
      fileOffset = rva;
    } else fileOffset = pe.offsetOf(rva, size || 1);
  } catch (error) {
    if (!(error instanceof CilError)) throw error;
    return { name, address: rva, addressKind, size, fileOffset, status: 'unmapped', reason: error.message };
  }
  return { name, address: rva, addressKind, size, fileOffset, status: size ? 'mapped' : 'address-only' };
}

function flags(value) {
  let knownMask = 0;
  const names = [];
  for (const [name, mask] of Object.entries(CorFlags)) {
    knownMask |= mask;
    if (value & mask) names.push(name);
  }
  return { value, names, unknownBits: (value & ~knownMask) >>> 0 };
}

function headers(pe) {
  const optional = { format: pe.pe32Plus ? 'PE32+' : 'PE32' };
  for (const name of optionalFields) optional[name] = typeof pe[name] === 'bigint' ? '0x' + pe[name].toString(16) : pe[name];
  return { dos: { magic: 0x5a4d, peHeaderOffset: pe.peHeaderOffset },
    coff: { machine: pe.machine, sectionCount: pe.sectionCount, timestamp: pe.timestamp,
      pointerToSymbolTable: pe.pointerToSymbolTable, numberOfSymbols: pe.numberOfSymbols,
      optionalHeaderSize: pe.optionalSize, characteristics: pe.characteristics }, optional };
}

function strongName(pe, limits) {
  const row = pe.metadata.rows[32]?.[0];
  const publicKey = row ? pe.metadata.blob(row[6]) : new Uint8Array();
  const location = directory(pe, pe.strongNameSignature, 'strongNameSignature');
  if (publicKey.length + location.size > limits.maxStrongNameBytes) throw new CilError('PE strong-name byte limit exceeded');
  let signature = null;
  let signatureState = location.status === 'empty' ? 'absent' : 'unmapped';
  if (location.status === 'mapped') {
    const bytes = pe.bytes.subarray(location.fileOffset, location.fileOffset + location.size);
    check(limits.signal);
    signatureState = isZero(bytes, limits.signal) ? 'zero-filled' : 'nonzero';
    signature = hexBytes(bytes, limits.signal);
  }
  return { directory: location, publicKeyFlag: Boolean(row?.[5] & 1), publicKey: hexBytes(publicKey, limits.signal),
    signedFlag: Boolean(pe.flags & CorFlags.StrongNameSigned), signatureState, signature, verification: 'not-performed' };
}

function debugDirectory(pe, limits) {
  const entries = readPEDebugDirectory(pe, { maxEntries: limits.maxDebugEntries,
    maxDataBytes: limits.maxDebugBytes, signal: limits.signal });
  return entries.map(entry => {
    check(limits.signal);
    const { bytes, ...scalars } = entry;
    return { ...scalars, kindName: debugKinds[entry.kind] ?? 'Unknown', size: bytes.length,
      payload: hexBytes(bytes, limits.signal), payloadEncoding: 'hex' };
  });
}

/** Internal projection over an already parsed image. All returned records are owned and JSON-safe. */
export function inspectPEHeaders(pe, options = {}) {
  const limits = settings(options);
  if (pe.bytes.length > limits.maxBytes) throw new CilError('PE inspection input byte limit exceeded');
  const directories = [];
  for (const entry of [...pe.dataDirectories.slice(0, pe.directoryCount), ...pe.additionalDataDirectories]) {
    check(limits.signal);
    directories.push(directory(pe, entry));
  }
  const cli = { headerSize: pe.cliHeaderSize, version: [...pe.cliVersion], flags: flags(pe.flags),
    entryPoint: { kind: pe.nativeEntryPoint ? 'native-rva' : 'managed-token', value: pe.entryPoint } };
  for (const name of cliDirectories) cli[name] = directory(pe, pe[name], name);
  const indicators = [];
  if (!(pe.flags & CorFlags.ILOnly)) indicators.push('ILOnly-unset');
  if (pe.nativeEntryPoint) indicators.push('native-entry-point');
  if (pe.managedNativeHeader.size) indicators.push('managed-native-header');
  const result = { format: 'sharpforge.pe-inspection', version: 1, bytes: pe.bytes.length,
    imageKind: pe.imageKind, isLibrary: pe.isLibrary,
    nativeCode: { indicated: indicators.length > 0, indicators, status: 'not-disassembled', disassembly: 'unsupported' },
    headers: headers(pe), sections: pe.sections.map(section => ({ ...section })), directories, cli,
    strongName: strongName(pe, limits), debugDirectory: debugDirectory(pe, limits) };
  check(limits.signal);
  return result;
}

/** Inspect bounded PE/CLI headers, debug records and signing facts without disassembling or executing code.
 * UInt64 values are hexadecimal strings; opaque debug/signature bytes are hexadecimal. No signature is verified. */
export function inspectPE(bytes, options = {}) {
  const limits = settings(options);
  return inspectPEHeaders(readPE(bytes, { maxBytes: limits.maxBytes, inspection: true }), limits);
}
