import {ManagedFault} from '../heap.js';
import {invokeSynchronousHostCallback} from './host-callbacks.js';

function stopped(pool) {
  const platform = pool.vm?.platform;
  return platform?.bclHost.isExecutionStopped(platform) === true;
}

/** A swallowed same-key reentry still aborts the unfinished publication; explicit stop cancels it. */
export function continueStringInitialization(operation) {
  if (stopped(operation.pool)) return false;
  if (operation.failure) throw operation.failure;
  return true;
}

/** Only cold allocating paths take a boundary. Pending entries are private to this VM (or standalone pool). */
export function initializeString(pool, group, key, operation, callback) {
  if (stopped(pool)) return null;
  const owner = pool.vm?.platform ?? pool;
  const state = owner.stringInitializations ??= {depth: 0, fields: new Map(), literals: new Map()};
  const pending = state[group];
  const active = pending.get(key);
  if (active) {
    active.failure ??= new ManagedFault('InvalidOperationException', 'Reentrant managed string initialization is not supported');
    throw active.failure;
  }
  if (state.depth >= 128) {
    throw new ManagedFault('ExecutionLimitException', 'Nested managed string initialization limit exceeded');
  }
  pending.set(key, operation);
  state.depth++;
  try {
    return pool.vm ? invokeSynchronousHostCallback(owner, callback, operation) : callback.call(operation);
  } catch (error) {
    if (stopped(pool)) return null;
    throw error;
  } finally {
    state.depth--;
    pending.delete(key);
  }
}

/** Both callers have already completed the same generation-checked pool lookup. */
export function initializeLiteral(pool, text) {
  return initializeString(pool, 'literals', text, {pool, text, failure: null}, allocateLiteral);
}

/** An allocation observer can finish another canonical string before the enclosing allocation returns. */
export function allocateLiteral() {
  const reference = this.pool.heap.string(this.text);
  if (!continueStringInitialization(this)) return null;
  const canonical = this.pool.find(this.text);
  if (canonical) return canonical;
  this.pool.entries.set(this.text, reference);
  return reference;
}
