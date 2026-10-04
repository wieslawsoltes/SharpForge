import {numericTypeId} from '@sharpforge/bytecode';
import {findContracts} from '@sharpforge/framework';

/** Whether this supported primitive must retain its runtime type at an object boundary. */
export function needsPrimitiveBox(target, source) {
  return target === 'object' && (numericTypeId(source) !== undefined || source === 'bool');
}

/** The existing managed-box ABI shared by compiler pipelines. */
export function primitiveBoxContract() {
  return findContracts('SharpForge.Runtime.Formatting', 'BoxValue', true)[0];
}
