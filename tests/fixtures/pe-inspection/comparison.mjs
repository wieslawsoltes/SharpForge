import { AssemblyInspector, CilError, inspectPE, methodCodeKind, sha256 } from '@sharpforge/cil';

export const hash = bytes => Array.from(sha256(bytes), value => value.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte, 16));
const scalarDirectory = ({ name, address, addressKind, size }) => ({ name, address, addressKind, size });

function strongNameFacts(value) {
  return { publicKeyFlag: value.publicKeyFlag, signedFlag: value.signedFlag,
    publicKeySize: value.publicKey.length / 2, publicKeySha256: hash(unhex(value.publicKey)),
    signatureSize: value.signature?.length / 2 || 0, signatureState: value.signatureState,
    signatureSha256: value.signature === null ? null : hash(unhex(value.signature)), verification: value.verification };
}

function methodFacts(inspector, definition) {
  const codeKind = methodCodeKind(definition.implFlags);
  let body = null;
  let bodyError = false;
  if (definition.hasBody) {
    try {
      const value = inspector.pe.methodBody(definition.token);
      body = { headerSize: value.headerSize, codeSize: value.code.length, maxStack: value.maxStack,
        localSignature: value.localSignature, initLocals: value.initLocals,
        exceptionRegionCount: value.handlers.length, codeSha256: hash(value.code) };
    } catch (error) {
      if (!(error instanceof CilError)) throw error;
      bodyError = true;
    }
  }
  if (!bodyError) {
    const method = inspector.getMethod(definition.token);
    if (!method.hasBody && method.instructions.length) throw new Error('Non-CIL or absent method was disassembled');
    if (method.codeKind !== 'CIL' && method.disassembly.status !== 'not-disassembled')
      throw new Error('Native implementation is missing its explicit disassembly boundary');
    if (body && (method.disassembly.status !== 'available' || method.codeSize !== body.codeSize))
      throw new Error('Available CIL was omitted from public inspection');
  }
  return { token: definition.token, name: definition.name, implFlags: definition.implFlags, rva: definition.rva,
    codeKind, hasCilBody: definition.hasBody, body, bodyError };
}

/** Project only scalar facts and SHA256 hashes: never persist third-party image or debug/signature payload bytes. */
export function productFacts(bytes) {
  const report = inspectPE(bytes);
  const inspector = new AssemblyInspector(bytes);
  const cli = { headerSize: report.cli.headerSize, version: report.cli.version,
    flags: report.cli.flags.value, entryPoint: report.cli.entryPoint };
  for (const [name, value] of Object.entries(report.cli)) {
    if (value?.addressKind) cli[name] = { rva: value.address, size: value.size };
  }
  return { imageKind: report.imageKind, headers: report.headers,
    sections: report.sections.map(({ headerOffset, ...section }) => section),
    directories: report.directories.map(scalarDirectory), cli,
    debugDirectory: report.debugDirectory.map(({ payload, kindName, payloadEncoding, ...entry }) => ({
      ...entry, payloadSha256: hash(unhex(payload)),
    })), strongName: strongNameFacts(report.strongName),
    methods: [...inspector.methods.values()].sort((left, right) => left.token - right.token)
      .map(method => methodFacts(inspector, method)) };
}

function nativeFacts(reference) {
  const { imageKind, headers, sections, directories, cli, debugDirectory, strongName } = reference;
  return { imageKind, headers, sections, directories, cli, debugDirectory, strongName,
    methods: reference.methods.map(method => ({ ...method,
      body: method.body ? (({ totalSize, ...body }) => body)(method.body) : null,
      bodyError: method.bodyError !== null,
    })) };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

/** Compare independent SRM facts to current public PE/method APIs. This function is shared by capture and browser replay. */
export function compareReference(bytes, reference) {
  if (hash(bytes) !== reference.image.sha256 || bytes.length !== reference.image.bytes) throw new Error('Reference image bytes differ');
  const actual = productFacts(bytes);
  const expected = nativeFacts(reference);
  const comparisons = [];
  for (const field of Object.keys(expected)) {
    const equal = JSON.stringify(stable(actual[field])) === JSON.stringify(stable(expected[field]));
    comparisons.push({ field, status: equal ? 'pass' : 'fail' });
  }
  return { comparisons, counts: { methods: actual.methods.length,
    availableCil: actual.methods.filter(method => method.hasCilBody && method.body).length,
    unavailableCil: actual.methods.filter(method => method.hasCilBody && method.bodyError).length,
    nonCil: actual.methods.filter(method => method.codeKind !== 'CIL').length },
    differences: comparisons.filter(value => value.status === 'fail').map(({ field }) => ({
      field, actual: actual[field], expected: expected[field],
    })) };
}
