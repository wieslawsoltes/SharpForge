import { CilError } from '../binary/error.js';

/** Optional per-read bounds; ordinary callers retain the existing one-million-row limit. */
export class MetadataReadBudget {
  constructor(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new CilError('Invalid metadata reader options');
    }
    this.maxRows = options.maxRows ?? 1_000_000;
    if (!Number.isInteger(this.maxRows) || this.maxRows < 0 || this.maxRows > 1_000_000) {
      throw new CilError('Metadata reader row limit must be an integer from 0 through 1000000');
    }
    this.signal = options.signal;
    this.check();
  }

  check() {
    if (this.signal?.aborted) {
      const error = new CilError('Metadata reading canceled');
      error.code = 'MD_READ_CANCELED';
      throw error;
    }
  }
}
