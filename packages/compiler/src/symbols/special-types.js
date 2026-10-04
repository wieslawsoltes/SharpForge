import {DiagnosticId} from '../diagnostics/codes.js';
import {NamedTypeSymbol,ErrorTypeSymbol,TypeKind,TypeParameterSymbol,Variance} from './types.js';
/**
 * Special types (the predefined types the language itself knows: System.Object ... System.Nullable<T>) and
 * well-known types (types the compiler needs for lowering: System.Index, Task builders, ValueTuple, Span, ...).
 *
 * The tables are data: [id, namespace, name, arity, type kind, base special-type id]. `TypeProvider` resolves an id
 * against a global namespace and reports CS0518 once when a predefined type is missing; `declareCoreTypes`
 * materialises definitions for a module that acts as the core library (the framework registry bridge does).
 */
const C=TypeKind.Class,S=TypeKind.Struct,I=TypeKind.Interface,D=TypeKind.Delegate;
const special=[
 ['System_Object','System','Object',0,C,null],['System_Enum','System','Enum',0,C,'System_ValueType'],['System_MulticastDelegate','System','MulticastDelegate',0,C,'System_Delegate'],['System_Delegate','System','Delegate',0,C,'System_Object'],['System_ValueType','System','ValueType',0,C,'System_Object'],
 ['System_Void','System','Void',0,S,'System_ValueType'],['System_Boolean','System','Boolean',0,S,'System_ValueType'],['System_Char','System','Char',0,S,'System_ValueType'],['System_SByte','System','SByte',0,S,'System_ValueType'],['System_Byte','System','Byte',0,S,'System_ValueType'],
 ['System_Int16','System','Int16',0,S,'System_ValueType'],['System_UInt16','System','UInt16',0,S,'System_ValueType'],['System_Int32','System','Int32',0,S,'System_ValueType'],['System_UInt32','System','UInt32',0,S,'System_ValueType'],['System_Int64','System','Int64',0,S,'System_ValueType'],['System_UInt64','System','UInt64',0,S,'System_ValueType'],
 ['System_Decimal','System','Decimal',0,S,'System_ValueType'],['System_Single','System','Single',0,S,'System_ValueType'],['System_Double','System','Double',0,S,'System_ValueType'],['System_String','System','String',0,C,'System_Object'],['System_IntPtr','System','IntPtr',0,S,'System_ValueType'],['System_UIntPtr','System','UIntPtr',0,S,'System_ValueType'],
 ['System_Array','System','Array',0,C,'System_Object'],['System_Collections_IEnumerable','System.Collections','IEnumerable',0,I,null],['System_Collections_Generic_IEnumerable_T','System.Collections.Generic','IEnumerable',1,I,null],['System_Collections_Generic_IList_T','System.Collections.Generic','IList',1,I,null],['System_Collections_Generic_ICollection_T','System.Collections.Generic','ICollection',1,I,null],
 ['System_Collections_IEnumerator','System.Collections','IEnumerator',0,I,null],['System_Collections_Generic_IEnumerator_T','System.Collections.Generic','IEnumerator',1,I,null],['System_Collections_Generic_IReadOnlyList_T','System.Collections.Generic','IReadOnlyList',1,I,null],['System_Collections_Generic_IReadOnlyCollection_T','System.Collections.Generic','IReadOnlyCollection',1,I,null],
 ['System_Nullable_T','System','Nullable',1,S,'System_ValueType'],['System_DateTime','System','DateTime',0,S,'System_ValueType'],['System_Runtime_CompilerServices_IsVolatile','System.Runtime.CompilerServices','IsVolatile',0,C,'System_Object'],['System_IDisposable','System','IDisposable',0,I,null],
 ['System_TypedReference','System','TypedReference',0,S,'System_ValueType'],['System_ArgIterator','System','ArgIterator',0,S,'System_ValueType'],['System_RuntimeArgumentHandle','System','RuntimeArgumentHandle',0,S,'System_ValueType'],['System_RuntimeFieldHandle','System','RuntimeFieldHandle',0,S,'System_ValueType'],['System_RuntimeMethodHandle','System','RuntimeMethodHandle',0,S,'System_ValueType'],['System_RuntimeTypeHandle','System','RuntimeTypeHandle',0,S,'System_ValueType'],
 ['System_IAsyncResult','System','IAsyncResult',0,I,null],['System_AsyncCallback','System','AsyncCallback',0,D,'System_MulticastDelegate'],['System_Runtime_CompilerServices_RuntimeFeature','System.Runtime.CompilerServices','RuntimeFeature',0,C,'System_Object'],['System_Runtime_CompilerServices_PreserveBaseOverridesAttribute','System.Runtime.CompilerServices','PreserveBaseOverridesAttribute',0,C,'System_Object'],['System_Runtime_CompilerServices_InlineArrayAttribute','System.Runtime.CompilerServices','InlineArrayAttribute',0,C,'System_Object']
];
const tuples=Array.from({length:8},(_,i)=>['System_ValueTuple_T'+(i<7?i+1:'Rest'),'System','ValueTuple',i+1,S,'System_ValueType']);
const funcs=Array.from({length:5},(_,i)=>['System_Func_T'+(i+1),'System','Func',i+1,D,'System_MulticastDelegate']),actions=Array.from({length:5},(_,i)=>['System_Action'+(i?'_T'+i:''),'System','Action',i,D,'System_MulticastDelegate']);
const wellKnown=[
 ['System_Math','System','Math',0,C,'System_Object'],['System_Console','System','Console',0,C,'System_Object'],['System_Exception','System','Exception',0,C,'System_Object'],['System_Type','System','Type',0,C,'System_Object'],['System_Attribute','System','Attribute',0,C,'System_Object'],['System_ParamArrayAttribute','System','ParamArrayAttribute',0,C,'System_Object'],
 ['System_Index','System','Index',0,S,'System_ValueType'],['System_Range','System','Range',0,S,'System_ValueType'],['System_Span_T','System','Span',1,S,'System_ValueType'],['System_ReadOnlySpan_T','System','ReadOnlySpan',1,S,'System_ValueType'],
 ['System_Threading_Tasks_Task','System.Threading.Tasks','Task',0,C,'System_Object'],['System_Threading_Tasks_Task_T','System.Threading.Tasks','Task',1,C,'System_Object'],['System_Threading_Tasks_ValueTask','System.Threading.Tasks','ValueTask',0,S,'System_ValueType'],['System_Threading_Tasks_ValueTask_T','System.Threading.Tasks','ValueTask',1,S,'System_ValueType'],
 ['System_Runtime_CompilerServices_AsyncTaskMethodBuilder','System.Runtime.CompilerServices','AsyncTaskMethodBuilder',0,S,'System_ValueType'],['System_Runtime_CompilerServices_AsyncTaskMethodBuilder_T','System.Runtime.CompilerServices','AsyncTaskMethodBuilder',1,S,'System_ValueType'],['System_Runtime_CompilerServices_AsyncVoidMethodBuilder','System.Runtime.CompilerServices','AsyncVoidMethodBuilder',0,S,'System_ValueType'],
 ['System_Runtime_CompilerServices_IAsyncStateMachine','System.Runtime.CompilerServices','IAsyncStateMachine',0,I,null],['System_Runtime_CompilerServices_TaskAwaiter','System.Runtime.CompilerServices','TaskAwaiter',0,S,'System_ValueType'],['System_Runtime_CompilerServices_TaskAwaiter_T','System.Runtime.CompilerServices','TaskAwaiter',1,S,'System_ValueType'],
 ['System_Runtime_CompilerServices_DefaultInterpolatedStringHandler','System.Runtime.CompilerServices','DefaultInterpolatedStringHandler',0,S,'System_ValueType'],['System_FormattableString','System','FormattableString',0,C,'System_Object'],
 ['System_IAsyncDisposable','System','IAsyncDisposable',0,I,null],['System_Collections_Generic_IAsyncEnumerable_T','System.Collections.Generic','IAsyncEnumerable',1,I,null],['System_Collections_Generic_IAsyncEnumerator_T','System.Collections.Generic','IAsyncEnumerator',1,I,null],
 ['System_Threading_Interlocked','System.Threading','Interlocked',0,C,'System_Object'],['System_Threading_Monitor','System.Threading','Monitor',0,C,'System_Object'],['System_Collections_Generic_List_T','System.Collections.Generic','List',1,C,'System_Object'],['System_Collections_Generic_Dictionary_KV','System.Collections.Generic','Dictionary',2,C,'System_Object'],['System_Collections_Generic_HashSet_T','System.Collections.Generic','HashSet',1,C,'System_Object'],
 ['System_Collections_Generic_EqualityComparer_T','System.Collections.Generic','EqualityComparer',1,C,'System_Object'],['System_Text_StringBuilder','System.Text','StringBuilder',0,C,'System_Object'],['System_InvalidOperationException','System','InvalidOperationException',0,C,'System_Exception'],['System_NotSupportedException','System','NotSupportedException',0,C,'System_Exception'],
 ['System_Runtime_CompilerServices_SwitchExpressionException','System.Runtime.CompilerServices','SwitchExpressionException',0,C,'System_InvalidOperationException'],['System_Runtime_CompilerServices_IsExternalInit','System.Runtime.CompilerServices','IsExternalInit',0,C,'System_Object'],
 ['System_Linq_Expressions_Expression','System.Linq.Expressions','Expression',0,C,'System_Object'],['System_Linq_Expressions_LambdaExpression','System.Linq.Expressions','LambdaExpression',0,C,'System_Linq_Expressions_Expression'],['System_Linq_Expressions_Expression_T','System.Linq.Expressions','Expression',1,C,'System_Linq_Expressions_LambdaExpression'],['System_Linq_Expressions_ExpressionVisitor','System.Linq.Expressions','ExpressionVisitor',0,C,'System_Object'],
 ['SharpForge_Runtime_Formatting','SharpForge.Runtime','Formatting',0,C,'System_Object'],['SharpForge_Runtime_Async','SharpForge.Runtime','Async',0,C,'System_Object'],
 ...tuples,...funcs,...actions
];
const describe=([id,namespace,name,arity,typeKind,baseId])=>Object.freeze({id,namespace,name,arity,typeKind,baseId,metadataName:(namespace?namespace+'.':'')+name+(arity?'`'+arity:'')});
const specialTable=new Map(special.map(r=>[r[0],describe(r)])),wellKnownTable=new Map(wellKnown.map(r=>[r[0],describe(r)]));
/** Roslyn SpecialType ids (System_Object ... ) mapped to themselves. */
export const SpecialType=Object.freeze(Object.fromEntries(special.map(r=>[r[0],r[0]])));
/** Well-known type ids the compiler needs for lowering. */
export const WellKnownType=Object.freeze(Object.fromEntries(wellKnown.map(r=>[r[0],r[0]])));
export const specialTypeDescriptor=id=>specialTable.get(id)??null;
export const wellKnownTypeDescriptor=id=>wellKnownTable.get(id)??null;
export const specialTypeIds=()=>[...specialTable.keys()];
export const wellKnownTypeIds=()=>[...wellKnownTable.keys()];
/** The descriptor for either table. */
export const coreTypeDescriptor=id=>specialTable.get(id)??wellKnownTable.get(id)??null;
/** Special-type id of a metadata full name such as "System.Int32" or "System.Nullable`1", or null. */
const byMetadataName=new Map(special.map(r=>[describe(r).metadataName,r[0]]));
export const specialTypeFromMetadataName=name=>byMetadataName.get(name)??null;
const keywordIds=Object.freeze({object:'System_Object',void:'System_Void',bool:'System_Boolean',char:'System_Char',sbyte:'System_SByte',byte:'System_Byte',short:'System_Int16',ushort:'System_UInt16',int:'System_Int32',uint:'System_UInt32',long:'System_Int64',ulong:'System_UInt64',decimal:'System_Decimal',float:'System_Single',double:'System_Double',string:'System_String',nint:'System_IntPtr',nuint:'System_UIntPtr'});
/** Special-type id for a C# type keyword (int, string, ...), or null. */
export const specialTypeFromKeyword=keyword=>Object.hasOwn(keywordIds,keyword)?keywordIds[keyword]:null;
const variantInterfaces=new Set(['System_Collections_Generic_IEnumerable_T','System_Collections_Generic_IEnumerator_T','System_Collections_Generic_IReadOnlyList_T','System_Collections_Generic_IReadOnlyCollection_T','System_Collections_Generic_IAsyncEnumerable_T','System_Collections_Generic_IAsyncEnumerator_T']);
/**
 * Declares definitions for the given core type ids (default: every special type) under `globalNamespace`, skipping
 * ids that are already declared. Base types are wired lazily so declaration order does not matter.
 */
