import {ManagedFault, isReference} from '../heap.js';

const identity = reference => reference ? `${reference.h}:${reference.g}` : '$application';

/** Private service state has owner-scoped heap edges and explicit snapshot/disposal contracts. */
export class ManagedUIModelState {
  constructor(platform, {resolveReference = () => null, maxRetained = 100000} = {}) {
    this.platform = platform;
    this.resolveReference = resolveReference;
    this.maxRetained = maxRetained;
    this.owners = new Map();
  }

  state(reference, key, factory) {
    if (reference) this.platform.heap.get(reference);
    const id = identity(reference);
    const owner = this.owners.get(id) ?? {reference, states: new Map()};
    if (!owner.states.has(key)) {
      if (typeof factory !== 'function') return undefined;
      owner.states.set(key, {value: factory(), factory});
      this.owners.set(id, owner);
      this.sync(reference);
    }
    return owner.states.get(key).value;
  }

  *retained(owner) {
    const visited = new Set();
    const queue = [...owner.states.values()].map(entry => ({value: entry.value, root: true}));
    while (queue.length) {
      const {value, root} = queue.pop();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      if (visited.size >= this.maxRetained) throw new ManagedFault('ExecutionLimitException', 'UI retained-model graph limit');
      visited.add(value);
      if (isReference(value)) { yield value; continue; }
      const reference = this.resolveReference(value);
      if (reference) yield reference;
      if ((!reference || root) && value.retainedValues) {
        const retainedValues = typeof value.retainedValues === 'function' ? value.retainedValues() : value.retainedValues;
        for (const retained of retainedValues) queue.push({value: retained, root: false});
      }
    }
  }

  sync(reference) {
    if (!reference) return;
    const owner = this.owners.get(identity(reference));
    if (!owner) return;
    const values = [...this.retained(owner)].filter(isReference);
    const platform = this.platform;
    const previous = platform.get(reference, '$uiModelRoots');
    if (previous) {
      const old = platform.heap.get(previous).data;
      if (old.length === values.length && old.every((value, index) => value.h === values[index].h && value.g === values[index].g)) return;
      platform.ui.journal?.captureReference(previous);
      platform.heap.replaceData(previous, values);
    }
    else if (values.length) {
      const roots = platform.heap.allocate('array', 'object[]', values);
      platform.heap.withRoots([reference, roots], () => platform.set(reference, '$uiModelRoots', roots));
    }
  }

  prune() {
    const heap = this.platform.heap;
    for (const [id, owner] of this.owners) {
      if (owner.reference && (heap.generations[owner.reference.h] !== owner.reference.g || !heap.records[owner.reference.h])) {
        this.disposeOwner(owner, {preserveValues: true, collected: true});
        this.owners.delete(id);
      }
    }
  }

  *roots() {
    this.prune();
    const application = this.owners.get('$application');
    if (application) yield* this.retained(application);
  }

  snapshot() {
    this.prune();
    return [...this.owners].map(([id, owner]) => ({
      id, reference: owner.reference,
      states: [...owner.states].map(([key, entry]) => {
        const value = entry.value;
        if (value?.snapshot && value?.restore) return {key, factory: entry.factory, value, data: value.snapshot(), kind: 'snapshot'};
        if (value?.reconstructible) return {key, factory: entry.factory, kind: 'reconstruct'};
        if (value === null || typeof value !== 'object' || isReference(value)) return {key, value, kind: 'value'};
        throw new ManagedFault('NotSupportedException', `UI model '${key}' does not support managed snapshot restoration`);
      })
    }));
  }

  restore(snapshot = []) {
    const retained = new Set(snapshot.map(owner => owner.id));
    for (const [id, owner] of this.owners) if (!retained.has(id)) {
      this.disposeOwner(owner, {preserveValues: true, restoring: true});
      this.owners.delete(id);
    }
    for (const data of snapshot) {
      const owner = this.owners.get(data.id) ?? {reference: data.reference, states: new Map()};
      const keys = new Set(data.states.map(entry => entry.key));
      for (const [key, entry] of owner.states) if (!keys.has(key)) {
        entry.value?.dispose?.({preserveValues: true, restoring: true});
        owner.states.delete(key);
      }
      for (const entry of data.states) {
        const value = entry.kind === 'value' ? entry.value
          : entry.kind === 'reconstruct' ? entry.factory() : entry.value ?? owner.states.get(entry.key)?.value ?? entry.factory();
        if (entry.kind === 'snapshot') value.restore(entry.data);
        owner.states.set(entry.key, {value, factory: entry.factory});
      }
      this.owners.set(data.id, owner);
    }
  }

  disposeOwner(owner, options) {
    for (const entry of owner.states.values()) entry.value?.dispose?.(options);
    owner.states.clear();
  }

  dispose(options) {
    for (const owner of this.owners.values()) this.disposeOwner(owner, options);
    this.owners.clear();
  }
}
