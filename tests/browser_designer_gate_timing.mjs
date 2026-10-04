import {assert} from './browser_designer_gate_harness.mjs';

export function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = value => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))] ?? null;
  return {samples: sorted.length, median: percentile(.5), p95: percentile(.95), p99: percentile(.99),
    maximum: sorted.at(-1) ?? null, over16ms: sorted.filter(value => value > 16).length};
}

/** Observe real renderer/worker tasks without changing their scheduling, CSP, or application handlers. */
export async function traceInteraction(context, page, action) {
  const client = await context.newCDPSession(page);
  try {
    await client.send('Tracing.start', {categories: 'toplevel,devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream'});
    let failure;
    try { await action(); } catch (error) { failure = error; }
    const completed = new Promise(resolve => client.once('Tracing.tracingComplete', resolve));
    await client.send('Tracing.end');
    const {stream} = await completed;
    let json = '';
    try {
      for (;;) {
        const part = await client.send('IO.read', {handle: stream});
        json += part.base64Encoded ? Buffer.from(part.data, 'base64').toString('utf8') : part.data;
        assert(json.length <= 128 * 1024 * 1024, 'The bounded browser timeline exceeded 128 MiB.');
        if (part.eof) break;
      }
    } finally { await client.send('IO.close', {handle: stream}); }
    const trace = JSON.parse(json);
    if (failure) { failure.rendererTrace = trace; throw failure; }
    return trace;
  } finally { await client.detach(); }
}

/** Full overlapping top-level tasks count, including a task crossing an interaction mark; nested calls are not added twice. */
export function traceMeasurements(trace, {startMark = 'a18-drag-start', endMark = 'a18-drag-end', minimumFrames = 20} = {}) {
  const events = trace.traceEvents;
  const renderers = new Set(events.filter(event => event.ph === 'M' && event.name === 'thread_name' &&
    event.args?.name === 'CrRendererMain').map(event => `${event.pid}:${event.tid}`));
  const start = events.find(event => event.name === startMark);
  const finish = events.find(event => event.name === endMark);
  assert(start && finish, 'The browser trace must include both interaction boundary marks.');
  const relevant = events.filter(event => renderers.has(`${event.pid}:${event.tid}`) && event.ph === 'X' &&
    event.ts <= finish.ts && event.ts + (event.dur ?? 0) >= start.ts);
  const tasks = relevant.filter(event => event.name === 'RunTask' || event.name === 'ThreadControllerImpl::RunTask');
  const frames = relevant.filter(event => event.name === 'FireAnimationFrame');
  assert(tasks.length, 'The trace did not expose renderer main-thread task durations; no frame-budget result can be claimed.');
  assert(frames.length >= minimumFrames, 'The interaction did not exercise enough real animation-frame gesture callbacks.');
  return {intervalMs: (finish.ts - start.ts) / 1000, rendererTasks: distribution(tasks.map(event => event.dur / 1000)),
    animationCallbacks: distribution(frames.map(event => event.dur / 1000)),
    longestTasks: [...tasks].sort((left, right) => right.dur - left.dur).slice(0, 10)
      .map(event => ({name: event.name, milliseconds: event.dur / 1000, timestampMicroseconds: event.ts}))};
}
