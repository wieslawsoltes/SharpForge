import {asyncTypes, asyncValueType} from '@sharpforge/cil';

/** Runtime identities for the bounded Task ABI; instances still use canonical value storage. */
export function asyncTypeTable(name, nativeIntBits) {
  if ([asyncTypes.machine, asyncTypes.notify, asyncTypes.critical].includes(name)) {
    return {flags: {interface: true}, interfaces: name === asyncTypes.critical ? [asyncTypes.notify] : []};
  }
  if (name === asyncTypes.task || name === asyncTypes.task + '`1') {
    return {base: name === asyncTypes.task ? 'System.Object' : asyncTypes.task, variance: name.endsWith('`1') ? [0] : []};
  }
  const value = asyncValueType(name);
  if (!value) return null;
  const task = value.element === null ? asyncTypes.task : asyncTypes.task + '`1<' + value.element + '>';
  const fields = ['builder', 'awaiter'].includes(value.kind) ? [{name: '$task', type: task}] : [];
  const interfaces = ['awaiter', 'yieldAwaiter'].includes(value.kind) ? [asyncTypes.critical] : [];
  return {base: 'System.ValueType', flags: {valueType: true, sealed: true, asyncValue: value.kind},
    fields, interfaces, valueSize: fields.length ? nativeIntBits / 8 : 1};
}
