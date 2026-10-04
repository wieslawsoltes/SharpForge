export const clauseDiagnosticCatalog = Object.freeze({
  CILR0004: 'Invalid exception clause flags',
  CILR0005: 'Invalid try start',
  CILR0006: 'Invalid try end',
  CILR0007: 'Invalid handler start',
  CILR0008: 'Invalid handler end',
  CILR0009: 'Empty or reversed try region',
  CILR0010: 'Empty or reversed handler region',
  CILR0011: 'Invalid exception clause payload',
  CILR0012: 'Filter must precede its handler',
  CILR0013: 'Filter offset disagrees with the legacy payload',
  CILR0014: 'Catch requires a TypeDefOrRef token',
  CILR0015: 'Finally and fault require a zero payload',
});

export function exceptionClausePayload(clause) {
  return clause.flags === 1 ? clause.filterOffset ?? clause.catchType : clause.catchType ?? 0;
}

const unsigned = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

function reject(fail, code) { fail(code, clauseDiagnosticCatalog[code]); }

/** Shared scalar clause checks; callers choose their public diagnostic namespace. */
export function validateExceptionClause(clause, codeSize, fail) {
  const flags = clause?.flags ?? 0;
  if (!clause || (flags !== 0 && flags !== 1 && flags !== 2 && flags !== 4)) reject(fail, 'CILR0004');
  if (!unsigned(clause.start, codeSize)) reject(fail, 'CILR0005');
  if (!unsigned(clause.end, codeSize)) reject(fail, 'CILR0006');
  if (!unsigned(clause.target, codeSize)) reject(fail, 'CILR0007');
  if (!unsigned(clause.handlerEnd, codeSize)) reject(fail, 'CILR0008');
  if (clause.start >= clause.end) reject(fail, 'CILR0009');
  if (clause.target >= clause.handlerEnd) reject(fail, 'CILR0010');
  const value = exceptionClausePayload(clause);
  if (!unsigned(value, 0xffffffff)) reject(fail, 'CILR0011');
  if (flags === 1) {
    if (value >= clause.target) reject(fail, 'CILR0012');
    if (clause.filterOffset !== undefined && clause.catchType !== undefined && clause.catchType !== value) reject(fail, 'CILR0013');
  } else if (flags === 0) {
    const table = value >>> 24;
    if ((table !== 1 && table !== 2 && table !== 27) || !(value & 0xffffff)) reject(fail, 'CILR0014');
  } else if (value !== 0) reject(fail, 'CILR0015');
}
