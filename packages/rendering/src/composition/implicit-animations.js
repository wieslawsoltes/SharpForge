function compatible(compositor, animation) {
  if (animation?.Compositor !== compositor || animation.closed) throw new TypeError('A live animation from this Compositor is required');
}

export class ImplicitAnimationCollection {
  constructor(compositor) { this.Compositor = compositor; this.kind = 'ImplicitAnimationCollection'; this.items = new Map(); }
  get Count() { return this.items.size; }
  get(name) { return this.items.get(name); }
  set(name, animation) {
    if (typeof name !== 'string' || !name || name.length > 128) throw new TypeError('Invalid implicit animation property');
    compatible(this.Compositor, animation);
    if (this.items.size >= 256 && !this.items.has(name)) throw new RangeError('Implicit animation limit exceeded');
    this.items.set(name, animation);
  }
  Insert(name, animation) { this.set(name, animation); return false; }
  Lookup(name) {
    if (!this.items.has(name)) throw new TypeError('Unknown implicit animation property');
    return this.items.get(name);
  }
  HasKey(name) { return this.items.has(name); }
  Remove(name) { return this.items.delete(name); }
  Clear() { this.items.clear(); }
  retainedValues() { return this.items.values(); }
  snapshot() { return [...this.items]; }
  restore(snapshot) { this.items = new Map(snapshot); }
}

export class CompositionAnimationGroup {
  constructor(compositor) { this.Compositor = compositor; this.kind = 'CompositionAnimationGroup'; this.animations = []; this.closed = false; }
  get Count() { return this.animations.length; }
  Add(animation) {
    compatible(this.Compositor, animation);
    if (this.animations.length >= 128) throw new RangeError('Animation group limit exceeded');
    this.animations.push(animation);
  }
  Remove(animation) { const index = this.animations.indexOf(animation); if (index >= 0) this.animations.splice(index, 1); }
  RemoveAll() { this.animations.length = 0; }
  [Symbol.iterator]() { return this.animations[Symbol.iterator](); }
  retainedValues() { return this.animations.values(); }
  snapshot() { return [...this.animations]; }
  restore(snapshot) { this.closed = false; this.animations = [...snapshot]; }
  dispose() { this.closed = true; this.RemoveAll(); }
}

/** Completion is delivered once after End and all participating animations stop or complete. */
export class CompositionScopedBatch {
  constructor(compositor) {
    this.Compositor = compositor;
    this.kind = 'CompositionScopedBatch';
    this.pending = new Set();
    this.listeners = new Set();
    this.ended = false;
    this.completed = false;
    this.closed = false;
    compositor.animations.batches.add(this);
  }
  track(record) { if (!this.ended && !this.closed) this.pending.add(record); }
  settled(record) { this.pending.delete(record); this.complete(); }
  End() { this.ended = true; this.Compositor.animations.batches.delete(this); this.complete(); }
  complete() {
    if (this.closed || this.completed || !this.ended || this.pending.size) return;
    this.completed = true;
    for (const listener of this.listeners) listener(this, {});
  }
  add_Completed(listener) { this.listeners.add(listener); }
  remove_Completed(listener) { this.listeners.delete(listener); }
  retainedValues() { return [this.Compositor, ...this.pending].flatMap(value => value.target ? [value.target, value.animation] : [value]); }
  snapshot() { return {pending: [...this.pending], listeners: [...this.listeners], ended: this.ended, completed: this.completed}; }
  restore(snapshot) {
    this.closed = false;
    this.pending = new Set(snapshot.pending);
    this.listeners = new Set(snapshot.listeners);
    this.ended = snapshot.ended;
    this.completed = snapshot.completed;
  }
  dispose() { this.closed = true; this.pending.clear(); this.listeners.clear(); this.Compositor.animations.batches.delete(this); }
}