export function declareCoreTypes(globalNamespace,ids=specialTypeIds()){
  const provider=new TypeProvider(globalNamespace),declared=[];
  for(const id of ids){const d=coreTypeDescriptor(id);if(!d)throw new RangeError(`Unknown core type '${id}'`);const container=globalNamespace.ensureNamespace(d.namespace);if(container.getTypeMembers(d.name,d.arity).length)continue;
    const names=d.arity===1?['T']:d.name==='Dictionary'?['TKey','TValue']:d.name==='Func'?[...Array.from({length:d.arity-1},(_,i)=>'T'+(d.arity>2?i+1:'')),'TResult']:Array.from({length:d.arity},(_,i)=>'T'+(i+1));
    const type=new NamedTypeSymbol({name:d.name,typeKind:d.typeKind,specialType:specialTable.has(id)?id:null,typeParameters:names.map(name=>new TypeParameterSymbol({name,variance:variantInterfaces.has(id)?Variance.Out:Variance.None})),isSealed:d.typeKind===TypeKind.Struct||id==='System_String',isStatic:['System_Math','System_Console','System_Threading_Interlocked','System_Threading_Monitor','SharpForge_Runtime_Formatting','SharpForge_Runtime_Async'].includes(id),
      baseType:d.baseId?()=>{const b=provider.getCoreType(d.baseId);return b.isErrorType()?null:b;}:null});
    // .NET 9: the type parameters of Func and Action are declared `allows ref struct`.
    if(d.name==='Func'||d.name==='Action')for(const p of type.typeParameters)p.allowsRefLikeType=true;
    type.wellKnownType=wellKnownTable.has(id)?id:null;container.addType(type);declared.push(type);}
  return declared;
}
/**
 * Resolves special and well-known types against a (merged) global namespace.
 * `report(node,code,args)` receives CS0518 the first time a predefined type cannot be found.
 */
