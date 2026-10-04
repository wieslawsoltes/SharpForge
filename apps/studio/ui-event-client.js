import {UIEventTransactions} from './workers/ui-event-transactions.js';
import {copyUIEventPayload, uiEventFailure, validUIEventSession, validateUIEventRequest} from './workers/ui-event-protocol.js';

/** Host defaults wait for a session-scoped managed decision; stale or superseded replies are discarded. */
export class StudioUIEventClient {
  constructor(bridge, options) {
    this.bridge = bridge;
    this.transactions = new UIEventTransactions(options);
  }

  assertActive(sessionId, id) {
    const {bridge} = this;
    if (bridge.closed || this.transactions.closed || !validUIEventSession(sessionId) || bridge.sessionId !== sessionId) {
      throw uiEventFailure('AbortError', 'UI event session changed or ended');
    }
    if (bridge.paused) throw uiEventFailure('InvalidStateError', 'Continue execution before interacting with the managed application');
    if (!bridge.host.nodes.has(id)) throw uiEventFailure('AbortError', 'UI event target was removed');
  }

  async request(id, event, payload = {}, {signal} = {}) {
    const {bridge} = this;
    const sessionId = bridge.sessionId;
    this.assertActive(sessionId, id);
    if (!Number.isSafeInteger(bridge.nextEventRequest)) throw new RangeError('UI event request identity limit');
    const params = validateUIEventRequest({version: 1, sessionId, requestId: bridge.nextEventRequest++, id, event, payload});
    const entry = this.transactions.begin(params.requestId, {signal});
    try {
      Promise.resolve(bridge.request('uiEventRequest', params)).then(result => {
        try {
          this.assertActive(sessionId, id);
          this.transactions.resolve(entry, copyUIEventPayload(result));
        } catch (error) { this.transactions.reject(entry, error); }
      }, error => this.transactions.reject(entry, error));
    } catch (error) { this.transactions.reject(entry, error); }
    try { return await entry.promise; }
    catch (error) {
      bridge.send('uiEventCancel', {version: 1, sessionId, requestId: params.requestId}, sessionId);
      throw error;
    }
  }

  cancelAll(message) { this.transactions.cancelAll(message); }
  dispose() { this.transactions.dispose(); }
}
