import {invokeDecimal} from './decimal-intrinsics.js';
import {unsignedMathExtremum, smallMathExtremum} from './math-extrema.js';
import {valueIntrinsicHandler} from './value-intrinsics.js';
import {invokeBitConverter} from './bit-converter.js';
import {nativeSize} from './native-int.js';
import {invokeLegacyBclBuiltin} from '@sharpforge/bcl-core';
import {mutateArray} from './array-ops.js';
import {intrinsicDefinition,intrinsicDefinitions} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {float} from './numeric-ops.js';
import {internString,isInternedString,referenceEquals,stringChar,stringFromChars} from './strings.js';
import {enumToString,enumHasFlag} from './enums.js';
import {objectType,typeFromHandle,typeEquals,typeName,typeHandle,typeProperty,runtimeTypeText} from './tokens.js';

function legacyHost(vm, formatType = null) {
  const cache = vm.platform;
  cache.legacyBclHosts ??= new Map();
  if (!cache.legacyBclHosts.has(formatType)) {
    cache.legacyBclHosts.set(formatType, {
      platform: vm.platform,
      heap: vm.heap,
      value: value => vm.value(value),
      format: value => vm.format(value, formatType),
      runtimeTypeText: value => runtimeTypeText(vm, value),
      fault: (type, message) => new ManagedFault(type, message)
    });
  }
  return cache.legacyBclHosts.get(formatType);
}

function legacyString(context) {
  const {vm, descriptor, self, parameters} = context;
  const name = 'string.' + descriptor.name.replace('Invariant', '');
  const args = descriptor.signature.isStatic ? parameters : [self, ...parameters];
  const result = invokeLegacyBclBuiltin(legacyHost(vm), name, args);
  return typeof result === 'boolean' ? Number(result) : result;
}

