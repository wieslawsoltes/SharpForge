import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {hashSetValues} from '@sharpforge/bcl-collections';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

export const elementNames = Object.freeze({
  'System.Int32': 'int', 'System.Double': 'double', 'System.Boolean': 'bool', 'System.String': 'string', 'System.Object': 'object'
});
const nativeNames = Object.fromEntries(Object.entries(elementNames).map(([name, alias]) => [alias, name]));
let emptyProgram;

function managedItem(platform, item, element) {
  if (item === null || item?.type === 'null') return null;
  if (typeof item !== 'object') return platform.managed(item, element);
  const type = elementNames[item.type];
  assert(type, `Unknown captured value type ${item.type}`);
  const value = platform.managed(item.value, type);
  return element === 'object' && type !== 'string' ? platform.heap.allocate('box', type, [value]) : value;
}

/** Root every fixture-owned object across unrelated setup allocations and observer-triggered collection. */
export function createCapacityHost(engine, {element = 'int', constructor = {kind: 'empty'}} = {}) {
  emptyProgram ??= compileToIL('class Program { static void Main() {} }', {pipeline: 'legacy'});
  assert.equal(emptyProgram.success, true, JSON.stringify(emptyProgram.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(emptyProgram.image) : new CilVirtualMachine(emptyProgram.assembly);
  const platform = vm.platform;
  const owner = `System.Collections.Generic.HashSet\`1<${element}>`;
  const handles = [];
  const root = value => { handles.push(platform.heap.createHandle(value)); return value; };
  const member = (name, parameters) => {
    const matches = findContracts(owner, name).filter(row => row.parameters.join(',') === parameters.join(','));
    assert.equal(matches.length, 1, `${owner}.${name}(${parameters.join(',')}) must be unambiguous`);
    return matches[0];
  };
  const parameters = constructor.kind === 'capacity' ? ['int'] : constructor.kind === 'array' ? [element + '[]'] : [];
  let argument;
  if (constructor.kind === 'capacity') argument = constructor.capacity;
  if (constructor.kind === 'array') {
    const values = constructor.items.map(item => root(managedItem(platform, item, element)));
    argument = root(platform.heap.allocate('array', element + '[]', values));
  }
  const reference = root(platform.invoke(member('.ctor', parameters), parameters.length ? [argument] : []));
  return {vm, platform, owner, element, reference, root, member,
    call(name, ...values) {
      const matches = findContracts(owner, name).filter(row => row.parameters.length === values.length);
      assert.equal(matches.length, 1, `${owner}.${name}/${values.length} must be unambiguous`);
      return platform.invoke(matches[0], [reference, ...values]);
    },
    stop() { for (const handle of handles) platform.heap.releaseHandle(handle); vm.stop(); }};
}

/** Preserve type annotations when comparing object boxes with the independent native fixture. */
export function describeCapacityValue(host, value, typed = false) {
  const {platform, element} = host;
  if (!typed) return platform.native(value);
  if (value === null) return {type: 'null', value: null};
  const record = platform.bclHost.isReference(value) ? platform.heap.get(value) : null;
  const type = record?.methodTable.name ?? nativeNames[element];
  const native = platform.native(record?.kind === 'box' ? record.data[0] : value);
  return {type, value: type === 'System.Boolean' ? Boolean(native) : native};
}

export function capacityState(host, typed = false) {
  return {capacity: host.call('get_Capacity'), count: host.call('get_Count'),
    values: [...hashSetValues(host.platform, host.reference)].map(value => describeCapacityValue(host, value, typed))};
}

export function capacityIterator(host) {
  const reference = host.root(host.call('GetEnumerator'));
  const owner = host.platform.record(reference).type;
  return name => host.platform.invoke(findContracts(owner, name)[0], [reference]);
}

export function observeCapacityIterator(host, iterator, typed = false) {
  try {
    const moved = Boolean(host.platform.native(iterator('MoveNext')));
    return {moved, current: moved ? describeCapacityValue(host, iterator('get_Current'), typed) : null, fault: null};
  } catch (error) {
    return {moved: false, current: null, fault: 'System.' + error.name};
  } finally { iterator('Dispose'); }
}

export function invokeCapacityStep(host, step) {
  let argumentsList = Object.hasOwn(step, 'argument') ? [step.argument] : [];
  if (step.operation === 'UnionWith') {
    argumentsList = [host.root(host.platform.heap.allocate('array', host.element + '[]', step.argument))];
  }
  const name = step.operation === 'TrimExcessCapacity' ? 'TrimExcess' : step.operation;
  const value = host.call(name, ...argumentsList);
  return name === 'Add' || name === 'Remove' ? Boolean(host.platform.native(value)) : host.platform.native(value);
}
