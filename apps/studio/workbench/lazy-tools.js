import {cancellable} from './events.js';

/** Explicit module loaders are bundled offline; cancelled activation never mounts a late result. */
export class LazyTools {
  constructor(loaders = {}) {
    this.loaders = new Map(Object.entries(loaders));
    this.modules = new Map();
    this.disposed = false;
  }
  register(id, loader) {
    if (this.loaders.has(id) || typeof loader !== 'function') throw new TypeError('Invalid or duplicate lazy tool');
    this.loaders.set(id, loader);
  }
  async load(id, {signal} = {}) {
    if (this.disposed) throw new Error('Lazy tools disposed');
    signal?.throwIfAborted();
    if (!this.loaders.has(id)) throw new Error('Unknown lazy tool ' + id);
    if (!this.modules.has(id)) {
      const loading = Promise.resolve().then(this.loaders.get(id));
      this.modules.set(id, loading);
      loading.catch(() => { if (this.modules.get(id) === loading) this.modules.delete(id); });
    }
    const module = await cancellable(this.modules.get(id), signal);
    if (this.disposed) throw new Error('Lazy tools disposed');
    return module;
  }
  dispose() { this.disposed = true; this.modules.clear(); this.loaders.clear(); }
}

export const studioToolLoaders = Object.freeze({
  designer: () => import('../designer-tools.js'),
  assembly: () => import('../assembly-workbench.js'),
  disassembly: () => import('../disassembly-tool.js'),
  msbuild: () => import('../msbuild-tools.js'),
  wizard: () => import('../project-wizard.js')
});
