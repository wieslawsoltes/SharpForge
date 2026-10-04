import { GitError, checkCancelled } from '@sharpforge/git';

const pendingLoads = new WeakMap();
const ownedLoads = new WeakMap();

function captureWorkspace(host) {
  const state = host.getState?.() ?? {};
  const identity = host.getWorkspaceIdentity();
  const fields = ['revision', 'diskRevision', 'workspaceEpoch', 'nativeMode'];
  const before = fields.map(key => state[key]);
  const files = state.files;
  return () => {
    const current = host.getState?.() ?? {};
    if (current.readOnly || host.getWorkspaceIdentity() !== identity || current.files !== files ||
        fields.some((key, index) => current[key] !== before[index])) {
      throw new GitError('Conflict', 'The workspace or its documents changed while Git was preparing files; no replacement was applied.');
    }
  };
}

function forwardAbort(signal, controller) {
  if (!signal || signal === controller.signal) return () => {};
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

/** Capture ownership before the first picker/read await; native hosts may supply their own workspace-load ticket. */
export function beginGitWorkspaceLoad(host, { signal } = {}) {
  checkCancelled(signal);
  const controller = new AbortController();
  const disconnect = forwardAbort(signal, controller);
  let native;
  let checkCaptured;
  try {
    native = host.beginWorkspaceLoad?.({ signal: controller.signal });
    if (host.beginWorkspaceLoad && (!native?.signal || typeof native.check !== 'function' || typeof native.finish !== 'function')) {
      throw new TypeError('The workspace-load host must return a signal, check function and finish function');
    }
    checkCaptured = native ? () => native.check() : captureWorkspace(host);
  } catch (error) { disconnect(); throw error; }
  let finished = false;
  const ticket = Object.freeze({
    native,
    signal: native?.signal ?? controller.signal,
    checkCurrent() {
      checkCancelled(ticket.signal);
      if (finished) throw new GitError('Cancelled', 'The Git workspace load has already finished');
      if (pendingLoads.get(host) !== ticket) throw new GitError('Cancelled', 'A newer workspace load superseded this Git operation');
    },
    check() { ticket.checkCurrent(); checkCaptured(); },
    connect(signal) { return signal === ticket.signal ? () => {} : forwardAbort(signal, controller); },
    cancel(reason = new GitError('Cancelled', 'Git workspace loading was cancelled')) { controller.abort(reason); },
    finish() {
      if (finished) return;
      finished = true;
      disconnect();
      if (pendingLoads.get(host) === ticket) pendingLoads.delete(host);
      native?.finish();
    }
  });
  const previous = pendingLoads.get(host);
  pendingLoads.set(host, ticket);
  ownedLoads.set(ticket, host);
  previous?.cancel(new GitError('Cancelled', 'A newer workspace load superseded this Git operation'));
  try { ticket.check(); }
  catch (error) { ticket.finish(); throw error; }
  return ticket;
}

/** Reuse one ticket across nested clone/provider/adoption calls and retain the original committed-failure identity. */
export async function withGitWorkspaceLoad(host, options = {}, action) {
  const existing = options.workspaceLoad;
  if (existing && ownedLoads.get(existing) !== host) throw new GitError('Conflict', 'Git workspace ticket belongs to another host');
  const ticket = existing ?? beginGitWorkspaceLoad(host, options);
  const disconnect = ticket.connect(options.signal);
  let failure;
  let failed = false;
  try {
    ticket.check();
    return await action({ ...options, workspaceLoad: ticket, signal: ticket.signal });
  } catch (error) { failed = true; failure = error; throw error; }
  finally {
    disconnect();
    if (!existing) {
      try { ticket.finish(); }
      catch (error) {
        if (!failed) throw error;
        const combined = new AggregateError([failure, error], 'Workspace loading failed and ticket cleanup reported an error');
        if (failure?.committed) combined.committed = true;
        throw combined;
      }
    }
  }
}

export function checkGitWorkspaceLoad(options = {}) {
  checkCancelled(options.signal);
  options.workspaceLoad?.check();
}

/** After source adoption only ticket ownership remains valid; the precommit document revision has intentionally advanced. */
export function checkGitWorkspaceLoadOwnership(options = {}) {
  checkCancelled(options.signal);
  options.workspaceLoad?.checkCurrent();
}

/** Native loaders consume the same ticket; legacy adopters call validate immediately before their state transaction. */
export function gitWorkspaceAdoptionOptions(options, values = {}) {
  checkGitWorkspaceLoad(options);
  return { ...values, signal: options.signal, load: options.workspaceLoad?.native,
    validate: () => checkGitWorkspaceLoad(options) };
}

export function cancelGitWorkspaceLoad(host) {
  const ticket = pendingLoads.get(host);
  ticket?.cancel();
  ticket?.finish();
}
