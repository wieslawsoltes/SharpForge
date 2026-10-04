import { ControlEvents, ControlError, requireInteger } from '../policy/events.js';

/** Navigation commits after cancellable callbacks; history and cached pages stay session-local. */
export class NavigationFrame extends ControlEvents {
  constructor({ factory, cacheSize = 10, maximumHistory = 1000, hooks = {}, cacheMode = page => page.NavigationCacheMode } = {}) {
    super();
    this.factory = factory;
    this.cacheSize = cacheSize;
    this.maximumHistory = maximumHistory;
    this.hooks = hooks;
    this.cacheMode = cacheMode;
    this.backStack = [];
    this.forwardStack = [];
    this.current = null;
    this.cache = new Map();
    this.navigating = false;
    this.stackEnabled = true;
    this.setCacheSize(cacheSize);
    requireInteger(maximumHistory, 'Frame history limit', { maximum: 100_000 });
  }

  get canGoBack() { return this.backStack.length > 0; }
  get canGoForward() { return this.forwardStack.length > 0; }
  get content() { return this.current?.page ?? null; }
  get backStackDepth() { return this.backStack.length; }

  navigate(type, parameter = null, transition = null) { return this.#navigate({ type, parameter, transition }, 'New'); }
  goBack() { return this.canGoBack ? this.#navigate(this.backStack.at(-1), 'Back') : false; }
  goForward() { return this.canGoForward ? this.#navigate(this.forwardStack.at(-1), 'Forward') : false; }

  #navigate(entry, mode) {
    if (this.navigating) throw new ControlError('SFUI1670', 'Nested frame navigation is not permitted');
    this.navigating = true;
    const args = { SourcePageType: entry.type, Parameter: entry.parameter, NavigationMode: mode,
      NavigationTransitionInfo: entry.transition, Cancel: false };
    const before = { current: this.current, back: [...this.backStack], forward: [...this.forwardStack], cache: new Map(this.cache) };
    try {
      this.emit('Navigating', args);
      this.hooks.navigating?.(this.current?.page, args);
      this.current?.page?.OnNavigatingFrom?.(args);
      if (args.Cancel) { this.hooks.cancelled?.(args); this.emit('NavigationStopped', args); return false; }
      const cached = this.cache.get(entry.type);
      const page = entry.page ?? cached ?? this.factory?.(entry.type, entry.parameter);
      if (!page || typeof page.then === 'function') throw new ControlError('SFUI1671', 'Navigation requires a synchronous page factory');
      const next = { ...entry, page };
      this.hooks.navigatedFrom?.(this.current?.page, args);
      this.current?.page?.OnNavigatedFrom?.(args);
      if (mode === 'Back') {
        this.backStack.pop();
        if (this.current && this.stackEnabled) this.forwardStack.push(this.#historyEntry());
      } else if (mode === 'Forward') {
        this.forwardStack.pop();
        if (this.current && this.stackEnabled) this.backStack.push(this.#historyEntry());
      } else {
        if (this.current && this.stackEnabled) this.backStack.push(this.#historyEntry());
        this.forwardStack.length = 0;
      }
      if (this.backStack.length > this.maximumHistory) this.backStack.shift();
      this.current = next;
      if (this.hooks.setFrame) this.hooks.setFrame(page);
      else page.Frame = this;
      if (this.cacheMode(page) === 1 || this.cacheMode(page) === 2) this.#cache(entry.type, page);
      page.OnNavigatedTo?.(args);
      this.hooks.navigated?.(page, args);
      this.emit('Navigated', { ...args, Content: page });
      return true;
    } catch (error) {
      this.current = before.current; this.backStack = before.back; this.forwardStack = before.forward; this.cache = before.cache;
      this.hooks.failed?.(error, args);
      const failed = this.emit('NavigationFailed', { ...args, Exception: error, Handled: false });
      if (!failed.Handled) throw error;
      return false;
    } finally { this.navigating = false; }
  }

  #cache(type, page) {
    this.cache.delete(type);
    this.cache.set(type, page);
    const removable = [...this.cache.keys()].filter(key => this.cacheMode(this.cache.get(key)) !== 1);
    while (this.cache.size > this.cacheSize && removable.length) this.cache.delete(removable.shift());
  }

  #historyEntry() {
    const { type, parameter, transition } = this.current;
    return { type, parameter, transition };
  }

  setCacheSize(value) {
    this.cacheSize = requireInteger(value, 'Frame cache size', { maximum: 10_000 });
    if (!this.cache) return;
    const removable = [...this.cache.keys()].filter(key => this.cacheMode(this.cache.get(key)) !== 1);
    while (this.cache.size > this.cacheSize && removable.length) this.cache.delete(removable.shift());
  }
  snapshot() {
    if (this.navigating) throw new ControlError('SFUI1672', 'Cannot snapshot navigation during a callback');
    return { version: 1, current: this.current ? { ...this.current } : null,
      backStack: this.backStack.map(entry => ({ ...entry })), forwardStack: this.forwardStack.map(entry => ({ ...entry })),
      cache: [...this.cache], cacheSize: this.cacheSize, stackEnabled: this.stackEnabled };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI1672', 'Invalid navigation snapshot');
    this.current = snapshot.current ? { ...snapshot.current } : null;
    this.backStack = snapshot.backStack.map(entry => ({ ...entry }));
    this.forwardStack = snapshot.forwardStack.map(entry => ({ ...entry }));
    this.cache = new Map(snapshot.cache);
    this.cacheSize = snapshot.cacheSize;
    this.stackEnabled = snapshot.stackEnabled ?? true;
    this.navigating = false;
  }
  *retainedValues() {
    for (const entry of [...this.backStack, ...this.forwardStack, ...(this.current ? [this.current] : [])]) {
      yield entry.type;
      yield entry.parameter;
      yield entry.page;
    }
    yield* this.cache.values();
  }
  dispose() { this.backStack.length = this.forwardStack.length = 0; this.cache.clear(); this.current = null; super.dispose(); }
}
