/** Stable designer source diagnostics; legacy SFSYNC codes remain compatible. */
const definitions = Object.freeze({
  SFSYNC: ['SFD0001', 'Inspect the selected construction method.'],
  SFSYNC_PARSE: ['SFD0002', 'Fix the C# diagnostic and analyze the document again.'],
  SFSYNC_DYNAMIC: ['SFD0003', 'Edit the protected expression in Code view.'],
  SFSYNC_OWNERSHIP: ['SFD0004', 'Move custom logic outside the construction region or edit it in Code view.'],
  SFSYNC_CONFLICT: ['SFD0005', 'Compare both revisions and explicitly choose which revision to keep.'],
  SFSYNC_SYMBOL: ['SFD0006', 'Resolve the symbol or choose a fully qualified construction method.'],
  SFSYNC_REFERENCE: ['SFD0007', 'Remove or update the listed handwritten references before deleting the control.'],
  SFSYNC_LIMIT: ['SFD0008', 'Reduce the document or selection to the reported limit.'],
  SFSYNC_CANCELLED: ['SFD0009', 'Analyze the current source revision again.'],
  SFSYNC_EVENT: ['SFD0010', 'Navigate to the subscriptions and edit the protected handlers in Code view.'],
  SFSYNC_DETACHED: ['SFD0011', 'Attach this control to the selected construction root.'],
  SFSYNC_COMPILE: ['SFD0012', 'Fix the candidate compilation diagnostics before committing the source change.']
});

export class DesignSyncError extends Error {
  constructor(message, code = 'SFSYNC', span = null, details = {}) {
    super(message);
    this.name = 'DesignSyncError';
    this.code = code;
    this.span = span;
    this.diagnosticId = definitions[code]?.[0] ?? definitions.SFSYNC[0];
    this.details = details;
    this.uri = details.uri ?? span?.uri ?? null;
  }
}

export function failSource(message, node = null, code = 'SFSYNC', details = {}) {
  const span = node ? {start: node.start, end: node.end, uri: node.uri} : null;
  throw new DesignSyncError(message, code, span, details);
}

/** Converts an exception or analysis warning to an Error List / LSP compatible diagnostic. */
export function designSourceDiagnostic(error, {uri = error?.uri ?? null} = {}) {
  const legacyCode = error?.code === 'OperationCanceled' ? 'SFSYNC_CANCELLED' : error?.code ?? 'SFSYNC';
  const definition = definitions[legacyCode] ?? definitions.SFSYNC;
  const start = error?.span?.start ?? error?.start ?? 0;
  const end = error?.span?.end ?? error?.end ?? start + (error?.length ?? 0);
  return {
    code: definition[0], legacyCode, severity: error?.severity ?? 'error',
    message: error?.message ?? String(error), uri, span: {start, end},
    start, length: Math.max(0, end - start), fixHint: definition[1], source: 'Designer',
    ...(error?.details?.references ? {relatedInformation: error.details.references} : {})
  };
}

export function designSourceDiagnostics(analysis) {
  return [
    ...(analysis.warnings ?? []).map(warning => designSourceDiagnostic({...warning, severity: 'warning'}, {uri: analysis.uri})),
    ...(analysis.compilerDiagnostics ?? []).map(diagnostic => ({...diagnostic, source: 'C#'}))
  ];
}

export function checkSourceCancellation(signal) {
  if (signal?.aborted || signal?.isCancellationRequested) failSource('Design analysis was cancelled', null, 'SFSYNC_CANCELLED');
}
