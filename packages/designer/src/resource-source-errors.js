/** A resource-source diagnostic retains both C# and optional decoded-markup locations. */
export class DesignerResourceSourceError extends Error {
  constructor(code, message, location = {}) {
    super(message);
    this.name = 'DesignerResourceSourceError';
    this.code = code;
    this.diagnostic = {code, severity: 'error', source: 'Designer', message, ...location};
  }
}

export function resourceSourceFail(code, message, location) {
  throw new DesignerResourceSourceError(code, message, location);
}

export function resourceSourceCheck(signal) {
  if (typeof signal?.throwIfCancellationRequested === 'function') signal.throwIfCancellationRequested();
  if (signal?.aborted) throw signal.reason ?? new DOMException('Resource analysis cancelled', 'AbortError');
}

export function resourceSourceLocation(uri, node) {
  return {uri, span: {start: node.start, length: node.end - node.start}};
}

export function resourceTargetDiagnostic(uri, node) {
  return {code: 'SFD1884', severity: 'error', source: 'Designer', ...resourceSourceLocation(uri, node),
    message: 'ResourceDictionary and XamlReader require Microsoft WinUI. The current SharpForge compiler/runtime cannot qualify this source.',
    fixHint: 'Keep the resource changes staged or export the candidate for a Windows App SDK build. Source has not been changed.',
    target: 'nativeWinUI', status: 'unavailable'};
}
