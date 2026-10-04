import {readExecutionSignatureAst, signatureSlotType, instancePointerLocalSignature,
  callSignatureKey, formatSignatureType} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {methodPointerSignature} from './method-pointers.js';
import {requireInstanceCalliTarget} from './instance-calli.js';

const caches = new WeakMap();
function cacheFor(vm) {
  const epoch = executionCodeState(vm);
  let cache = caches.get(epoch);
  if (!cache) caches.set(epoch, cache = {locals: new Map(), keys: new Map()});
  return cache;
}

/** Plans contain metadata only and are dropped with the code epoch, including restore. */
export function instancePointerLocalPlan(vm, frame, index) {
  if (!vm.inspector || !frame?.method?.localSignature) return null;
  const type = frame.method.locals[index];
  if (typeof type !== 'string' || !type.startsWith('method ')) return null;
  const cache = cacheFor(vm), token = frame.method.localSignature;
  if (!cache.locals.has(token)) {
    const metadata = vm.inspector.metadata;
    const ast = readExecutionSignatureAst(metadata, token);
    const plans = ast.types.map((_, slot) => {
      const node = signatureSlotType(ast, 'local', slot);
      const signature = instancePointerLocalSignature(metadata, node);
      return signature ? Object.freeze({type: formatSignatureType(node, metadata), key: callSignatureKey(signature)}) : null;
    });
    cache.locals.set(token, Object.freeze(plans));
  }
  const plan = cache.locals.get(token)[index] ?? null;
  if (plan && plan.type !== type) {
    throw new ManagedFault('InvalidProgramException', 'Typed pointer local no longer matches its metadata declaration');
  }
  return plan;
}

/** Validate provenance and exact selected signature before overwriting a local or returning its value. */
export function instancePointerLocalValue(vm, value, plan) {
  if (value === null) return null;
  const signature = methodPointerSignature(vm, value);
  const keys = cacheFor(vm).keys;
  if (!keys.has(value.token)) keys.set(value.token, callSignatureKey(signature));
  if (keys.get(value.token) !== plan.key) {
    throw new ManagedFault('InvalidProgramException', 'Managed instance function-pointer local signature mismatch');
  }
  requireInstanceCalliTarget(vm, value.token);
  return value;
}
