/** Validate every committed parse case before applying the calibrated latency budget. */
const positiveMetrics = ['parseMs', 'megabytesPerSecond', 'relativeToCalibration'];
const heapMetrics = ['retainedHeapMB', 'peakHeapMB'];

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

function invalidCase(entry, side) {
  if (!isRecord(entry)) return `${side} case is missing or is not an object`;
  if (!Number.isSafeInteger(entry.characters) || entry.characters <= 0) return `${side} character count is invalid`;
  for (const metric of positiveMetrics)
    if (!isFiniteNumber(entry[metric]) || entry[metric] <= 0) return `${side} ${metric} must be finite and positive`;
  for (const metric of heapMetrics)
    if (!isFiniteNumber(entry[metric]) || entry[metric] < 0) return `${side} ${metric} requires a finite measurement with --expose-gc`;
  return null;
}

/**
 * Returns invalid/missing cases and cases exceeding `limit` (a fraction, default 0.15).
 * Every baseline case must be measured against the same input size; omitted cases never pass a gate.
 * Memory numbers are validated and retained as observations, not treated as allocation measurements.
 */
export function regressions(current, baseline, limit = 0.15) {
  if (!isFiniteNumber(limit) || limit < 0 || limit > 1) throw new RangeError('Regression tolerance must be between zero and one');
  if (!isRecord(baseline?.cases) || !Object.keys(baseline.cases).length)
    return [{ name: 'baseline', message: 'The baseline must contain measured cases' }];
  if (!isRecord(current?.cases)) return [{ name: 'measurement', message: 'The measurement must contain cases' }];

  const failures = [];
  for (const name of new Set([...Object.keys(baseline.cases), ...Object.keys(current.cases)])) {
    const entry = current.cases[name],
      reference = baseline.cases[name],
      invalid = invalidCase(reference, 'baseline') ?? invalidCase(entry, 'current');
    if (invalid) {
      failures.push({ name, message: invalid });
      continue;
    }
    if (entry.characters !== reference.characters) {
      failures.push({ name, message: `Input size changed: ${reference.characters} to ${entry.characters} characters` });
      continue;
    }
    const ratio = entry.relativeToCalibration / reference.relativeToCalibration;
    if (ratio > 1 + limit) {
      failures.push({
        name,
        baseline: reference.relativeToCalibration,
        current: entry.relativeToCalibration,
        change: Math.round((ratio - 1) * 10_000) / 100
      });
    }
  }
  return failures;
}
