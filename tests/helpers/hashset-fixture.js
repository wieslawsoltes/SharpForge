import assert from 'node:assert/strict';
import {managedFixture} from '../managed-fixtures.js';

/** Adapt only unavailable source APIs; retain the native program and expected output verbatim. */
export function supportedHashSetSource(source) {
  assert.equal(source.split('double.NaN').length, 4, 'Adapt exactly three unavailable NaN field references');
  const join = 'Console.WriteLine(string.Join(",", numbers.ToArray()));';
  assert.equal(source.split(join).length, 2, 'Adapt exactly one unavailable generic Double Join');
  return source.replaceAll('double.NaN', '(0.0 / 0.0)').replace(join,
    'var remainingNumbers = numbers.ToArray(); Console.WriteLine(remainingNumbers[0] + "," + remainingNumbers[1]);');
}

/** Ordinary CIL directly loads NaN/zero operands and returns the final managed Double array. */
export function hashSetNaNAssembly() {
  const owner = 'System.Collections.Generic.HashSet`1<double>';
  return managedFixture({methods: [{
    name: 'Main', result: 'double[]', locals: [owner], maxStack: 2,
    body(writer, context) {
      const member = (name, result, parameters = []) => context.member(owner, name, result, parameters, false);
      const print = type => writer.op('call', context.member('System.Console', 'WriteLine', 'void', [type]));
      writer.op('newobj', member('.ctor', 'void')).op('stloc.0');
      for (const value of [NaN, -0, 0, NaN, 1]) {
        writer.op('ldloc.0').op('ldc.r8', value).op('callvirt', member('Add', 'bool', ['double'])).op('pop');
      }
      writer.op('ldloc.0').op('callvirt', member('get_Count', 'int'));
      print('int');
      for (const [name, value] of [['Remove', NaN], ['Contains', 0], ['Remove', -0]]) {
        writer.op('ldloc.0').op('ldc.r8', value).op('callvirt', member(name, 'bool', ['double']));
        print('bool');
      }
      writer.op('ldloc.0').op('ldc.r8', 2).op('callvirt', member('Add', 'bool', ['double'])).op('pop');
      writer.op('ldloc.0').op('callvirt', member('ToArray', 'double[]')).op('ret');
    }
  }]});
}

/** Let an invalid capacity fault escape the VM so the test can assert its exact managed type. */
export function invalidHashSetCapacityAssembly() {
  const owner = 'System.Collections.Generic.HashSet`1<int>';
  return managedFixture({methods: [{
    name: 'Main', result: owner, maxStack: 1,
    body(writer, context) {
      writer.op('ldc.i4', -1).op('newobj', context.member(owner, '.ctor', 'void', ['int'], false)).op('ret');
    }
  }]});
}
