import {findContracts, frameworkAssignable, frameworkType, propertiesFor, XAML} from '@sharpforge/framework';
import {isReference, ManagedFault} from './heap.js';

const attachedNames = new Set(['Left', 'Top', 'ZIndex', 'Row', 'Column', 'RowSpan', 'ColumnSpan', 'WrapRowSpan', 'WrapColumnSpan']);

function invalid(message) {
  throw new ManagedFault('InvalidOperationException', message);
}

function attachedType(contract) {
  return contract.kind === 'attachedSet' ? contract.parameters[1] : contract.result;
}

function attachedDefault(contract) {
  return contract.property.endsWith('Span') ? 1 : 0;
}

function requireAttachedTarget(platform, reference, contract) {
  if (!isReference(reference)) invalid('An attached property requires a managed visual target.');
  const record = platform.record(reference);
  platform.attachedTargets ??= new WeakMap();
  let targets = platform.attachedTargets.get(record);
  const target = contract.parameters[0];
  if (targets?.has(target)) return;
  if (!frameworkAssignable(target, record.type)) invalid(`Attached property ${contract.owner}.${contract.property} is not applicable to this target.`);
  if (!targets) platform.attachedTargets.set(record, targets = new Set());
  targets.add(target);
}

function boxedValue(platform, value, type) {
  const kind = frameworkType(type)?.kind;
  if (!platform.vm.inspector || !(['value', 'enum'].includes(kind) || ['int', 'double', 'bool'].includes(type))) return value;
  return platform.heap.withRoots([value], () => platform.heap.allocate('box', type, [value]));
}

/** Convert a boxed dependency value to the storage representation used by the selected engine. */
export function unbox(platform, value, type) {
  if (isReference(value) && platform.heap.get(value).kind === 'box') value = platform.heap.get(value).data[0];
  return type === 'double' && typeof value === 'number' ? platform.managed(value, 'double') : value;
}

/** Reject foreign handles before reading dependency property metadata. */
export function propertyName(platform, dependency) {
  if (!isReference(dependency) || platform.heap.get(dependency).type !== XAML + 'DependencyProperty') {
    invalid('A registered DependencyProperty is required.');
  }
  return platform.native(platform.get(dependency, 'Name'));
}

function isLocal(platform, reference, property, storage) {
  const marker = platform.get(reference, '$local:' + property);
  return marker === null ? platform.propertyIndex(platform.record(reference)).has(storage) : !!platform.native(marker);
}

/** Legacy attached slots remain readable; an explicit false local marker represents ClearValue. */
export function attachedStorageName(key) {
  const name = key.startsWith('$') ? key.slice(1) : null;
  return attachedNames.has(name) ? name : null;
}

/** Explicit false markers win over retained default slots and old snapshot storage. */
export function hasAttachedLocalValue(platform, reference, property) {
  return isLocal(platform, reference, property, '$' + property);
}

/** Public attached getters and DependencyObject.GetValue share the declared owner's storage contract. */
export function getAttachedProperty(platform, reference, contract) {
  requireAttachedTarget(platform, reference, contract);
  return platform.get(reference, '$' + contract.property, platform.managed(attachedDefault(contract), attachedType(contract)));
}

/** Validation completes before either a value or its local-state marker changes. */
export function setAttachedProperty(platform, reference, contract, value) {
  requireAttachedTarget(platform, reference, contract);
  const type = attachedType(contract);
  value = unbox(platform, value, type);
  const number = platform.native(value);
  const integer = type === 'int';
  if (typeof number !== 'number' || !Number.isFinite(number)
    || integer && (!Number.isInteger(number) || number < -2147483648 || number > 2147483647)
    || ['Row', 'Column'].includes(contract.property) && number < 0
    || contract.property.endsWith('Span') && number < 1) {
    throw new ManagedFault('ArgumentOutOfRangeException', `Invalid attached layout value for ${contract.owner}.${contract.property}.`);
  }
  platform.set(reference, '$' + contract.property, platform.managed(number, type));
  if (platform.get(reference, '$local:' + contract.property) !== true) platform.set(reference, '$local:' + contract.property, true);
  platform.command({op: 'set', id: `${reference.h}:${reference.g}`, property: contract.property, value: number});
  return null;
}

function clearAttachedProperty(platform, reference, contract) {
  requireAttachedTarget(platform, reference, contract);
  if (!hasAttachedLocalValue(platform, reference, contract.property)) return null;
  const value = attachedDefault(contract);
  platform.set(reference, '$' + contract.property, platform.managed(value, attachedType(contract)));
  platform.set(reference, '$local:' + contract.property, false);
  platform.command({op: 'set', id: `${reference.h}:${reference.g}`, property: contract.property, value});
  return null;
}

function dependencyProperty(platform, reference, dependency) {
  const name = propertyName(platform, dependency);
  const owner = platform.native(platform.get(dependency, 'Owner'));
  const contract = findContracts(owner, 'Set' + name, true).find(member => member.owner === owner && member.kind === 'attachedSet');
  if (contract) {
    requireAttachedTarget(platform, reference, contract);
    return {name: contract.property, type: contract.parameters[1], contract, storage: '$' + contract.property};
  }
  const property = propertiesFor(platform.record(reference).type)[name];
  if (!property || !frameworkAssignable(owner, platform.record(reference).type)) invalid('Dependency property is not applicable to this target.');
  return {name, type: property.type, storage: name};
}

/** Resolve by declaring owner before dispatch; equal Grid and wrap member names never alias. */
export function invokeDependencyProperty(platform, descriptor, args, clearProperty) {
  const reference = args[0];
  const property = dependencyProperty(platform, reference, args[1]);
  const {name, type, contract, storage} = property;
  if (descriptor.name === 'GetValue') {
    const value = contract ? getAttachedProperty(platform, reference, contract) : platform.get(reference, name);
    return boxedValue(platform, value, type);
  }
  if (descriptor.name === 'ReadLocalValue') {
    const local = contract ? hasAttachedLocalValue(platform, reference, name) : platform.get(reference, '$local:' + name);
    if (!local) return platform.unsetValue();
    const animated = platform.animations.bases.has(platform.animations.key(reference, storage));
    const value = animated ? platform.managed(platform.animations.getBase(reference, storage), type) : platform.get(reference, storage);
    return boxedValue(platform, value, type);
  }
  if (descriptor.name === 'ClearValue') {
    if (contract) return clearAttachedProperty(platform, reference, contract);
    clearProperty(platform, reference, name);
    return null;
  }
  const value = unbox(platform, args[2], type);
  return contract ? setAttachedProperty(platform, reference, contract, value)
    : platform.setProperty(reference, {owner: platform.record(reference).type, property: name}, value);
}
