import { Writer, utf8, equalBytes } from '@sharpforge/cil';
import { PdbGuids, fail } from './contracts.js';
import { wideHash } from './hash-wide.js';
import { sha1, sha256 } from './hash.js';

const hashAlgorithms = new Map([
  [PdbGuids.sha1, { size: 20, compute: sha1 }],
  [PdbGuids.sha256, { size: 32, compute: sha256 }],
  [PdbGuids.sha384, { size: 48, compute: (bytes) => wideHash(bytes, 384) }],
  [PdbGuids.sha512, { size: 64, compute: (bytes) => wideHash(bytes, 512) }],
]);

/** Match SRM's separator selection and deduplicate path components in the blob heap. */
function documentName(builder, name) {
  if (typeof name !== 'string') fail('Document name must be a string');
  let forward = 0;
  let backward = 0;
  for (const character of name) {
    if (character === '/') forward++;
    else if (character === '\\') backward++;
  }
  const separator = forward >= backward ? '/' : '\\';
  const writer = new Writer().u8(separator.charCodeAt(0));
  for (const part of name.split(separator)) writer.compressed(builder.blob(utf8(part)));
  return builder.blob(writer.finish());
}

/** Compute all standardized document hashes synchronously and verify supplied digests. */
function documentHash(source, bytes, algorithm) {
  const codec = hashAlgorithms.get(algorithm);
  if (!codec) fail('Unsupported document hash algorithm');
  if (source.hash !== undefined) {
    if (!(source.hash instanceof Uint8Array) || source.hash.length !== codec.size) fail('Invalid document hash length');
    if (codec.compute && !equalBytes(codec.compute(bytes), source.hash))
      fail('Document checksum does not match source');
    return source.hash;
  }
  if (!codec.compute) fail('Document hash algorithm requires a precomputed digest');
  return codec.compute(bytes);
}

/** A mapped document may have a declared checksum even when its source bytes are unavailable. */
function writeDocumentOnly(builder, source) {
  if (source.text !== undefined || source.bytes !== undefined) fail('Document-only source must not include content');
  const hasHash = source.hash !== undefined;
  if (hasHash !== (source.hashAlgorithm !== undefined)) fail('Document-only checksum requires an algorithm and hash');
  if (hasHash && (typeof source.hashAlgorithm !== 'string' || !source.hashAlgorithm)) fail('Invalid document-only checksum algorithm');
  if (hasHash && (!(source.hash instanceof Uint8Array) || source.hash.length > 4096))
    fail('Invalid or oversized document-only checksum');
  const id = builder.add(48, [
    documentName(builder, source.uri),
    hasHash ? builder.guid(source.hashAlgorithm) : 0,
    hasHash ? builder.blob(source.hash) : 0,
    builder.guid(source.language ?? PdbGuids.csharp),
  ]);
  return { id, bytes: null };
}

/** Emit one standard Document row and return its id and unchanged checksum input bytes. */
export function writeDocument(builder, source) {
  if (source.documentOnly === true) return writeDocumentOnly(builder, source);
  const bytes = source.bytes ?? utf8(source.text ?? '');
  if (!(bytes instanceof Uint8Array)) fail('Document source must be bytes or text');
  const algorithm = (source.hashAlgorithm ?? PdbGuids.sha256).toLowerCase();
  const language = source.language ?? PdbGuids.csharp;
  const hash = documentHash(source, bytes, algorithm);
  const id = builder.add(48, [
    documentName(builder, source.uri),
    builder.guid(algorithm),
    builder.blob(hash),
    builder.guid(language),
  ]);
  return { id, bytes };
}
