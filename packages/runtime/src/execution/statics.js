import {decodeCoded,genericTypeParts,executionFieldAccessError} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {initializeStaticFieldSlot} from './external-field-values.js';

const threadFields = new WeakMap();
function threadStaticFields(inspector) {
  let fields = threadFields.get(inspector);
  if (fields) return fields;
  fields = new Set();
  for (const row of inspector.metadata.rows[12] ?? []) {
    const parent = decodeCoded('HasCustomAttribute', row[0]);
    if (parent >>> 24 !== 4) continue;
    const constructor = inspector.resolveToken(decodeCoded('CustomAttributeType', row[1]));
    if (constructor.owner === 'System.ThreadStaticAttribute') fields.add(parent);
  }
  threadFields.set(inspector, fields);
  return fields;
}

/** A physical static slot captures type instantiation and scheduler context identity.
 * Managed addresses retain this key so switching contexts cannot redirect a byref.
 */
export function staticSlot(vm, token, frame = vm.top, opcode = 'ldsfld') {
  const contextIdentity = frame?.genericIdentity ?? null;
  const field = vm.typeSystem.fieldCache.resolve(token, null, contextIdentity).field;
  if (!field.isStatic) throw new ManagedFault('InvalidProgramException', 'Expected a static field');
  const error = executionFieldAccessError(field, opcode);
  if (error) throw new ManagedFault('InvalidProgramException', error);
  const contextType = contextIdentity && genericTypeParts(contextIdentity).definition;
  const instance = field.ownerInstance ?? (contextType === field.owner ? contextIdentity : null);
  const genericIdentity = instance===null?null:vm.typeSystem.table(instance).name;
  const context = threadStaticFields(vm.inspector).has(field.resolvedToken) ? vm.scheduler?.currentId ?? 1 : null;
  const key = genericIdentity !== null || context !== null ? JSON.stringify([field.resolvedToken, genericIdentity, context]) : field.resolvedToken;
  if (!vm.statics.has(key) && !initializeStaticFieldSlot(vm, key, field)) return null;
  return {key, field, typeToken: field.ownerToken, genericIdentity, context};
}

/** JS cooperative contexts observe ordered instruction-granularity memory access.
 * These operations therefore provide acquire/release ordering without host threads.
 */
export function volatilePrefix(frame) { frame.volatileAccess = true; }
export function finishMemoryAccess(frame) { if (frame.volatileAccess) frame.volatileAccess = false; }
