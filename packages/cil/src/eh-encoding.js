import { Writer, CilError, align } from './binary.js';
import { exceptionClausePayload, validateExceptionClause } from './exception-clauses.js';

const defaultOptions = Object.freeze({});

export const exceptionEncodingDiagnosticCatalog = Object.freeze({
  CILEH0001: 'Invalid method body or exception clause',
  CILEH0002: 'Method body or exception section limit exceeded',
  CILEH0003: 'Exception clause does not fit the small encoding',
  CILEH0004: 'Method body encoding cancelled',
  CILEH0005: 'Chained EH sections are unsupported by the native execution profile',
});

function fail(code, message = exceptionEncodingDiagnosticCatalog[code]) {
  const error = new CilError(message);
  error.code = code;
  throw error;
}

function cancelled(signal) {
  if (signal?.aborted) fail('CILEH0004');
}

function unsigned(value, max) { return Number.isInteger(value) && value >= 0 && value <= max; }

function invalidClause(_code, message) { fail('CILEH0001', message); }

function sectionPlan(handlers, codeSize, options) {
  const { exceptionFormat = 'fat', maxClauses = 100000, signal } = options;
  if (exceptionFormat !== 'fat' && exceptionFormat !== 'small' && exceptionFormat !== 'auto') {
    fail('CILEH0001', 'Invalid exception section format');
  }
  if (!unsigned(maxClauses, 1000000) || handlers.length > maxClauses) fail('CILEH0002');
  if (options.clausesPerSection !== undefined) fail('CILEH0005');
  if (!handlers.length) return null;
  let small = handlers.length <= 20;
  for (const clause of handlers) {
    cancelled(signal);
    validateExceptionClause(clause, codeSize, invalidClause);
    small &&= clause.start <= 65535 && clause.target <= 65535 &&
      clause.end - clause.start <= 255 && clause.handlerEnd - clause.target <= 255;
  }
  if (exceptionFormat === 'small' && !small) fail('CILEH0003');
  small &&= exceptionFormat !== 'fat';
  const bytes = 4 + handlers.length * (small ? 12 : 24);
  if (bytes > 0xffffff) fail('CILEH0002');
  return { small, bytes };
}

function writeSection(writer, section, handlers, signal) {
  writer.u8(section.small ? 1 : 0x41);
  if (section.small) writer.u8(section.bytes).u16(0);
  else writer.u8(section.bytes).u8(section.bytes >>> 8).u8(section.bytes >>> 16);
  for (const clause of handlers) {
    cancelled(signal);
    if (section.small) {
      writer.u16(clause.flags ?? 0).u16(clause.start).u8(clause.end - clause.start)
        .u16(clause.target).u8(clause.handlerEnd - clause.target);
    } else {
      writer.u32(clause.flags ?? 0).u32(clause.start).u32(clause.end - clause.start)
        .u32(clause.target).u32(clause.handlerEnd - clause.target);
    }
    writer.u32(exceptionClausePayload(clause));
  }
}

function headerPlan(codeSize, localToken, maxStack, handlers, options) {
  const { headerFormat, initLocals = true, hasDynamicStackAllocation = false } = options;
  if (headerFormat === undefined) {
    if (options.initLocals !== undefined || options.hasDynamicStackAllocation !== undefined) {
      fail('CILEH0001', 'Explicit initialization policy requires headerFormat');
    }
    return { tiny: false, initLocals: true, maxStack: Math.max(1, maxStack) };
  }
  if (!['auto', 'fat', 'tiny'].includes(headerFormat) || typeof initLocals !== 'boolean' ||
      typeof hasDynamicStackAllocation !== 'boolean') fail('CILEH0001', 'Invalid method header policy');
  const eligible = codeSize < 64 && localToken === 0 && maxStack <= 8 && handlers.length === 0 &&
    (!hasDynamicStackAllocation || !initLocals);
  if (headerFormat === 'tiny' && !eligible) fail('CILEH0001', 'Method body is not eligible for a tiny header');
  return { tiny: headerFormat !== 'fat' && eligible, initLocals, maxStack };
}

/** Encode bounded method/EH sections. Omitted headerFormat preserves legacy fat bytes (including the maxstack floor).
 * Explicit auto/fat/tiny keeps exact fat maxstack; tiny implies eight. Dynamic-allocation/initLocals facts are caller-owned. */
export function writeMethodBody(code, localToken, maxStack, handlers = [], options = defaultOptions) {
  cancelled(options.signal);
  if (!(code instanceof Uint8Array) || !Array.isArray(handlers) || !unsigned(maxStack, 65535) ||
      !unsigned(localToken, 0xffffffff) || (localToken !== 0 && (localToken >>> 24 !== 17 || !(localToken & 0xffffff)))) {
    fail('CILEH0001');
  }
  if (code.length > 64 * 1024 * 1024) fail('CILEH0002');
  const section = sectionPlan(handlers, code.length, options);
  const header = headerPlan(code.length, localToken, maxStack, handlers, options);
  if (header.tiny) {
    const bytes = new Writer(code.length + 1).u8((code.length << 2) | 2).bytes(code).finish();
    cancelled(options.signal);
    return bytes;
  }
  const headerBytes = 12 + code.length;
  const capacity = section ? align(headerBytes) + section.bytes : headerBytes;
  const writer = new Writer(capacity).u16(0x3003 | (header.initLocals ? 0x10 : 0) | (handlers.length ? 8 : 0)).u16(header.maxStack)
    .u32(code.length).u32(localToken).bytes(code);
  if (section) writeSection(writer.pad(), section, handlers, options.signal);
  cancelled(options.signal);
  return writer.finish();
}
