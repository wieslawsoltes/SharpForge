import {CilError} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';

/** Unsupported execution conventions retain machine-readable managed diagnostics at admission. */
export function requireVerifiedCil(report) {
  if (report.success) return;
  const unsupported = report.issues.find(issue => issue.exceptionType === 'NotSupportedException');
  let error;
  if (unsupported) {
    error = new ManagedFault('NotSupportedException', unsupported.message);
    error.member = unsupported.member;
    error.callingConvention = unsupported.callingConvention;
  } else {
    const messages = report.issues.map(issue => `${issue.method ?? ''}${issue.offset === undefined ? '' :
      ` IL_${issue.offset.toString(16)}`}: ${issue.message}`);
    error = new CilError('Managed IL verification failed: ' + messages.join('; '));
  }
  error.issues = report.issues;
  throw error;
}
