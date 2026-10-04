/** One explicitly registered module/controller. Loading is shared; disposal prevents late construction and mounting. */
export class LazyFeature {
  constructor({ id, title, modules, create, onError = () => {} }) {
    Object.assign(this, { id, title, modules, create, onError });
    this.controller = new AbortController();
    this.instance = null;
    this.pending = null;
    this.mounts = new Map();
    this.disposed = false;
  }

  peek() { return this.instance; }

  load() {
    if (this.disposed) return Promise.reject(new Error(`${this.title} has been disposed`));
    if (this.instance) return Promise.resolve(this.instance);
    if (!this.pending) {
      const pending = this.modules.load(this.id, { signal: this.controller.signal }).then(module => {
        if (this.disposed) throw new Error(`${this.title} has been disposed`);
        const instance = this.create(module);
        if (!instance || typeof instance !== 'object') throw new TypeError(`${this.title} factory did not return a controller`);
        this.instance = instance;
        return instance;
      });
      this.pending = pending;
      pending.catch(() => { if (this.pending === pending) this.pending = null; });
    }
    return this.pending;
  }

  async call(method, args = []) {
    const instance = await this.load();
    if (typeof instance[method] !== 'function') throw new Error(`${this.title} does not implement '${method}'`);
    return instance[method](...args);
  }

  /** Rendering may start a load, while unrelated status reads and invalidation never activate a feature. */
  mount(key, element, render) {
    if (this.disposed) return;
    const request = { element, render };
    this.mounts.set(key, request);
    const current = () => !this.disposed && this.mounts.get(key) === request && element.isConnected !== false;
    const perform = instance => {
      if (!current()) return;
      element.removeAttribute('aria-busy');
      return render(instance);
    };
    const failed = error => {
      if (!current()) return;
      element.removeAttribute('aria-busy');
      const document = element.ownerDocument;
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = `${this.title} could not load: ${error.message}`;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.onclick = () => this.mount(key, element, render);
      element.replaceChildren(message, retry);
      this.onError(error);
    };
    if (this.instance) {
      try { Promise.resolve(perform(this.instance)).catch(failed); } catch (error) { failed(error); }
      return;
    }
    element.setAttribute('aria-busy', 'true');
    const status = element.ownerDocument.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = `Loading ${this.title}…`;
    element.replaceChildren(status);
    this.load().then(perform).catch(failed);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    this.mounts.clear();
    this.instance?.dispose?.();
    this.instance = null;
  }
}
