import {ManagedFault,isReference} from '../heap.js';
import {number,storage as numericStorage} from './numeric-ops.js';
import {storageDefault,storageValue} from './storage.js';
import {boxValue,unboxValue,copyValue} from './value-types.js';
import {address,dereference} from './managed-pointers.js';
import {checkArrayStore,castCacheFor} from './casting.js';
import {enumUnderlying} from './enums.js';
import {arrayInteger,reserveArray} from './array-limits.js';
import {isArrayStorage,primitiveArrayStorage,storageRead} from './array-storage.js';

const fault=(name,message)=>new ManagedFault(name,message);
const integer=arrayInteger;
export function arrayRecord(vm,reference) {
  const record=vm.heap.get(reference);
  if(record.kind!=='array'||!record.methodTable.flags.array)throw fault('InvalidProgramException','An array reference is required');
  return record;
}
/** Legacy vectors are described lazily; every multidimensional allocation has a shape. */
export function arrayShape(record) {
  if(record.arrayShape)return record.arrayShape;
  if(!record.methodTable.flags.szArray)throw fault('InvalidProgramException','Multidimensional array shape is missing');
  return Object.freeze({rank:1,szArray:true,lengths:Object.freeze([record.data.length]),lowerBounds:Object.freeze([0]),strides:Object.freeze([1])});
}
/** Snapshot preflight: shape metadata must describe exactly the stored elements. */
export function validateArrayShape(record) {
  const invalid=()=>{throw new TypeError('Invalid snapshot array shape');};
  const table=record?.methodTable,shape=record?.arrayShape;
  if(!table?.flags.array||!isArrayStorage(record.data))invalid();
  if(shape===undefined){if(!table.flags.szArray)invalid();return;}
  if(!shape||!Number.isInteger(shape.rank)||shape.rank<1||shape.rank>32||shape.rank!==table.rank||shape.szArray!==table.flags.szArray||
    ![shape.lengths,shape.lowerBounds,shape.strides].every(values=>Array.isArray(values)&&values.length===shape.rank))invalid();
  let total=1;
  for(let i=shape.rank-1;i>=0;i--) {
    const length=shape.lengths[i],lower=shape.lowerBounds[i];
    if(!Number.isInteger(length)||length<0||length>Number.MAX_SAFE_INTEGER||!Number.isInteger(lower)||lower<Number.MIN_SAFE_INTEGER||lower>Number.MAX_SAFE_INTEGER||
      length>0&&!Number.isSafeInteger(lower+length-1)||shape.strides[i]!==total)invalid();
    total*=length;
  }
  if(total!==record.data.length||shape.szArray&&(shape.rank!==1||shape.lowerBounds[0]!==0))invalid();
}
export function arrayVectorRecord(vm,reference,index) {
  const record=arrayRecord(vm,reference);
  if(!record.methodTable.flags.szArray)throw fault('InvalidProgramException','Vector opcode requires a single-dimensional zero-based array');
  const offset=integer(index,'IndexOutOfRangeException');
  if(offset<0||offset>=record.data.length)throw fault('IndexOutOfRangeException','Array index is outside its bounds');
  return record;
}

