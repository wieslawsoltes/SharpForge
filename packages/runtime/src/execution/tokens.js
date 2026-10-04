import {decodeCoded,token} from '@sharpforge/cil';
import {ManagedFault,isReference} from '../heap.js';
import {cachedMetadataToken} from './token-cache.js';

function tableFor(vm,type) {
  const registry=vm.heap.methodTables;
  if(!registry)throw new ManagedFault('InvalidProgramException','Runtime method tables are not initialized');
  return registry.get(type);
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
  const table=vm.typeSystem.table(descriptor.kind==='type'?metadataToken:descriptor.owner);
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
  else if(value?.valueType)type=value.valueType;
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

function simpleName(table) {
  if(table.elementType)return simpleName(table.elementType)+table.name.slice(table.elementType.name.length);
  const name=table.genericDefinition?.name??table.name;
  return name.slice(Math.max(name.lastIndexOf('.'),name.lastIndexOf('+'))+1);
}
function assemblyIdentity(vm,table) {
  const md=vm.inspector?.metadata,name=table.genericDefinition?.name??table.name;
  if(md) {
    const own=vm.inspector.types.find(type=>type.name===name);
    let row=own?md.rows[32]?.[0]:null,isDefinition=!!row;
    if(!row)for(let index=0;index<(md.rows[1]?.length??0);index++) {
      if(md.typeName(token(1,index+1))!==name)continue;
      let scope=decodeCoded('ResolutionScope',md.rows[1][index][0]);
      while(scope>>>24===1)scope=decodeCoded('ResolutionScope',md.row(scope)[0]);
      if(scope>>>24===35)row=md.row(scope);
      break;
    }
    if(!row&&name.startsWith('System.'))row=(md.rows[35]??[]).find(item=>['System.Runtime','mscorlib','System.Private.CoreLib'].includes(md.string(item[6])));
    if(row) {
      const version=row.slice(isDefinition?1:0,isDefinition?5:4).join('.'),assembly=md.string(row[isDefinition?7:6]);
      const culture=md.string(row[isDefinition?8:7])||'neutral',key=md.blob(row[isDefinition?6:5]);
      // System.Runtime is the reference facade for core library types in this profile.
      const core=assembly==='System.Runtime',publicKey=core?'7cec85d7bea7798e':key.length===8?Array.from(key,b=>b.toString(16).padStart(2,'0')).join(''):'null';
      return `${core?'System.Private.CoreLib':assembly}, Version=${version}, Culture=${culture}, PublicKeyToken=${publicKey}`;
    }
  }
  return name.startsWith('System.')?'System.Private.CoreLib, Version=8.0.0.0, Culture=neutral, PublicKeyToken=7cec85d7bea7798e':`${vm.image?.name??'Application'}, Version=0.2.0.0, Culture=neutral, PublicKeyToken=null`;
}
function fullName(vm,table) {
  if(table.containsGenericParameters&&!table.flags.genericDefinition)return null;
  if(table.elementType){const element=fullName(vm,table.elementType);return element===null?null:element+table.name.slice(table.elementType.name.length);}
  if(table.genericDefinition)return table.genericDefinition.name+'[['+table.typeArguments.map(type=>fullName(vm,type)+', '+assemblyIdentity(vm,type)).join('],[')+']]';
  return table.name;
}
export function typeName(vm,reference,full=false) {
  const table=typeTable(vm,reference);
  return full?fullName(vm,table):simpleName(table);
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
  const display=type=>type.genericDefinition?type.genericDefinition.name+'['+type.typeArguments.map(display).join(',')+']':type.elementType?display(type.elementType)+type.name.slice(type.elementType.name.length):type.name;
  return display(table);
}
export function* runtimeTypeRoots(vm) {yield* vm.typeObjects?.values()??[];}
export function clearRuntimeTypes(vm) {vm.typeObjects?.clear();}
