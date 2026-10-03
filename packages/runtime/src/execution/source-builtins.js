import {hasLegacyBclBuiltin,invokeLegacyBclBuiltin} from '@sharpforge/bcl-core';
import {mutateArray} from './array-ops.js';
import {Builtins} from '@sharpforge/bytecode';
import {ManagedFault,isReference} from '../heap.js';
import {internString,isInternedString,referenceEquals,stringChar} from './strings.js';
import {enumHasFlag} from './enums.js';
import {SourceBuiltinResults} from './source-values.js';
import {objectType,typeName,runtimeTypeText} from './tokens.js';

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
  return vm.legacyBclHost ??= {
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
    switch (name) {
      case 'string.Intern': return internString(vm,args[0]);
      case 'string.IsInterned': return isInternedString(vm,args[0]);
      case 'string.get_Chars': return stringChar(vm,args[0],args[1]);
      case 'object.GetType': return objectType(vm,args[0]);
      case 'Type.Name': case 'Type.FullName': {const text=typeName(vm,args[0],name==='Type.FullName');return text===null?null:vm.heap.string(text);}
      case 'object.ReferenceEquals': return referenceEquals(args[0],args[1]);
      case 'Enum.HasFlag': return enumHasFlag(vm,args[0],args[1]);
      case '$Math.Abs.Int32':
        if (a === -2147483648) throw new ManagedFault('OverflowException', 'Absolute value of Int32.MinValue is not representable');
        return Math.abs(a);
      case 'Console.WriteLine': vm.emitOutput((args.length ? vm.format(args[0]) : '') + '\n'); return null;
      case 'Console.Write': vm.emitOutput(vm.format(args[0])); return null;
      case 'GC.Collect': vm.heap.collect(); return null;
      case 'GC.GetTotalMemory':
        if (a === true) vm.heap.collect();
        return BigInt(vm.heap.stats.liveBytes);
      case 'GC.CollectionCount':
        if (!Number.isInteger(a) || a < 0 || a > 2) throw new ManagedFault('ArgumentOutOfRangeException', 'GC generation must be between 0 and 2');
        // Every collection in this non-generational heap collects all three generations.
        return vm.heap.stats.collections;
      case 'Array.Reverse': case 'Array.Sort': return mutateArray(vm,name.slice(6),args[0]);
      case 'Exception.new': return vm.heap.allocate('exception', 'Exception', [args[0]]);
      case 'Exception.Message': return vm.heap.get(args[0]).data[0];
      case 'Debug.Assert':
        if (a !== true) throw new ManagedFault('AssertionException', args.length > 1 ? vm.format(args[1]) : 'Assertion failed');
        return null;
      case 'Environment.TickCount': return Math.trunc(performance.now()) | 0;
      default: throw new ManagedFault('MissingMethodException', `Intrinsic '${name}' is not implemented`);
    }
  });
}
