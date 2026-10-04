/** Inspect real FieldRVA payloads and literal method bodies through the public CIL metadata API. */
import { AssemblyInspector, decodeSignature, readPE } from '@sharpforge/cil';

const primitiveSizes = new Map([['byte', 1], ['sbyte', 1], ['short', 2], ['ushort', 2], ['int', 4], ['uint', 4], ['long', 8], ['ulong', 8]]);

export function utf8DataRows(bytes) {
  const pe = readPE(bytes);
  const metadata = pe.metadata;
  const layouts = new Map((metadata.rows[15] ?? []).map(([packing, size, parent]) => [parent, { packing, size }]));
  return (metadata.rows[29] ?? []).map(([rva, index]) => {
    const [flags, name, signature] = metadata.rows[4][index - 1];
    const type = decodeSignature(metadata.blob(signature)).type;
    const layout = type.kind === 'valuetype' ? layouts.get(type.token & 0xffffff) : null;
    const size = layout?.size ?? primitiveSizes.get(type.name);
    if (!size) throw new Error('Unknown literal field storage size');
    const offset = pe.offsetOf(rva, size);
    return { token: 0x04000000 | index, name: metadata.string(name), flags, rva, size, packing: layout?.packing ?? null,
      bytes: [...pe.bytes.subarray(offset, offset + size)] };
  });
}

export function literalInstructions(bytes, name, owner = 'Utf8Literals') {
  const inspector = new AssemblyInspector(bytes);
  const method = [...inspector.methods.values()].find(candidate => candidate.owner === owner && candidate.name === name);
  if (!method) throw new Error('Missing method ' + owner + '.' + name);
  return inspector.getMethod(method.token).instructions;
}

/**
 * Controlled reference projection: make exactly one public span constructor private by changing its Flags column.
 * No installed reference is modified. Roslyn and SharpForge consume the same projected bytes for fallback/CS0656 probes.
 */
export function referenceWithoutSpanConstructor(input, kind) {
  if (!['pointer', 'array'].includes(kind)) throw new Error('Unknown span constructor projection');
  const bytes = new Uint8Array(input);
  const pe = readPE(bytes);
  const metadata = pe.metadata;
  const ownerIndex = metadata.rows[2].findIndex(row => metadata.string(row[1]) === 'ReadOnlySpan`1'
    && metadata.string(row[2]) === 'System');
  if (ownerIndex < 0) throw new Error('No ReadOnlySpan<T> definition in reference');
  const first = metadata.rows[2][ownerIndex][5];
  const end = metadata.rows[2][ownerIndex + 1]?.[5] ?? metadata.rows[6].length + 1;
  const matches = [];
  for (let index = first; index < end; index++) {
    const row = metadata.rows[6][index - 1];
    if (metadata.string(row[3]) !== '.ctor') continue;
    const signature = decodeSignature(metadata.blob(row[4]));
    const parameters = signature.parameters;
    const matchesPointer = parameters.length === 2 && parameters[0].kind === 'pointer'
      && parameters[0].element.name === 'void' && parameters[1].name === 'int';
    const matchesArray = parameters.length === 3 && parameters[0].kind === 'szarray'
      && parameters[1].name === 'int' && parameters[2].name === 'int';
    if (kind === 'pointer' ? matchesPointer : matchesArray) matches.push(index);
  }
  if (matches.length !== 1) throw new Error('Expected one span constructor for projection, found ' + matches.length);
  const index = matches[0];
  const row = metadata.rows[6][index - 1];
  if ((row[2] & 7) !== 6) throw new Error('Selected constructor was not public');
  const offset = pe.metadataOffset + metadata.tableOffset + metadata.rowOffsets[6][index - 1] + 6;
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, (row[2] & ~7) | 1, true);
  return { bytes, methodToken: 0x06000000 | index, offset, originalFlags: row[2], projectedFlags: (row[2] & ~7) | 1 };
}
