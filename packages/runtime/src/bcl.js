import {frameworkType} from '@sharpforge/framework';
import {fail, bclScalar} from '@sharpforge/bcl-core';
export {bclScalar, formatBclValue, compositeFormat} from '@sharpforge/bcl-core';

/** Released Math fallback; registered family modules own other BCL behavior. */
export function invokeBcl(p, descriptor, args, type = frameworkType(descriptor.owner)) {
  if (type?.kind !== 'bcl' || type.family !== 'math') return {handled: false};
  if (descriptor.kind === 'get') {
    return {handled: true, value: p.managed(type.properties[descriptor.property].value, 'double')};
  }
  const reference = descriptor.isStatic || descriptor.kind === 'constructor' ? null : args[0];
  const values = (reference === null ? args : args.slice(1)).map(value => bclScalar(p, value));
  let value;
  if (descriptor.name === 'Clamp') {
    if (values[1] > values[2]) fail(p, 'ArgumentException', 'Minimum exceeds maximum');
    value = Math.min(values[2], Math.max(values[1], values[0]));
  } else {
    value = Math[descriptor.name === 'Truncate' ? 'trunc' : descriptor.name.toLowerCase()](...values);
  }
  return {handled: true, value: p.managed(value, descriptor.result)};
}
