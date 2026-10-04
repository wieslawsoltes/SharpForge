import {hasLegacyBclBuiltin,invokeLegacyBclBuiltin} from '@sharpforge/bcl-core';
import {Builtins} from '@sharpforge/bytecode';
import {ManagedFault,isReference} from '../heap.js';
import {SourceBuiltinResults} from './source-values.js';
import {objectType,runtimeTypeText} from './tokens.js';
import {invokeNamedBuiltin} from './source-builtins/index.js';

function legacyStringPlatform(vm) {
  // The builtin seam also supports heap/value/format services without a complete VM.
  return vm.platform ?? {
    heap: vm.heap,
    vm,
    native: value => vm.value(value),
    managed: (value, type) => type === 'string' ? vm.heap.string(value) : value,
    bclHost: {
      isReference,
      fault(type, message) {
        throw new ManagedFault(type, message);
      }
    }
  };
}

function legacyHost(vm) {
  const cache = vm.platform ?? vm;
  return cache.legacyBclHost ??= {
    platform: legacyStringPlatform(vm),
    heap: vm.heap,
    value: value => vm.value(value),
    format: value => vm.format(value),
    runtimeTypeText: value => runtimeTypeText(vm, value),
    fault: (type, message) => new ManagedFault(type, message)
  };
}

/** Invoke an intrinsic with heap/value/format/output/platform services; no image is required. */
export function builtin(vm, id, args) {
  const entry = Builtins[id];
  if (entry.contract) {
    const result=vm.platform.invoke(entry.contract,args);
    return (vm.builtinResults ??= new SourceBuiltinResults()).convert(vm, entry, result);
  }
  const name = entry.name;
  return vm.heap.withRoots(args, () => {
    if (hasLegacyBclBuiltin(name)) {
      return invokeLegacyBclBuiltin(legacyHost(vm), name, args);
    }
    const a = vm.value(args[0]);
    if(name.startsWith('$type.'))return objectType(vm,args[0],name.split('.')[1]);
    if (name.startsWith('Math.')) {
      const fn = {Abs: 'abs', Min: 'min', Max: 'max', Pow: 'pow', Sqrt: 'sqrt', Floor: 'floor', Ceiling: 'ceil', Round: 'round'}[name.slice(5)];
      if (fn === 'round') {
        const f = Math.floor(a), fraction = a - f;
        return fraction === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(a);
      }
      return Math[fn](...args);
    }
    return invokeNamedBuiltin(vm,name,args,a);
  });
}
