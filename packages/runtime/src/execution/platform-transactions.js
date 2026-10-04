import {ManagedFault} from './managed-fault.js';

export function beginPlatformTransaction(platform) {
  if (platform.transaction) throw new ManagedFault('InvalidOperationException', 'Nested platform transaction');
  const transaction = [];
  platform.transaction = transaction;
  return transaction;
}

/** Prepare coherent managed state after closing the buffer, before publishing any host command.
 * A preparation failure reopens the same buffer for rollback. Publication failures are committed.
 */
export function commitPlatformTransaction(platform, transaction, prepare) {
  if (!transaction) return;
  if (platform.transaction !== transaction) throw new ManagedFault('InvalidOperationException', 'Invalid UI transaction');
  platform.transaction = null;
  try {
    prepare?.();
  } catch (error) {
    platform.transaction = transaction;
    throw error;
  }
  for (const command of transaction) platform.options.onUICommand?.(command);
}

export function rollbackPlatformTransaction(platform, transaction) {
  if (transaction && platform.transaction === transaction) platform.transaction = null;
}
