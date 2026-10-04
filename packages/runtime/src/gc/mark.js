/** Eager and incremental collectors intentionally share the same tracer and termination protocol. */
export function drainMark(marker) {
  return marker.drain();
}
