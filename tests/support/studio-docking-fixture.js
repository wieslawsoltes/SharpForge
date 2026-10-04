import { setMaxListeners } from 'node:events';
import { DockLayout, DockHost } from '@sharpforge/docking';
import { FoldingStateStore } from '@sharpforge/editor';
import { StudioDocking } from '../../apps/studio/workbench/layout-workspace.js';
import { DocumentTabs } from '../../apps/studio/workbench/tabs/index.js';
import { studioLoaderFixture } from './studio-loader-fixture.js';
import { ownershipView } from './editor-view-ownership.js';
import { dockingDocument } from './docking-dom.js';

class RecordingDockHost extends DockHost {
  render() {
    this.renderCount = (this.renderCount ?? 0) + 1;
    super.render();
  }
}

/** Real workspace loader, document ownership, tab policy and retained docking renderer around inert editor paint/input. */
export function studioDockingFixture(t) {
  const cleanup = [];
  const fixture = studioLoaderFixture({ after: callback => cleanup.push(callback) });
  const { services, state, context } = fixture;
  const document = dockingDocument();
  const root = document.createElement('div');
  document.body.append(root);
  const created = [], resolved = [], focused = [];
  const session = { models: services.documents.models, views: new Set(), foldingState: new FoldingStateStore() };
  let faultUri = null;
  const failure = new Error('Editor content creation failed');
  services.documents.createEditor = (record, options) => {
    if (record.uri === faultUri) throw failure;
    const editor = ownershipView(options.model, session);
    editor.element = document.createElement('div');
    created.push({ uri: record.uri, viewId: options.viewId, editor });
    return editor;
  };
  const layout = new DockLayout([
    { id: 'output', title: 'Output', kind: 'tool' },
    { id: 'app:one', title: 'Application', kind: 'document' }
  ]);
  const tabs = new DocumentTabs({ layout, documents: services.documents, confirmClose: async () => 'discard' });
  const content = new Map(['output', 'app:one'].map(id => [id, document.createElement('div')]));
  const docking = Object.assign(Object.create(StudioDocking.prototype), {
    layout, tabs, documents: services.documents, content,
    media: { matches: false }, mobile: false, pendingRestore: null,
    createDocument(uri, options) {
      resolved.push({ uri, viewId: options.viewId });
      return services.documents.createDocument(uri, options);
    }
  });
  const host = new RecordingDockHost(root, layout, {
    resolveContent: id => docking.resolve(id), onWindowFocus: event => focused.push(event)
  });
  // A real browser's AbortSignal has no Node-only listener warning threshold.
  setMaxListeners(64, host.controller.signal);
  docking.host = host;
  const renderWorkspace = context.renderWorkspace;
  context.resetEditors = () => docking.resetDocumentViews();
  context.renderWorkspace = () => {
    renderWorkspace();
    docking.sync(state.files, state.tabs, state.active);
  };
  context.renderWorkspace();
  layout.open('output');
  t.after(() => {
    tabs.dispose();
    host.dispose();
    context.projectServices.dispose();
    for (const dispose of cleanup.reverse()) dispose();
  });
  return { ...fixture, docking, host, layout, tabs, document, created, resolved, focused,
    failCreation(uri) { faultUri = uri; return failure; } };
}
