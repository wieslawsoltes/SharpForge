import {UIEventTransactions} from './ui-event-transactions.js';
import {copyUIEventPayload, uiEventFailure, validateUIEventRequest} from './ui-event-protocol.js';

/** A worker session accepts each event request once and propagates cancellation into managed deferrals. */
export class RuntimeUIEventRequests {
  constructor(bridge, options) {
    this.bridge = bridge;
    this.transactions = new UIEventTransactions(options);
    this.lastRequest = 0;
  }

  assertActive(sessionId) {
    const {bridge} = this;
    if (bridge.closed || !bridge.vm || bridge.sessionId !== sessionId || this.transactions.closed) {
      throw uiEventFailure('AbortError', 'UI event session changed or ended');
    }
    if (bridge.vm.state === 'paused') {
      throw uiEventFailure('InvalidStateError', 'Continue execution before interacting with the managed application');
    }
    if (bridge.vm.state === 'faulted') throw uiEventFailure('InvalidStateError', 'The managed application has faulted');
  }

  async request(input) {
    const params = validateUIEventRequest(input);
    this.assertActive(params.sessionId);
    if (params.requestId <= this.lastRequest) throw new TypeError('UI event request identity was already used');
    this.lastRequest = params.requestId;
    const entry = this.transactions.begin(params.requestId);
    try {
      const context = this.bridge.vm.platform.ui;
      const receiver = context.reference(params.id);
      const result = context.requestEvent(receiver, params.event, params.payload,
        {signal: entry.controller.signal, timeout: this.transactions.timeout});
      Promise.resolve(result).then(value => {
        try {
          this.assertActive(params.sessionId);
          this.transactions.resolve(entry, copyUIEventPayload(value));
        } catch (error) { this.transactions.reject(entry, error); }
      }, error => this.transactions.reject(entry, error));
    } catch (error) { this.transactions.reject(entry, error); }
    return entry.promise;
  }

  cancel(params) {
    validateUIEventRequest(params, {cancellation: true});
    if (params.sessionId !== this.bridge.sessionId || this.bridge.closed) return false;
    return this.transactions.cancelRequest(params.requestId);
  }

  observe() {
    if (this.bridge.closed || ['paused', 'faulted'].includes(this.bridge.vm?.state)) {
      this.transactions.cancelAll('The managed UI session paused or ended');
    }
  }
  dispose() { this.transactions.dispose(); }
}

export function registerRuntimeEventRequests(handlers, {current, interactive, flush, schedule}) {
  handlers.registerHandler('uiEventRequest', params => {
    interactive();
    const {bridge} = current();
    const pending = bridge.eventRequests.request(params);
    flush();
    schedule();
    return pending.finally(() => {
      if (current()?.bridge !== bridge || bridge.closed) return;
      flush();
      schedule();
    });
  });
  handlers.registerHandler('uiEventCancel', params => current().bridge.eventRequests.cancel(params));
}
