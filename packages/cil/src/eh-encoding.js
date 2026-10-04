import { Writer, CilError, align } from './binary.js';

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

function payload(clause) {
  return clause.flags === 1 ? clause.filterOffset ?? clause.catchType : clause.catchType ?? 0;
}

function validateClause(clause, codeSize) {
  const flags = clause?.flags ?? 0;
  if (!clause || (flags !== 0 && flags !== 1 && flags !== 2 && flags !== 4)) fail('CILEH0001', 'Invalid EH flags');
  if (!unsigned(clause.start, codeSize) || !unsigned(clause.end, codeSize) ||
      !unsigned(clause.target, codeSize) || !unsigned(clause.handlerEnd, codeSize)) fail('CILEH0001', 'Invalid EH range');
  if (clause.start >= clause.end || clause.target >= clause.handlerEnd) fail('CILEH0001', 'Empty or reversed EH range');
  const value = payload(clause);
  if (!unsigned(value, 0xffffffff)) fail('CILEH0001', 'Invalid EH payload');
  if (clause.flags === 1) {
    if (value >= clause.target || (clause.filterOffset !== undefined && clause.catchType !== undefined && clause.catchType !== value)) {
      fail('CILEH0001', 'Filter offset must precede its handler and agree with the legacy payload');
    }
  } else if (!(clause.flags ?? 0)) {
    const table = value >>> 24;
    if ((table !== 1 && table !== 2 && table !== 27) || !(value & 0xffffff)) fail('CILEH0001', 'Catch requires a TypeDefOrRef token');
  } else if (value !== 0) fail('CILEH0001', 'Finally and fault clauses require a zero payload');
}

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
    validateClause(clause, codeSize);
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
    writer.u32(payload(clause));
  }
}

/** Encode a fat method header and bounded catch/filter/finally/fault sections; fat remains the replay-compatible default. */
export function writeMethodBody(code, localToken, maxStack, handlers = [], options = defaultOptions) {
  cancelled(options.signal);
  if (!(code instanceof Uint8Array) || !Array.isArray(handlers) || !unsigned(maxStack, 65535) ||
      !unsigned(localToken, 0xffffffff) || (localToken !== 0 && (localToken >>> 24 !== 17 || !(localToken & 0xffffff)))) {
    fail('CILEH0001');
  }
  if (code.length > 64 * 1024 * 1024) fail('CILEH0002');
  const section = sectionPlan(handlers, code.length, options);
  const headerBytes = 12 + code.length;
  const capacity = section ? align(headerBytes) + section.bytes : headerBytes;
  const writer = new Writer(capacity).u16(0x3013 | (handlers.length ? 8 : 0)).u16(Math.max(1, maxStack))
    .u32(code.length).u32(localToken).bytes(code);
  if (section) writeSection(writer.pad(), section, handlers, options.signal);
  cancelled(options.signal);
  return writer.finish();
}
