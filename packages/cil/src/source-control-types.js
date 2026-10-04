import {CilError} from './binary.js';

/** Closed generic synchronization returns the declared byref location's element type. */
export function sourceBuiltinResultType(builtin, arguments_) {
  const result = builtin.result;
  if (builtin.synchronization?.genericArity && result === '!!0') {
    const location = arguments_[0];
    if (typeof location !== 'string' || !location.endsWith('&')) throw new CilError('Synchronization requires a typed managed address');
    return location.slice(0, -1);
  }
  return result === 'void' ? 'null' : result === 'numeric' ? arguments_.includes('double') ? 'double' : 'int' : result;
}
