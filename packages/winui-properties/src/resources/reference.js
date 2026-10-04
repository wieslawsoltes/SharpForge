import {ResourceFault} from './errors.js';

/** Resource references are immutable descriptions; each consumer owns its subscription. */
export class ResourceReference {
  constructor(key, {dynamic = false} = {}) {
    if (key === undefined || key === null) throw new ResourceFault('SFRES001', 'A resource key is required.');
    this.kind = dynamic ? 'ThemeResource' : 'StaticResource';
    this.key = key;
    this.dynamic = dynamic;
    Object.freeze(this);
  }
}

export const staticResource = key => new ResourceReference(key);
export const themeResource = key => new ResourceReference(key, {dynamic: true});

/** Deferred resources are initialized once; recursive activation is a deterministic error. */
export class DeferredResource {
  constructor(factory, {dispose = null, retainedValues = null} = {}) {
    if (typeof factory !== 'function') throw new TypeError('A deferred resource factory is required.');
    this.factory = factory;
    this.disposer = dispose;
    this.retained = retainedValues;
    this.state = 'deferred';
    this.value = undefined;
  }

  get(context) {
    if (this.state === 'disposed') throw new ResourceFault('SFRES002', 'The deferred resource is disposed.');
    if (this.state === 'loading') throw new ResourceFault('SFRES003', 'Recursive deferred resource activation.');
    if (this.state === 'ready') return this.value;
    this.state = 'loading';
    try {
      this.value = this.factory(context);
      if (this.value?.then) throw new ResourceFault('SFRES004', 'Resource factories must complete synchronously.');
      this.state = 'ready';
      return this.value;
    } catch (error) {
      this.state = 'deferred';
      this.value = undefined;
      throw error;
    }
  }

  dispose() {
    if (this.state === 'disposed') return;
    if (this.state === 'ready') this.disposer?.(this.value);
    this.state = 'disposed';
    this.value = undefined;
    this.factory = null;
    this.disposer = null;
    this.retained = null;
  }

  *retainedValues() {
    if (this.state === 'ready') yield this.value;
    if (this.retained) yield* this.retained();
  }

  snapshot() {
    return {state: this.state, value: this.value, factory: this.factory, disposer: this.disposer, retained: this.retained};
  }

  restore(snapshot) {
    this.state = snapshot.state;
    this.value = snapshot.value;
    this.factory = snapshot.factory;
    this.disposer = snapshot.disposer;
    this.retained = snapshot.retained;
  }
}
