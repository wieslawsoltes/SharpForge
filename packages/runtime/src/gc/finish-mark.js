/** One atomic termination phase owns root rescan, ephemeron closure, weak clearing and finalizer discovery. */
export function finishMark(heap, marker, extraRoots, callbacks, { rescan = true } = {}) {
  if (rescan) marker.roots(extraRoots);
  const rescanWork = marker.drain();
  const lifetime = heap.lifetime?.finishMark?.(callbacks) ?? {};
  const finalWork = marker.drain();
  return { rescanWork, finalWork, ...lifetime };
}
