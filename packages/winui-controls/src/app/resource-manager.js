import { ControlError } from '../policy/events.js';
import { ResourceLoader } from './resources.js';

/** A resource context is isolated from the application language until explicitly applied. */
export class ResourceContext {
  constructor(language = 'en-US') { this.setLanguage(language); }
  setLanguage(language) { this.language = Intl.getCanonicalLocales(language)[0]; }
  getQualifier(name) {
    if (name !== 'Language') throw new ControlError('SFUI1694', 'This string-resource profile supports the Language qualifier', { name });
    return this.language;
  }
  setQualifier(name, value) {
    this.getQualifier(name);
    this.setLanguage(value);
  }
  snapshot() { return { version: 1, language: this.language }; }
  restore(value) {
    if (value?.version !== 1) throw new ControlError('SFUI1694', 'Invalid resource-context snapshot');
    this.setLanguage(value.language);
  }
}

export class ResourceMap {
  constructor(loader, prefix = '') { this.loader = loader; this.prefix = prefix; }
  getValue(key, context = null) {
    const path = this.#path(key);
    const loader = this.loader;
    const exists = [...loader.resources.values()].some(values => values.has(path));
    if (!exists) throw new ControlError('SFUI1695', 'Resource key was not found', { key: path });
    return Object.freeze({ Kind: 0, ValueAsString: loader.getString(path, context?.language ?? loader.language) });
  }
  getSubtree(key) { return new ResourceMap(this.loader, this.#path(key) + '/'); }
  #path(key) {
    if (typeof key !== 'string' || !key || key.length > 1024 || key.split('/').some(part => part === '..' || !part)) {
      throw new ControlError('SFUI1694', 'Invalid resource-map path');
    }
    return this.prefix + key;
  }
  snapshot() { return { version: 1, prefix: this.prefix }; }
  restore(value) {
    if (value?.version !== 1) throw new ControlError('SFUI1694', 'Invalid resource-map snapshot');
    this.prefix = value.prefix;
  }
}

export class ResourceManager {
  constructor(loader) {
    if (!(loader instanceof ResourceLoader)) throw new TypeError('A ResourceLoader is required');
    this.loader = loader;
    this.mainResourceMap = new ResourceMap(loader);
  }
  createResourceContext() { return new ResourceContext(this.loader.language); }
  snapshot() { return { version: 1 }; }
  restore(value) {
    if (value?.version !== 1) throw new ControlError('SFUI1694', 'Invalid resource-manager snapshot');
  }
}
