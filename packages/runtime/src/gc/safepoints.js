import {ManagedFault} from './fault.js';

export const SafepointKind = Object.freeze({
  Allocation: 'allocation', Call: 'call', BackEdge: 'back-edge', SliceBoundary: 'slice-boundary',
  HostTransition: 'host-transition', Debugger: 'debugger', Explicit: 'explicit', Instruction: 'instruction'
});

const validKinds = new Set(Object.values(SafepointKind));

function validateKind(kind) {
  if (!validKinds.has(kind)) throw new TypeError(`Unregistered safepoint kind '${kind}'`);
}

function callback(value, name) {
  if (value !== null && typeof value !== 'function') throw new TypeError(`${name} must be a function or null`);
  return value;
}

/** Cooperative stop-the-world handshake. A running context is never presumed suspended. */
export class SafepointCoordinator {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.contexts = new Map();
    this.epoch = 0;
    this.suspension = null;
    this.maxContexts = options.maxSafepointContexts ?? 65536;
    if (!Number.isSafeInteger(this.maxContexts) || this.maxContexts < 1) throw new RangeError('Invalid safepoint context limit');
  }

  register(id, {kind = SafepointKind.SliceBoundary, parked = true, deopt = null, publishRoots = null} = {}) {
    validateKind(kind);
    if (id === null || id === undefined || this.contexts.has(id)) throw new TypeError('Safepoint context identity must be unique');
    if (this.contexts.size >= this.maxContexts) throw new ManagedFault('ExecutionLimitException', 'Safepoint context limit exceeded');
    if (this.suspension) throw new ManagedFault('InvalidOperationException', 'Cannot register a mutator during suspension');
    const registration = Object.freeze({});
    const context = {
      id, registration, kind, parked: !!parked, atSafepoint: !!parked, arrivedEpoch: 0,
      deopt: callback(deopt, 'Tier deoptimization hook'), publishRoots: callback(publishRoots, 'Root publication hook')
    };
    this.contexts.set(id, context);
    return Object.freeze({
      id,
      dispose: () => this._unregister(id, registration)
    });
  }

  _unregister(id, registration) {
    if (this.contexts.get(id)?.registration !== registration) return false;
    if (this.suspension) throw new ManagedFault('InvalidOperationException', 'Cannot unregister a mutator during suspension');
    return this.contexts.delete(id);
  }

  _context(id) {
    const context = this.contexts.get(id);
    if (!context) throw new TypeError(`Unknown safepoint context '${String(id)}'`);
    return context;
  }

  _arrive(context) {
    const ticket = this.suspension;
    if (!ticket || !context.atSafepoint || context.arrivedEpoch === ticket.epoch) return;
    context.deopt?.(context.kind, ticket);
    context.publishRoots?.(context.kind, ticket);
    context.arrivedEpoch = ticket.epoch;
  }

  _refreshTicket() {
    const ticket = this.suspension;
    ticket.pending = [];
    for (const context of this.contexts.values()) {
      if (!context.atSafepoint || context.arrivedEpoch !== ticket.epoch) ticket.pending.push(context.id);
    }
    ticket.state = ticket.pending.length ? 'requested' : 'stopped';
    return ticket;
  }

  /** Allocation/call/back-edge/slice hooks publish roots before collection may begin. */
  poll(id, kind, options = null) {
    validateKind(kind);
    const context = this._context(id);
    context.kind = kind;
    context.parked = options?.parked ?? true;
    context.atSafepoint = true;
    if (this.suspension) {
      this._arrive(context);
      this._refreshTicket();
    }
    return context;
  }

  leave(id) {
    if (this.suspension) throw new ManagedFault('InvalidOperationException', 'The mutator cannot leave a safepoint before GC resumes it');
    const context = this._context(id);
    context.parked = false;
    context.atSafepoint = false;
  }

  withContext(id, kind, action) {
    const context = this._context(id);
    const previous = {kind: context.kind, parked: context.parked, atSafepoint: context.atSafepoint};
    this.poll(id, kind);
    try {
      return action();
    } finally {
      if (this.suspension) throw new ManagedFault('InvalidOperationException', 'Safepoint scope ended while GC is suspended');
      Object.assign(context, previous);
    }
  }

  request({reason = 'Induced', generation = 2} = {}) {
    if (this.suspension) return this.suspension;
    if (!Number.isSafeInteger(this.epoch + 1)) throw new ManagedFault('ExecutionLimitException', 'Safepoint epoch exhausted');
    const ticket = {epoch: ++this.epoch, reason, generation, state: 'requested', pending: []};
    this.suspension = ticket;
    try {
      for (const context of this.contexts.values()) this._arrive(context);
      return this._refreshTicket();
    } catch (error) {
      this.suspension = null;
      ticket.state = 'failed';
      throw error;
    }
  }

  assertStopped(ticket = this.suspension) {
    if (!ticket || ticket !== this.suspension) throw new TypeError('GC requires its current suspension ticket');
    this._refreshTicket();
    if (ticket.state !== 'stopped') {
      throw new ManagedFault('InvalidOperationException', `GC suspension awaits contexts: ${ticket.pending.map(String).join(', ')}`);
    }
    return ticket;
  }

  resume(ticket = this.suspension) {
    if (!ticket || ticket !== this.suspension) throw new TypeError('Invalid GC resume ticket');
    this.suspension = null;
    ticket.state = 'resumed';
  }

  withSuspension(action, options = {}) {
    const previous = this.suspension;
    const ticket = this.request(options);
    try {
      this.assertStopped(ticket);
      return action();
    } finally {
      if (!previous && this.suspension === ticket) this.resume(ticket);
    }
  }

  snapshot() {
    if (this.suspension) throw new ManagedFault('InvalidOperationException', 'Cannot snapshot an active suspension');
    return {epoch: this.epoch, contexts: [...this.contexts.values()].map(context => ({...context}))};
  }

  restore(state) {
    if (this.suspension) throw new ManagedFault('InvalidOperationException', 'Cannot restore an active suspension');
    this.epoch = Math.max(this.epoch, state.epoch);
    this.contexts = new Map(state.contexts.map(context => [context.id, {...context}]));
  }
}
