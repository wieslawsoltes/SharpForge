import {frameworkType} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {delegateBindingMode} from '../execution/delegate-targets.js';

const marker = /^SharpForge\.<>Delegate\{(.+)\}$/;
const equalReference = (a, b) => a === b || isReference(a) && isReference(b) && a.h === b.h && a.g === b.g;

/** Serialized compiler delegate records must match their closed contract and emitted field/signature shape. */
export function loweredDelegateInfo(context, reference) {
  const {heap, vm} = context.platform, record = heap.get(reference);
  if (record.kind !== 'object') return null;
  const match = marker.exec(record.type);
  if (!match) return null;
  let contractName;
  try { contractName = decodeURIComponent(match[1]); } catch { return null; }
  const type = vm.image?.types.find(type => type.name === record.type);
  const members = context.bindingServices.members.types.get(record.type);
  if (!members) return null;
  const fields = [...members.fields.values()].filter(field => !field.isStatic);
  const method = fields.find(field => field.name === 'method'), next = fields.find(field => field.name === 'next');
  const sameType = (left, right) => heap.methodTables.get(left) === heap.methodTables.get(right);
  if (!method || !next || !sameType(method.type, 'int') || next.type !== record.type) return null;
  const contract = frameworkType(contractName);
  const count = contract?.kind === 'delegate' ? contract.parameters.length
    : type?.delegateInvoke != null ? vm.image.methods[type.delegateInvoke]?.parameters.length - 1 : null;
  if (!Number.isSafeInteger(count) || count < 0) return null;
  const invoke = context.bindingServices.members.method(record.type, 'Invoke', count + 1, {staticOnly: true});
  if (!invoke || invoke.parameters[0] !== record.type) return null;
  if (type && (type.delegateContract !== contractName || type.delegateInvoke !== invoke.id)) return null;
  if (!type && (!contract || contract.kind !== 'delegate')) return null;
  if (contract && (!sameType(invoke.returnType, contract.result) ||
    contract.parameters.some((parameter, index) => !sameType(parameter, invoke.parameters[index + 1])))) return null;
  return {invoke, contractName, fields};
}

/** Method-group unsubscribe compares immutable capture records by target and method, never by wrapper allocation. */
export function managedDelegatesEqual(platform, left, right) {
  const pending = [[left, right]], seen = new Set();
  while (pending.length) {
    if (seen.size >= 4096) throw new ManagedFault('ExecutionLimitException', 'Delegate comparison depth limit');
    const [a, b] = pending.pop();
    if (equalReference(a, b)) continue;
    if (!isReference(a) || !isReference(b)) return false;
    const key = `${a.h}:${a.g}/${b.h}:${b.g}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = platform.heap.get(a), y = platform.heap.get(b);
    if (x.type !== y.type || x.kind !== y.kind) return false;
    if (x.kind === 'delegate') {
      const method = platform.get(a, 'method');
      if (method !== platform.get(b, 'method')) return false;
      if (method >= 0 && delegateBindingMode(platform.vm, a, method) !== delegateBindingMode(platform.vm, b, method)) return false;
      const first = platform.get(a, 'receiver'), second = platform.get(b, 'receiver');
      if (!equalReference(first, second)) {
        if (!first || !second || !loweredDelegateInfo(platform.ui, first) || !loweredDelegateInfo(platform.ui, second)) return false;
        pending.push([first, second]);
      }
      continue;
    }
    const info = loweredDelegateInfo(platform.ui, a);
    if (!info || !loweredDelegateInfo(platform.ui, b)) return false;
    for (const field of info.fields) {
      const index = field.index ?? platform.vm.field(field.token, a).index;
      const first = x.data[index], second = y.data[index];
      if (field.name === 'next') pending.push([first, second]);
      else if (!equalReference(first, second)) return false;
    }
  }
  return true;
}
