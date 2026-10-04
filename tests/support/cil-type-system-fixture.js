import {AssemblyInspector} from '@sharpforge/cil';
import {ManagedHeap} from '@sharpforge/runtime';
import {CilTypeSystem} from '../../packages/runtime/src/execution/type-system.js';
import {genericCallFixture} from './generic-call-fixture.js';

/** Real CLI metadata supplies the full inspector contract used by dispatch and field indexes. */
export function cilTypeSystemFixture() {
  const bytes = genericCallFixture([
    {name: 'Example.Interface', flags: 0xa1, interface: true, methods: []},
    {name: 'Example.Base', fields: [{name: 'BaseValue', type: 'int'}], methods: []},
    {name: 'Example.Derived', base: 'Example.Base', interfaces: ['Example.Interface'],
      fields: [{name: 'DerivedValue', type: 'int'}], methods: []},
    {name: 'Example.Unrelated', fields: [{name: 'OtherValue', type: 'int'}], methods: []},
    {name: 'Program', methods: [{name: 'Main', body: writer => writer.op('ret')}]}
  ]);
  const inspector = new AssemblyInspector(bytes);
  const base = inspector.types.find(type => type.name === 'Example.Base');
  const derived = inspector.types.find(type => type.name === 'Example.Derived');
  const vm = {heap: new ManagedHeap(), inspector};
  return {vm, base, derived, system: new CilTypeSystem(vm)};
}
