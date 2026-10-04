import { CilError } from '../binary.js';
import { decodeCoded } from '../metadata.js';
import { readManagedResources, readMethodHeader } from '../pe.js';
import { inspectPEHeaders } from '../inspector-pe.js';
import { methodCodeFacts } from '../inspector-method.js';

function peOptions(options) {
  const value = options.peOptions === undefined ? {} : options.peOptions;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CilError('Invalid PE inspection options');
  return { ...value, signal: options.signal ?? value.signal };
}

function header(inspector, options = {}) {
  const { metadata, pe } = inspector;
  const row = metadata.rows[32]?.[0];
  const name = row ? metadata.string(row[7]) : metadata.string(metadata.rows[0]?.[0]?.[1] ?? 0);
  const result = {
    name,
    version: row ? row.slice(1, 5).join('.') : null,
    entryPoint: pe.entryPoint,
    bytes: pe.bytes.length,
    format: 'ECMA-335 PE/CLI',
    profile: inspector.debug?.format ?? null,
    machine: pe.machine,
    cliFlags: pe.flags,
    imageKind: pe.imageKind,
  };
  if (options.includePE) result.pe = inspectPEHeaders(pe, peOptions(options));
  return result;
}

function methodSummary(inspector, definition, includeMethods) {
  if (!includeMethods) return methodCodeFacts(definition, { ...definition });
  try {
    return inspector.getMethod(definition.token);
  } catch (error) {
    const method = methodCodeFacts(definition, { ...definition });
    if (method.codeKind === 'CIL' && definition.hasBody) method.disassembly = { status: 'unavailable', reason: error.message };
    method.error = error.message;
    method.instructions = [];
    method.locals = [];
    method.handlers = [];
    method.codeSize = 0;
    return method;
  }
}

function checkCancelled(signal) {
  if (signal?.aborted) throw new CilError('Inspector page cancelled');
}

function pageSummary(
  inspector,
  { includeMethods = true, methodOffset = 0, methodLimit = 100, maxPageCodeBytes = 1024 * 1024, signal, includePE, peOptions },
) {
  const total = inspector.metadata.counts[6] ?? 0;
  if (!Number.isSafeInteger(methodOffset) || methodOffset < 0 || methodOffset > total)
    throw new CilError('Invalid method page offset');
  if (!Number.isSafeInteger(methodLimit) || methodLimit < 0 || methodLimit > 1000)
    throw new CilError('Invalid method page limit');
  if (!Number.isSafeInteger(maxPageCodeBytes) || maxPageCodeBytes < 0 || maxPageCodeBytes > 1024 * 1024)
    throw new CilError('Invalid method page code budget');
  checkCancelled(signal);
  const end = Math.min(total, methodOffset + methodLimit),
    definitions = [];
  let codeBytes = 0;
  for (let index = methodOffset; index < end; index++) {
    if ((index & 127) === 0) checkCancelled(signal);
    const token = 0x06000001 + index;
    const definition = inspector.methods.get(token);
    if (!definition) throw new CilError('Orphan MethodDef in requested page');
    definitions.push(definition);
    if (!includeMethods || !definition.hasBody) continue;
    try {
      codeBytes += readMethodHeader(inspector.pe, token)?.codeSize ?? 0;
    } catch (error) {
      if (!(error instanceof CilError)) throw error;
      // Preserve summary's per-method diagnostics; malformed headers cannot contribute a decoded body.
      continue;
    }
    if (codeBytes > maxPageCodeBytes) throw new CilError('Method page code budget exceeded');
  }
  const methods = definitions.map((definition) => {
    checkCancelled(signal);
    return structuredClone(methodSummary(inspector, definition, includeMethods));
  });
  return {
    ...header(inspector, { includePE, peOptions, signal }),
    methods,
    methodPage: {
      offset: methodOffset,
      limit: methodLimit,
      total,
      nextOffset: end < total && methodLimit ? end : null,
    },
    diagnostics: [...inspector.diagnostics],
  };
}

/** Opt-in pages visit only selected physical MethodDefs. The default retains the complete legacy inventory. */
export function assemblySummary(inspector, options = {}) {
  if (options.includePE !== undefined && typeof options.includePE !== 'boolean') throw new CilError('Invalid includePE option');
  const signal = options.signal ?? (options.includePE ? options.peOptions?.signal : undefined);
  checkCancelled(signal);
  if (options.methodOffset !== undefined || options.methodLimit !== undefined || options.maxPageCodeBytes !== undefined)
    return pageSummary(inspector, { ...options, signal });
  const { includeMethods = true } = options;
  const { metadata, pe } = inspector;
  const methods = [];
  for (const definition of inspector.methods.values()) {
    checkCancelled(signal);
    methods.push(methodSummary(inspector, definition, includeMethods));
  }
  return {
    ...header(inspector, options),
    streams: [...metadata.streams].map(([name, bytes]) => ({ name, bytes: bytes.length })),
    tables: { ...metadata.counts },
    references: (metadata.rows[35] ?? []).map((row) => ({
      name: metadata.string(row[6]),
      version: row.slice(0, 4).join('.'),
    })),
    resources: readManagedResources(pe),
    customAttributes: (metadata.rows[12] ?? []).map((row) => ({
      parent: decodeCoded('HasCustomAttribute', row[0]),
      constructor: decodeCoded('CustomAttributeType', row[1]),
      blobBytes: metadata.blob(row[2]).length,
    })),
    genericParameters: (metadata.rows[42] ?? []).map((row) => ({
      index: row[0],
      flags: row[1],
      owner: decodeCoded('TypeOrMethodDef', row[2]),
      name: metadata.string(row[3]),
    })),
    types: inspector.types.map((type) => ({
      ...type,
      methods: type.methods.map((method) => method.token),
      fields: type.fields.map((field) => {
        try {
          return { ...field, type: inspector.signature(field.token).type };
        } catch (error) {
          return { ...field, error: error.message };
        }
      }),
    })),
    methods,
    diagnostics: [...inspector.diagnostics],
  };
}
