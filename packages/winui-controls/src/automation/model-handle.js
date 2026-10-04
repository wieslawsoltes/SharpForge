import { AutomationPeer } from './automation-peer.js';
import { TextRangeProvider } from './text-provider.js';

/** Owner-scoped managed heap edges and debugger restoration without serializing browser services. */
export class AutomationModelHandle {
  constructor(service, model, kind, owner = null) {
    this.service = service;
    this.model = model;
    this.kind = kind;
    this.owner = owner;
  }
  snapshot() {
    const model = this.model;
    return { version: 1, kind: this.kind, owner: this.owner,
      peerId: model instanceof AutomationPeer ? model.id : null, boundOwnerId: model.boundOwnerId,
      eventsSource: model instanceof AutomationPeer ? model.EventsSource : null,
      disposed: model instanceof AutomationPeer ? model.disposed : false,
      range: model instanceof TextRangeProvider ? { start: model.start, end: model.end } : null };
  }
  restore(value) {
    if (value?.version !== 1 || value.kind !== this.kind) throw new TypeError('SFAX016: Invalid automation handle snapshot');
    this.owner = value.owner;
    if (this.model instanceof AutomationPeer) {
      this.model.id = value.peerId; this.model.boundOwnerId = value.boundOwnerId;
      this.model.disposed = !!value.disposed;
      this.model.tree = value.disposed ? null : this.service.tree;
      this.model.EventsSource = value.eventsSource;
    }
    if (value.range) { this.model.start = value.range.start; this.model.end = value.range.end; }
  }
  *retainedValues() {
    if (this.owner != null) yield this.owner;
    const peer = this.model instanceof AutomationPeer ? this.model : this.model.peer ?? this.model.provider?.peer;
    if (peer?.EventsSource) {
      const reference = this.service.referenceFor(peer.EventsSource);
      if (reference) yield reference;
    }
  }
  dispose() { this.service.releaseHandle(this); }
}

export class AutomationPropertyIdentity {
  constructor(name) { this.name = name; Object.freeze(this); }
}

/** CreatePeerForElement retains one managed peer as long as its owner remains alive. */
export class AutomationOwnerPeerLease {
  constructor(reference) { this.reference = reference; }
  snapshot() { return { reference: this.reference }; }
  restore(value) { this.reference = value.reference; }
  retainedValues() { return this.reference ? [this.reference] : []; }
  dispose() { this.reference = null; }
}
