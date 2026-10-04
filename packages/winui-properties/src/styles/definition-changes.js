import {ResourceFault} from '../resources/errors.js';

/** Legacy definition consumers are weak and owned by each application layer's explicit lifetime. */
export class StyleDefinitionChanges {
  constructor() { this.listeners = new Set(); this.changing = false; }

  subscribe(listener) {
    const reference = new WeakRef(listener);
    const changes = this;
    let active = true;
    for (const entry of this.listeners) if (!entry.deref()) this.listeners.delete(entry);
    if (this.listeners.size >= 100000) throw new ResourceFault('SFSTYLE017', 'Style subscription limit exceeded.');
    this.listeners.add(reference);
    return {
      dispose() { active = false; changes.listeners.delete(reference); },
      snapshot() { return {active}; },
      restore(snapshot) {
        active = snapshot.active;
        if (active) changes.listeners.add(reference);
        else changes.listeners.delete(reference);
      },
      // The lease keeps its listener alive; the shared definition keeps only the WeakRef.
      listener
    };
  }

  mutate(write, undo) {
    if (this.changing) throw new ResourceFault('SFSTYLE018', 'Reentrant style definition mutation is not supported.');
    this.changing = true;
    const updates = [];
    try {
      write();
      const listeners = new Set();
      for (const reference of this.listeners) {
        const listener = reference.deref();
        if (listener) listeners.add(listener);
        else this.listeners.delete(reference);
      }
      if (listeners.size > 1024) throw new ResourceFault('SFSTYLE017', 'A legacy style mutation exceeds 1024 consumer layers.');
      for (const listener of listeners) updates.push(listener.prepare());
      const commit = index => index === updates.length
        ? updates.forEach(update => update.commit()) : updates[index].transaction(() => commit(index + 1));
      commit(0);
      for (const update of updates) update.finalize();
    } catch (error) {
      undo();
      const failures = [];
      for (let index = updates.length - 1; index >= 0; index--) {
        try { updates[index].rollback(); } catch (failure) { failures.push(failure); }
      }
      if (failures.length) throw new AggregateError([error, ...failures], 'Style mutation rollback failed.');
      throw error;
    } finally { this.changing = false; }
  }
}
