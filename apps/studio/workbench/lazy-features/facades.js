import { createNativeBuildSettings, hasLocalHostCapability } from './native-settings.js';

const designerPanels = new Set(['designer', 'designer-toolbox', 'designer-tree', 'designer-properties',
  'designer-layout', 'designer-styles', 'designer-source']);

/** The renderer contract stays synchronous; controller activation and active commands are awaitable. */
export function designerFacade(feature) {
  return {
    peek: () => feature.peek(),
    async ensure() { const tools = await feature.load(); tools.ensure(); return tools; },
    renderTool(id, element) {
      if (!designerPanels.has(id)) return false;
      feature.mount(id, element, tools => tools.renderTool(id, element));
      return true;
    },
    sourceSync: { sourceChanged: uri => feature.peek()?.sourceSync.sourceChanged(uri) }
  };
}

export function assemblyFacade(feature) {
  return { open: (...args) => feature.call('open', args),
    render: element => feature.mount('assembly', element, tools => tools.render(element)) };
}

export function disassemblyFacade(feature) {
  return { reset: () => feature.peek()?.reset(),
    render: (element, snapshot) => feature.mount('disassembly', element, tools => tools.render(element, snapshot)) };
}

export function wizardFacade(feature) {
  return { openProject: (...args) => feature.call('openProject', args), openItem: (...args) => feature.call('openItem', args),
    selectImport: (...args) => feature.call('selectImport', args) };
}

/** Passive native state reads preserve a cold startup. Only explicit operations or a capability URL load the tool. */
export class NativeBuildFacade {
  constructor(feature) {
    this.feature = feature;
    this.settings = createNativeBuildSettings();
    this.buffers = new Map();
  }
  get client() { return this.feature.peek()?.client ?? null; }
  get capabilities() { return this.feature.peek()?.capabilities ?? null; }
  get workspace() { return this.feature.peek()?.workspace ?? null; }
  get job() { return this.feature.peek()?.job ?? null; }
  get busy() { return this.feature.peek()?.busy ?? false; }
  get attached() { return this.feature.peek()?.attached ?? false; }
  set attached(value) { if (this.feature.peek()) this.feature.peek().attached = value; }
  get sourcePath() { return this.feature.peek()?.sourcePath ?? null; }
  set sourcePath(value) { if (this.feature.peek()) this.feature.peek().sourcePath = value; }
  get onSaved() { return this.feature.peek()?.onSaved; }
  sourceChanges() { return this.feature.peek()?.sourceChanges() ?? []; }
  snapshot() {
    return this.feature.peek()?.snapshot() ?? { connected: false, attached: false, capabilities: null, workspace: null,
      job: null, inspection: null, busy: false, sourcePath: null, dirtyBuffers: [] };
  }
  connect(...args) { return this.feature.call('connect', args); }
  attach(...args) { return this.feature.call('attach', args); }
  refresh(...args) { return this.feature.call('refresh', args); }
  open(...args) { return this.feature.call('open', args); }
  save(...args) { return this.feature.call('save', args); }
  run(...args) { return this.feature.call('run', args); }
  cancel() { return this.feature.peek()?.cancel() ?? Promise.resolve(); }
  autoConnect(location = globalThis.location) {
    return hasLocalHostCapability(location) ? this.feature.call('autoConnect') : Promise.resolve(false);
  }
  render(id, element) { this.feature.mount(id, element, tools => tools.render(id, element)); }
  renderBuild(...args) { return this.feature.peek()?.renderBuild(...args); }
  renderSource(...args) { return this.feature.peek()?.renderSource(...args); }
  dispose() { this.feature.dispose(); }
}
