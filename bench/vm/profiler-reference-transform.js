const requiredConsumers = new Set(['vm.js', 'cil-vm.js', 'snapshot.js', 'execution/call-frames.js', 'execution/cil-method-events.js',
  'execution/cil-step.js', 'execution/cil-slice.js', 'execution/source-slice.js', 'execution/source-fusion.js',
  'execution/initialize-source.js', 'execution/cil-instrumentation.js', 'execution/context-events.js',
  'execution/stop.js', 'execution/heap-allocation.js']);
const consumers = new Set([...requiredConsumers, 'execution/cil-array-continuations.js', 'execution/source-array-continuations.js',
  'execution/numeric-blocks.js', 'execution/object-value-slice.js']);
const cilArrayProfilerBody = `  const profiler = vm.profiler;
  let succeeded = false;
  try {
    profiler?.instruction(frame);
    const result = resumeArrayOperation(vm, frame);
    if (result.done && result.returns) vm.push(result.value);
    succeeded = true;
  } finally { profiler?.endInstruction(succeeded); }`;
const cilObjectProfilerBody = `  let succeeded = false;
  try {
    vm.profiler?.instruction(frame);
    resumeObjectValueWork(vm, frame);
    succeeded = true;
  } finally { vm.profiler?.endInstruction(succeeded); }`;
const hook = /\b(?:executionProfiler|initializeExecutionProfiler|allocationObserver)\b|\b(?:vm|this)\.profiler\b|\bprofiler\?\./;
const unreviewedHook = /\b(?:vm|this)\.options\.profile\b|\bprofiler\.[A-Za-z_$][\w$]*\s*\(/;
const standalone = new Set(['instruction(frame);', 'endInstruction(succeeded);', 'enter(frame);', 'suspend();',
  'beginSlice();', 'closeSlice();', 'reportClockFailure();', 'boundary();']);

function hasHook(source) {
  return source.split('\n').some(line => !line.trim().startsWith('//') && (hook.test(line) || unreviewedHook.test(line)));
}

/** Reviewed textual deletions only. An unrecognized executable profiling hook makes the reference fail closed. */
export function stripProfilerConsumer(path, source) {
  if (path === 'execution/profiler.js' || path === 'execution/profiler-clock.js') return {source, changes: 0};
  if (!consumers.has(path)) {
    if (hasHook(source)) throw new Error('Unreviewed profiler consumer: ' + path);
    return {source, changes: 0};
  }
  let changes = 0;
  const rewrite = (pattern, replacement = '') => {
    source = source.replace(pattern, (...arguments_) => {
      changes++;
      return typeof replacement === 'function' ? replacement(...arguments_) : replacement;
    });
  };
  if (path === 'execution/cil-array-continuations.js') {
    rewrite(cilArrayProfilerBody, '  const result = resumeArrayOperation(vm, frame);\n' +
      '  if (result.done && result.returns) vm.push(result.value);');
  }
  if (path === 'execution/object-value-slice.js') rewrite(cilObjectProfilerBody, '  resumeObjectValueWork(vm, frame);');
  rewrite(/^import\s+\{\s*(?:executionProfiler|initializeExecutionProfiler)\s*\}\s+from\s+'[^']*\/profiler\.js';\r?\n/gm);
  rewrite(/get profiler\(\)\{return executionProfiler\(this\);\}/g, 'get profiler(){return null;}');
  rewrite(/^[ \t]*initializeExecutionProfiler\(vm, options\.profile\);\r?\n/gm);
  rewrite(/^[ \t]*const profiler = (?:vm\.profiler|executionProfiler\(vm\));\r?\n/gm);
  rewrite(/^[ \t]*if \(reason === 'call'\) vm\.profiler\?\.enter\(frame\);\r?\n/gm);
  rewrite(/^[ \t]*heap\.allocationObserver\?\.allocation\((?:size|delta, true)\);\r?\n/gm);
  rewrite(/^[ \t]*(?:vm\.)?profiler\?\.[^\n]+;\r?\n/gm, line => {
    // Keep exact known calls; a new argument or method requires explicit review.
    if (!standalone.has(line.trim().replace(/^(?:vm\.)?profiler\?\./, ''))) {
      throw new Error('Unreviewed profiler statement in ' + path);
    }
    return '';
  });
  if (path === 'execution/cil-step.js') {
    rewrite(/^[ \t]*let succeeded = false;\r?\n/gm);
    rewrite(/^[ \t]*succeeded = true;\r?\n/gm);
  }
  if (path === 'execution/source-slice.js') rewrite(/onSequence, profiler, started/g, 'onSequence, started');
  if (path === 'execution/source-fusion.js') rewrite(/ \|\| vm\.profiler \|\| vm\.options\.profile/g);
  if (path === 'execution/numeric-blocks.js') rewrite(/vm\.profiler \|\| vm\.options\.profile \|\| /g);
  if (path === 'execution/context-events.js') {
    rewrite(/if \(\(!log && !profiler\) \|\| previous === next\)/g, 'if (!log || previous === next)');
  }
  if (path === 'execution/stop.js') {
    rewrite(/^[ \t]*const hadGuestFault = vm\.fault \|\| vm\.pendingFault;\r?\n/gm);
    rewrite(/^[ \t]*if \(!hadGuestFault\) vm\.profiler\?\.reportClockFailure\(\);\r?\n/gm);
  }
  if (hasHook(source)) throw new Error('Unrecognized profiling hook remains in ' + path);
  return {source, changes};
}

export function profilerReferenceChanges(files) {
  const result = [];
  for (const [path, before] of files) {
    const transformed = stripProfilerConsumer(path, before);
    if (transformed.source !== before) result.push({path, before, after: transformed.source, changes: transformed.changes});
  }
  for (const path of requiredConsumers) {
    if (!result.some(change => change.path === path)) throw new Error('Expected profiler reference consumer was not transformed: ' + path);
  }
  return result;
}
