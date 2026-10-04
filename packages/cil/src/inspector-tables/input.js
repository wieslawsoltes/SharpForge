import { CilError } from '../binary.js';
import { readMetadata } from '../metadata.js';
import { readPE } from '../pe.js';
import { metadataColumnKind } from '../metadata/pointer-tables.js';
import { metadataIndexWidth } from '../metadata/indices.js';
import { tableDefinitions, TableId } from '../metadata/tables.js';
import { checkTableCancellation, tableInteger } from './budget.js';

/** Reuse a parsed PE/AssemblyInspector, or invoke the existing reader once for PE/metadata-root bytes. */
export function tableViewInput(source, { maxBytes = 64 * 1024 * 1024, signal } = {}) {
  tableInteger(maxBytes, 'input byte limit', 64 * 1024 * 1024);
  checkTableCancellation(signal);
  let parsed = source?.pe ?? source;
  if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
    const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
    if (bytes.length > maxBytes) throw new CilError('Metadata view input exceeds byte limit');
    const metadataRoot = bytes[0] === 0x42 && bytes[1] === 0x53 && bytes[2] === 0x4a && bytes[3] === 0x42;
    parsed = metadataRoot
      ? { bytes, metadata: readMetadata(bytes), metadataOffset: 0, metadataDirectory: { size: bytes.length } }
      : readPE(bytes, { maxBytes, inspection: true });
  }
  const bytes = parsed?.bytes, metadata = parsed?.metadata;
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes || !(metadata?.streams instanceof Map))
    throw new CilError('Expected PE/metadata bytes, a parsed PE, or an AssemblyInspector');
  const metadataOffset = tableInteger(parsed.metadataOffset, 'metadata offset', bytes.length);
  const metadataSize = tableInteger(parsed.metadataDirectory?.size, 'metadata size', bytes.length - metadataOffset);
  const streams = new Map();
  for (const [name, data] of metadata.streams) {
    if (!(data instanceof Uint8Array)) throw new CilError('Invalid metadata stream bytes');
    const fileOffset = data.byteOffset - bytes.byteOffset;
    if (data.buffer !== bytes.buffer || fileOffset < metadataOffset ||
        fileOffset + data.length > metadataOffset + metadataSize)
      throw new CilError('Metadata stream is outside the source image');
    streams.set(name, { name, data, fileOffset, metadataOffset: fileOffset - metadataOffset });
  }
  const tableStream = streams.get(metadata.uncompressed ? '#-' : '#~');
  if (!tableStream || tableStream.metadataOffset !== metadata.tableOffset)
    throw new CilError('Metadata table stream origin is inconsistent');
  checkTableCancellation(signal);
  return { metadata, metadataOffset, metadataSize, streams, tableStream,
    indexCounts: { ...metadata.externalCounts, ...metadata.counts } };
}

export function tableDefinition(table) {
  const id = typeof table === 'string' && Object.hasOwn(TableId, table) ? TableId[table] : table;
  if (!Number.isInteger(id) || !Object.hasOwn(tableDefinitions, id)) throw new CilError('Unknown metadata table');
  return tableDefinitions[id];
}

export function tableColumns(context, definition) {
  let offset = 0;
  return definition.columns.map((name, column) => {
    const physicalKind = metadataColumnKind(definition.id, column, context.indexCounts, context.metadata.uncompressed);
    const width = metadataIndexWidth(physicalKind, context.indexCounts, context.metadata.heapFlags, context.metadata.minimalDelta);
    const result = { name, kind: definition.types[column], physicalKind, width, offset };
    offset += width;
    return result;
  });
}

export function physicalRow(context, table, rowId) {
  const offset = context.metadata.rowOffsets[table]?.[rowId - 1];
  if (!Number.isSafeInteger(offset) || offset < 0) throw new CilError('Metadata row offset is unavailable');
  return { streamOffset: offset, metadataOffset: context.tableStream.metadataOffset + offset,
    fileOffset: context.tableStream.fileOffset + offset };
}
