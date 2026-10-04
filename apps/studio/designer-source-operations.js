import { CSharpDesignSession } from '@sharpforge/designer';
import { captureDesignerTarget, reportDesignerError } from './designer-diagnostics.js';

export async function connectDesignerSource(sync, uri) {
  const view = sync.view;
  view.ensure();
  const generation = sync.generation;
  const files = view.sourceFiles?.() ?? [];
  if (!uri) {
    const active = files.find(file => file.uri === view.state.active);
    const preferred = files.find(file => /DesignedView.*\.cs$/.test(file.uri));
    uri = preferred?.uri ?? active?.uri;
    if (files.length > 1) uri = await view.choose('Connect C# construction method', files.map(file => file.uri), uri);
  }
  if (!uri) return null;
  const file = files.find(candidate => candidate.uri === uri);
  if (!file) throw new Error('C# source file is not open in this workspace');
  if (generation !== sync.generation || view.sourceFiles?.().find(candidate => candidate.uri === uri) !== file) {
    throw new Error('C# source selection changed while choosing a construction method');
  }
  const target = captureDesignerTarget(view, uri);
  let session;
  try { session = new CSharpDesignSession(file.text, { uri }); }
  catch (error) { reportDesignerError(view, error, target); throw error; }
  view.diagnostics?.clear(sync.diagnosticTarget);
  sync.generation++;
  clearTimeout(sync.sourceTimer);
  clearTimeout(sync.designTimer);
  sync.session = session;
  sync.loading = true;
  try { view.replace(session.document, { path: uri.replace(/(?:\.g)?\.cs$/i, '.sfdesign.json') }); }
  finally { sync.loading = false; }
  sync.report('synced', `Linked ${uri} · ${session.analysis.method.name} · ${session.analysis.warnings.length} protected expression(s)`, target);
  view.chrome?.setMode('split');
  return sync.snapshot();
}

export async function readDesignerSource(sync, { discardDesign = false } = {}) {
  if (!sync.session) throw new Error('Connect a C# file first');
  if (sync.writing) throw new Error('Wait for the pending source update');
  if (sync.dirty() && !discardDesign) throw new Error('Designer changes are staged. Confirm Read C# to discard them.');
  const file = sync.file();
  if (!file) throw new Error('Linked C# file was removed');
  const generation = sync.generation;
  const document = sync.session.read(file.text);
  if (generation !== sync.generation) throw new Error('C# link changed');
  const selection = [...sync.view.document.selection];
  sync.loading = true;
  try {
    sync.view.replace(document, { path: sync.view.path });
    sync.view.document.select(selection.filter(id => document.nodes.some(node => node.id === id)));
  } finally { sync.loading = false; }
  sync.report('synced', `Read ${file.uri} · ${sync.session.analysis.warnings.length} protected expression(s)`);
  return sync.snapshot();
}

export async function writeDesignerSource(sync) {
  if (!sync.session) throw new Error('Connect a C# file first');
  if (sync.writing) return sync.pending;
  const file = sync.file();
  if (!file) throw new Error('Linked C# file was removed');
  if (sync.view.state.readOnly) throw new Error('Begin Edit and Continue or stop debugging before changing C#');
  const session = sync.session;
  const epoch = sync.generation;
  const revision = sync.view.document.revision;
  const target = captureDesignerTarget(sync.view, file.uri);
  const plan = session.plan(sync.view.document.value, file.text);
  if (!plan.edits.length) {
    sync.report('synced', 'C# and design are synchronized.');
    return sync.snapshot();
  }
  const version = file.version;
  sync.writing = true;
  sync.report('validating', `Validating ${plan.edits.length} C# source edit(s)…`, target);
  sync.pending = (async () => {
    try {
      await sync.view.applySourceEdits(file.uri, plan, version, () => {
        if (epoch !== sync.generation || session !== sync.session || revision !== sync.view.document.revision) {
          throw new Error('Designer changed during compilation; retry the latest edit.');
        }
      });
      if (epoch !== sync.generation || session !== sync.session) throw new Error('C# link changed during source update');
      session.commit(plan);
      sync.report('synced', `Applied ${plan.edits.length} source edit(s) · user handlers retained`);
      return sync.snapshot();
    } catch (error) {
      if (epoch === sync.generation && session === sync.session) sync.report('blocked', error.message, target);
      throw error;
    } finally {
      sync.writing = false;
      sync.pending = null;
      sync.view.chrome?.refreshSource();
    }
  })();
  return sync.pending;
}
