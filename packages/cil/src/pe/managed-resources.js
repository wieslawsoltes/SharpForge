import { Writer, Reader, CilError, utf8, text } from '../binary.js';
import { decodeCoded } from '../metadata/indices.js';

const maximumResourceBytes = 64 * 1024 * 1024;
const maximumResourceCount = 65535;
export const ManifestResourceVisibility = Object.freeze({ Public: 1, Private: 2 });

/** Write embedded resources in input order, with eight-byte-aligned length prefixes. */
export function writeManagedResources(resources, metadata) {
  if (!Array.isArray(resources) || resources.length > maximumResourceCount) throw new CilError('Invalid managed resource count');
  const names = new Set();
  const normalized = [];
  let size = 0;
  for (const resource of resources) {
    const name = resource?.name;
    if (typeof name !== 'string' || !name || name.length > 1024 || name.includes('\0') || text(utf8(name)) !== name) {
      throw new CilError('Invalid managed resource name');
    }
    if (names.has(name)) throw new CilError(`Duplicate managed resource name: ${name}`);
    names.add(name);
    if (!(resource.bytes instanceof Uint8Array)) throw new CilError('Managed resource bytes must be Uint8Array');
    const visibility = resource.visibility ?? 'public';
    if (!['public', 'private'].includes(visibility)) throw new CilError('Invalid managed resource visibility');
    size = Math.ceil(size / 8) * 8 + 4 + resource.bytes.length;
    if (size > maximumResourceBytes) throw new CilError('Managed resources exceed size limit');
    normalized.push({ name, bytes: resource.bytes, flags: visibility === 'public' ? 1 : 2 });
  }
  const writer = new Writer(size);
  for (const resource of normalized) {
    writer.pad(8);
    metadata.manifest.manifestResource({ Offset: writer.length, Flags: resource.flags, Name: resource.name, Implementation: 0 });
    writer.u32(resource.bytes.length).bytes(resource.bytes);
  }
  return writer.finish();
}

/** List resource metadata, validating embedded ranges; byte payloads are copied only when requested. */
export function readManagedResources(pe, { includeBytes = false, maxResourceBytes = maximumResourceBytes } = {}) {
  if (!Number.isSafeInteger(maxResourceBytes) || maxResourceBytes < 0) throw new CilError('Invalid managed resource size limit');
  const rows = pe.metadata.rows[40] ?? [];
  if (rows.length > maximumResourceCount) throw new CilError('Managed resource count exceeds limit');
  const directory = pe.resources;
  if (directory.size > maxResourceBytes) throw new CilError('Managed resources exceed size limit');
  const start = directory.size ? pe.offsetOf(directory.rva, directory.size) : 0;
  return rows.map(row => {
    const [offset, flags, nameIndex, implementationIndex] = row;
    const implementation = decodeCoded('Implementation', implementationIndex);
    const resource = { offset, flags, name: pe.metadata.string(nameIndex), implementation, size: null };
    if (implementation) return resource;
    if (!directory.size || offset > directory.size - 4) throw new CilError('Managed resource offset exceeds CLI directory');
    const reader = new Reader(pe.bytes, start + offset, directory.size - offset);
    resource.size = reader.u32();
    reader.need(resource.size);
    if (includeBytes) resource.bytes = new Uint8Array(reader.take(resource.size));
    return resource;
  });
}

/** Bound and patch the CLI embedded-resource directory within the managed section. */
export function patchManagedResourceDirectory(cli, options, sectionLength, metadataOffset, metadataLength) {
  if (!options.resources) return;
  const { offset, size } = options.resources;
  if (!Number.isSafeInteger(offset) || offset < 72 || !Number.isSafeInteger(size) || size < 0
    || offset + size > sectionLength || (size && offset < metadataOffset + metadataLength && offset + size > metadataOffset)) {
    throw new CilError('Invalid CLI resource range');
  }
  cli.setUint32(24, size ? options.firstSectionRva + offset : 0, true);
  cli.setUint32(28, size, true);
}
