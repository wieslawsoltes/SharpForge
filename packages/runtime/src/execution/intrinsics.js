import {intrinsicDefinition,intrinsicDefinitions} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {float} from './numeric-ops.js';

function stringReceiver(context) {
  const value=context.vm.value(context.self);
  if(typeof value!=='string')throw new ManagedFault('NullReferenceException','String receiver required');
  return value;
}
const implementations={
  console:({vm,descriptor,parameters})=>{vm.emitOutput((parameters.length?vm.format(parameters[0],descriptor.signature.parameters[0]):'')+(descriptor.name==='WriteLine'?'\n':''));return null;},
  objectCtor:()=>null,
  objectToString:({vm,self})=>vm.heap.string(vm.format(self)),
  exceptionCtor:({vm,self,parameters})=>{vm.heap.get(self).data[0]=parameters[0]??vm.heap.string('Exception');return null;},
  exceptionMessage:({vm,self})=>vm.heap.get(self).data[0],
  stringConcat:({vm,parameters})=>vm.heap.string(parameters.map(value=>vm.format(value)).join('')),
  stringCompare:({descriptor,values})=>(values[0]===values[1])!==(descriptor.name==='op_Inequality')?1:0,
  stringNullOrEmpty:({values})=>values[0]===null||values[0]===''?1:0,
  stringLength:context=>stringReceiver(context).length,
  stringChars:context=>{
    const string=stringReceiver(context),index=context.values[0];
    if(!Number.isInteger(index)||index<0||index>=string.length)throw new ManagedFault('IndexOutOfRangeException','String index out of range');
    return string.charCodeAt(index);
  },
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
    if(values[0]!==0)throw new ManagedFault('ArgumentOutOfRangeException','Only GC generation zero is modeled');
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
  const definition=intrinsicDefinition(descriptor),handler=definition&&intrinsicHandlers.get(definition.key);
  if(!handler)throw new ManagedFault('MissingMethodException',`${descriptor.owner}::${descriptor.name}`);
  return handler(vm,descriptor,args,definition);
}
