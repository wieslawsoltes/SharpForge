import { decodeTypeSignature, formatSignatureType } from '@sharpforge/cil';
import { PdbGuids, fail } from './contracts.js';
import { createMetadataTypeNames } from './metadata-type-names.js';
import { createFrameworkTypeResolver } from './framework-type-identity.js';
import { annotationDisplay } from './annotation-display.js';
import { constantTypeSpecs } from './nullable-constant.js';

const annotationKinds = new Map([
  [PdbGuids.dynamicLocals, 'dynamicFlags'],
  [PdbGuids.tupleNames, 'tupleElementNames'],
]);
export const hasLocalAnnotations = (value) => value.dynamicFlags !== undefined || value.tupleElementNames !== undefined;

/** Validate raw annotation payloads before the existing CDI decoder allocates arrays or strings. */
export function preflightLocalAnnotation(kind, parent, bytes, counts, budget) {
  if (!annotationKinds.has(kind)) return;
  const table = parent >>> 24,
    row = parent & 0xffffff;
  if ((table !== 51 && table !== 52) || !row || row > (counts[table] ?? 0)) fail('Invalid local annotation parent');
  const key = kind + ':' + parent;
  budget.keys ??= new Set();
  if (budget.keys.has(key)) fail('Duplicate local annotation');
  if (budget.keys.size >= 4096 || (budget.bytes = (budget.bytes ?? 0) + bytes.length) > 1024 * 1024)
    fail('Local annotation aggregate limit exceeded');
  budget.keys.add(key);
  let entries = bytes.length * 8;
  if (kind === PdbGuids.tupleNames) {
    entries = 0;
    let length = 0;
    for (const byte of bytes) {
      if (byte === 0) {
        entries++;
        length = 0;
      } else if (++length > 3072) fail('Tuple element name byte limit exceeded');
    }
    if (length) fail('Unterminated tuple element name');
  }
  if (entries > 1024 || (budget.entries = (budget.entries ?? 0) + entries) > 65536)
    fail('Local annotation entry limit exceeded');
}

export function attachLocalAnnotations(custom, variables, constants) {
  for (const record of custom) {
    const property = annotationKinds.get(record.kind);
    if (!property) continue;
    const value = property === 'dynamicFlags' ? record.flags : record.names;
    if (
      property === 'tupleElementNames' &&
      (value.some((name) => name?.length > 1024) ||
        value.reduce((total, name) => total + (name?.length ?? 0), 0) > 4096)
    )
      fail('Tuple element name limit exceeded');
    const target = (record.parent >>> 24 === 51 ? variables : constants)[(record.parent & 0xffffff) - 1];
    target[property] = [...value];
    target.displayTypeName = null;
    target.annotationReason = 'type-metadata-required';
  }
}

export function copyLocalAnnotations(value) {
  if (!hasLocalAnnotations(value)) return {};
  return {
    ...(value.dynamicFlags !== undefined ? { dynamicFlags: [...value.dynamicFlags] } : {}),
    ...(value.tupleElementNames !== undefined ? { tupleElementNames: [...value.tupleElementNames] } : {}),
    displayTypeName: value.displayTypeName ?? null,
    annotationReason: value.annotationReason ?? null,
  };
}

export function annotationContext(
  metadata,
  displays = metadata && createMetadataTypeNames(metadata, 'Local annotation'),
) {
  const frameworkName = metadata
    ? createFrameworkTypeResolver(metadata, (name) => name === 'Object' || /^ValueTuple`[1-8]$/.test(name))
    : () => null;
  return {
    frameworkName,
    format:
      displays?.format ??
      ((type, formatType) => formatSignatureType(type, null, { formatType, maxNodes: 256, maxDepth: 32 })),
  };
}

/** Constants retain their value codec; only their declared-type display is annotated. */
export function bindConstantAnnotations(constants, metadata = null) {
  if (!constants.some(hasLocalAnnotations)) return;
  const annotated = constants.filter(hasLocalAnnotations);
  const context = annotationContext(metadata);
  const specs = metadata && constantTypeSpecs(annotated, metadata);
  const types = new Map();
  for (const constant of annotated) {
    let type;
    if (!constant.typeToken && !constant.enumTypeToken) type = { kind: 'primitive', name: constant.type };
    else if (!metadata) continue;
    else {
      const token = constant.typeToken ?? constant.enumTypeToken;
      if (token >>> 24 === 27) {
        if (!types.has(token)) types.set(token, decodeTypeSignature(specs.get(token), { maxDepth: 32, maxNodes: 256 }));
        type = types.get(token);
      } else type = { kind: constant.type === 'class' ? 'class' : 'valuetype', token };
    }
    Object.assign(constant, annotationDisplay(type, constant, context));
  }
}
