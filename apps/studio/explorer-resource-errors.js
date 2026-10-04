import {EditorServiceError} from '@sharpforge/editor';

/** Keep stale-resource diagnostics specific only when the journal proves that no commit or disk mutation occurred. */
export function resourceTransactionError(error) {
  const receipt = error?.receipt;
  if (error?.code !== 'SFW1110' || error.cause?.code !== 'SFEX_RESOURCE_CHANGED' || error.committed !== false ||
      receipt?.status !== 'failed' || !Array.isArray(receipt.completedMutations) || receipt.completedMutations.length !== 0 ||
      error.completedMutations !== receipt.completedMutations || !Array.isArray(error.written) || error.written.length !== 0) {
    return error;
  }
  const diagnostic = new EditorServiceError(error.cause.code, error.cause.message);
  Object.defineProperty(diagnostic, 'cause', {value: error, writable: true, configurable: true});
  diagnostic.receipt = receipt;
  diagnostic.completedMutations = error.completedMutations;
  diagnostic.written = error.written;
  diagnostic.committed = false;
  return diagnostic;
}
