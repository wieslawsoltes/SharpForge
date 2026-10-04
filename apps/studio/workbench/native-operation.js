import { abortError, assertId, cancellable } from './events.js';

const phases = new Map([['queued', 0], ['running', 1], ['cancelling', 2], ['succeeded', 3], ['failed', 3], ['cancelled', 3]]);

export function nativeJobTerminal(status) {
  return phases.get(status) === 3;
}

function checkedSnapshot(job, id = job?.id) {
  assertId(job?.id, 'Native job ID');
  if (job.id !== id) throw new Error('Native host replied for a different job');
  if (!phases.has(job.status)) throw new Error('Native host reported an unknown job status');
  if (!Number.isSafeInteger(job.nextCursor) || job.nextCursor < 0) throw new Error('Native host reported an invalid job cursor');
  if (job.events !== undefined && !Array.isArray(job.events)) throw new Error('Native host reported invalid job events');
  return job;
}

function advances(job, previous) {
  return !previous || previous.id !== job.id || (!nativeJobTerminal(previous.status) &&
    job.nextCursor >= previous.nextCursor && phases.get(job.status) >= phases.get(previous.status));
}

function selectedJob(tools, owner, id) {
  return tools.jobOwner === owner && tools.job?.id === id;
}

function operationFor(tools, owner, id) {
  const operation = tools.nativeOperation;
  return operation?.owner === owner && operation.jobId === id ? operation : null;
}

/** Publish a native snapshot with captured cancellation ownership; background replies preserve the selected native job. */
export function acceptNativeJob(tools, job, { owner = tools.client, select = true } = {}) {
  checkedSnapshot(job);
  if (!owner || typeof owner.cancel !== 'function') throw new TypeError('Native jobs require their actual client owner');
  const snapshot = { ...job, events: [] };
  const operation = operationFor(tools, owner, job.id);
  if (operation && advances(snapshot, operation.job)) operation.job = snapshot;
  if (tools.disposed) return snapshot;
  const same = selectedJob(tools, owner, job.id);
  const selected = select && (!same || advances(snapshot, tools.job));
  if (selected) {
    if (!same) { tools.log = ''; tools.cursor = 0; }
    for (const event of job.events ?? []) {
      if (event.cursor > tools.cursor) tools.log += event.text;
    }
    tools.cursor = job.nextCursor;
    if (tools.log.length > 1048576) tools.log = tools.log.slice(-1048576);
    tools.job = snapshot;
    tools.jobOwner = owner;
  }
  const cancel = () => cancelNativeJob(tools, { owner, jobId: job.id });
  tools.onJob?.(snapshot, { owner, cancel, selected });
  if (selected) tools.renderBuild();
  return snapshot;
}

async function transport(tools, owner, id, request) {
  try {
    return checkedSnapshot(await request(), id);
  } catch (error) {
    if (!tools.disposed) tools.onJobFailure?.(id, error, { owner });
    throw error;
  }
}

/** Cancel the captured job, including an older visible task, without consulting a later client or UI job selection. */
export async function cancelNativeJob(tools, { owner = tools.jobOwner ?? tools.client, jobId = tools.job?.id } = {}) {
  if (!jobId || !owner) return null;
  if (selectedJob(tools, owner, jobId) && nativeJobTerminal(tools.job.status)) return tools.job;
  const operation = operationFor(tools, owner, jobId);
  if (operation?.job && nativeJobTerminal(operation.job.status)) return operation.job;
  const owners = tools.nativeCancellations ??= new Map();
  const jobs = owners.get(owner) ?? new Map();
  if (jobs.has(jobId)) return jobs.get(jobId);
  owners.set(owner, jobs);
  const cancel = async () => {
    const snapshot = await transport(tools, owner, jobId, () => owner.cancel(jobId));
    acceptNativeJob(tools, snapshot, { owner, select: selectedJob(tools, owner, jobId) });
    return snapshot;
  };
  const pending = cancel();
  jobs.set(jobId, pending);
  try {
    return await pending;
  } finally {
    if (jobs.get(jobId) === pending) jobs.delete(jobId);
    if (!jobs.size && owners.get(owner) === jobs) owners.delete(owner);
  }
}

