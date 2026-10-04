/** Drain an existing lazy sweep without changing its live-set decisions. */
export function drainSweep(sweep) {
  let work = 0;
  while (!sweep.done) work += sweep.step(65536).work;
  return { ...sweep.statistics, work };
}
