import {sourceVarargsBuiltin} from './source-varargs.js';
import {sourceExceptionBuiltin} from './source-exception-builtins.js';
import {createException, exceptionField} from './exception-object.js';
import {sourceArrayBuiltin} from './source-array-builtins.js';
import {invokeNumericIntrinsic} from './numeric-intrinsics.js';
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

function legacyHost(vm, formatType = null) {
  const cache = vm.platform ?? vm;
  cache.legacyBclHosts ??= new Map();
  if (!cache.legacyBclHosts.has(formatType)) cache.legacyBclHosts.set(formatType, {
    platform: legacyStringPlatform(vm),
    heap: vm.heap,
    value: value => vm.value(value),
    format: value => vm.format(value, formatType),
    runtimeTypeText: value => runtimeTypeText(vm, value),
    fault: (type, message) => new ManagedFault(type, message)
  });
  return cache.legacyBclHosts.get(formatType);
}

/** Invoke an intrinsic with heap/value/format/output/platform services; no image is required. */
export function builtin(vm, id, args,types=[]) {
  const entry = Builtins[id];
  if(entry.varargsRuntime)return sourceVarargsBuiltin(vm,entry.varargsRuntime,args);
  if (entry.exceptionRuntime) return sourceExceptionBuiltin(vm, entry.exceptionRuntime, args);
  if(entry.arrayRuntime)return vm.heap.withRoots(args,()=>sourceArrayBuiltin(vm,entry,args,types));
  if(entry.numeric)return vm.heap.withRoots(args,()=>invokeNumericIntrinsic(vm,entry.numeric,args).value);
  if(entry.synchronization)return vm.heap.withRoots(args,()=>vm.sync.invoke(entry.synchronization,args).value);
  if (entry.contract) {
    const result=vm.platform.invoke(entry.contract,args);
    return (vm.builtinResults ??= new SourceBuiltinResults()).convert(vm, entry, result);
  }
  const name = entry.name;
  return vm.heap.withRoots(args, () => {
    if (hasLegacyBclBuiltin(name)) {
      const formatType = name === 'object.ToString' || name === 'Convert.ToString' ? types[0] ?? null : null;
      return invokeLegacyBclBuiltin(legacyHost(vm, formatType), name, args);
    }
    const a = vm.value(args[0]);
    if(name.startsWith('$type.'))return objectType(vm,args[0],name.split('.')[1]);
    if (name.startsWith('Math.')) {
      const type=entry.result==='numeric'?(types.includes('double')?'double':types.includes('float')?'float':types.includes('long')?'long':types.length?'int':'double'):entry.result;
      return invokeNumericIntrinsic(vm,{owner:'System.Math',name:name.slice(5),parameters:types,returnType:type,isStatic:true},args).value;
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
      case 'Console.WriteLine': vm.emitOutput((args.length ? vm.format(args[0],types[0]) : '') + '\n'); return null;
      case 'Console.Write': vm.emitOutput(vm.format(args[0],types[0])); return null;
      case 'GC.Collect': vm.heap.collect(); return null;
      case 'GC.GetTotalMemory':
        if (a === true) vm.heap.collect();
        return BigInt(vm.heap.stats.liveBytes);
      case 'GC.CollectionCount':
        if (!Number.isInteger(a) || a < 0 || a > 2) throw new ManagedFault('ArgumentOutOfRangeException', 'GC generation must be between 0 and 2');
        // Every collection in this non-generational heap collects all three generations.
        return vm.heap.stats.collections;
      case 'Array.Reverse': case 'Array.Sort': return mutateArray(vm,name.slice(6),args[0]);
      case 'Exception.new': return createException(vm, 'Exception', args[0]);
      case 'Exception.Message': return exceptionField(vm, args[0], 'Message');
      case 'Debug.Assert':
        if (a !== true) throw new ManagedFault('AssertionException', args.length > 1 ? vm.format(args[1]) : 'Assertion failed');
        return null;
      case 'Environment.TickCount': return Math.trunc(performance.now()) | 0;
      default: throw new ManagedFault('MissingMethodException', `Intrinsic '${name}' is not implemented`);
    }
  });
}
