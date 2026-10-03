import {CilError} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';

/** Preserve structured unsupported-member failures without losing the complete verifier report. */
export function verificationFault(report) {
  const unsupported = report.issues.find(issue => issue.exceptionType === 'NotSupportedException');
  const messages = report.issues.map(issue => `${issue.method ?? ''}${issue.offset === undefined ? '' :
    ' IL_' + issue.offset.toString(16)}: ${issue.message}`).join('; ');
  const error = unsupported ? new ManagedFault('NotSupportedException', unsupported.message) :
    new CilError('Managed IL verification failed: ' + messages);
  error.issues = report.issues;
  if (unsupported) {
    error.member = unsupported.member;
    error.callingConvention = unsupported.callingConvention;
  }
  return error;
}
