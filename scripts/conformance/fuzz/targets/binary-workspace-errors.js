import { binaryRejection } from './binary-guards.js';
import { zipFailure } from './binary-zip-errors.js';

const validationMessages = new Set([
  'Multiple workspace manifests; open a narrower ZIP or remove the ambiguous manifests',
  'Workspace manifest limit exceeded', 'Unsupported workspace manifest',
  'Files outside the manifest root would be lost; use a plain ZIP or a single workspace root',
  'Invalid workspace settings', 'Invalid workspace language version', 'Invalid workspace name',
  'Invalid workspace mode', 'Invalid workspace entry type', 'Invalid startup project',
  'Invalid configuration', 'Invalid platform', 'Too many open documents',
  'Invalid breakpoint flag', 'Invalid breakpoint expression', 'Invalid condition mode',
  'Invalid breakpoints', 'Breakpoint limit exceeded', 'Invalid source breakpoint', 'Invalid breakpoint column',
  'Function breakpoint limit exceeded', 'Invalid function breakpoint', 'Invalid built-in extension settings',
  'Invalid extension switch', 'Invalid generated version', 'Extension input limit exceeded',
  'Invalid generator input', 'Invalid analyzer settings', 'Invalid analyzer severity',
]);
const typeMessages = new Set([
  'Invalid startup configuration', 'Unsupported startup configuration', 'Invalid startup entry',
  'Invalid session project ID', 'Invalid startup action', 'Invalid startup profile',
  'Invalid compute preferences', 'Invalid compute backend', 'Invalid launch profile metadata',
  'Unsupported launch profile metadata', 'Invalid launch profile project', 'Invalid launch profile',
  'Invalid launch profile ID', 'Invalid launch renderer', 'Invalid launch profile name',
  'Invalid stop on entry', 'Invalid selected launch profile', 'Invalid session user settings',
]);
const rangeMessages = new Set([
  'Invalid startup project count', 'Invalid startup order', 'Invalid compute worker count',
  'Invalid compute element limit', 'Invalid launch profile count', 'Session user settings exceed the limit',
]);

/** Recognize only diagnostics explicitly emitted by workspace import/settings; writer invariants remain findings. */
export function workspaceImportFailure(error, signal) {
  if (signal?.aborted && (error === signal.reason || error?.cause === signal.reason)) return binaryRejection('FUZZ_CANCELLED');
  if (error instanceof SyntaxError) return binaryRejection('WORKSPACE_MANIFEST_JSON', error.message);
  if (error instanceof TypeError && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
    return binaryRejection('WORKSPACE_MANIFEST_UTF8');
  }
  const message = error?.message;
  if (typeof message !== 'string') throw error;
  if (error?.constructor === Error && (validationMessages.has(message) ||
      message.startsWith('Workspace entry is missing: ') || message.startsWith('Session project is missing from the workspace: ') ||
      /^Unknown selected launch profile '.*'$/.test(message))) {
    return binaryRejection('WORKSPACE_VALIDATION', message);
  }
  if (error?.constructor === TypeError && (typeMessages.has(message) ||
      /^Duplicate (?:startup project|launch profile project|launch profile) '.*'$/.test(message))) {
    return binaryRejection('WORKSPACE_VALIDATION', message);
  }
  if (error?.constructor === RangeError && rangeMessages.has(message)) return binaryRejection('WORKSPACE_VALIDATION', message);
  return zipFailure(error);
}
