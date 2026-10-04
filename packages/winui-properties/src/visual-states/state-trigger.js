/** Custom managed triggers call setActive; each attachment has an explicit removal token. */
export class StateTriggerBase {
  constructor({owner = null} = {}) {
    this.owner = owner;
    this.isActive = false;
    this.listeners = new Set();
    this.disposed = false;
  }

  setActive(value) {
    if (this.disposed) throw new Error('State trigger is disposed.');
    const active = Boolean(value);
    if (this.isActive === active) return;
    this.isActive = active;
    for (const listener of [...this.listeners]) listener(this);
  }

  subscribe(listener) {
    if (this.disposed) throw new Error('State trigger is disposed.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return {owner: this.owner, isActive: this.isActive, disposed: this.disposed, listeners: [...this.listeners],
      minWindowWidth: this.minWindowWidth, minWindowHeight: this.minWindowHeight,
      windowWidth: this.windowWidth, windowHeight: this.windowHeight};
  }

  restore(snapshot) {
    this.owner = snapshot.owner;
    this.isActive = snapshot.isActive;
    this.disposed = snapshot.disposed;
    this.listeners = new Set(snapshot.listeners);
    if ('minWindowWidth' in this) this.minWindowWidth = snapshot.minWindowWidth;
    if ('minWindowHeight' in this) this.minWindowHeight = snapshot.minWindowHeight;
    if ('windowWidth' in this) this.windowWidth = snapshot.windowWidth;
    if ('windowHeight' in this) this.windowHeight = snapshot.windowHeight;
  }

  *retainedValues() {
    yield this.owner;
    for (const listener of this.listeners) if (listener.retainedValues) yield* listener.retainedValues();
  }

  dispose() { this.disposed = true; this.isActive = false; this.listeners.clear(); this.owner = null; }
}

export class StateTrigger extends StateTriggerBase {
  constructor(active = false) { super(); this.setActive(active); }
}

export class AdaptiveTrigger extends StateTriggerBase {
  constructor({minWindowWidth = 0, minWindowHeight = 0} = {}) {
    super();
    if (![minWindowWidth, minWindowHeight].every(value => Number.isFinite(value) && value >= 0)) {
      throw new RangeError('Adaptive trigger dimensions must be finite and non-negative.');
    }
    this.minWindowWidth = minWindowWidth;
    this.minWindowHeight = minWindowHeight;
    this.windowWidth = 0;
    this.windowHeight = 0;
  }

  update(width, height) {
    if (![width, height].every(value => Number.isFinite(value) && value >= 0)) throw new RangeError('Invalid adaptive trigger viewport.');
    this.windowWidth = width;
    this.windowHeight = height;
    this.setActive(width >= this.minWindowWidth && height >= this.minWindowHeight);
  }
}

/** Custom active triggers outrank adaptive triggers, then greatest width/height thresholds, then declaration order. */
export function activeState(states) {
  let best = null;
  let rank = [-1, -1, -1];
  for (const state of states) {
    for (const trigger of state.triggers) {
      if (!trigger.isActive || trigger.disposed) continue;
      const next = trigger instanceof AdaptiveTrigger
        ? [0, trigger.minWindowWidth, trigger.minWindowHeight] : [1, 0, 0];
      const better = next[0] > rank[0] || next[0] === rank[0] &&
        (next[1] > rank[1] || next[1] === rank[1] && next[2] > rank[2]);
      if (better) { best = state; rank = next; }
    }
  }
  return best;
}
