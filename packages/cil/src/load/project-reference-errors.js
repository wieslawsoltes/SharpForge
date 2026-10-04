import {CilError} from '../binary.js';

export const projectReferenceDiagnostics = Object.freeze({
  PRJ0001: 'Invalid or unsupported project assembly profile',
  PRJ0002: 'Required project assembly was not supplied',
  PRJ0003: 'Project assembly identity or content hash does not match',
  PRJ0004: 'Conflicting project assembly identity',
  PRJ0005: 'Project member definition or signature cannot be resolved',
  PRJ0006: 'Project assembly graph exceeds its limits or contains a cycle',
  PRJ0007: 'Project assembly loading was cancelled',
});

export function projectReferenceError(code, detail) {
  const error = new CilError(projectReferenceDiagnostics[code] + ': ' + detail);
  error.code = code;
  return error;
}

export function requireProjectReference(condition, code, detail) {
  if (!condition) throw projectReferenceError(code, detail);
}

export function checkProjectCancellation(signal) {
  if (signal?.aborted) throw projectReferenceError('PRJ0007', 'the caller aborted the request');
}
