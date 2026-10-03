import {designerSourceDocument, retainDesignerRuntimeBindings} from './designer-source-projection.js';
import {sameDesignerSources} from './designer-source-snapshots.js';

/** Handler creation uses the same worker, complete-source checks, and editor transaction as visual edits. */
export async function createDesignerSourceEvent(sync, request, {navigateOnly = false} = {}) {
  if (!sync.session || !sync.protocol) throw new Error('Connect a C# document before editing handlers');
  if (sync.writing) throw new Error('Wait for the pending source transaction');
  if (!navigateOnly && sync.dirty()) await sync.write();
  const file = sync.file();
  if (!file) throw new Error('The linked source file is no longer in the workspace');
  if (!navigateOnly && sync.view.state.readOnly) throw new Error('Enable source editing before creating a handler');
  sync.cancelPending();
  const baseline = sync.session;
  const protocol = sync.protocol;
  const generation = sync.generation;
  const operation = new AbortController();
  sync.operation = operation;
  const token = protocol.begin('design', {signal: operation.signal});
  const version = file.version;
  const assertCurrent = () => {
    if (generation !== sync.generation || baseline !== sync.session || !protocol.isCurrent(token)) {
      throw new Error('Source or design changed while planning the handler');
    }
  };
  sync.writing = true;
  try {
    const plan = await sync.view.analyzeDesign({
      operation: 'event', uri: file.uri, nodeId: request.nodeId, event: request.event, navigateOnly,
      options: {name: request.methodName ?? request.name?.split('.').at(-1)},
      baselineSources: baseline.sources, previous: {...baseline.analysis, document: sync.view.document.snapshot()}, generation,
      signal: operation.signal, workspaceId: sync.view.workspaceId?.()
    });
    if (navigateOnly && plan.navigationAvailable === true) {
      assertCurrent();
      assertNavigationCurrent(sync, plan);
      protocol.cancel(token);
      await sync.view.openSource(plan.navigation.uri, plan.navigation.start, plan.navigation.end);
      sync.view.documentHost?.setMode('code');
      return {...plan, ok: true};
    }
    if (plan.success === false) throw Object.assign(new Error(plan.diagnostics?.[0]?.message ?? 'Cannot edit this handler'), {
      diagnostics: plan.diagnostics ?? []
    });
    assertCurrent();
    const changed = plan.changes?.some(change => change.edits.length) ?? false;
    if (navigateOnly && changed) throw new Error('This event has no existing source handler');
    if (changed) await sync.view.applySourceEdits(file.uri, plan, version, assertCurrent);
    assertCurrent();
    acceptHandlerPlan(sync, plan, token, changed);
    if (plan.navigation) {
      const {uri, start, end} = plan.navigation;
      sync.view.openSource(uri, start, end);
      sync.view.documentHost?.setMode('code');
    }
    return {...plan, ok: true};
  } catch (error) {
    protocol.reject(token, {code: error.code ?? 'SFSYNC_EVENT', message: error.message});
    if (generation === sync.generation && !operation.signal.aborted) sync.reportOperationError(error);
    throw error;
  } finally {
    sync.writing = false;
    sync.pending = null;
    sync.view.chrome?.refreshSource();
  }
}

function assertNavigationCurrent(sync, plan) {
  if (plan.changes?.some(change => change.edits.length) || plan.edits?.length || !plan.existing
    || !sameDesignerSources(plan.expectedSources, sync.view.sourceFiles?.())
    || plan.workspaceRevision !== undefined && plan.workspaceRevision !== sync.view.state.revision) {
    throw new Error('Source changed before navigating the existing handler.');
  }
  const location = plan.navigation;
  const file = plan.expectedSources.find(source => source.uri === location?.uri);
  if (!file || !Number.isSafeInteger(location.start) || !Number.isSafeInteger(location.end)
    || location.start < 0 || location.end < location.start || location.end > file.text.length) {
    throw new Error('The existing handler source location is unavailable.');
  }
}

function acceptHandlerPlan(sync, plan, token, changed) {
  const current = sync.file();
  const document = changed ? plan.document : sync.view.document.value;
  const accepted = sync.protocol.accept(token, {document: designerSourceDocument(document), text: current.text, sourceVersion: current.version,
    designRevision: sync.view.document.revision + (changed ? 1 : 0), diagnostics: plan.diagnostics ?? []});
  if (!accepted.accepted) throw new Error('Handler source transaction became stale');
  if (changed) {
    sync.loading = true;
    try {
      sync.view.document.load(retainDesignerRuntimeBindings(sync.view.document.value, document), {label: 'source sync', history: false});
    }
    finally { sync.loading = false; }
    sync.session = {analysis: {...plan.analysis, text: current.text},
      sources: (sync.view.sourceFiles?.() ?? []).map(file => ({...file}))};
  }
  sync.report('synced', changed ? 'Created and subscribed ' + plan.handler : 'Opened existing event handler', []);
}
