import {createDesign} from '@sharpforge/designer';
import {DESIGN_TOOLS} from './designer-tools.js';

/** Compatibility facade: every operation resolves the active URI at call time, never a global design document. */
export class ActiveDesignerTools {
  constructor(workbench) {
    this.workbench = workbench;
    this.sourceSync = {
      connect: async uri => {
        await workbench.documents.open(uri ?? workbench.state.active, 'split');
        return this.current.sourceSync.snapshot();
      },
      disconnect: () => workbench.documents.tools?.sourceSync.disconnect(),
      read: options => this.current.sourceSync.read(options),
      write: () => this.current.sourceSync.write(),
      setAuto: value => this.current.sourceSync.setAuto(value),
      sourceChanged: uri => workbench.sourceChanged(uri),
      snapshot: () => workbench.documents.tools?.sourceSync.snapshot() ?? {state: 'unlinked', uri: null}
    };
  }

  get current() {
    const tools = this.workbench.documents.tools;
    if (!tools) throw new Error('Open a compatible C# or design document first');
    return tools;
  }
  get document() { return this.current.document; }
  get chrome() { return this.current.chrome; }
  get panelResolver() { return id => this.current.panel(id); }
  ensure() { this.current.ensure(); }
  snapshot() { return this.workbench.documents.tools?.snapshot() ?? {uri: null, document: null, sourceSync: this.sourceSync.snapshot()}; }
  replace(...args) { return this.current.replace(...args); }
  action(action) { return this.current.action(action); }
  attach(...args) { return this.current.attach(...args); }
  applyLive(...args) { return this.current.applyLive(...args); }
  undo(redo) { return this.current.undo(redo); }

  renderTool(id) {
    if (!DESIGN_TOOLS.includes(id)) return false;
    this.workbench.documents.tools?.renderTool(id);
    return true;
  }

  async open() {
    const {documents, state} = this.workbench;
    if (documents.probe(state.active).compatible) await documents.open(state.active, 'design');
    else await this.workbench.fileServices.createDesignDocument(createDesign());
    this.workbench.context.docking.reset('designer');
    return this.snapshot();
  }

  async load(value, options = {}) {
    await this.workbench.fileServices.createDesignDocument(value, options.path ?? 'View.sfdesign.json');
    return this.snapshot();
  }
}
