import { CilError } from '../binary.js';

export function checkTableCancellation(signal) {
  if (signal?.aborted) throw new CilError('Metadata view cancelled');
}

export function tableInteger(value, name, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new CilError(`Invalid metadata view ${name}`);
  return value;
}

export function tableOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new CilError('Invalid metadata view options');
  return options;
}

/** Limits charge physical row bytes and every returned heap/name occurrence before decoding/copying. */
export class TableViewBudget {
  constructor(options = {}) {
    const { maxPageBytes = 1024 * 1024, maxEntryBytes = 65536, signal } = tableOptions(options);
    this.remaining = tableInteger(maxPageBytes, 'page byte budget', 4 * 1024 * 1024);
    this.entryBytes = tableInteger(maxEntryBytes, 'entry byte budget', 1024 * 1024);
    this.signal = signal;
    checkTableCancellation(signal);
  }

  charge(bytes) {
    checkTableCancellation(this.signal);
    if (bytes > this.remaining) throw new CilError('Metadata view page byte budget exceeded');
    this.remaining -= bytes;
  }

  checkEntry(bytes) {
    if (bytes > this.entryBytes) throw new CilError('Metadata view entry byte budget exceeded');
    if (bytes > this.remaining) throw new CilError('Metadata view page byte budget exceeded');
    checkTableCancellation(this.signal);
  }
}

export function tablePage(options, total) {
  const { offset: pageOffset = 0, limit: pageLimit = 100 } = options;
  const offset = tableInteger(pageOffset, 'page offset', total);
  const limit = tableInteger(pageLimit, 'page limit', 1000);
  const end = Math.min(total, offset + limit);
  return { offset, limit, end, total, nextOffset: limit && end < total ? end : null };
}
