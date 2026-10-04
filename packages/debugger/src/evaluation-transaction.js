import {parseExpression} from '@sharpforge/syntax';
import {isReference} from '@sharpforge/runtime';

function parseEvaluation(vm, expression, options) {
  if (!options.allowSideEffects) throw new Error('Function evaluation executes program code. Explicit side-effect consent is required');
  if (!['paused', 'waiting', 'terminated'].includes(vm.state)) throw new Error('Pause before evaluating program code');
  if (!Number.isSafeInteger(options.maxInstructions) || options.maxInstructions < 1 || options.maxInstructions > 1000000 ||
      !Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs < 1 || options.timeBudgetMs > 2000) {
    throw new Error('Invalid evaluation budget');
  }
  if (typeof expression !== 'string' || expression.length > 16384) throw new Error('Evaluation expression exceeds 16384 characters');
  const parsed = parseExpression(expression);
  if (parsed.diagnostics.length) throw new Error(parsed.diagnostics[0].message);
  return parsed.expression;
}

function captureEvaluation(session) {
  const vm = session.vm;
  return {
    snapshot: vm.snapshot(), roots: [...vm.roots()], state: vm.state,
    suppressed: vm.scheduler?.suppressed, maximum: vm.options.maxInstructions,
    callbacks: {onOutput: vm.onOutput, onWrite: vm.onWrite, onException: vm.onException},
    reportMethods: vm.report?.methods.slice(), handles: session.evaluationHandles?.slice(),
    history: [...(session.history ?? [])], historyBytes: session.historyBytes, historyDropped: session.historyDropped,
    begin: performance.now(), instructions: vm.instructions, outputStart: vm.output.length
  };
}

function restoreControls(vm, before) {
  if (vm.scheduler) vm.scheduler.suppressed = before.suppressed;
  Object.assign(vm, before.callbacks);
  vm.options.maxInstructions = before.maximum;
}

function restoreEvaluation(session, before, transaction, started) {
  const vm = session.vm;
  try {
    // The open buffer suppresses restore's scene notification; no speculative effect escapes.
    if (started) vm.restore(before.snapshot);
  } finally {
    vm.state = before.state;
    vm.platform?.rollbackTransaction?.(transaction);
    session.history = before.history;
    session.historyBytes = before.historyBytes;
    session.historyDropped = before.historyDropped;
    if (before.handles) session.evaluationHandles = before.handles;
    else delete session.evaluationHandles;
    if (before.reportMethods) vm.report.methods = before.reportMethods;
  }
}

function retainResult(session, result) {
  if (!isReference(result.value)) return;
  const handles = session.evaluationHandles ??= [];
  handles.push(session.vm.heap.createHandle(result.value));
  while (handles.length > 32) session.vm.heap.releaseHandle(handles.shift());
}

function evaluationResponse(vm, result, before, commit) {
  const reference = isReference(result.value);
  return {
    result: result.type === 'bool' ? (result.value ? 'True' : 'False') : vm.display(result.value),
    type: result.type, value: commit || !reference ? result.value : null,
    reference: commit && reference ? result.value : null,
    output: vm.output.slice(before.outputStart).join(''), committed: commit,
    instructions: vm.instructions - before.instructions
  };
}

/** Managed evaluation rolls back until preparation completes. Host delivery is an irreversible commit boundary. */
export function evaluateTransaction(session, expression, supplied, Evaluator) {
  const {allowSideEffects = false, commit = true, maxInstructions = 100000, timeBudgetMs = 250, frameId, signal} = supplied;
  const options = {allowSideEffects, commit, maxInstructions, timeBudgetMs, frameId, signal};
  const vm = session.vm;
  const parsed = parseEvaluation(vm, expression, options);
  const frame = options.frameId === undefined ? vm.top : session.frame(options.frameId);
  const before = captureEvaluation(session);
  const check = () => {
    if (options.signal?.aborted) throw new Error('Function evaluation cancelled');
    if (performance.now() - before.begin > options.timeBudgetMs) throw new Error('Function evaluation timed out');
    if (vm.instructions - before.instructions > options.maxInstructions) throw new Error('Function evaluation instruction budget exceeded');
  };
  let transaction, started = false, restored = false, committed = false;
  try {
    check();
    session.remember?.(true);
    if (vm.scheduler) vm.scheduler.suppressed = true;
    vm.onOutput = () => {};
    vm.onWrite = null;
    vm.onException = null;
    vm.options.maxInstructions = vm.instructions + options.maxInstructions;
    transaction = vm.platform?.beginTransaction?.();
    started = true;
    const evaluator = new Evaluator(session, frame, check);
    const result = vm.heap.withRoots(before.roots, () => evaluator.eval(parsed));
    const response = evaluationResponse(vm, result, before, options.commit);
    if (!options.commit) {
      restored = true;
      restoreEvaluation(session, before, transaction, started);
      return response;
    }
    vm.heap.withRoots([result.value], () => {
      const prepare = () => {
        check();
        vm.state = before.state;
        vm.writeRevision++;
        restoreControls(vm, before);
        session.remember?.(true);
        // Temporary pins protect the result during capture without adding a transient history lease.
        retainResult(session, result);
        committed = true;
      };
      if (transaction) vm.platform.commitTransaction(transaction, prepare);
      else prepare();
      if (response.output) before.callbacks.onOutput(response.output);
    });
    return response;
  } catch (error) {
    if (!committed && !restored) restoreEvaluation(session, before, transaction, started);
    throw error;
  } finally {
    restoreControls(vm, before);
  }
}
