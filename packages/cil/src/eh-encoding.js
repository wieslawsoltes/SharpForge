import { Writer, CilError, align } from './binary.js';

export const exceptionEncodingDiagnosticCatalog = Object.freeze({
  CILEH0001: 'Invalid method body or exception clause',
  CILEH0002: 'Method body or exception section limit exceeded',
  CILEH0003: 'Exception clause does not fit the small encoding',
  CILEH0004: 'Method body encoding cancelled',
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
  const { exceptionFormat = 'fat', clausesPerSection = handlers.length || 1, maxClauses = 100000, signal } = options;
  if (!['fat', 'small', 'auto'].includes(exceptionFormat)) fail('CILEH0001', 'Invalid exception section format');
  if (!unsigned(maxClauses, 1000000) || handlers.length > maxClauses) fail('CILEH0002');
  if (!unsigned(clausesPerSection, 1000000) || clausesPerSection === 0) fail('CILEH0002');
  if (Math.ceil(handlers.length / clausesPerSection) > 32) fail('CILEH0002', 'At most 32 EH sections are supported');
  const sections = [];
  for (let start = 0; start < handlers.length; start += clausesPerSection) {
    const end = Math.min(start + clausesPerSection, handlers.length);
    let small = end - start <= 20;
    for (let index = start; index < end; index++) {
      cancelled(signal);
      const clause = handlers[index];
      validateClause(clause, codeSize);
      small &&= clause.start <= 65535 && clause.target <= 65535 &&
        clause.end - clause.start <= 255 && clause.handlerEnd - clause.target <= 255;
    }
    if (exceptionFormat === 'small' && !small) fail('CILEH0003');
    small &&= exceptionFormat !== 'fat';
    const bytes = 4 + (end - start) * (small ? 12 : 24);
    if (bytes > 0xffffff) fail('CILEH0002');
    sections.push({ start, end, small, bytes });
  }
  return sections;
}

function writeSection(writer, section, handlers, more, signal) {
  writer.u8(1 | (section.small ? 0 : 0x40) | (more ? 0x80 : 0));
  if (section.small) writer.u8(section.bytes).u16(0);
  else writer.u8(section.bytes).u8(section.bytes >>> 8).u8(section.bytes >>> 16);
  for (let index = section.start; index < section.end; index++) {
    cancelled(signal);
    const clause = handlers[index];
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
export function writeMethodBody(code, localToken, maxStack, handlers = [], options = {}) {
  cancelled(options.signal);
  if (!(code instanceof Uint8Array) || !Array.isArray(handlers) || !unsigned(maxStack, 65535) ||
      !unsigned(localToken, 0xffffffff) || (localToken !== 0 && (localToken >>> 24 !== 17 || !(localToken & 0xffffff)))) {
    fail('CILEH0001');
  }
  if (code.length > 64 * 1024 * 1024) fail('CILEH0002');
  const sections = sectionPlan(handlers, code.length, options);
  const headerBytes = 12 + code.length;
  const capacity = sections.length ? align(headerBytes) + sections.reduce((size, section) => size + section.bytes, 0) : headerBytes;
  const writer = new Writer(capacity).u16(0x3013 | (handlers.length ? 8 : 0)).u16(Math.max(1, maxStack))
    .u32(code.length).u32(localToken).bytes(code);
  if (sections.length) writer.pad();
  for (let index = 0; index < sections.length; index++) {
    writeSection(writer, sections[index], handlers, index + 1 < sections.length, options.signal);
  }
  cancelled(options.signal);
  return writer.finish();
}
