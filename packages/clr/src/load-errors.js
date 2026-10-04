/** Stable loader failure categories; no host paths or exception messages are inferred. */
export const LoadErrorCode = Object.freeze({
  InvalidName: 'SFCLR001',
  MissingAssembly: 'SFCLR002',
  IdentityMismatch: 'SFCLR003',
  ConflictingAssembly: 'SFCLR004',
  InvalidImage: 'SFCLR005',
  InvalidConfiguration: 'SFCLR006',
  LimitExceeded: 'SFCLR007',
  Disposed: 'SFCLR008',
  Cancelled: 'SFCLR009',
  UnsupportedFramework: 'SFCLR010',
  RecursiveResolution: 'SFCLR011',
  TypeLoad: 'SFCLR012',
  UnsupportedFeature: 'SFCLR013',
  MissingFile: 'SFCLR014',
  FileLoad: 'SFCLR015',
});

const exceptionTypes = Object.freeze({
  SFCLR002: 'System.IO.FileNotFoundException',
  SFCLR005: 'System.BadImageFormatException',
  SFCLR008: 'System.ObjectDisposedException',
  SFCLR009: 'System.OperationCanceledException',
  SFCLR012: 'System.TypeLoadException',
  SFCLR013: 'System.NotSupportedException',
  SFCLR014: 'System.IO.FileNotFoundException',
  SFCLR015: 'System.IO.FileLoadException',
});

/** A managed exception descriptor carried by a JavaScript Error with deterministic diagnostics. */
export class AssemblyLoadError extends Error {
  constructor(code, reason, { requested = null, requester = null, attempts = [] } = {}) {
    super(reason);
    this.code = code;
    this.managedType = exceptionTypes[code] ?? 'System.IO.FileLoadException';
    this.name = this.managedType.slice(this.managedType.lastIndexOf('.') + 1);
    this.requestedAssembly = requested;
    this.requestingAssembly = requester;
    this.attempts = Object.freeze(attempts.map(attempt => Object.freeze({ ...attempt })));
    this.fusionLog = [
      `Requested: ${requested ?? '<unspecified>'}`,
      `Requester: ${requester ?? '<unspecified>'}`,
      ...this.attempts.map(attempt => `${attempt.provider}: ${attempt.reason}`),
      `${code}: ${reason}`,
    ].join('\n');
  }
}

export function loadError(code, reason, context) {
  return new AssemblyLoadError(code, reason, context);
}

export function checkCancellation(signal) {
  if (signal?.aborted) throw loadError(LoadErrorCode.Cancelled, 'Assembly operation cancelled');
}
