import assert from 'node:assert/strict';
import {managedFixture} from '../managed-fixtures.js';

const owner = 'System.Collections.Generic.HashSet`1<int>';
const integer = value => value === -2147483648 ? '(-2147483647 - 1)' : String(value);
const array = values => `new int[] {${values.map(integer).join(',')}}`;
const nameOf = step => step.operation === 'TrimExcessCapacity' ? 'TrimExcess' : step.operation;
const returns = name => name === 'Add' || name === 'Remove' ? 'bool' : name === 'EnsureCapacity' ? 'int' : 'void';

/** Adapt only the released array constructor/Union input profile; new capacity calls retain exact source signatures. */
export function hashSetCapacitySource(row) {
  const constructor = row.constructor;
  const argument = constructor.kind === 'array' ? array(constructor.items)
    : constructor.kind === 'capacity' ? integer(constructor.capacity) : '';
  const lines = [`var values = new HashSet<int>(${argument});`];
  for (const step of row.steps) {
    const name = nameOf(step);
    const argument = step.operation === 'UnionWith' ? array(step.argument)
      : Object.hasOwn(step, 'argument') ? integer(step.argument) : '';
    const expression = `values.${name}(${argument})`;
    const call = returns(name) === 'void' ? `${expression}; Console.WriteLine("null");` : `Console.WriteLine(${expression});`;
    lines.push(`try { ${call} } catch (Exception error) { Console.WriteLine(error.GetType().Name); }`);
    lines.push('Console.WriteLine(values.Capacity); Console.WriteLine(values.Count);');
  }
  return '{' + lines.join('\n') + '}';
}

/** Expected transcripts are read from an actual native capture, never recomputed from the implementation. */
export function capacityTranscript(row) {
  return row.steps.flatMap(step => [step.fault?.replace('System.', '') ??
    (step.result === null ? 'null' : typeof step.result === 'boolean' ? step.result ? 'True' : 'False' : String(step.result)),
  String(step.capacity), String(step.count)]).join('\n') + '\n';
}

/** Author ordinary CIL with genuine ctor/Add/Remove/Clear/capacity MemberRefs; no source compiler or compatibility array APIs. */
export function hashSetCapacityAssembly(row, targetIndex = row.steps.length - 1) {
  const owner = `System.Collections.Generic.HashSet\`1<${row.element ?? 'int'}>`;
  assert(['empty', 'capacity', 'null'].includes(row.constructor.kind));
  assert(row.steps.every(step => step.operation !== 'UnionWith'));
  return managedFixture({name: 'HashSetCapacity', fields: [
    {name: 'Set', type: owner}, {name: 'Result', type: 'int'}, {name: 'Capacity', type: 'int'}, {name: 'Count', type: 'int'}
  ], methods: [{name: 'Main', result: 'void', maxStack: 2, body(writer, context) {
    const set = 0x04000000 | context.fields.Set;
    const member = (name, result, parameters = []) => context.member(owner, name, result, parameters, false);
    if (row.constructor.kind === 'null') writer.op('ldnull');
    else if (row.constructor.kind === 'capacity') {
      writer.op('ldc.i4', row.constructor.capacity).op('newobj', member('.ctor', 'void', ['int']));
    } else writer.op('newobj', member('.ctor', 'void'));
    writer.op('stsfld', set);
    for (let index = 0; index <= targetIndex; index++) {
      const step = row.steps[index];
      // Earlier rejected range checks had no state effects; test each rejection independently as the final call.
      if (index !== targetIndex && step.fault) continue;
      const name = nameOf(step);
      const parameters = Object.hasOwn(step, 'argument') ? ['int'] : [];
      writer.op('ldsfld', set);
      if (parameters.length) writer.op('ldc.i4', step.argument);
      writer.op('callvirt', member(name, returns(name), parameters));
      if (returns(name) !== 'void') {
        if (index === targetIndex && returns(name) === 'int') writer.op('stsfld', 0x04000000 | context.fields.Result);
        else writer.op('pop');
      }
    }
    for (const property of ['Capacity', 'Count']) {
      writer.op('ldsfld', set).op('callvirt', member('get_' + property, 'int'))
        .op('stsfld', 0x04000000 | context.fields[property]);
    }
    writer.op('ret');
  }}]});
}

/** A standalone CIL property load proves the null Capacity receiver independently of source lowering. */
export function nullHashSetCapacityAssembly() {
  return managedFixture({methods: [{name: 'Main', result: 'int', maxStack: 1, body(writer, context) {
    writer.op('ldnull').op('callvirt', context.member(owner, 'get_Capacity', 'int', [], false)).op('ret');
  }}]});
}
