import {simpleTypeName,fullTypeName,displayTypeName} from './type-display.js';
import {isDecimal} from './decimal.js';
import {ManagedFault,isReference} from '../heap.js';
import {cachedMetadataToken} from './token-cache.js';

function tableFor(vm,type) {
  const registry=vm.heap.methodTables;
  if(!registry)throw new ManagedFault('InvalidProgramException','Runtime method tables are not initialized');
  return vm.inspector?vm.typeSystem.table(type):registry.get(type);
}
function validHandle(vm,handle,kind) {
  if(!handle||!Object.isFrozen(handle)||handle.runtimeHandle!==kind||handle.owner!==vm.snapshotOwner)
    throw new ManagedFault('ArgumentException','Runtime handle has the wrong kind or belongs to another VM');
  try {if(tableFor(vm,handle.table)!==handle.table)throw new Error();}
  catch {throw new ManagedFault('ArgumentException','Runtime handle has an invalid type identity');}
  return handle;
}

/** Runtime handles are immutable, owned metadata identities, never managed addresses. */
export function loadToken(vm,metadataToken) {
  if(!Number.isInteger(metadataToken)||metadataToken<=0||metadataToken>0xffffffff)
    throw new ManagedFault('InvalidProgramException','Invalid ldtoken operand');
  let descriptor;
  try {descriptor=cachedMetadataToken(vm,metadataToken);}
  catch {throw new ManagedFault('InvalidProgramException','Invalid ldtoken metadata token');}
  if(!['type','method','field'].includes(descriptor.kind))
    throw new ManagedFault('InvalidProgramException','ldtoken requires a type, method, or field token');
  const table=tableFor(vm,descriptor.kind==='type'?metadataToken:descriptor.owner);
  return Object.freeze({runtimeHandle:descriptor.kind,owner:vm.snapshotOwner,table,
    token:descriptor.resolvedToken??metadataToken,
    ...(descriptor.kind==='type'?{}:{name:descriptor.name,definitionToken:descriptor.definitionToken??descriptor.resolvedToken??metadataToken}),
    ...(descriptor.genericArguments?{typeArguments:Object.freeze(descriptor.genericArguments.map(type=>tableFor(vm,type)))}:{})});
}

/** One rooted managed System.RuntimeType object for each MethodTable in this VM. */
export function runtimeTypeObject(vm,type) {
  const table=tableFor(vm,type),cache=vm.typeObjects??=new Map();
  if(cache.has(table))return cache.get(table);
  const handle=Object.freeze({runtimeHandle:'type',owner:vm.snapshotOwner,table,token:table.token});
  const reference=vm.heap.allocate('runtime-type',tableFor(vm,'System.RuntimeType'),[handle]);
  cache.set(table,reference);
  return reference;
}
export function typeFromHandle(vm,handle) {
  // The CLI default RuntimeTypeHandle has no type; GetTypeFromHandle returns null.
  if(handle===null)return null;
  return runtimeTypeObject(vm,validHandle(vm,handle,'type').table);
}
export function objectType(vm,value,typeHint=null) {
  if(value===null||value===undefined)throw new ManagedFault('NullReferenceException','GetType receiver is null');
  if(value?.byref)value=vm.dereference(value);
  let type;
  if(isReference(value)){const record=vm.heap.get(value);type=record.methodTable??record.type;}
  else if(isDecimal(value))type='System.Decimal';
  else if(value?.enumType)type=value.enumType;
  else if(value?.float)type=value.float==='r4'?'float':'double';
  else if(typeHint)type=typeHint;
  else if(typeof value==='boolean')type='bool';
  else if(typeof value==='bigint')type='long';
  else if(typeof value==='number')type=Number.isInteger(value)?'int':'double';
  else if(value?.runtimeHandle)type={type:'System.RuntimeTypeHandle',method:'System.RuntimeMethodHandle',field:'System.RuntimeFieldHandle'}[value.runtimeHandle];
  else throw new ManagedFault('InvalidProgramException','GetType requires a managed object or value');
  return runtimeTypeObject(vm,type);
}
function typeTable(vm,reference) {
  const record=vm.heap.get(reference);
  if(record.kind!=='runtime-type')throw new ManagedFault('ArgumentException','Runtime Type object required');
  return validHandle(vm,record.data[0],'type').table;
}
export function typeEquals(vm,left,right) {
  if(left===null||right===null)return left===right;
  if(!isReference(left)||!isReference(right)||vm.heap.get(left).kind!=='runtime-type'||vm.heap.get(right).kind!=='runtime-type')return false;
  return typeTable(vm,left)===typeTable(vm,right);
}

export function typeName(vm,reference,full=false) {
  const table=typeTable(vm,reference);
  return full?fullTypeName(vm,table):simpleTypeName(table);
}
export function typeProperty(vm,reference,property) {
  const table=typeTable(vm,reference);
  if(property==='IsGenericType')return !!(table.flags.genericDefinition||table.genericDefinition);
  if(property==='IsGenericTypeDefinition')return table.flags.genericDefinition;
  if(property==='ContainsGenericParameters')return table.containsGenericParameters;
  throw new ManagedFault('MissingMethodException','Unsupported Type property');
}
export function typeHandle(vm,reference) {
  typeTable(vm,reference);
  return vm.heap.get(reference).data[0];
}
export function runtimeTypeText(vm,value) {
  if(!isReference(value)||vm.heap.get(value).kind!=='runtime-type')return null;
  const table=typeTable(vm,value);
  return displayTypeName(table);
}
export function* runtimeTypeRoots(vm) {yield* vm.typeObjects?.values()??[];}
export function clearRuntimeTypes(vm) {vm.typeObjects?.clear();}
