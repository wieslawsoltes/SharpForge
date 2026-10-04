import {convert, float, number} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {boxUIValue} from './checked-casts.js';

const targets = Object.freeze({int: 'i4', uint: 'u4', float: 'r4', double: 'r8'});
const faults = Object.freeze({fault: (name, message) => new ManagedFault(name, message)});

/** A Double carrier preserves every approved 32-bit input; its declared source selects CLI conversion semantics. */
export function convertUINumeric(context, value, sourceType, targetType, checked = false) {
  if (!Object.hasOwn(targets, sourceType) || !Object.hasOwn(targets, targetType)) {
    throw new ManagedFault('NotSupportedException', 'The UI numeric conversion requires an approved scalar type');
  }
  const raw = context.native(value);
  if (typeof raw !== 'number') throw new ManagedFault('ArgumentException', 'A numeric UI value is required');
  const source = sourceType === 'float' || sourceType === 'double'
    ? float(raw, sourceType === 'float' ? 'r4' : 'r8') : raw | 0;
  const floatingTarget = targetType === 'float' || targetType === 'double';
  const unsigned = sourceType === 'uint';
  const input = unsigned && floatingTarget ? convert('conv.r.un', source, faults) : source;
  const operation = 'conv.' + (checked && !floatingTarget ? 'ovf.' : '') + targets[targetType] +
    (checked && !floatingTarget && unsigned ? '.un' : '');
  const converted = convert(operation, input, faults);
  // Source UInt32 values are mathematical unsigned numbers; CIL storage reconstructs their I4 stack bit pattern.
  const scalar = targetType === 'uint' ? number(converted) >>> 0 : number(converted);
  return boxUIValue(context, scalar, targetType);
}
