import {frameworkType} from '@sharpforge/framework';
import {ManagedFault,isReference} from '../heap.js';
import {defaults,storage as numericStorage} from './numeric-ops.js';
import {enumInfo,enumUnderlying,enumValue} from './enums.js';

const aliases={'System.Void':'void','System.Boolean':'bool','System.Char':'char','System.SByte':'sbyte','System.Byte':'byte','System.Int16':'short','System.UInt16':'ushort','System.Int32':'int','System.UInt32':'uint','System.Int64':'long','System.UInt64':'ulong','System.Single':'float','System.Double':'double','System.Decimal':'decimal','System.IntPtr':'nint','System.UIntPtr':'nuint'};
export const isValueTypeValue=value=>!!value?.valueType&&Array.isArray(value.fields);
export const isAggregateType=table=>table.flags.valueType&&!table.flags.primitive&&!table.flags.enum&&!table.flags.dynamic&&!Object.hasOwn(aliases,table.name)&&!table.flags.nullable;
function tableFor(vm,type) {try{return vm.inspector?vm.typeSystem.table(type):vm.heap.methodTables.get(type);}catch{throw new ManagedFault('InvalidProgramException','Value type belongs to another VM or is invalid');}}
function checkDepth(depth) {if(depth>128)throw new ManagedFault('InvalidProgramException','Value-type nesting limit exceeded');}

/** Structs are immutable typed records. Every assignment copies nested values;
 * managed object references inside them deliberately retain reference identity. */
export function createValue(vm,type,fields=null,depth=0) {
  checkDepth(depth);const table=tableFor(vm,type);
  if(!isAggregateType(table))throw new ManagedFault('InvalidProgramException','Aggregate value type required');
  if(fields!==null&&(!Array.isArray(fields)||fields.length!==table.fields.length))throw new ManagedFault('InvalidProgramException','Struct field count does not match its type');
  return vm.heap.withRoots(fields??[],()=>{
    const copied=[];
    for(const [index,field] of table.fields.entries()) {
      const value=fields===null?valueDefault(vm,field.type,depth+1):copyValue(vm,fields[index],field.type,undefined,depth+1);
      copied.push(value);vm.heap.pins.push(value);
    }
    return Object.freeze({valueType:table,fields:Object.freeze(copied)});
  });
}
export function valueDefault(vm,type,depth=0) {
  checkDepth(depth);const table=tableFor(vm,type);
  if(isAggregateType(table))return createValue(vm,table,null,depth+1);
  const info=table.flags.enum?enumInfo(vm,table.name):null;
  if(info)return vm.image&&!vm.inspector?enumValue(vm,table.name,0):enumUnderlying(0,info.underlyingType);
  if(table.flags.enum)return numericStorage(0,table.enumUnderlyingType.name);
  if(table.name==='System.Boolean'&&vm.image&&!vm.inspector)return false;
  return defaults(aliases[table.name]??table.name,vm.options);
}
export function copyValue(vm,value,type=null,numericContext,depth=0) {
  checkDepth(depth);
  const table=type===null?(isValueTypeValue(value)?tableFor(vm,value.valueType):null):tableFor(vm,type);
  if(value?.byref)throw new ManagedFault('InvalidProgramException','Managed pointers cannot be stored in value fields or boxes');
  if(isValueTypeValue(value)) {
    let actual;try{actual=tableFor(vm,value.valueType);}catch{throw new ManagedFault('InvalidProgramException','Value belongs to another VM');}
    if(table!==actual)throw new ManagedFault('InvalidCastException','Value type identity mismatch');
    return createValue(vm,actual,value.fields,depth+1);
  }
  if(table&&isAggregateType(table))throw new ManagedFault('InvalidCastException','A struct value is required');
  if(isReference(value)) {
    const record=vm.heap.get(value);
    if(table?.flags.valueType) {
      // Existing framework value adapters use private heap records. Copy that
      // record at the boundary without turning user structs into heap objects.
      if(frameworkType(table.name)?.kind!=='value'||record.methodTable!==table)throw new ManagedFault('InvalidCastException','Value type identity mismatch');
      return vm.heap.withRoots([value],()=>{const data=[];for(const item of record.data){const copied=copyValue(vm,item);data.push(copied);vm.heap.pins.push(copied);}return vm.heap.allocate(record.kind,table,data);});
    }
    return value;
  }
  if(table?.flags.enum) {
    const underlying=table.enumUnderlyingType?.name??enumInfo(vm,table.name)?.underlyingType??'int';
    if(vm.image&&!vm.inspector&&enumInfo(vm,table.name))return enumValue(vm,table.name,value);
    return numericStorage(enumUnderlying(value,underlying),underlying,numericContext);
  }
  if(table?.name==='System.Boolean'&&typeof value==='boolean'&&vm.image&&!vm.inspector)return value;
  if(table&&Object.hasOwn(aliases,table.name))return numericStorage(typeof value==='boolean'?Number(value):value,aliases[table.name],numericContext);
  if(value!==null&&typeof value==='object'&&!Object.isFrozen(value))throw new ManagedFault('InvalidProgramException','Mutable host objects are not managed values');
  return value;
}
export function replaceValueField(vm,value,index,replacement) {
  if(!isValueTypeValue(value)||!Number.isInteger(index)||index<0||index>=value.fields.length)throw new ManagedFault('InvalidProgramException','Invalid value-type field');
  const fields=[...value.fields];fields[index]=replacement;return createValue(vm,value.valueType,fields);
}
export function boxValue(vm,value,type) {
  const table=tableFor(vm,type);
  if(!table.flags.valueType) {
    if(value!==null&&!isReference(value))throw new ManagedFault('InvalidCastException','Reference boxing requires a managed reference');
    if(value!==null)vm.heap.get(value);return value;
  }
  return vm.heap.withRoots([value],()=>{const copied=copyValue(vm,value,table);return vm.heap.allocate('box',table,[copied],[copied]);});
}
export function unboxValue(vm,reference,type) {
  const table=tableFor(vm,type),record=vm.heap.get(reference);
  if(record.kind!=='box'||record.methodTable!==table)throw new ManagedFault('InvalidCastException','Boxed type mismatch');
  return copyValue(vm,record.data[0],table);
}

/** Source IR can opt into value storage before struct syntax is implemented. */
export function sourceValue(vm,type,fields=null) {return createValue(vm,type,fields);}
export function sourceValueCopy(vm,value,type=null) {return copyValue(vm,value,type);}
