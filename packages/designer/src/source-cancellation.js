import {CancellationToken} from '@sharpforge/syntax';

/** Preserve native parser tokens; adapt AbortSignal to the syntax package's cooperative polling contract. */
export function sourceSyntaxCancellationToken(signal) {
  if (!signal || typeof signal.throwIfCancellationRequested === 'function') return signal;
  return new CancellationToken({poll: () => signal.aborted === true || signal.isCancellationRequested === true});
}