/** ECMA-335 II.14.2: row-major storage, last dimension changes fastest. */
export function createArray(vm,elementType,lengths,lowerBounds=null,{reflection=false}={}) {
  if(!Array.isArray(lengths)||lengths.length===0)throw fault('ArgumentException','At least one array dimension is required');
  if(lengths.length>32)throw fault('TypeLoadException','Array rank exceeds the CLI limit of 32');
  if(lowerBounds!==null&&(!Array.isArray(lowerBounds)||lowerBounds.length!==lengths.length))throw fault('ArgumentException','Array lengths and lower bounds have different ranks');
  const element=vm.inspector?vm.typeSystem.table(elementType):vm.heap.methodTables.get(elementType);
  if(element.name==='System.Void'||element.flags.byRef||element.flags.pointer||element.containsGenericParameters)throw fault('NotSupportedException','Array element type cannot be instantiated');
  const sizes=lengths.map(value=>integer(value,reflection?'ArgumentOutOfRangeException':'OverflowException'));
  const bounds=(lowerBounds??Array(sizes.length).fill(0)).map(value=>integer(value));
  let total=1;
  for(let i=0;i<sizes.length;i++) {
    if(sizes[i]<0)throw fault(reflection?'ArgumentOutOfRangeException':'OverflowException','Array length cannot be negative');
    if(sizes[i]>0&&!Number.isSafeInteger(bounds[i]+sizes[i]-1))throw fault('ArgumentOutOfRangeException','Array upper bound exceeds exact addressing');
    total*=sizes[i];
    if(!Number.isSafeInteger(total)||total>0xffffffff)throw fault('OutOfMemoryException','Array dimensions exceed the supported allocation size');
  }
  reserveArray(vm,element,total);
  const strides=Array(sizes.length);let stride=1;
  for(let i=sizes.length-1;i>=0;i--){strides[i]=stride;stride*=sizes[i];}
  // CoreCLR also morphs rank-one ARRAY constructors with lower bound zero to SZARRAY.
  const szArray=sizes.length===1&&bounds[0]===0;
  const suffix=szArray?'[]':sizes.length===1?'[*]':'['+','.repeat(sizes.length-1)+']';
  const table=vm.heap.methodTables.get(element.name+suffix);
  const zero=storageDefault(vm,element),reference=vm.heap.allocate('array',table,primitiveArrayStorage(element,total,zero));
  vm.heap.get(reference).arrayShape=Object.freeze({rank:sizes.length,szArray,lengths:Object.freeze(sizes),lowerBounds:Object.freeze(bounds),strides:Object.freeze(strides)});
  return reference;
}
export function arrayOffset(record,indices,{reflection=false}={}) {
  const shape=arrayShape(record);
  if(!Array.isArray(indices)||indices.length!==shape.rank)throw fault(reflection?'ArgumentException':'InvalidProgramException','Index count must match array rank');
  let offset=0;
  for(let i=0;i<indices.length;i++) {
    const index=integer(indices[i],reflection&&typeof number(indices[i])==='bigint'?'ArgumentOutOfRangeException':'IndexOutOfRangeException')-shape.lowerBounds[i];
    if(index<0||index>=shape.lengths[i])throw fault('IndexOutOfRangeException','Array index is outside its dimension bounds');
    offset+=index*shape.strides[i];
  }
  return offset;
}
export function arrayDimension(vm,reference,dimension,property='length') {
  const shape=arrayShape(arrayRecord(vm,reference)),index=integer(dimension,'IndexOutOfRangeException');
  if(index<0||index>=shape.rank)throw fault('IndexOutOfRangeException','Array dimension is outside its rank');
  if(property==='lower')return shape.lowerBounds[index];
  if(property==='upper')return shape.lowerBounds[index]+shape.lengths[index]-1;
  return shape.lengths[index];
}
export function arrayGet(vm,reference,indices,{reflection=false,type=null}={}) {
  return vm.heap.withRoots([reference],()=>{
    const record=arrayRecord(vm,reference),offset=arrayOffset(record,indices,{reflection}),element=record.methodTable.elementType;
    const value=copyValue(vm,storageRead(record.data,offset,element,{source:!!vm.image&&!vm.inspector}),type??element);
    return reflection&&element.flags.valueType?boxValue(vm,value,element):value;
  });
}
export function arrayAddress(vm,reference,indices,{type=null,readonly=false}={}) {
  const record=arrayRecord(vm,reference),index=arrayOffset(record,indices),actual=record.methodTable.elementType;
  const requested=type===null?actual:vm.inspector?vm.typeSystem.table(type):vm.heap.methodTables.get(type);
  const casts=castCacheFor(vm.heap.methodTables);
  const valueAlias=requested.flags.valueType&&actual.flags.valueType&&casts.isAssignableFrom(vm.heap.methodTables.get(requested.name+'[]'),vm.heap.methodTables.get(actual.name+'[]'));
  const compatible=requested===actual||valueAlias||readonly&&casts.isAssignableFrom(requested,actual);
  if(!compatible)throw fault('ArrayTypeMismatchException','Array address requires a compatible element type');
  return address(vm,'array',index,reference,{readonly});
}
const widening=new Map([
  ['SByte',['Int16','Int32','Int64','Single','Double']],['Byte',['Char','Int16','UInt16','Int32','UInt32','Int64','UInt64','Single','Double']],
  ['Int16',['Int32','Int64','Single','Double']],['UInt16',['Char','Int32','UInt32','Int64','UInt64','Single','Double']],
  ['Char',['UInt16','Int32','UInt32','Int64','UInt64','Single','Double']],['Int32',['Int64','Single','Double']],
  ['UInt32',['Int64','UInt64','Single','Double']],['Int64',['Single','Double']],['UInt64',['Single','Double']],['Single',['Double']]
]);
function reflectedValue(vm,value,element) {
  if(value===null)return storageDefault(vm,element);
  if(!isReference(value))throw fault('InvalidCastException','Array.SetValue requires a boxed value or object reference');
  const record=vm.heap.get(value);
  if(!element.flags.valueType) {
    if(!castCacheFor(vm.heap.methodTables).isAssignableFrom(element,record.methodTable))throw fault('InvalidCastException','Object cannot be stored in this array');
    return value;
  }
  if(record.kind!=='box')throw fault('InvalidCastException','Value cannot be unboxed to this array element');
  if(record.methodTable===element)return unboxValue(vm,value,element);
  const source=record.methodTable.enumUnderlyingType??record.methodTable;
  if(!source.flags.primitive||!element.flags.primitive||element.flags.enum||['System.Decimal','System.IntPtr','System.UIntPtr'].includes(element.name))throw fault('InvalidCastException','Boxed type is incompatible with this array');
  if(source!==element&&!widening.get(source.name.slice(7))?.includes(element.name.slice(7)))throw fault('ArgumentException','Array.SetValue does not narrow primitive values');
  let raw=record.methodTable.flags.enum?enumUnderlying(record.data[0],source.name):record.data[0];
  if(source.name==='System.UInt64')raw=BigInt.asUintN(64,raw);
  else if(source.name==='System.UInt32')raw=Number(raw)>>>0;
  else if(source.name==='System.Boolean')raw=Number(raw);
  return numericStorage(raw,element.name,vm.options);
}
export function arraySet(vm,reference,indices,value,{reflection=false}={}) {
  return vm.heap.withRoots([reference,value],()=>{
    const record=arrayRecord(vm,reference),offset=arrayOffset(record,indices,{reflection}),element=record.methodTable.elementType;
    const stored=reflection?reflectedValue(vm,value,element):storageValue(vm,value,element);
    if(!reflection)checkArrayStore(vm.heap,record,stored);
    return dereference(vm,address(vm,'array',offset,reference),true,stored);
  });
}

/** Source IR uses these same operations; source syntax support is a frontend task. */
export const sourceArrayCreate=createArray;
export const sourceArrayGet=arrayGet;
export const sourceArraySet=arraySet;
export const sourceArrayAddress=arrayAddress;
