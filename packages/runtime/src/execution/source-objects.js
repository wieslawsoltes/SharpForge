import {primitiveTypeName} from './method-table.js';
import {defaultValue} from './source-ops.js';

/** Allocate every inherited instance slot before either base or derived field initializers execute. */
export function createSourceObject(vm, typeId) {
  const type = vm.image.types[typeId];
  const table = vm.heap.methodTables.get(type.name);
  return vm.heap.object(type.name, table.fields.map(field => defaultValue(primitiveTypeName(field.type.name), vm)));
}
