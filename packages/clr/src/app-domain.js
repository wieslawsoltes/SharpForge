import { AssemblyLoadSession } from './load-context.js';
import { asAssemblyName } from './assembly-name.js';

/** Session-scoped AppContext data and switches, initialized from runtimeconfig properties. */
export class RuntimeAppContext {
  #data;
  #switches = new Map();
  constructor({ baseDirectory = '', properties = {} } = {}) {
    this.baseDirectory = String(baseDirectory);
    this.#data = new Map(Object.entries(properties));
    for (const [name, value] of this.#data) if (typeof value === 'boolean') this.#switches.set(name, value);
  }

  getData(name) { return this.#data.get(String(name)) ?? null; }
  setData(name, value) { this.#data.set(String(name), value); }
  setSwitch(name, value) {
    if (typeof value !== 'boolean') throw new TypeError('AppContext switches are Boolean');
    this.#switches.set(String(name), value);
  }
  tryGetSwitch(name) { return Object.freeze({ found: this.#switches.has(name), enabled: this.#switches.get(name) ?? false }); }
}

/** One logical current AppDomain per runtime session; event subscriptions return disposal callbacks. */
export class RuntimeAppDomain {
  constructor({ session = new AssemblyLoadSession(), appContext = new RuntimeAppContext(), friendlyName = 'SharpForge' } = {}) {
    this.session = session;
    this.appContext = appContext;
    this.friendlyName = friendlyName;
    Object.freeze(this);
  }

  get currentDomain() { return this; }
  get baseDirectory() { return this.appContext.baseDirectory; }
  getAssemblies() { return this.session.getAssemblies(); }
  onAssemblyLoad(listener) { return this.session.onAssemblyLoad(listener); }
  onAssemblyResolve(listener) { return this.session.onAssemblyResolve(listener); }
  onTypeResolve(listener) { return this.session.onTypeResolve(listener); }
  load(name, options) { return this.session.defaultContext.loadFromAssemblyName(asAssemblyName(name), options); }
  resolveType(name, requester = null) { return this.session.resolveType(Object.freeze({ name, requester })); }
}
