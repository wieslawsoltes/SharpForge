import {arrayMethodDefinition} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {typeHandle} from './tokens.js';
import {castCacheFor} from './casting.js';
import {arrayRecord,arrayShape,createArray,arrayGet,arraySet,arrayAddress,arrayDimension} from './arrays.js';

function vector(vm,reference,type) {
  if(reference===null)throw new ManagedFault('ArgumentNullException','Array dimension or index vector is null');
  const record=arrayRecord(vm,reference);
  if(!record.methodTable.flags.szArray||record.methodTable!==vm.heap.methodTables.get(type))throw new ManagedFault('ArgumentException','A matching zero-based integer vector is required');
  return [...record.data];
}
/** Shared direct-call/newobj hook; args includes the receiver for instance calls. */
export function arrayCall(vm,descriptor,args,instruction='call') {
  const definition=arrayMethodDefinition(descriptor);
  if(!definition)return {handled:false};
  const {operation,rank,elementType}=definition;
  if(operation==='construct') {
    if(instruction!=='newobj')throw new ManagedFault('InvalidProgramException','Array constructor requires newobj');
    const lower=args.length===rank*2?args.filter((_,i)=>i%2===0):null;
    const lengths=lower?args.filter((_,i)=>i%2===1):args;
    return {handled:true,returns:true,value:createArray(vm,elementType,lengths,lower)};
  }
  if(operation==='create') {
    if(args[0]===null)throw new ManagedFault('ArgumentNullException','Array element Type is null');
    const table=typeHandle(vm,args[0]).table,parameters=descriptor.signature.parameters;
    const lengths=parameters[1].endsWith('[]')?vector(vm,args[1],parameters[1]):args.slice(1);
    const bounds=parameters.length===3&&parameters[2].endsWith('[]')?vector(vm,args[2],parameters[2]):null;
    return {handled:true,returns:true,value:createArray(vm,table,lengths,bounds,{reflection:true})};
  }
  const receiver=args[0],record=arrayRecord(vm,receiver),shape=arrayShape(record);
  const owner=rank?(vm.inspector?vm.typeSystem.table(descriptor.owner):vm.heap.methodTables.get(descriptor.owner)):null;
  if(rank&&(shape.rank!==rank||!castCacheFor(vm.heap.methodTables).isAssignableFrom(owner,record.methodTable)))throw new ManagedFault('InvalidProgramException','Array method receiver has an incompatible array type');
  let value;const returns=!['set','setValue'].includes(operation);
  switch(operation) {
    case 'get':value=arrayGet(vm,receiver,args.slice(1),{type:owner.elementType});break;
    case 'set':arraySet(vm,receiver,args.slice(1,-1),args.at(-1));break;
    case 'address':value=arrayAddress(vm,receiver,args.slice(1),{type:owner.elementType});break;
    case 'rank':value=shape.rank;break;
    case 'length':value=record.data.length;break;
    case 'longLength':value=BigInt(record.data.length);break;
    case 'GetLength':case 'GetLongLength':value=arrayDimension(vm,receiver,args[1]);if(operation==='GetLongLength')value=BigInt(value);break;
    case 'GetLowerBound':value=arrayDimension(vm,receiver,args[1],'lower');break;
    case 'GetUpperBound':value=arrayDimension(vm,receiver,args[1],'upper');break;
    case 'getValue':case 'setValue': {
      const parameters=descriptor.signature.parameters,index=operation==='setValue'?2:1;
      const indices=parameters.at(-1).endsWith('[]')?vector(vm,args[index],parameters.at(-1)):args.slice(index);
      if(operation==='getValue')value=arrayGet(vm,receiver,indices,{reflection:true});
      else arraySet(vm,receiver,indices,args[1],{reflection:true});
      break;
    }
  }
  return {handled:true,returns,value};
}
