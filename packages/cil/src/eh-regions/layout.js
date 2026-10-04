import { exceptionClausePayload, validateExceptionClause } from '../exception-clauses.js';
import { checkRegionCancellation, regionFailure } from './contracts.js';

const handlerKinds = Object.freeze({ 0: 'catch', 1: 'filter-handler', 2: 'finally', 4: 'fault' });

function appendRegion(regions, kind, start, end, index) {
  const region = { id: regions.length, kind, start, end, parent: null, children: [], clauses: [index] };
  regions.push(region);
  return region.id;
}

function validateBoundaries(clause, boundary) {
  if (!boundary(clause.start)) regionFailure('CILR0016');
  if (!boundary(clause.end)) regionFailure('CILR0017');
  if (!boundary(clause.target)) regionFailure('CILR0018');
  if (!boundary(clause.handlerEnd)) regionFailure('CILR0019');
  const filter = clause.flags === 1 ? exceptionClausePayload(clause) : null;
  if (filter !== null && !boundary(filter)) regionFailure('CILR0020');
  const handlerStart = filter ?? clause.target;
  if (clause.start < clause.handlerEnd && handlerStart < clause.end) regionFailure('CILR0021');
}

/** Shared clause geometry for decoded byte offsets or compiler source-PC boundaries. */
export function projectClauses(handlers, boundary, options) {
  const regions = [];
  const clauses = [];
  const tries = new Map();
  for (const [index, clause] of handlers.entries()) {
    checkRegionCancellation(options.signal);
    validateExceptionClause(clause, options.codeSize, regionFailure);
    validateBoundaries(clause, boundary);
    const flags = clause.flags ?? 0;
    const key = `${clause.start}:${clause.end}`;
    let shared = tries.get(key);
    if (shared) {
      if (flags === 2 || flags === 4 || shared.exclusive) regionFailure('CILR0024');
      regions[shared.id].clauses.push(index);
    } else {
      shared = { id: appendRegion(regions, 'try', clause.start, clause.end, index), exclusive: flags === 2 || flags === 4 };
      tries.set(key, shared);
    }
    const handlerRegion = appendRegion(regions, handlerKinds[flags], clause.target, clause.handlerEnd, index);
    const filterRegion = flags === 1 ? appendRegion(regions, 'filter', exceptionClausePayload(clause), clause.target, index) : null;
    clauses.push({ index, flags, tryRegion: shared.id, handlerRegion, filterRegion });
  }
  return { regions, clauses };
}

