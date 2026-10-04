import {DiagnosticId} from '../diagnostics/codes.js';
import {ArrayTypeSymbol,SymbolKind} from './types.js';
import {MethodKind} from './members.js';
import {coreTypeDescriptor} from './special-types.js';
/**
 * Well-known members: the framework members the compiler itself needs (lowering targets and runtime helpers).
 *
 * Descriptor shape: {id, type (core type id), name, kind:'method'|'constructor'|'property'|'field', isStatic,
 * parameters:[type descriptor], returnType, arity}. A type descriptor is a core type id, {array:d},
 * {typeParameter:n} (of the declaring type), {methodTypeParameter:n} or {generic:id,args:[d]}.
 * `WellKnownMembers.get` resolves a descriptor against real symbols and reports CS0656 when it is missing, so a
 * lowering pass never reaches into the framework by name.
 */
const arr=d=>({array:d}),T=n=>({typeParameter:n}),MT=n=>({methodTypeParameter:n}),G=(id,...args)=>({generic:id,args});
const method=(id,type,name,isStatic,parameters,returnType,arity=0)=>({id,type,name,kind:'method',isStatic,parameters,returnType,arity});
const ctor=(id,type,parameters)=>({id,type,name:'.ctor',kind:'constructor',isStatic:false,parameters,returnType:'System_Void',arity:0});
const getter=(id,type,name,isStatic,returnType)=>({id,type,name,kind:'property',isStatic,parameters:[],returnType,arity:0});
const O='System_Object',S='System_String',V='System_Void',B='System_Boolean',I='System_Int32',TASK='System_Threading_Tasks_Task',ATMB='System_Runtime_CompilerServices_AsyncTaskMethodBuilder',ATMBT=ATMB+'_T',SM='System_Runtime_CompilerServices_IAsyncStateMachine',EX='System_Exception';
const descriptors=[
  method('System_Object__ToString',O,'ToString',false,[],S),method('System_Object__Equals',O,'Equals',false,[O],B),method('System_Object__GetHashCode',O,'GetHashCode',false,[],I),
  method('System_String__Concat_String_String',S,'Concat',true,[S,S],S),method('System_String__Concat_StringArray',S,'Concat',true,[arr(S)],S),method('System_String__Format_String_ObjectArray',S,'Format',true,[S,arr(O)],S),getter('System_String__get_Length',S,'Length',false,I),method('System_String__op_Equality',S,'op_Equality',true,[S,S],B),
  method('System_IDisposable__Dispose','System_IDisposable','Dispose',false,[],V),ctor('System_Exception__ctor_String',EX,[S]),getter('System_Exception__get_Message',EX,'Message',false,S),
  method('System_Console__WriteLine_Object','System_Console','WriteLine',true,[O],V),getter('System_Array__get_Length','System_Array','Length',false,I),
  getter('System_Nullable_T__get_HasValue','System_Nullable_T','HasValue',false,B),getter('System_Nullable_T__get_Value','System_Nullable_T','Value',false,T(0)),method('System_Nullable_T__GetValueOrDefault','System_Nullable_T','GetValueOrDefault',false,[],T(0)),ctor('System_Nullable_T__ctor','System_Nullable_T',[T(0)]),
  method('System_Delegate__Combine','System_Delegate','Combine',true,['System_Delegate','System_Delegate'],'System_Delegate'),method('System_Delegate__Remove','System_Delegate','Remove',true,['System_Delegate','System_Delegate'],'System_Delegate'),
  method('System_Threading_Monitor__Exit','System_Threading_Monitor','Exit',true,[O],V),method('System_Threading_Interlocked__CompareExchange_T','System_Threading_Interlocked','CompareExchange',true,[MT(0),MT(0),MT(0)],MT(0),1),
  ctor('System_Index__ctor','System_Index',[I,B]),ctor('System_Range__ctor','System_Range',['System_Index','System_Index']),
  method('System_Collections_IEnumerable__GetEnumerator','System_Collections_IEnumerable','GetEnumerator',false,[],'System_Collections_IEnumerator'),method('System_Collections_IEnumerator__MoveNext','System_Collections_IEnumerator','MoveNext',false,[],B),getter('System_Collections_IEnumerator__get_Current','System_Collections_IEnumerator','Current',false,O),
  method('System_Collections_Generic_IEnumerable_T__GetEnumerator','System_Collections_Generic_IEnumerable_T','GetEnumerator',false,[],G('System_Collections_Generic_IEnumerator_T',T(0))),getter('System_Collections_Generic_IEnumerator_T__get_Current','System_Collections_Generic_IEnumerator_T','Current',false,T(0)),
  method(ATMB+'__Create',ATMB,'Create',true,[],ATMB),method(ATMB+'__SetResult',ATMB,'SetResult',false,[],V),method(ATMB+'__SetException',ATMB,'SetException',false,[EX],V),getter(ATMB+'__get_Task',ATMB,'Task',false,TASK),method(ATMB+'__SetStateMachine',ATMB,'SetStateMachine',false,[SM],V),
  method(ATMBT+'__Create',ATMBT,'Create',true,[],G(ATMBT,T(0))),method(ATMBT+'__SetResult',ATMBT,'SetResult',false,[T(0)],V),method(ATMBT+'__SetException',ATMBT,'SetException',false,[EX],V),getter(ATMBT+'__get_Task',ATMBT,'Task',false,G(TASK+'_T',T(0))),
  method(SM+'__MoveNext',SM,'MoveNext',false,[],V),method(SM+'__SetStateMachine',SM,'SetStateMachine',false,[SM],V),
  ctor('System_Runtime_CompilerServices_SwitchExpressionException__ctor','System_Runtime_CompilerServices_SwitchExpressionException',[]),ctor('System_InvalidOperationException__ctor','System_InvalidOperationException',[]),
  method('SharpForge_Runtime_Formatting__FormatValue','SharpForge_Runtime_Formatting','FormatValue',true,[O,S,I,S],S),method('SharpForge_Runtime_Formatting__BoxValue','SharpForge_Runtime_Formatting','BoxValue',true,[O,S],O),
  method('SharpForge_Runtime_Async__Await_Task','SharpForge_Runtime_Async','Await',true,[TASK],V),method('SharpForge_Runtime_Async__Start_Action','SharpForge_Runtime_Async','Start',true,['System_Action'],TASK)
];
const table=new Map(descriptors.map(d=>[d.id,Object.freeze(d)]));
/** Well-known member ids mapped to themselves. */
export const WellKnownMember=Object.freeze(Object.fromEntries(descriptors.map(d=>[d.id,d.id])));
export const wellKnownMemberDescriptor=id=>table.get(id)??null;
export const wellKnownMemberIds=()=>[...table.keys()];
export class WellKnownMembers {
  /** @param typeProvider a TypeProvider; @param report `(node,code,args)` receiving CS0656 once per missing member. */
  constructor(typeProvider,report=null){this.types=typeProvider;this.report=report;this.cache=new Map();this.reported=new Set();}
  matches(descriptor,type,owner,member){
    if(typeof descriptor==='string'){const expected=this.types.getCoreTypeQuiet(descriptor);return !expected.isErrorType()&&expected.equals(type);}
    if(descriptor.array)return type instanceof ArrayTypeSymbol&&type.rank===1&&this.matches(descriptor.array,type.elementType,owner,member);
    if(descriptor.typeParameter!==undefined)return (owner.typeArguments[descriptor.typeParameter]?.type??null)===type||!!owner.typeArguments[descriptor.typeParameter]?.type.equals(type);
    if(descriptor.methodTypeParameter!==undefined)return member.typeParameters?.[descriptor.methodTypeParameter]===type;
    if(descriptor.generic){const definition=this.types.getCoreTypeQuiet(descriptor.generic);return type.originalDefinition===definition&&descriptor.args.every((a,i)=>this.matches(a,type.typeArguments[i].type,owner,member));}
    return false;
  }
  /** Finds the member without reporting; null when the type or member is missing. `containingType` selects a construction of a generic declaring type. */
  find(id,containingType=null){
    const d=table.get(id);if(!d)throw new RangeError(`Unknown well-known member '${id}'`);const owner=containingType??this.types.getCoreTypeQuiet(d.type);if(owner.isErrorType())return null;
    for(const m of owner.getMembers(d.kind==='constructor'?'.ctor':d.name)){
      if(d.kind==='property'){if(m.kind===SymbolKind.Property&&m.isStatic===d.isStatic&&this.matches(d.returnType,m.type,owner,m))return m;continue;}
      if(d.kind==='field'){if(m.kind===SymbolKind.Field&&m.isStatic===d.isStatic)return m;continue;}
      if(m.kind!==SymbolKind.Method||(d.kind==='constructor')!==(m.methodKind===MethodKind.Constructor)||m.isStatic!==d.isStatic||m.arity!==d.arity||m.parameters.filter(p=>!p.isOptional).length>d.parameters.length||m.parameters.length<d.parameters.length)continue;
      if(d.parameters.every((p,i)=>this.matches(p,m.parameters[i].type,owner,m))&&(d.kind==='constructor'||this.matches(d.returnType,m.returnType,owner,m)))return m;
    }
    return null;
  }
  /** The member symbol, or null after reporting CS0656 ("Missing compiler required member 'Type.Member'") at `node`. */
  get(id,node=null,containingType=null){
    const key=containingType?null:id;if(key&&this.cache.has(key))return this.cache.get(key);const member=this.find(id,containingType);if(key&&member)this.cache.set(key,member);
    if(!member&&this.report&&!this.reported.has(id)){this.reported.add(id);const d=table.get(id),t=coreTypeDescriptor(d.type);this.report(node,DiagnosticId.CS0656,[(t.namespace?t.namespace+'.':'')+t.name,d.name]);}
    return member;
  }
  has(id,containingType=null){return this.find(id,containingType)!==null;}
}
