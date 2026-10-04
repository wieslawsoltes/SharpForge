import { DestinationError } from './destination-preflight.js';

/** Existing save callers retain the strict-empty contract; only explicit merge mode enables overwrite and rollback. */
export function destinationMode(options) {
  const mode = options.mode ?? 'empty';
  if (!['empty', 'merge'].includes(mode)) throw new DestinationError('SFDST001', 'Invalid destination mode: ' + mode);
  if (mode === 'empty' && options.overwritePaths?.length) {
    throw new DestinationError('SFDST001', 'Confirmed overwrites require explicit merge destination mode');
  }
  return mode;
}

export async function requireEmptyDestination(handle, signal) {
  signal?.throwIfAborted();
  for await (const _entry of handle.entries()) {
    throw new DestinationError('SFDST005', 'Choose an empty destination folder; existing content is never overwritten');
  }
  signal?.throwIfAborted();
}

export function destinationWriteFailure(cause, written, rollback, mode) {
  const completed = written.length + ' file(s) written before failure.';
  const detail = mode === 'empty' ? ' No preexisting file was intentionally overwritten.' :
    rollback.rolledBack ? ' Destination restored.' : ' Rollback left ' + rollback.leftovers.map(item => item.path).join(', ');
  const error = new DestinationError('SFDST007', cause.message + '; ' + completed + detail, { cause });
  if (mode === 'empty' || cause.name === 'AbortError') error.name = cause.name;
  return Object.assign(error, { written, atomic: false, ...rollback });
}
