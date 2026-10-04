import { abortError } from './events.js';

/** Retain the workspace-opening ticket from the user gesture through the file-input change event. */
export class StudioWorkspaceInputs {
  constructor({ begin, onError }) {
    this.begin = begin;
    this.onError = onError;
    this.bindings = new Map();
    this.pending = new Map();
    this.cancelledSelections = new WeakSet();
    this.disposed = false;
  }

  bind(input, consume) {
    if (this.disposed || this.bindings.has(input)) throw new Error('Workspace input is unavailable or already bound');
    const change = () => {
      const files = [...input.files];
      input.value = '';
      if (this.cancelledSelections.has(input)) {
        this.cancelledSelections.delete(input);
        return;
      }
      let operation = this.pending.get(input);
      if (!operation && !files.length) return;
      if (!operation) {
        try { operation = this.operation(input); }
        catch (error) { this.onError?.(error); return; }
      }
      operation.awaitingSelection = false;
      if (!files.length) { operation.finish(null); return; }
      Promise.resolve().then(() => {
        operation.load.check();
        return consume(files, { load: operation.load, signal: operation.load.signal });
      }).then(operation.finish, operation.fail);
    };
    const cancel = () => {
      this.cancelledSelections.delete(input);
      this.pending.get(input)?.finish(null);
    };
    input.addEventListener('change', change);
    input.addEventListener('cancel', cancel);
    this.bindings.set(input, { change, cancel });
  }

  operation(input, { load, resolve, reject } = {}) {
    if (this.disposed) throw abortError('Workspace inputs are disposed');
    const ticket = load ?? this.begin();
    ticket.check();
    this.pending.get(input)?.fail(abortError('A newer selection replaced this file picker'));
    let settled = false;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      ticket.signal.removeEventListener('abort', abort);
      if (error && operation.awaitingSelection && this.pending.get(input) === operation) this.cancelledSelections.add(input);
      if (this.pending.get(input) === operation) this.pending.delete(input);
      if (!load) ticket.finish();
      if (error) {
        if (reject) reject(error);
        else if (error.name !== 'AbortError') this.onError?.(error);
      } else resolve?.(value);
    };
    const operation = { load: ticket, awaitingSelection: true, finish: value => settle(null, value), fail: error => settle(error) };
    const abort = () => operation.fail(ticket.signal.reason ?? abortError('Workspace selection was cancelled'));
    this.pending.set(input, operation);
    ticket.signal.addEventListener('abort', abort, { once: true });
    return operation;
  }

  open(input, options = {}) {
    if (!this.bindings.has(input)) return Promise.reject(new Error('Workspace input has no import provider'));
    return new Promise((resolve, reject) => {
      let operation;
      try {
        operation = this.operation(input, { ...options, resolve, reject });
        this.cancelledSelections.delete(input);
        input.click();
      } catch (error) {
        if (operation) operation.fail(error);
        else reject(error);
      }
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const operation of this.pending.values()) operation.fail(abortError('Workspace inputs are disposed'));
    for (const [input, { change, cancel }] of this.bindings) {
      input.removeEventListener('change', change);
      input.removeEventListener('cancel', cancel);
    }
    this.bindings.clear();
  }
}
