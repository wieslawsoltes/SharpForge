import {fail} from '../host.js';

/** Retain the comparison exception as a GC-visible managed InnerException. */
export function comparisonFailure(platform, error) {
  const heap = platform.heap;
  heap.withRoots([error.reference], () => {
    let inner = error.reference;
    if (!inner) {
      const message = heap.string(error.message);
      inner = heap.allocate('exception', error.name, [message], [message]);
    }
    heap.withRoots([inner], () => {
      const text = 'Failed to compare two elements in the array.';
      const message = heap.string(text);
      const reference = heap.allocate('exception', 'System.InvalidOperationException', [message, inner], [message, inner]);
      fail(platform, 'InvalidOperationException', text, reference);
    });
  });
}
