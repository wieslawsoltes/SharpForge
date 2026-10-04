import {DesignDocument, createDesign, createDesignerResourceDocument} from '@sharpforge/designer';
import {registerDesignerWorker} from '../../apps/studio/designer-worker.js';
import {DesignerSourceSync} from '../../apps/studio/designer-source-sync.js';
import {DesignerResourceSourceSync} from '../../apps/studio/designer-resource-sync.js';
import {createDesignerSourceServices} from '../../apps/studio/designer-source-services.js';

export const componentUri = 'Widget.cs';
export const componentType = 'Example.Widget';
export const componentSource = `using Microsoft.UI.Xaml.Controls;
namespace Example {
  public partial class Widget : UserControl {
    public Widget() { InitializeComponent(); }
    void InitializeComponent() {
      var root = new Grid();
      var action = new Button { Content = "Owned", Width = 120 };
      root.Children.Add(action);
      this.Content = root;
    }
  }
}`;
export const compositionSource = `using Microsoft.UI.Xaml.Controls;
namespace Example {
  class Host {
    public static Page Create() {
      var page = new Page();
      var widget = new Widget();
      page.Content = widget;
      return page;
    }
  }
}`;

/** The transport is in process; all source ownership, compiler, catalog and planning implementations are production code. */
export function designerWorkerHarness(context) {
  const handlers = new Map();
  const dispose = registerDesignerWorker({registerHandler(name, handler) {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }});
  context.after(dispose);
  const requests = [];
  return {
    requests,
    async request(method, params = {}, {signal} = {}) {
      requests.push({method, params: structuredClone(params), signal});
      const result = await handlers.get(method)(structuredClone(params), method, {signal});
      return structuredClone(result);
    }
  };
}

export function componentFiles({composition = false} = {}) {
  return [{uri: componentUri, text: componentSource, version: 1},
    ...(composition ? [{uri: 'Host.cs', text: compositionSource, version: 1}] : [])];
}

/** Fake editor edges surround the production SourceSync, source services, model and worker. */
export function sourcePreviewHarness(context, {files = componentFiles(), uri = componentUri, resource = false} = {}) {
  const state = {name: 'PreviewWorkspace', files: structuredClone(files), active: uri, revision: 1, readOnly: false};
  const compiler = designerWorkerHarness(context);
  const document = resource ? createDesignerResourceDocument() : new DesignDocument(createDesign());
  const navigation = [];
  const catalogs = [];
  const services = createDesignerSourceServices({state, compiler,
    applyEdits() { throw new Error('A read-only preview must never dispatch source edits'); },
    documents: () => new Map(), history: {capture() {}, record() {}}
  });
  const view = {state, document, compiler, session: {uri}, ensure() {}, workspaceId: () => 'preview-workspace',
    sourceFiles: () => state.files, analyzeDesign: services.analyzeDesign,
    replace(value) { document.load(value, {label: 'source sync', history: false}); },
    chrome: {renderSync() {}, refreshSource() {}},
    documentHost: {setDiagnostics(value) { this.diagnostics = value; }, setMode() {}},
    toolbox: {updateAnalysis(value) { catalogs.push(value); }, updatePreviewAnalysis(value) { catalogs.push(value); }},
    openSource: (...args) => navigation.push(args)
  };
  const sync = resource ? new DesignerResourceSourceSync(view) : new DesignerSourceSync(view);
  view.sourceSync = sync;
  sync.auto = false;
  const unsubscribe = document.subscribe(event => sync.designChanged(event));
  context.after(() => { unsubscribe(); sync.dispose(); document.dispose(); });
  return {state, compiler, document, view, sync, navigation, catalogs,
    type(text) {
      const file = state.files.find(candidate => candidate.uri === uri);
      file.text = text;
      file.version++;
      state.revision++;
      sync.sourceChanged(uri);
    }
  };
}
