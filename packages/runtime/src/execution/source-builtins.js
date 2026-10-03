import {mutateArray} from './array-ops.js';
import {Builtins} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {internString,isInternedString,referenceEquals,stringChar} from './strings.js';
import {enumHasFlag,enumInfo,enumValue} from './enums.js';
import {objectType,typeName,runtimeTypeText} from './tokens.js';

/** Invoke an intrinsic with heap/value/format/output/platform services; no image is required. */
export function builtin(vm, id, args) {
  const entry = Builtins[id];
  if (entry.contract) {
    const result=vm.platform.invoke(entry.contract,args);
    return enumInfo(vm,entry.contract.result)?enumValue(vm,entry.contract.result,result):result;
  }
  const name = entry.name;
  return vm.heap.withRoots(args, () => {
    const a = vm.value(args[0]), b = vm.value(args[1]), c = vm.value(args[2]);
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
      case 'int.Parse': {
        const s = String(a ?? '').trim();
        if (!/^[+-]?\d+$/.test(s)) throw new ManagedFault('FormatException', 'Input string was not in a correct format');
        const value = Number(s);
        if (value < -2147483648 || value > 2147483647) throw new ManagedFault('OverflowException', 'Value is outside the Int32 range');
        return value | 0;
      }
      case 'double.Parse': {
        const s = String(a ?? '').trim();
        if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) throw new ManagedFault('FormatException', 'Invalid floating-point input');
        return Number(s);
      }
      case 'Convert.ToInt32': {
        const v = Number(a), f = Math.floor(v), fraction = v - f, n = fraction === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(v);
        if (!Number.isFinite(n) || n < -2147483648 || n > 2147483647) throw new ManagedFault('OverflowException', 'Value is outside the Int32 range');
        return n | 0;
      }
      case 'Convert.ToDouble': {
        const v = Number(a);
        if (Number.isNaN(v)) throw new ManagedFault('FormatException', 'Cannot convert value to double');
        return v;
      }
      case 'Convert.ToString': case 'object.ToString': return vm.heap.string(runtimeTypeText(vm,args[0])??vm.format(args[0]));
      case 'string.Concat': return vm.heap.string(vm.format(args[0]) + vm.format(args[1]));
      case 'string.IsNullOrEmpty': return a === null || a === '';
      case 'Array.Reverse': case 'Array.Sort': return mutateArray(vm,name.slice(6),args[0]);
      case 'string.Substring':
        if (typeof a !== 'string') throw new ManagedFault('NullReferenceException', 'String is null');
        if (!Number.isInteger(b) || b < 0 || b > a.length || args.length === 3 && (!Number.isInteger(c) || c < 0 || b + c > a.length)) {
          throw new ManagedFault('ArgumentOutOfRangeException', 'Substring range is outside the string');
        }
        return vm.heap.string(args.length === 3 ? a.slice(b, b + c) : a.slice(b));
      case 'string.Contains': case 'string.IndexOf': case 'string.StartsWith': case 'string.EndsWith': {
        if (typeof a !== 'string') throw new ManagedFault('NullReferenceException', 'String is null');
        if (b === null) throw new ManagedFault('ArgumentNullException', 'Value is null');
        const method = {Contains: 'includes', IndexOf: 'indexOf', StartsWith: 'startsWith', EndsWith: 'endsWith'}[name.slice(7)];
        return a[method](b);
      }
      case 'string.ToUpper': case 'string.ToLower': case 'string.Trim':
        if (typeof a !== 'string') throw new ManagedFault('NullReferenceException', 'String is null');
        return vm.heap.string(a[{ToUpper: 'toUpperCase', ToLower: 'toLowerCase', Trim: 'trim'}[name.slice(7)]]());
      case 'string.Replace':
        if (typeof a !== 'string') throw new ManagedFault('NullReferenceException', 'String is null');
        if (b === null || b === '') throw new ManagedFault('ArgumentException', 'Old value cannot be null or empty');
        return vm.heap.string(a.split(b).join(c ?? ''));
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
