/**
 * Running a compiled program to its end and comparing it with a pinned Roslyn result (SF-A02-T40); shared by every
 * execution axis of the differential harness.
 */

const TIME_STEPS = 10_000;

/** The first line of an error, bounded, for a report cell. */
export const brief = error => String(error?.message ?? error).split('\n')[0].slice(0, 200);

/**
 * Runs a program to its end. Time is virtual: when every context waits (Task.Delay, Thread.Sleep) the clock jumps to
 * the next deadline, so asynchronous programs finish deterministically and without real delays.
 */
export function runToEnd(vm) {
  let result = vm.run();
  for (let step = 0; step < TIME_STEPS && result.state === 'waiting'; step++) {
    const delay = vm.scheduler.nextDelay();
    if (delay === null) break;
    vm.scheduler.advance(delay);
    result = vm.run();
  }
  return result;
}

/** Runs one compiled program; returns `{ok, detail}` against the pinned output and termination kind. */
export function compareRun(run, pinned) {
  let result;
  try {
    result = run();
  } catch (error) {
    return { ok: false, detail: 'crash: ' + brief(error) };
  }
  const expectedState = pinned.exception ? 'faulted' : 'terminated';
  if (result.state !== expectedState) {
    return { ok: false, detail: `state ${result.state}${result.fault ? ' (' + brief(result.fault) + ')' : ''}, expected ${expectedState}` };
  }
  if (result.output !== pinned.output) {
    return { ok: false, detail: `output ${JSON.stringify(result.output).slice(0, 120)} expected ${JSON.stringify(pinned.output).slice(0, 120)}` };
  }
  return { ok: true, detail: '' };
}
