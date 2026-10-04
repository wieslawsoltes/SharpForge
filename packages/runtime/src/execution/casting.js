import {ManagedFault,isReference} from '../heap.js';

const arrayGenericInterfaces=new Set(['System.Collections.Generic.IEnumerable`1','System.Collections.Generic.ICollection`1','System.Collections.Generic.IList`1','System.Collections.Generic.IReadOnlyCollection`1','System.Collections.Generic.IReadOnlyList`1']);
// ECMA-335 reduced integral types: arrays may share signed/unsigned storage.
// Boolean and Char keep their own identities; enums reduce to their underlying type.
const reducedIntegers=new Map([['System.SByte','i1'],['System.Byte','i1'],['System.Int16','i2'],['System.UInt16','i2'],['System.Int32','i4'],['System.UInt32','i4'],['System.Int64','i8'],['System.UInt64','i8'],['System.IntPtr','i'],['System.UIntPtr','i']]);
const reduced=table=>reducedIntegers.get((table.enumUnderlyingType??table).name);

/** Cached Type.IsAssignableFrom semantics. Keys are tables, never display names. */
export class CastCache {
  constructor(registry){this.registry=registry;this.cache=new WeakMap();this.hits=0;this.misses=0;}
  clear(){this.cache=new WeakMap();this.hits=0;this.misses=0;}
  isAssignableFrom(target,source) {
    if(source===null||source===undefined)return false;
    target=this.registry.get(target);source=this.registry.get(source);
    const prior=this.cache.get(source);
    if(prior?.has(target)){this.hits++;return prior.get(target);}
    this.misses++;const result=this.assignable(target,source,new Map());
    if(!prior)this.cache.set(source,new Map([[target,result]]));else prior.set(target,result);
    return result;
  }
  assignable(target,source,visited) {
    if(target===source)return true;
    if(source.registry!==target.registry)return false;
    if(source.flags.byRef||target.flags.byRef||source.flags.pointer||target.flags.pointer||source.name==='System.Void'||target.name==='System.Void')return false;
    if(target.nullableType===source)return true;
    if(target.name==='System.Object')return true;
    let targets=visited.get(source);if(targets?.has(target))return false;
    if(!targets){targets=new Set();visited.set(source,targets);}targets.add(target);
    try {
      if(target.flags.array) {
        if(!source.flags.array||source.rank!==target.rank||target.flags.szArray&&!source.flags.szArray)return false;
        return this.arrayElement(target.elementType,source.elementType,visited);
      }
      if(source.flags.array&&target.genericDefinition&&arrayGenericInterfaces.has(target.genericDefinition.name)) {
        return source.flags.szArray&&this.arrayElement(target.typeArguments[0],source.elementType,visited);
      }
      if(this.variant(target,source,visited))return true;
      for(const iface of source.interfaceMap.keys())if(iface===target||this.variant(target,iface,visited))return true;
      return source.base!==null&&this.assignable(target,source.base,visited);
    } finally {targets.delete(target);}
  }
  variant(target,source,visited) {
    if(!target.genericDefinition||target.genericDefinition!==source.genericDefinition)return false;
    if(!target.flags.interface&&!target.flags.delegate)return false;
    return target.typeArguments.every((expected,index)=>{
      const actual=source.typeArguments[index];if(actual===expected)return true;
      if(!actual||actual.flags.valueType||expected.flags.valueType)return false;
      const variance=target.variance[index];
      return variance===1?this.assignable(expected,actual,visited):variance===-1?this.assignable(actual,expected,visited):false;
    });
  }
  arrayElement(target,source,visited) {
    if(target===source)return true;
    if(source.flags.valueType||target.flags.valueType) {
      const sourceReduced=reduced(source);return sourceReduced!==undefined&&sourceReduced===reduced(target);
    }
    return this.assignable(target,source,visited);
  }
}

const caches=new WeakMap();
export function castCacheFor(registry) {
  let cache=caches.get(registry);if(!cache){cache=new CastCache(registry);caches.set(registry,cache);}return cache;
}
export function castReference(heap,reference,target,throwOnFailure=true) {
  if(reference===null)return null;
  const table=heap.methodTables.get(target);
  const valid=isReference(reference)&&castCacheFor(heap.methodTables).isAssignableFrom(table,heap.get(reference).methodTable);
  if(!valid&&throwOnFailure)throw new ManagedFault('InvalidCastException','Incompatible reference type');
  return valid?reference:null;
}
/** Covariant array casts never weaken the actual array element's store check. */
export function checkArrayStore(heap,record,value) {
  if(record.kind!=='array'||!record.methodTable.flags.array)throw new ManagedFault('InvalidProgramException','An array record is required');
  return checkElementStore(heap, record.methodTable.elementType, value);
}

/** Check an already resolved array element type without rebuilding an array record. */
export function checkElementStore(heap, element, value) {
  if(value===null&&!element.flags.valueType)return value;
  if(element.flags.valueType)return value; // Numeric opcodes perform value-width checks.
  if(!isReference(value)||!castCacheFor(heap.methodTables).isAssignableFrom(element,heap.get(value).methodTable))throw new ManagedFault('ArrayTypeMismatchException','Value is incompatible with the array element type');
  return value;
}