function ready(tools) {
  if (tools.disposed) throw new Error('Native build tools are disposed');
  if (tools.busy) throw new Error('A native operation is already running');
  if (!tools.client || !tools.capabilities) throw new Error('Open Studio from the local MSBuild host URL');
  if (!tools.capabilities.available) throw new Error(tools.capabilities.error ?? 'MSBuild is not installed');
  if (!tools.capabilities.trusted || !tools.settings.trusted) {
    throw new Error('Enable native execution on the host and explicitly trust this workspace before running MSBuild, including evaluation.');
  }
}

function inspect(tools, operation, action) {
  const job = operation.job;
  if (tools.disposed || !selectedJob(tools, operation.owner, job.id) || job.status !== 'succeeded' || !job.result) return;
  tools.inspection = { project: job.request.project, action: job.request.action, result: job.result, jobId: job.id };
  tools.renderInspector();
  if (['evaluate', 'preprocess', 'targets'].includes(action)) tools.onSelectPanel?.('msbuild-inspector');
}

function waitForPoll(signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 200);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Run and poll one captured MSBuild client/job. Only failures after an observed job ID are reported as that task's failure. */
export async function runNativeOperation(tools, action = 'build') {
  ready(tools);
  let finish;
  const operation = { owner: tools.client, jobId: null, job: null, controller: new AbortController(),
    finished: new Promise(resolve => { finish = resolve; }) };
  const request = tools.request(action);
  tools.nativeOperation = operation;
  tools.busy = true;
  tools.renderBuild();
  try {
    const dirty = (tools.getSourceChanges?.().length ?? 0) + tools.sourceChanges().length;
    if (dirty) {
      if (!tools.settings.save) throw new Error('Unsaved native editor changes. Save them, or enable Save before operation.');
      await tools.save();
    }
    if (tools.disposed) throw new Error('Native build tools are disposed');
    const first = checkedSnapshot(await operation.owner.start(request));
    operation.jobId = first.id;
    operation.job = first;
    tools.log = '';
    tools.cursor = 0;
    tools.accept(first, { owner: operation.owner });
    if (tools.disposed && !nativeJobTerminal(operation.job.status)) {
      await cancelNativeJob(tools, { owner: operation.owner, jobId: operation.jobId });
    }
    if (!tools.disposed) tools.onSelectPanel?.('msbuild');
    while (!nativeJobTerminal(operation.job.status) && !tools.disposed) {
      await waitForPoll(operation.controller.signal);
      if (tools.disposed || nativeJobTerminal(operation.job.status)) break;
      const snapshot = await transport(tools, operation.owner, operation.jobId,
        () => cancellable(operation.owner.job(operation.jobId, operation.job.nextCursor), operation.controller.signal));
      tools.accept(snapshot, { owner: operation.owner, select: selectedJob(tools, operation.owner, operation.jobId) });
    }
    inspect(tools, operation, action);
    return operation.job;
  } catch (error) {
    if (!tools.disposed || error?.name !== 'AbortError' || !operation.jobId) throw error;
    await cancelNativeJob(tools, { owner: operation.owner, jobId: operation.jobId });
    return operation.job;
  } finally {
    if (tools.nativeOperation === operation) tools.nativeOperation = null;
    tools.busy = false;
    finish();
    tools.renderBuild();
  }
}

/** Keep owner credentials until captured cancellations settle, including a job whose start response is still pending. */
export function disposeNativeOperations(tools) {
  if (tools.nativeDisposal) return tools.nativeDisposal;
  tools.disposed = true;
  const operation = tools.nativeOperation;
  const owners = new Set([tools.client, tools.jobOwner, operation?.owner].filter(Boolean));
  const pending = [];
  if (operation?.jobId && !nativeJobTerminal(operation.job.status)) {
    pending.push(cancelNativeJob(tools, { owner: operation.owner, jobId: operation.jobId }));
  }
  operation?.controller.abort(abortError('Native tools disposed'));
  if (tools.job && !nativeJobTerminal(tools.job.status) && !operationFor(tools, tools.jobOwner, tools.job.id)) {
    pending.push(cancelNativeJob(tools));
  }
  if (operation) pending.push(operation.finished);
  const disconnect = () => { for (const owner of owners) owner.disconnect?.(); };
  if (!pending.length) {
    disconnect();
    tools.nativeDisposal = Promise.resolve();
    return tools.nativeDisposal;
  }
  tools.nativeDisposal = Promise.allSettled(pending).then(results => {
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) {
      tools.disposeError = errors.length === 1 ? errors[0] : new AggregateError(errors, 'Native cancellation during disposal failed');
      tools.onError?.(tools.disposeError);
    }
  }).finally(disconnect);
  return tools.nativeDisposal;
}
