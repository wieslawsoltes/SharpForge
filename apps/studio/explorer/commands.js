import {createExplorerCommandTable} from './command-table.js';
import {buildExplorerMenu} from './menu.js';
import {createExplorerHistory, performExplorerOperations, undoExplorerOperation} from './operation-history.js';
import {moveExplorerItems} from './move-copy.js';
import {destinationFolder} from './guards.js';

const nonPhysical = new Set(['project', 'project-file', 'solution', 'solution-folder', 'dependencies', 'dependency-group',
  'package', 'reference', 'framework', 'target-framework', 'analyzer', 'project-reference', 'generated', 'generated-group', 'symbol',
  'unloaded-project', 'generator', 'imports', 'import']);

/** Stable command facade; handlers own file operations and this class owns workspace admission/lifetime. */
export class ExplorerCommands {
  constructor(host) {
    this.host = host;
    this.history = [];
    this.clipboard = null;
    this.busy = false;
    this.identity = null;
    this.registry = createExplorerCommandTable();
    this.fileHistory = createExplorerHistory(this);
  }

  context() {
    if (this.disposed) throw new Error('Explorer commands are disposed');
    const context = this.host.context();
    if (this.identity !== context.identity) {
      if (this.identity !== null) this.operationController?.abort();
      this.identity = context.identity;
      this.history = [];
      this.clipboard = null;
      this.fileHistory?.clear();
    }
    return context;
  }

  editable() {
    const context = this.context();
    if (context.readOnly) return 'Stop debugging before changing files';
    if (this.busy) return 'A file operation is in progress';
    if (context.native && context.buildBusy) return 'Finish the native build before changing files';
    return true;
  }

  nodes(node, selection = []) { return selection.length ? selection : node ? [node] : []; }
  files(nodes) { return nodes.filter(node => node.path && !nonPhysical.has(node.kind)); }
  folder(node) { return destinationFolder(node); }
  menu(node, selection = []) { return buildExplorerMenu(this, node, selection); }

  async run(action, node = null, selection = [], event = null) {
    let ownsOperation = false;
    try {
      const context = this.context();
      const nodes = this.nodes(node, selection);
      if (action === 'context') {
        this.host.menu({items: this.menu(node, nodes), x: event?.clientX ?? 0, y: event?.clientY ?? 0,
          anchor: event?.currentTarget ?? this.host.explorer.tree,
          document: event?.target?.ownerDocument ?? globalThis.document});
        return;
      }
      const command = this.registry.get(action);
      if (!command) throw new Error('Unknown explorer command: ' + action);
      if (command.mutates) {
        const editable = this.editable();
        if (editable !== true) throw new Error(editable);
        if (this.runningMutation) throw new Error('Complete or cancel the active file dialog first');
        this.runningMutation = true;
        ownsOperation = true;
        this.operationIdentity = context.identity;
        this.readSet = new Map();
        this.operationController = new AbortController();
      }
      return await command.execute({commands: this, context, node, nodes, event, action});
    } catch (error) {
      this.host.error(error);
      return {error: error.message};
    } finally {
      if (ownsOperation) {
        this.runningMutation = false;
        this.operationIdentity = null;
        this.readSet = null;
        this.operationController = null;
        this.host.render();
      }
    }
  }

  async readText(path) {
    const context = this.context();
    let text = context.records.find(file => file.path === path)?.text;
    if (context.native && typeof text !== 'string') text = (await context.client.read(path)).text;
    if (typeof text !== 'string') throw new Error('Editable text not found: ' + path);
    if (this.readSet?.has(path) && this.readSet.get(path) !== text) throw new Error('Project changed while preparing the operation: ' + path);
    this.readSet?.set(path, text);
    return text;
  }

  move(mappings, copy, destinationProject = null, options = {}) {
    return moveExplorerItems(this, mappings, copy, destinationProject, options);
  }

  perform(operations, mappings = [], options = {}) { return performExplorerOperations(this, operations, mappings, options); }
  undo() { return undoExplorerOperation(this); }
  redo() { return undoExplorerOperation(this, true); }

  dispose() {
    this.disposed = true;
    this.operationController?.abort();
    this.history = [];
    this.clipboard = null;
    this.fileHistory.journal.dispose();
    this.fileHistory.clear();
    this.registry.clear();
  }
}
