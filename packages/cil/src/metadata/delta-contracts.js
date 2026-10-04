import { CilError } from '../binary/error.js';
import { metadataReadSignal } from './reader-budget.js';
import { TableId, tableDefinitions } from './tables.js';

export const metadataGenerationDiagnosticCatalog = Object.freeze({
  MD_GEN_INPUT: 'Invalid metadata generation input or options',
  MD_GEN_FORMAT: 'Unsupported or malformed physical CLI generation',
  MD_GEN_IDENTITY: 'Module identity or generation chain does not match',
  MD_GEN_MAP: 'Invalid edit-and-continue entity mapping',
  MD_GEN_REFERENCE: 'A raw row references an unavailable aggregate entity or heap slot',
  MD_GEN_TOKEN: 'Invalid, unavailable or future metadata entity handle',
  MD_GEN_HEAP: 'Invalid, unavailable or unreadable metadata heap handle',
  MD_GEN_CONTROL: 'EnC control tables have generation-local identities only',
  MD_GEN_BUDGET: 'Metadata generation retention or query budget exceeded',
  MD_GEN_CANCELED: 'Metadata generation operation was canceled',
  MD_GEN_DISPOSED: 'Metadata generation history is disposed',
});

const limits = Object.freeze({
  maxGenerations: [64, 1024],
  maxInputBytes: [64 * 1024 * 1024, 128 * 1024 * 1024],
  maxRetainedBytes: [128 * 1024 * 1024, 1024 * 1024 * 1024],
  maxRetainedRecords: [500_000, 1_000_000],
});

export function generationError(code, message, cause) {
  const error = new CilError(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  throw error;
}

export function generationOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    generationError('MD_GEN_INPUT', 'Metadata generation options must be an object');
  }
  return options;
}

export function generationInteger(value, name, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    generationError('MD_GEN_INPUT', `Invalid metadata generation ${name}`);
  }
  return value;
}

export function generationSignal(signal) {
  try { return metadataReadSignal(signal); }
  catch (error) { generationError('MD_GEN_INPUT', 'Invalid metadata generation signal', error); }
}

export function checkGenerationCancellation(signal) {
  if (signal?.aborted) generationError('MD_GEN_CANCELED', 'Metadata generation operation canceled');
}

export function generationLimits(options) {
  generationOptions(options);
  return Object.fromEntries(Object.entries(limits).map(([name, [value, maximum]]) =>
    [name, generationInteger(options[name] ?? value, name, maximum, 1)]));
}

export function generationTable(table, controls = false) {
  const id = typeof table === 'string' ? TableId[table] : table;
  const definition = Number.isInteger(id) && id >= 0 && id <= 44 ? tableDefinitions[id] : null;
  if (!definition) generationError('MD_GEN_TOKEN', 'Unknown CLI metadata table');
  if (!controls && (id === 30 || id === 31)) {
    generationError('MD_GEN_CONTROL', 'Use controlRows for generation-local EnC tables');
  }
  return definition;
}

export function generationToken(value, allowNil = false, controls = false) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff || (!allowNil && !(value & 0xffffff))) {
    generationError('MD_GEN_TOKEN', 'Invalid CLI metadata entity token');
  }
  generationTable(value >>> 24, controls);
  return value;
}

/** Per-call output bounds; no operation retains decoded heap values in a query cache. */
export class GenerationQuery {
  constructor(options = {}) {
    generationOptions(options);
    this.signal = generationSignal(options.signal);
    this.remaining = generationInteger(options.maxPageBytes ?? 1024 * 1024, 'page byte limit', 16 * 1024 * 1024);
    this.maxEntry = generationInteger(options.maxEntryBytes ?? 65536, 'heap entry limit', 1024 * 1024);
    this.check();
  }

  check() { checkGenerationCancellation(this.signal); }

  checkEntry(bytes) {
    this.check();
    if (bytes > this.maxEntry || bytes > this.remaining) {
      generationError('MD_GEN_BUDGET', 'Metadata generation heap entry budget exceeded');
    }
  }

  charge(bytes) {
    this.check();
    if (bytes > this.remaining) generationError('MD_GEN_BUDGET', 'Metadata generation page byte budget exceeded');
    this.remaining -= bytes;
  }
}

export function generationPage(options, total) {
  const offset = generationInteger(options.offset ?? 0, 'page offset', total);
  const limit = generationInteger(options.limit ?? 100, 'page limit', 1000);
  const end = Math.min(total, offset + limit);
  return { offset, limit, total, end, nextOffset: limit && end < total ? end : null };
}
