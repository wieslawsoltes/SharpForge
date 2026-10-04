import {PropertyFault} from '@sharpforge/winui-properties';
import {ManagedFault} from '../heap.js';

/** Preserve the property engine's declared exception type at the managed ABI boundary. */
export function managedPropertyFault(error) {
  return error instanceof PropertyFault ? new ManagedFault(error.kind, error.message) : error;
}
