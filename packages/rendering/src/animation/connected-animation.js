function bounds(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(name => Number.isFinite(value[name])) || value.width < 0 || value.height < 0) {
    throw new RangeError('Invalid connected animation bounds');
  }
  return {...value};
}

export class ConnectedAnimation {
  constructor(service, key, source) {
    this.kind = 'Microsoft.UI.Xaml.Media.Animation.ConnectedAnimation';
    this.service = service;
    this.key = key;
    this.sourceBounds = bounds(service.getBounds(source));
    this.source = source;
    this.snapshotResource = service.capture(source);
    if (this.snapshotResource?.then) throw new TypeError('Snapshot capture must provide a retained surface synchronously');
    this.preparedAt = service.now();
    this.listeners = new Set();
    this.overlay = null;
    this.batch = null;
    this.definitions = [];
    this.closed = false;
    this.started = false;
  }

  TryStart(destination) {
    if (this.closed || this.started) return false;
    if (this.service.now() - this.preparedAt > this.service.timeout || this.service.reducedMotion()) {
      this.Cancel();
      return false;
    }
    const target = bounds(this.service.getBounds(destination));
    if (!this.sourceBounds.width || !this.sourceBounds.height || !target.width || !target.height) {
      this.Cancel();
      return false;
    }
    const visual = this.service.createOverlay(this.snapshotResource, this.sourceBounds);
    this.overlay = visual;
    const compositor = this.service.compositor;
    const batch = compositor.CreateScopedBatch();
    this.batch = batch;
    const offset = compositor.CreateVector3KeyFrameAnimation();
    offset.Duration = this.service.duration;
    offset.InsertKeyFrame(0, [this.sourceBounds.x, this.sourceBounds.y, 0]);
    offset.InsertKeyFrame(1, [target.x, target.y, 0]);
    const scale = compositor.CreateVector3KeyFrameAnimation();
    scale.Duration = this.service.duration;
    scale.InsertKeyFrame(0, [1, 1, 1]);
    scale.InsertKeyFrame(1, [target.width / this.sourceBounds.width, target.height / this.sourceBounds.height, 1]);
    this.definitions = [offset, scale];
    visual.StartAnimation('Offset', offset);
    visual.StartAnimation('Scale', scale);
    this.started = true;
    batch.add_Completed(() => {
      if (this.closed) return;
      this.release();
      for (const listener of this.listeners) listener(this, {});
    });
    batch.End();
    return true;
  }
  add_Completed(listener) { this.listeners.add(listener); }
  remove_Completed(listener) { this.listeners.delete(listener); }
  retainedValues() { return [this.source, this.service]; }
  snapshot() {
    return {closed: this.closed, started: this.started, sourceBounds: {...this.sourceBounds}, snapshotResource: this.snapshotResource,
      overlay: this.overlay, batch: this.batch, definitions: [...this.definitions], listeners: [...this.listeners], preparedAt: this.preparedAt};
  }
  restore(snapshot) {
    if (snapshot.snapshotResource?.closed) throw new TypeError('SF_COMPOSITION_SNAPSHOT_UNAVAILABLE: the captured connected surface was released');
    Object.assign(this, snapshot);
    this.sourceBounds = {...snapshot.sourceBounds};
    this.listeners = new Set(snapshot.listeners);
  }
  release() {
    if (this.closed) return;
    this.closed = true;
    this.service.animations.delete(this.key);
    this.overlay?.dispose();
    for (const definition of this.definitions) definition.dispose();
    this.definitions = [];
    this.batch?.dispose();
    this.service.releaseSnapshot(this.snapshotResource);
    this.overlay = null;
    this.snapshotResource = null;
  }
  Cancel() {
    if (this.closed) return;
    this.batch?.dispose();
    this.release();
  }
  dispose() { this.Cancel(); this.listeners.clear(); }
}

/** Navigation cancellation releases prepared snapshots; services are scoped to one application. */
export class ConnectedAnimationService {
  constructor(compositor, {getBounds, capture, createOverlay, releaseSnapshot = snapshot => snapshot?.dispose?.(),
    now = () => performance.now(), reducedMotion = () => false, duration = 300, timeout = 2000} = {}) {
    this.compositor = compositor;
    this.kind = 'Microsoft.UI.Xaml.Media.Animation.ConnectedAnimationService';
    this.getBounds = getBounds;
    this.capture = capture;
    this.createOverlay = createOverlay;
    this.releaseSnapshot = releaseSnapshot;
    this.now = now;
    this.reducedMotion = reducedMotion;
    this.duration = duration;
    this.timeout = timeout;
    this.animations = new Map();
    this.closed = false;
  }
  PrepareToAnimate(key, source) {
    if (this.closed || typeof key !== 'string' || !key || key.length > 128) throw new TypeError('Invalid connected animation key or disposed service');
    if (![this.getBounds, this.capture, this.createOverlay].every(value => typeof value === 'function')) {
      throw new TypeError('Connected animation requires bounds, snapshot capture and overlay services');
    }
    this.animations.get(key)?.Cancel();
    if (this.animations.size >= 32) throw new RangeError('Connected animation preparation limit exceeded');
    const animation = new ConnectedAnimation(this, key, source);
    this.animations.set(key, animation);
    return animation;
  }
  GetAnimation(key) { return this.animations.get(key) ?? null; }
  retainedValues() { return [this.compositor, ...this.animations.values()]; }
  snapshot() { return [...this.animations].map(([key, animation]) => ({key, animation, state: animation.snapshot()})); }
  restore(snapshot) {
    for (const [key, animation] of this.animations) if (!snapshot.some(entry => entry.key === key)) animation.Cancel();
    this.closed = false;
    this.animations = new Map(snapshot.map(entry => {
      entry.animation.restore(entry.state);
      return [entry.key, entry.animation];
    }));
  }
  cancelNavigation() { for (const animation of [...this.animations.values()]) animation.Cancel(); }
  dispose() { if (this.closed) return; this.cancelNavigation(); this.closed = true; }
}

export class NavigationTransitionInfo {
  constructor(kind = 'EntranceNavigationTransitionInfo', {SlideNavigationTransitionEffect = 0} = {}) {
    if (!['EntranceNavigationTransitionInfo', 'DrillInNavigationTransitionInfo', 'SlideNavigationTransitionInfo',
      'SuppressNavigationTransitionInfo'].includes(kind)) throw new TypeError('Unsupported navigation transition');
    this.kind = 'Microsoft.UI.Xaml.Media.Animation.' + kind;
    this.Effect = SlideNavigationTransitionEffect;
  }
  snapshot() { return {effect: this.Effect}; }
  restore(snapshot) { this.Effect = snapshot.effect; }
}
