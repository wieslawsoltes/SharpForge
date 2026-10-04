import { CilError } from '../binary.js';
import { clauseDiagnosticCatalog } from '../exception-clauses.js';

export const exceptionRegionDiagnosticCatalog = Object.freeze({
  CILR0001: 'Invalid exception region input or options',
  CILR0002: 'Exception region size limit exceeded',
  CILR0003: 'Exception region validation cancelled',
  ...clauseDiagnosticCatalog,
  CILR0016: 'Try start is not an instruction-group boundary',
  CILR0017: 'Try end is not an instruction-group boundary',
  CILR0018: 'Handler start is not an instruction-group boundary',
  CILR0019: 'Handler end is not an instruction-group boundary',
  CILR0020: 'Filter start is not an instruction-group boundary',
  CILR0021: 'Regions of one exception clause overlap',
  CILR0022: 'Exception regions partially overlap',
  CILR0023: 'Only try regions may share an identical interval',
  CILR0024: 'A shared try requires catch or filter handlers',
  CILR0025: 'An exception clause cannot nest inside a filter',
  CILR0026: 'Nested clause regions must lie within one enclosing region',
  CILR0027: 'Nested clauses must precede enclosing clauses',
  CILR0028: 'Exception region depth limit exceeded',
  CILR0029: 'Invalid method instructions',
  CILR0030: 'Dangling instruction prefix',
});

export function regionFailure(code, message = exceptionRegionDiagnosticCatalog[code]) {
  const error = new CilError(message);
  error.code = code;
  throw error;
}

export function checkRegionCancellation(signal) {
  if (signal?.aborted) regionFailure('CILR0003');
}
