import {memoryCall} from './memory-calls.js';
import {invokeAsyncIntrinsic} from './async-runtime.js';
import {arrayCall} from './array-calls.js';
import {invokeNumericIntrinsic} from './numeric-intrinsics.js';
import {mutateArray} from './array-ops.js';
import {intrinsicDefinition,intrinsicDefinitions} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {float} from './numeric-ops.js';
import {internString,isInternedString,referenceEquals,stringChar,stringFromChars} from './strings.js';
import {enumToString,enumHasFlag} from './enums.js';
import {objectType,typeFromHandle,typeEquals,typeName,typeHandle,typeProperty,runtimeTypeText} from './tokens.js';

function stringReceiver(context) {
  const value=context.vm.value(context.self);
  if(typeof value!=='string')throw new ManagedFault('NullReferenceException','String receiver required');
  return value;
}
const implementations={
  synchronization:({vm,descriptor,self,parameters})=>vm.sync.invoke(descriptor,descriptor.signature.isStatic?parameters:[self,...parameters]).value,
  decimal:({vm,descriptor,self,parameters})=>invokeNumericIntrinsic(vm,descriptor,descriptor.signature.isStatic?parameters:[self,...parameters]).value,
  arrayMutate:({vm,descriptor,parameters})=>mutateArray(vm,descriptor.name,parameters[0]),
  console:({vm,descriptor,parameters})=>{vm.emitOutput((parameters.length?vm.format(parameters[0],descriptor.signature.parameters[0]):'')+(descriptor.name==='WriteLine'?'\n':''));return null;},
  objectCtor:()=>null,
  objectToString:({vm,self})=>vm.heap.string(runtimeTypeText(vm,self)??vm.format(self)),
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
  exceptionCtor:({vm,self,parameters})=>{vm.heap.writeData(self,0,parameters[0]??vm.heap.string('Exception'));return null;},
  exceptionMessage:({vm,self})=>vm.heap.get(self).data[0],
  exceptionInner:({vm,self})=>vm.heap.get(self).data[1]??null,
  stringCtor:({vm,parameters})=>stringFromChars(vm,parameters[0]),
  stringConcat:({vm,parameters})=>vm.heap.string(parameters.map(value=>vm.format(value)).join('')),
  stringCompare:({descriptor,values})=>(values[0]===values[1])!==(descriptor.name==='op_Inequality')?1:0,
  stringNullOrEmpty:({values})=>values[0]===null||values[0]===''?1:0,
  stringIntern:({vm,parameters})=>internString(vm,parameters[0]),
  stringIsInterned:({vm,parameters})=>isInternedString(vm,parameters[0]),
  stringLength:context=>stringReceiver(context).length,
  stringChars:({vm,self,values})=>stringChar(vm,self,values[0]),
  stringTransform:context=>{
    const string=stringReceiver(context),{vm,descriptor,self}=context;
    if(descriptor.name==='ToString')return self;
    return vm.heap.string(string[{ToUpper:'toUpperCase',ToUpperInvariant:'toUpperCase',ToLower:'toLowerCase',ToLowerInvariant:'toLowerCase',Trim:'trim'}[descriptor.name]]());
  },
  stringSubstring:context=>{
    const string=stringReceiver(context),[at,length=string.length-at]=context.values;
    if(!Number.isInteger(at)||!Number.isInteger(length)||at<0||length<0||at+length>string.length)throw new ManagedFault('ArgumentOutOfRangeException','Substring bounds');
    return context.vm.heap.string(string.slice(at,at+length));
  },
  stringReplace:context=>{
    const string=stringReceiver(context),{vm,values}=context;
    if(values[0]===null||values[0]==='')throw new ManagedFault('ArgumentException','Invalid oldValue');
    return vm.heap.string(string.split(values[0]).join(values[1]??''));
  },
  stringSearch:context=>{
    const string=stringReceiver(context),{descriptor,values}=context;
    if(values[0]===null)throw new ManagedFault('ArgumentNullException','Null string argument');
    const result=string[{Contains:'includes',StartsWith:'startsWith',EndsWith:'endsWith',IndexOf:'indexOf'}[descriptor.name]](values[0]);
    return typeof result==='boolean'?result?1:0:result;
  },
  math:({vm,descriptor,parameters})=>invokeNumericIntrinsic(vm,descriptor,parameters).value,
  gcCollect:({vm})=>{vm.heap.collect();return null;},
  gcMemory:({vm,values})=>{if(values[0])vm.heap.collect();return BigInt(vm.heap.stats.liveBytes);},
  gcCount:({vm,values})=>{
    if(!Number.isInteger(values[0])||values[0]<0||values[0]>2)throw new ManagedFault('ArgumentOutOfRangeException','Generation must be between 0 and 2');
    return vm.heap.stats.collections;
  },
  parse:({vm,descriptor,values})=>{
    const text=String(values[0]??'').trim();
    if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))throw new ManagedFault('FormatException','Invalid numeric text');
    if(descriptor.signature.returnType==='double')return float(Number(text));
    if(!/^[+-]?\d+$/.test(text))throw new ManagedFault('FormatException','Invalid integer text');
    return vm.convert(descriptor.signature.returnType==='long'?'conv.ovf.i8':'conv.ovf.i4',BigInt(text));
  },
  convertString:({vm,descriptor,parameters})=>vm.heap.string(vm.format(parameters[0],descriptor.signature.parameters[0])),
  convertDouble:({values})=>{
    const value=Number(values[0]);
    if(Number.isNaN(value))throw new ManagedFault('FormatException','Invalid conversion');
    return float(value);
  },
  convertInt32:({vm,values})=>{
    const value=Number(values[0]),floor=Math.floor(value),rounded=value-floor===0.5?(floor%2===0?floor:floor+1):Math.round(value);
    return vm.convert('conv.ovf.i4',float(rounded));
  }
};

/** Closed owner::name(signature) registry shared with verifier acceptance. */
export const intrinsicHandlers=new Map(intrinsicDefinitions.map(definition=>{
  if(!definition.contract&&!implementations[definition.implementation])throw new Error(`Missing intrinsic implementation '${definition.implementation}'`);
  return [definition.key,(vm,descriptor,args,selected=definition)=>{
    if(selected.contract)return vm.platform.invoke(selected.contract,args);
    const self=descriptor.signature.isStatic?null:args[0],parameters=descriptor.signature.isStatic?args:args.slice(1);
    if(!descriptor.signature.isStatic&&self===null)throw new ManagedFault('NullReferenceException','Null instance receiver');
    return implementations[selected.implementation]({vm,descriptor,self,parameters,values:parameters.map(value=>vm.value(value))});
  }];
}));
export function invokeIntrinsic(vm,descriptor,args) {
  const memory=memoryCall(vm,descriptor,args);if(memory.handled)return memory.value;
  const array=arrayCall(vm,descriptor,args);if(array.handled)return array.value;
  const async=invokeAsyncIntrinsic(vm,descriptor,args);if(async.handled)return async.value;
  const sync=vm.sync?.invoke(descriptor,args);if(sync?.handled)return sync.value;
  const definition=intrinsicDefinition(descriptor),handler=definition&&intrinsicHandlers.get(definition.key);
  if(!handler)throw new ManagedFault('MissingMethodException',`${descriptor.owner}::${descriptor.name}`);
  return handler(vm,descriptor,args,definition);
}
