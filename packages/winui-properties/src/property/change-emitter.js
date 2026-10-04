/** Index effective brush/value consumers so one mutation emits only affected property commands. */
export class EffectiveValueEmitter {
  constructor({emit, valuesOf = value => value?.$values, isMutableValue, maxDependencies = 100000, maxDepth = 32}) {
    this.emit = emit;
    this.valuesOf = valuesOf;
    this.isMutableValue = isMutableValue;
    this.maxDependencies = maxDependencies;
    this.maxDepth = maxDepth;
    if (![maxDependencies, maxDepth].every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError('Invalid value dependency budget');
    this.consumers = new WeakMap();
    this.owners = new WeakMap();
  }

  track(owner, property, value) {
    let records = this.owners.get(owner);
    if (!records) { records = new Map(); this.owners.set(owner, records); }
    const previous = records.get(property.id);
    const entry = {owner: new WeakRef(owner), property, dependencies: []};
    const seen = new Set();
    const pending = [[value, 0]];
    while (pending.length) {
      const [candidate, depth] = pending.pop();
      if (!candidate || typeof candidate !== 'object' || seen.has(candidate) || !this.isMutableValue(candidate)) continue;
      if (depth > this.maxDepth || seen.size >= this.maxDependencies) throw new RangeError('Value dependency budget exceeded');
      seen.add(candidate);
      const consumers = this.consumers.get(candidate) ?? new Set();
      if (consumers.size - Number(consumers.has(previous)) >= this.maxDependencies) {
        for (const consumer of [...consumers]) if (!consumer.owner.deref()) this.detach(consumer);
        if (consumers.size - Number(consumers.has(previous)) >= this.maxDependencies) throw new RangeError('Value consumer budget exceeded');
      }
      entry.dependencies.push(candidate);
      for (const nested of Object.values(this.valuesOf(candidate) ?? {})) pending.push([nested, depth + 1]);
    }
    if (previous) this.detach(previous);
    for (const dependency of entry.dependencies) {
      const consumers = this.consumers.get(dependency) ?? new Set();
      consumers.add(entry);
      this.consumers.set(dependency, consumers);
    }
    if (entry.dependencies.length) records.set(property.id, entry);
    else records.delete(property.id);
  }

  detach(entry) {
    for (const dependency of entry.dependencies) this.consumers.get(dependency)?.delete(entry);
    entry.dependencies.length = 0;
  }

  /** Value nodes have no independent drawing; refresh each live consumer once. */
  mutated(value) {
    const entries = this.consumers.get(value);
    if (!entries) return;
    for (const entry of [...entries]) {
      const owner = entry.owner.deref();
      if (!owner) { this.detach(entry); continue; }
      this.emit(owner, entry.property);
    }
  }

  remove(owner) {
    for (const entry of this.owners.get(owner)?.values() ?? []) this.detach(entry);
    this.owners.delete(owner);
  }
}
