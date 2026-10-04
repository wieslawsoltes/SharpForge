import {invokeSynchronization} from './sync-primitives.js';
import {sourceExceptionBuiltin} from './source-exception-builtins.js';
import {hasLegacyBclBuiltin,invokeLegacyBclBuiltin} from '@sharpforge/bcl-core';
import {Builtins} from '@sharpforge/bytecode';
import {ManagedFault,isReference} from '../heap.js';
import {SourceBuiltinResults} from './source-values.js';
import {objectType,runtimeTypeText} from './tokens.js';
import {invokeNamedBuiltin} from './source-builtins/index.js';
import {invokeDecimal} from './decimal-intrinsics.js';
import {invokeIntrinsic} from './intrinsics.js';
import {floatingNumberExtremum} from './float-extrema.js';
import {sourceArrayBuiltin} from './source-array-builtins.js';
import {sourceVarargsBuiltin} from './source-varargs.js';
import {sourceObjectBuiltin} from './source-object-builtins.js';

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
    if (['object.ToString', 'object.Equals', 'object.GetHashCode'].includes(name)) return sourceObjectBuiltin(vm, name, args);
    if (entry.numeric) return invokeIntrinsic(vm, entry.numeric, args);
    if (entry.exceptionRuntime) return sourceExceptionBuiltin(vm, entry.exceptionRuntime, args);
    if (entry.synchronization) return invokeSynchronization(vm, entry.synchronization, args).value;
    if (entry.varargs) return sourceVarargsBuiltin(vm, entry.varargs, args);
    if (entry.arrayRuntime) return sourceArrayBuiltin(vm, entry, args);
    if (entry.math) return invokeIntrinsic(vm, entry.math, args);
    if (entry.decimal) return invokeDecimal(vm, entry.decimal, args).value;
    if (hasLegacyBclBuiltin(name)) {
      return invokeLegacyBclBuiltin(legacyHost(vm), name, args);
    }
    const a = vm.value(args[0]);
    if(name.startsWith('$type.'))return objectType(vm,args[0],name.split('.')[1]);
    if (name.startsWith('Math.')) {
      const fn = {Abs: 'abs', Min: 'min', Max: 'max', Pow: 'pow', Sqrt: 'sqrt', Floor: 'floor', Ceiling: 'ceil', Round: 'round'}[name.slice(5)];
      if (fn === 'min' || fn === 'max') {
        const b = vm.value(args[1]);
        return typeof a === 'number' && typeof b === 'number'
          ? floatingNumberExtremum(name.slice(5), a, b) : Math[fn](a, b);
      }
      if (fn === 'round') {
        const f = Math.floor(a), fraction = a - f;
        return fraction === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(a);
      }
      return Math[fn](...args);
    }
    return invokeNamedBuiltin(vm,name,args,a);
  });
}
