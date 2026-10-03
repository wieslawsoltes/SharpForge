import {isDeepStrictEqual} from 'node:util';
const sortedIds = rows => Array.isArray(rows) && rows.every(value => typeof value === 'string')
  && new Set(rows).size === rows.length && isDeepStrictEqual(rows, [...rows].sort());
export function validateTrace(trace, expected) {
  if (trace?.schemaVersion !== 1 || !['js', 'rust'].includes(trace.collector?.engine)
      || typeof trace.collector.version !== 'string' || !trace.collector.version
      || typeof trace.platform !== 'string' || !/^[a-z0-9]+-[a-z0-9]+$/.test(trace.platform)
      || trace.seed !== expected.seed || trace.fixtureSHA256 !== expected.fixtureSHA256
      || !/^[a-f0-9]{40}$/.test(trace.commit ?? '') || !Array.isArray(trace.traces)) throw new Error('Trace provenance or fixture mismatch');
  if (trace.traces.length !== expected.fixtures.length) throw new Error('Incomplete trace fixture set');
  for (const [i, fixture] of expected.fixtures.entries()) {
    const row = trace.traces[i], steps = fixture.operations.flatMap((operation, step) => operation.op === 'collect' ? [step] : []);
    if (row.fixture !== fixture.id || !Array.isArray(row.checkpoints) || row.checkpoints.length !== steps.length) throw new Error('Incomplete collection checkpoints');
    const known = new Set(fixture.operations.filter(operation => operation.op === 'allocate').map(operation => operation.id));
    for (const [j, point] of row.checkpoints.entries()) {
      if (point.step !== steps[j] || !sortedIds(point.reachable) || !sortedIds(point.collected)
          || [...point.reachable, ...point.collected].some(id => !known.has(id))
          || point.reachable.some(id => point.collected.includes(id))
          || !point.weak || Array.isArray(point.weak) || typeof point.weak !== 'object'
          || Object.values(point.weak).some(id => id !== null && !known.has(id))) throw new Error('Malformed reachable-set checkpoint');
    }
    const finalization = row.finalization;
    if (!finalization || !['recorded', 'unsupported'].includes(finalization.status)
        || finalization.status === 'recorded' && (!Array.isArray(finalization.order) || finalization.order.some(id => !known.has(id)))
        || finalization.status === 'unsupported' && (finalization.order !== null || !finalization.reason)) throw new Error('Invalid finalization observation');
  }
  return trace;
}
export function compareTraces(left, right, expected) {
  validateTrace(left, expected); validateTrace(right, expected);
  if (left.collector.engine !== 'js' || right.collector.engine !== 'rust') throw new Error('Comparison needs distinct JS and Rust collectors');
  const differences = [], unsupported = [];
  for (const [i, actual] of left.traces.entries()) {
    const other = right.traces[i];
    for (const [j, point] of actual.checkpoints.entries()) for (const field of ['reachable', 'collected', 'weak']) {
      if (!isDeepStrictEqual(point[field], other.checkpoints[j][field])) differences.push({fixture: actual.fixture, step: point.step,
        classification: field === 'weak' ? 'weak-reference-liveness' : field === 'collected' ? 'reclamation-set' : 'reachable-set', js: point[field], rust: other.checkpoints[j][field]});
    }
    if (actual.finalization.status !== 'recorded' || other.finalization.status !== 'recorded') unsupported.push({fixture: actual.fixture,
      axis: 'finalization-order', reason: 'At least one collector cannot observe GC finalization'});
    else if (!isDeepStrictEqual(actual.finalization.order, other.finalization.order)) differences.push({fixture: actual.fixture,
      classification: 'finalization-order', js: actual.finalization.order, rust: other.finalization.order});
  }
  return {status: differences.length ? 'different' : unsupported.length ? 'partial' : 'matched',
    reachableSets: differences.some(row => row.classification !== 'finalization-order') ? 'different' : 'matched', differences, unsupported};
}