function stringReceiver(context) {
  const value=context.vm.value(context.self);
  if(typeof value!=='string')throw new ManagedFault('NullReferenceException','String receiver required');
  return value;
}
const implementations={
  smallMathExtremum: ({descriptor, values}) =>
    smallMathExtremum(descriptor.name, descriptor.signature.returnType, values[0], values[1]),
  unsignedMathExtremum: ({descriptor, values}) =>
    unsignedMathExtremum(descriptor.name, descriptor.signature.returnType, values[0], values[1]),
  decimal:({vm,descriptor,self,parameters})=>invokeDecimal(vm,descriptor,descriptor.signature.isStatic?parameters:[self,...parameters]).value,
  bitConverter:({descriptor,parameters})=>invokeBitConverter(descriptor,parameters),
  nativeSize:({vm})=>nativeSize(vm.options),
  arrayMutate:({vm,descriptor,parameters})=>mutateArray(vm,descriptor.name,parameters[0]),
  console:({vm,descriptor,parameters})=>{vm.emitOutput((parameters.length?vm.format(parameters[0],descriptor.signature.parameters[0]):'')+(descriptor.name==='WriteLine'?'\n':''));return null;},
  objectCtor:()=>null,
  objectToString:({vm,self,isVirtual})=>invokeLegacyBclBuiltin(legacyHost(vm),isVirtual?'object.ToString':'Convert.ToString',[self]),
  objectGetType:({vm,self})=>objectType(vm,self),
  typeFromHandle:({vm,parameters})=>typeFromHandle(vm,parameters[0]),
  typeCompare:({vm,descriptor,parameters})=>typeEquals(vm,parameters[0],parameters[1])!==(descriptor.name==='op_Inequality')?1:0,
  typeEquals:({vm,self,parameters})=>typeEquals(vm,self,parameters[0])?1:0,
  typeName:({vm,self,descriptor})=>{const name=typeName(vm,self,descriptor.name==='get_FullName');return name===null?null:vm.heap.string(name);},
  typeHandle:({vm,self})=>typeHandle(vm,self),
  typeProperty:({vm,self,descriptor})=>typeProperty(vm,self,descriptor.name.slice(4))?1:0,
  typeString:({vm,self})=>vm.heap.string(runtimeTypeText(vm,self)),
  objectReferenceEquals:({parameters})=>referenceEquals(parameters[0],parameters[1])?1:0,
  enumToString:({vm,self})=>{const text=enumToString(vm,self);if(text===null)throw new ManagedFault('ArgumentException','Enum receiver required');return vm.heap.string(text);},
  enumHasFlag:({vm,self,parameters})=>enumHasFlag(vm,self,parameters[0])?1:0,
  exceptionCtor:({vm,self,parameters})=>{vm.heap.get(self).data[0]=parameters[0]??vm.heap.string('Exception');return null;},
  exceptionMessage:({vm,self})=>vm.heap.get(self).data[0],
  exceptionInner:({vm,self})=>vm.heap.get(self).data[1]??null,
  stringCtor:({vm,parameters})=>stringFromChars(vm,parameters[0]),
  stringConcat:legacyString,
  stringCompare:({descriptor,values})=>(values[0]===values[1])!==(descriptor.name==='op_Inequality')?1:0,
  stringNullOrEmpty:legacyString,
  stringIntern:({vm,parameters})=>internString(vm,parameters[0]),
  stringIsInterned:({vm,parameters})=>isInternedString(vm,parameters[0]),
  stringLength:context=>stringReceiver(context).length,
  stringChars:({vm,self,values})=>stringChar(vm,self,values[0]),
  stringTransform: context => {
    if (context.descriptor.name === 'ToString') {
      stringReceiver(context);
      return context.self;
    }
    return legacyString(context);
  },
  stringSubstring:legacyString,
  stringReplace:legacyString,
  stringSearch:legacyString,
  math:({descriptor,values})=>{
    const name=descriptor.name,signature=descriptor.signature;
    let result;
    if(typeof values[0]==='bigint') {
      if(name==='Abs') {
        if(values[0]===-(1n<<63n))throw new ManagedFault('OverflowException','Int64 absolute value overflow');
        result=values[0]<0?-values[0]:values[0];
      } else result=name==='Min'?values[0]<values[1]?values[0]:values[1]:values[0]>values[1]?values[0]:values[1];
    } else if(name==='Round') {
      const floor=Math.floor(values[0]),fraction=values[0]-floor;
      result=fraction===0.5?(floor%2===0?floor:floor+1):Math.round(values[0]);
    } else {
      if(name==='Abs'&&signature.returnType==='int'&&values[0]===-2147483648)throw new ManagedFault('OverflowException','Int32 absolute value overflow');
      result=Math[name==='Ceiling'?'ceil':name.toLowerCase()](...values);
    }
    return signature.returnType==='double'||signature.returnType==='float'?float(result,signature.returnType==='float'?'r4':'r8'):result;
  },
  gcCollect:({vm})=>{vm.heap.collect();return null;},
  gcMemory:({vm,values})=>{if(values[0])vm.heap.collect();return BigInt(vm.heap.stats.liveBytes);},
  gcCount:({vm,values})=>{
    if(!Number.isInteger(values[0])||values[0]<0||values[0]>2)throw new ManagedFault('ArgumentOutOfRangeException','Generation must be between 0 and 2');
    return vm.heap.stats.collections;
  },
  parse: ({vm, descriptor, parameters, values}) => {
    const type = descriptor.signature.returnType;
    if (type === 'double') return float(invokeLegacyBclBuiltin(legacyHost(vm), 'double.Parse', parameters));
    if (type === 'int') return invokeLegacyBclBuiltin(legacyHost(vm), 'int.Parse', parameters);
    const text = String(values[0] ?? '').trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
      throw new ManagedFault('FormatException', 'Invalid numeric text');
    }
    if (!/^[+-]?\d+$/.test(text)) throw new ManagedFault('FormatException', 'Invalid integer text');
    return vm.convert('conv.ovf.i8', BigInt(text));
  },
  convertString: ({vm, descriptor, parameters}) => {
    const host = legacyHost(vm, descriptor.signature.parameters[0]);
    return invokeLegacyBclBuiltin(host, 'Convert.ToString', parameters);
  },
  convertDouble: ({vm, parameters}) => float(invokeLegacyBclBuiltin(legacyHost(vm), 'Convert.ToDouble', parameters)),
  convertInt32: ({vm, parameters}) => invokeLegacyBclBuiltin(legacyHost(vm), 'Convert.ToInt32', parameters)

};

const sharedConversions = new Set(['convertInt32', 'convertDouble', 'convertString', 'decimal']);

/** Closed owner::name(signature) registry shared with verifier acceptance. */
export const intrinsicHandlers=new Map(intrinsicDefinitions.map(definition=>{
  if(!definition.contract&&!implementations[definition.implementation])throw new Error(`Missing intrinsic implementation '${definition.implementation}'`);
  return [definition.key,(vm,descriptor,args,selected=definition,isVirtual=false)=>{
    if(selected.contract)return vm.platform.invoke(selected.contract,args);
    const self=descriptor.signature.isStatic?null:args[0],parameters=descriptor.signature.isStatic?args:args.slice(1);
    if(!descriptor.signature.isStatic&&self===null)throw new ManagedFault('NullReferenceException','Null instance receiver');
    // Shared conversions decode their own arguments through the host adapter.
    const values = sharedConversions.has(selected.implementation) ? null : parameters.map(value => vm.value(value));
    return implementations[selected.implementation]({vm,descriptor,self,parameters,values,isVirtual});
  }];
}));
export function invokeIntrinsic(vm,descriptor,args,isVirtual=false) {
  const definition=intrinsicDefinition(descriptor),handler=definition&&(intrinsicHandlers.get(definition.key)??valueIntrinsicHandler(definition));
  if(!handler)throw new ManagedFault('MissingMethodException',`${descriptor.owner}::${descriptor.name}`);
  return handler(vm,descriptor,args,definition,isVirtual);
}
