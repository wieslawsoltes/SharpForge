import { AssemblyInspector } from './inspector.js';
import { compileILBodyDetails } from './il-document-body.js';
import { DocumentUserStrings } from './il-document-strings.js';
import { appendDocumentMetadata } from './il-document-metadata.js';
import { sameILBody } from './il-document-preservation.js';
import { Reader, Writer, CilError, align } from './binary.js';

function invalidateDebugMap(output, metadataOffset) {
  const reader = new Reader(output, metadataOffset);
  reader.take(12);
  const versionLength = reader.u32();
  reader.take(versionLength);
  reader.u16();
  const count = reader.u16();
  for (let index = 0; index < count; index++) {
    reader.u32();
    reader.u32();
    const at = reader.position;
    let name = '';
    for (let value; (value = reader.u8());) name += String.fromCharCode(value);
    reader.position = align(reader.position);
    if (name === '#SF') { output[at + 1] = 0x49; output[at + 2] = 0x4c; }
  }
}

function clearSignatures(output, view, pe, directory, cli) {
  view.setUint32(cli + 16, pe.flags & ~8, true);
  const signatureRva = view.getUint32(cli + 32, true), signatureSize = view.getUint32(cli + 36, true);
  if (signatureRva && signatureSize) {
    const at = pe.offsetOf(signatureRva, signatureSize);
    output.fill(0, at, at + signatureSize);
  }
  view.setUint32(cli + 32, 0, true);
  view.setUint32(cli + 36, 0, true);
  // Authenticode certificates cannot authenticate a modified PE.
  view.setUint32(directory + 4 * 8, 0, true);
  view.setUint32(directory + 4 * 8 + 4, 0, true);
}

function documentResult(bytes, methods, warnings = []) {
  return { bytes, methods, format: 'ECMA-335 PE/CLI', profile: 'SharpForge.ManagedIL/1', warnings };
}

/** Compile every visible body; retain unchanged encodings and append only actual edits. */
export function rebuildILDocument(image, methods, options) {
  const inspector = new AssemblyInspector(image), pe = inspector.pe, metadata = inspector.metadata;
  if (!(pe.flags & 1) || pe.flags & 0x10) throw new CilError('Only IL-only managed images can be rebuilt');
  const expected = [...inspector.methods.values()].filter(method => method.hasBody);
  if (methods.size !== expected.length || expected.some(method => !methods.has(method.token))) {
    throw new CilError('All original method bodies must be supplied exactly once; no embedded-code fallback is allowed');
  }
  const section = [...pe.sections].sort((left, right) => right.offset - left.offset)[0];
  if (pe.sections.some(value => value !== section && value.rva >= section.rva)) {
    throw new CilError('Unsupported PE section ordering for rewriting');
  }
  const inputView = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const fileAlignment = inputView.getUint32(pe.optionalStart + 36, true);
  const sectionAlignment = inputView.getUint32(pe.optionalStart + 32, true);
  if (!fileAlignment || !sectionAlignment || fileAlignment > 65536 || sectionAlignment > 1048576) {
    throw new CilError('Unsupported PE alignment');
  }
  const userStrings = new DocumentUserStrings(metadata, options.maxUserStringBytes);
  const data = new Writer(image.length + 4096).bytes(image).pad(4), patches = [];
  const bodyOptions = { relaxBranches: options.relaxBranches, userStrings };
  for (const method of expected) {
    const body = methods.get(method.token);
    const originalBody = pe.methodBody(method.token);
    const originalMethod = inspector.getMethod(method.token);
    body.originalSize = originalBody.code.length;
    if (body.localSignature && body.localSignature >>> 24 !== 17) throw new CilError('Expected StandAloneSig locals token');
    if (body.localSignature && inspector.signature(body.localSignature).kind !== 'locals') throw new CilError('Invalid locals signature');
    const compiled = compileILBodyDetails(body, { ...bodyOptions, original: { body: originalBody, instructions: originalMethod.instructions } });
    if (sameILBody(compiled, originalBody)) continue;
    data.pad(4);
    patches.push([metadata.rowOffsets[6][(method.token & 0xffffff) - 1], section.rva + data.length - section.offset]);
    data.bytes(compiled.bytes);
  }
  const heap = userStrings.finish();
  if (!patches.length && heap === null) return documentResult(image.slice(), expected.length);
  const root = appendDocumentMetadata(pe, heap, data);
  const virtualSize = data.length - section.offset;
  data.pad(fileAlignment);
  const output = data.finish(), view = new DataView(output.buffer);
  view.setUint32(section.headerOffset + 8, virtualSize, true);
  view.setUint32(section.headerOffset + 16, output.length - section.offset, true);
  view.setUint32(section.headerOffset + 36, view.getUint32(section.headerOffset + 36, true) | 0x60000020, true);
  view.setUint32(pe.optionalStart + 56, align(section.rva + virtualSize, sectionAlignment), true);
  view.setUint32(pe.optionalStart + 4, view.getUint32(pe.optionalStart + 4, true) + output.length - image.length, true);
  view.setUint32(pe.optionalStart + 64, 0, true);
  for (const [offset, rva] of patches) view.setUint32(root.offset + root.tableOffset + offset, rva, true);
  invalidateDebugMap(output, root.offset);
  const directory = pe.optionalStart + (pe.magic === 0x10b ? 96 : 112);
  const cli = pe.offsetOf(view.getUint32(directory + 14 * 8, true), 72);
  view.setUint32(cli + 8, root.offset === pe.metadataOffset ? pe.metadataDirectory.rva : section.rva + root.offset - section.offset, true);
  view.setUint32(cli + 12, root.size, true);
  clearSignatures(output, view, pe, directory, cli);
  const check = new AssemblyInspector(output);
  for (const method of expected) check.getMethod(method.token);
  return documentResult(output, expected.length, ['Rewritten assemblies are unsigned. #SF debug maps were invalidated. ' +
    'Metadata and resources were preserved; every visible method body was assembled and validated.']);
}