export class TypeProvider {
  constructor(globalNamespace,report=null){this.globalNamespace=globalNamespace;this.report=report;this.cache=new Map();this.reported=new Set();}
  /** The symbol for a core type id, or an ErrorTypeSymbol (never null). */
  getCoreType(id,node=null){
    let type=this.cache.get(id);
    if(!type){const d=coreTypeDescriptor(id);if(!d)throw new RangeError(`Unknown core type '${id}'`);const found=this.globalNamespace.lookupNamespace(d.namespace)?.getTypeMembers(d.name,d.arity)??[];
      type=found[0]??new ErrorTypeSymbol(d.name,d.arity,{reason:{code:DiagnosticId.CS0518,args:[d.metadataName.replace(/`\d+$/,'')]}});this.cache.set(id,type);}
    if(type.isErrorType()&&this.report&&!this.reported.has(id)){this.reported.add(id);this.report(node,DiagnosticId.CS0518,type.reason.args);}
    return type;
  }
  getSpecialType(id,node=null){if(!specialTable.has(id))throw new RangeError(`'${id}' is not a special type`);return this.getCoreType(id,node);}
  getWellKnownType(id,node=null){if(!wellKnownTable.has(id))throw new RangeError(`'${id}' is not a well-known type`);return this.getCoreType(id,node);}
  /** The special type a C# keyword denotes, or null when the word is not a type keyword. */
  getKeywordType(keyword,node=null){const id=specialTypeFromKeyword(keyword);return id?this.getCoreType(id,node):null;}
  /** True when the id resolves to a real definition. */
  has(id){return !this.getCoreTypeQuiet(id).isErrorType();}
  getCoreTypeQuiet(id){const report=this.report;this.report=null;try{return this.getCoreType(id);}finally{this.report=report;}}
}
