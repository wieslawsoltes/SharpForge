import { CilError } from '../binary.js';

export const inventoryDiagnostics = Object.freeze({
  CILDI0001: 'Invalid metadata inventory input or options',
  CILDI0002: 'Metadata inventory size limit exceeded',
  CILDI0003: 'Metadata inventory cancelled',
  CILDI0004: 'Physical metadata rows and table counts disagree',
  CILDI0005: 'Metadata row summary is unavailable',
  CILDI0006: 'Whole-assembly C# reconstruction is incomplete',
  CILDI0007: 'Physical MethodDef has no usable decompile result',
  CILDI0008: 'Method output does not preserve all declaration metadata',
  CILDI0009: 'Metadata table semantics are not represented by the decompiler',
});

const ceilings = Object.freeze({ maxRows: 1_000_000, maxBytes: 64 * 1024 * 1024, maxEntryBytes: 1024 * 1024 });
const defaults = Object.freeze({ maxRows: 100_000, maxBytes: 16 * 1024 * 1024, maxEntryBytes: 65536 });

export function inventoryFailure(code, detail) {
  const error = new CilError(inventoryDiagnostics[code] + (detail ? ': ' + detail : ''));
  error.code = code;
  throw error;
}

export function inventoryCancellation(signal) {
  if (signal?.aborted) inventoryFailure('CILDI0003');
}

export function inventoryOptions(options = {}, signal) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) inventoryFailure('CILDI0001');
  if (signal != null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
    inventoryFailure('CILDI0001', 'signal');
  }
  const result = { signal };
  for (const [name, ceiling] of Object.entries(ceilings)) {
    const value = options[name] === undefined ? defaults[name] : options[name];
    if (!Number.isSafeInteger(value) || value < 0 || value > ceiling) inventoryFailure('CILDI0001', name);
    result[name] = value;
  }
  inventoryCancellation(signal);
  return result;
}

/** Budget adapter for the existing table-heap extent reader, with inventory-wide limits and stable diagnostics. */
export class InventoryBudget {
  constructor(limits) {
    this.remaining = limits.maxBytes;
    this.entryBytes = limits.maxEntryBytes;
    this.signal = limits.signal;
    this.entryCharged = null;
  }

  beginEntry() { this.entryCharged = 0; }
  endEntry() { this.entryCharged = null; }

  checkEntry(bytes) {
    inventoryCancellation(this.signal);
    if (bytes > this.entryBytes) inventoryFailure('CILDI0002', 'summary entry bytes');
    // Reserve progress before decoding. Unterminated strings never reach the heap reader's final charge.
    this.charge(bytes);
  }

  charge(bytes) {
    inventoryCancellation(this.signal);
    const additional = this.entryCharged === null ? bytes : Math.max(0, bytes - this.entryCharged);
    if (additional > this.remaining) inventoryFailure('CILDI0002', 'summary bytes');
    this.remaining -= additional;
    if (this.entryCharged !== null) this.entryCharged = Math.max(this.entryCharged, bytes);
  }
}
