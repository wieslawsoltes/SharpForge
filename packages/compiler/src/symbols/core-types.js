/**
 * The predefined types the type-system modules reason about, resolved once against the core library of a compilation
 * (the framework registry bridge): `core.int`, `core.object`, `core.nullableOf(T)`, `core.keyword('ulong')`...
 * `nint`/`nuint` are IntPtr/UIntPtr flagged as native integers, so they are distinct from the plain structs until
 * C# 11 identity is asked for (conversions/native-int.js).
 */
import {ConstructedNamedTypeSymbol,ArrayTypeSymbol,TypeWithAnnotations,TypeKind} from './types.js';
import {frameworkBridge} from './registry-bridge.js';
import {specialTypeFromKeyword} from './special-types.js';

const keywordNames=['object','void','bool','char','sbyte','byte','short','ushort','int','uint','long','ulong','decimal','float','double','string'];
export class CoreTypes{
  constructor(bridge=frameworkBridge()){
    this.bridge=bridge;this.byKeyword=new Map();this.arrays=new Map();
    for(const k of keywordNames){const type=bridge.coreType(specialTypeFromKeyword(k));this[k]=type;this.byKeyword.set(k,type);}
    const native=(id,keyword)=>{const def=bridge.coreType(id),type=new ConstructedNamedTypeSymbol(def,[],null);type.isNativeInteger=true;this[keyword]=type;this.byKeyword.set(keyword,type);};
    native('System_IntPtr','nint');native('System_UIntPtr','nuint');
    this.intPtr=bridge.coreType('System_IntPtr');this.uintPtr=bridge.coreType('System_UIntPtr');
    this.valueType=bridge.coreType('System_ValueType');this.enumType=bridge.coreType('System_Enum');this.array=bridge.coreType('System_Array');
    this.delegate=bridge.coreType('System_Delegate');this.multicastDelegate=bridge.coreType('System_MulticastDelegate');this.exception=bridge.coreType('System_Exception');
    this.nullable=bridge.coreType('System_Nullable_T');this.idisposable=bridge.coreType('System_IDisposable');
    this.ienumerable=bridge.coreType('System_Collections_IEnumerable');this.ienumerableT=bridge.coreType('System_Collections_Generic_IEnumerable_T');
    this.ienumerator=bridge.coreType('System_Collections_IEnumerator');this.ienumeratorT=bridge.coreType('System_Collections_Generic_IEnumerator_T');
    this.ilistT=bridge.coreType('System_Collections_Generic_IList_T');this.icollectionT=bridge.coreType('System_Collections_Generic_ICollection_T');
    this.ireadOnlyListT=bridge.coreType('System_Collections_Generic_IReadOnlyList_T');this.ireadOnlyCollectionT=bridge.coreType('System_Collections_Generic_IReadOnlyCollection_T');
    this.task=bridge.coreType('System_Threading_Tasks_Task');this.taskT=bridge.coreType('System_Threading_Tasks_Task_T');this.type=bridge.coreType('System_Type');this.attribute=bridge.coreType('System_Attribute');
  }
  /** The type a C# type keyword denotes (including nint/nuint), or null. */
  keyword(word){return this.byKeyword.get(word)??null;}
  /** T? for a value type T. */
  nullableOf(type){return this.nullable.construct(type instanceof TypeWithAnnotations?type:new TypeWithAnnotations(type));}
  /** T[] (rank 1) or a multi-dimensional array; arrays implement IList<T> and friends through System.Array. */
  arrayOf(element,rank=1){
    const bare=element instanceof TypeWithAnnotations?element.type:element;
    return new ArrayTypeSymbol(element,rank,{baseType:()=>this.array,interfaces:rank===1?()=>[this.ilistT,this.icollectionT,this.ienumerableT,this.ireadOnlyListT,this.ireadOnlyCollectionT].map(i=>i.construct(bare)).concat(this.ienumerable):()=>[this.ienumerable]});
  }
  func(arity){return this.bridge.coreType('System_Func_T'+arity);}
  action(arity){return this.bridge.coreType('System_Action'+(arity?'_T'+arity:''));}
  /** The underlying type of an enum (int when unspecified); null for other types. */
  enumUnderlying(type){return type?.typeKind===TypeKind.Enum?(type.originalDefinition.enumUnderlyingType??this.int):null;}
}
let shared=null;
/** Core types over the shared framework bridge. */
export function coreTypes(){return shared??=new CoreTypes();}
