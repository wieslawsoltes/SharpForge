import {checkedUICast, isUIInstance, boxUIValue} from './checked-casts.js';
import {invokeManagedMethod} from './callbacks.js';
import {initializeFrameworkBase} from './object-storage.js';
import {convertUINumeric} from './numeric-values.js';
import {ManagedFault, isReference} from '../heap.js';

/** Resolve an application-declared callback by exact virtual slot or an unambiguous name and arity. */
export function resolveManagedUIMethod(context, receiver, slot, count) {
  if (!isReference(receiver)) throw new ManagedFault('ArgumentException', 'A managed callback receiver is required');
  const vm = context.platform.vm;
  let table = vm.heap.get(receiver).methodTable;
  const visited = new Set();
  const exactSlot = slot.includes('(');
  const name = exactSlot ? slot.slice(0, slot.indexOf('(')) : slot;
  while (table && visited.size < 256 && !visited.has(table)) {
    visited.add(table);
    const methods = vm.inspector ? vm.inspector.types.find(type => type.name === table.name)?.methods ?? []
      : vm.image.methods.filter(method => method.owner === table.name);
    const candidates = methods.filter(method => {
      const signature = vm.inspector ? vm.inspector.signature(method.token) : method;
      const parameters = signature.parameters;
      if (signature.isStatic || method.name !== name || parameters.length !== count) return false;
      const identity = method.virtualSlot ?? method.name + '(' + parameters.map(parameter => parameter.type ?? parameter).join(',') + ')';
      return !exactSlot || identity === slot;
    });
    if (candidates.length > 1) throw new ManagedFault('AmbiguousMatchException', 'The UI callback requires an exact method slot');
    if (candidates.length) return vm.inspector
      ? {...candidates[0], signature: vm.inspector.signature(candidates[0].token)} : candidates[0];
    table = table.base;
  }
  return null;
}

export function invokeManagedVirtual(context, receiver, slot, args = []) {
  const method = resolveManagedUIMethod(context, receiver, slot, args.length);
  if (!method) return null;
  const signature = method.signature ?? method;
  const values = [];
  return context.platform.heap.withRoots([receiver], () => {
    for (const [index, value] of args.entries()) {
      const parameter = signature.parameters[index];
      const type = parameter.type ?? parameter;
      const boxedValue = isReference(value) && context.platform.heap.get(value).kind === 'box'
        && context.platform.heap.methodTables.get(type).flags.valueType;
      const managed = context.managed(boxedValue ? context.properties.toNative(value, type) : value, type);
      values.push(managed);
      context.platform.heap.pins.push(managed);
    }
    return invokeManagedMethod(context.platform, method.token ?? method.id, receiver, values);
  });
}

/** Compiler-generated UI casts use the same checked method-table identity as direct CIL. */
export function registerManagedUIRuntimeAdapters(registry) {
  registry.register({owner: 'SharpForge.UI.Runtime', name: 'TypeOf'}, ({context, args}) => context.typeValue(context.native(args[0])));
  const owner = 'SharpForge.UI.Runtime';
  registry.register({owner, name: 'ConvertNumeric', arity: 4}, ({context, args}) =>
    convertUINumeric(context, args[0], context.native(args[1]), context.native(args[2]), !!context.native(args[3])));
  registry.register({owner, name: 'Box', arity: 2}, ({context, args}) => boxUIValue(context, args[0], context.native(args[1])));
  registry.register({owner, name: 'RequireNullableValue', arity: 1}, ({args}) => {
    if (args[0] === null) throw new ManagedFault('InvalidOperationException', 'Nullable object must have a value.');
  });
  registry.register({owner, name: 'IsInstance', arity: 2}, ({context, args}) =>
    isUIInstance(context, args[0], context.native(args[1])));
  registry.register({owner, name: 'Cast', arity: 2}, ({context, args}) =>
    checkedUICast(context, args[0], context.native(args[1])));
  registry.register({owner, name: 'InvokeVirtual', arity: 3}, ({context, args}) =>
    invokeManagedVirtual(context, args[0], context.native(args[1]), context.items(args[2])));
  registry.register({owner, name: 'InitializeFrameworkBase', arity: 3}, ({context, args}) =>
    initializeFrameworkBase(context, args[0], context.native(args[1]), context.items(args[2])));
}
