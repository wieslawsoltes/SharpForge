import {sameDesignerSources} from './designer-source-snapshots.js';

export function setSourceAuthoringCapability(sync, analysis) {
  sync.view.document.setReadOnly(analysis.readOnly === true,
    analysis.previewCapability?.reason ?? 'This source preview is read-only. Edit C# or disconnect its source link.');
}

export function publishSourceCatalog(sync, candidate, version) {
  if (candidate.analysis.kind === 'resources') return;
  const snapshot = {success: candidate.success, previewAvailable: candidate.previewAvailable,
    projectTypes: candidate.projectTypes ?? [], version};
  if (candidate.success) sync.view.toolbox?.updateAnalysis?.(snapshot);
  else if (candidate.previewAvailable) sync.view.toolbox?.updatePreviewAnalysis?.(snapshot);
}

export function markSourcePreviewBaseline(sync, analysis, diagnostics = analysis.diagnostics ?? []) {
  if (analysis.compilationSucceeded !== false || !analysis.previewCapability?.previewAvailable) return;
  sync.protocol.acceptPreview(sync.protocol.begin('source'), {document: sync.protocol.document,
    sourceVersion: sync.protocol.source.version, designRevision: sync.view.document.revision,
    success: false, capability: analysis.previewCapability, diagnostics});
}

export function isDesignerCancellation(error) {
  return error?.name === 'AbortError' || ['ABORT_ERR', 'OperationCanceled', 'SFSYNC_CANCELLED', 'SFD0009'].includes(error?.code);
}

export function firstSourceError(diagnostics) {
  return diagnostics.find(diagnostic => diagnostic.severity === 'error') ?? diagnostics[0];
}

/** Protected handlers remain navigable from an exact retained source snapshot without authorizing a source write. */
export async function navigateReadOnlySourceEvent(sync, nodeId, event) {
  const analysis = sync.session?.analysis;
  if (!analysis || !sameDesignerSources(sync.session.sources, sync.view.sourceFiles?.())) {
    throw Object.assign(new Error('Read the current source before navigating this preview handler.'), {code: 'SFSYNC_CONFLICT'});
  }
  const subscription = analysis.bindings?.[nodeId]?.events?.[event]?.subscriptions?.[0];
  if (!subscription) throw Object.assign(new Error('This event has no existing source handler.'), {code: 'SFSYNC_EVENT'});
  const navigation = subscription.location ?? {uri: analysis.uri,
    start: subscription.span?.start ?? subscription.expression?.start, end: subscription.span?.end ?? subscription.expression?.end};
  const file = sync.session.sources.find(source => source.uri === navigation.uri);
  if (!file || !Number.isSafeInteger(navigation.start) || !Number.isSafeInteger(navigation.end)
    || navigation.start < 0 || navigation.end < navigation.start || navigation.end > file.text.length) {
    throw Object.assign(new Error('The handler source location is unavailable.'), {code: 'SFSYNC_EVENT'});
  }
  await sync.view.openSource(navigation.uri, navigation.start, navigation.end);
  sync.view.documentHost?.setMode('code');
  return {ok: true, success: analysis.compilationSucceeded === true, compilationSucceeded: analysis.compilationSucceeded,
    existing: true, readOnly: true, navigation, changes: []};
}
