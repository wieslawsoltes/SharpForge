/** Hard ceilings are part of the offline fixture contract, not campaign suggestions. */
export const HARD_LIMITS = Object.freeze({
  maxCases: 4096, caseTimeoutMs: 2000, startupTimeoutMs: 10000, campaignTimeoutMs: 600000,
  maxInputBytes: 65536, maxOutputBytes: 65536, heapGrowthBytes: 32 * 1024 * 1024,
  v8HeapMb: 128, rssBytes: 256 * 1024 * 1024, maxCorpusCases: 128, maxCorpusBytes: 8 * 1024 * 1024,
});

export const DEFAULT_BUDGETS = Object.freeze({
  ...HARD_LIMITS, maxCases: 32, caseTimeoutMs: 1000, startupTimeoutMs: 5000,
  campaignTimeoutMs: 30000, heapGrowthBytes: 16 * 1024 * 1024,
});

export const TARGET_IDS = Object.freeze([
  'pe-loader', 'bytecode-image', 'portable-pdb', 'zip-archive', 'protocol',
  'il-document', 'msbuild-xml', 'network',
]);

export const SELF_TEST_IDS = Object.freeze([
  'harness-accepted', 'harness-rejected', 'harness-overrun', 'harness-allocation',
  'harness-failure', 'harness-output', 'harness-disposal',
  'harness-abort-rejection',
]);

export const CONTROL_BYTES = 128 * 1024;
export const MAX_SEEDS = 32;
export const PROTOCOL = 'sharpforge-offline-robustness-v1';

/** Reject unknown settings and nonintegral/out-of-range values; never silently widen a limit. */
export function normalizeBudgets(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Budgets must be an object');
  const result = { ...DEFAULT_BUDGETS };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(HARD_LIMITS, key)) throw new RangeError(`Unknown fixture budget: ${key}`);
    const minimum = key === 'v8HeapMb' ? 32 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || value > HARD_LIMITS[key]) {
      throw new RangeError(`${key} must be ${minimum}..${HARD_LIMITS[key]}`);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

export function validateTargetId(targetId, selfTest = false) {
  if (typeof selfTest !== 'boolean' || !(selfTest ? SELF_TEST_IDS : TARGET_IDS).includes(targetId)) {
    throw new RangeError('A fixed reviewed target ID is required');
  }
  return targetId;
}

export function validateUint32(value, name = 'seed') {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError(`${name} must be a uint32`);
  return value;
}

export function validateInput(input, maxInputBytes) {
  if (!(input instanceof Uint8Array)) throw new TypeError('Fixture input must be Uint8Array');
  if (input.byteLength > maxInputBytes) throw new RangeError('Fixture input exceeds byte limit');
  return input;
}
