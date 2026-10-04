import test from 'node:test';
import assert from 'node:assert/strict';
import {types,contracts,findContracts,frameworkType} from '@sharpforge/framework';
import {Builtins,BuiltinMap} from '@sharpforge/bytecode';
import {NamedTypeSymbol,ArrayTypeSymbol,ErrorTypeSymbol,TypeKind,SymbolKind,SymbolDisplayFormat as F} from '../packages/compiler/src/symbols/types.js';
import {MethodKind} from '../packages/compiler/src/symbols/members.js';
import {NamespaceSymbol,NamespaceExtent,MergedNamespaceSymbol,mergeGlobalNamespaces,AliasSymbol} from '../packages/compiler/src/symbols/namespaces.js';
import {SpecialType,WellKnownType,TypeProvider,declareCoreTypes,specialTypeDescriptor,wellKnownTypeDescriptor,specialTypeIds,specialTypeFromKeyword,specialTypeFromMetadataName} from '../packages/compiler/src/symbols/special-types.js';
import {WellKnownMember,WellKnownMembers,wellKnownMemberIds,wellKnownMemberDescriptor} from '../packages/compiler/src/symbols/well-known-members.js';
import {RegistryBridge,frameworkBridge,parseRegistryName} from '../packages/compiler/src/symbols/registry-bridge.js';
import {LegacyTypeAdapter} from '../packages/compiler/src/symbols/legacy-types.js';
import {hasDiagnosticCode,formatMessage} from '../packages/compiler/src/diagnostics/codes.js';
const bridge=frameworkBridge();
// Symbols form large cyclic graphs: compare by identity without asking assert to render a diff.
const same=(a,b,message)=>assert(a===b,message??'expected the same symbol');
test('A02-T16 namespace symbols: nesting, lookup and qualified names',()=>{
  const g=new NamespaceSymbol();assert.equal(g.isGlobalNamespace,true);assert.equal(g.toDisplayString(),'<global namespace>');
  const inner=g.ensureNamespace('A.B.C');assert.equal(inner.qualifiedName,'A.B.C');assert.equal(inner.toDisplayString(),'A.B.C');assert.equal(inner.toDisplayString(F.FullyQualified),'global::A.B.C');assert.equal(inner.toDisplayString(F.MinimallyQualified),'C');
  assert.equal(g.lookupNamespace('A.B'),inner.containingNamespace);assert.equal(g.lookupNamespace('A.X'),null);assert.equal(g.ensureNamespace('A.B.C'),inner);assert.equal(inner.kind,SymbolKind.Namespace);
  const foo=inner.addType(new NamedTypeSymbol({name:'Foo'})),foo1=inner.addType(new NamedTypeSymbol({name:'Foo',arity:1}));
  same(g.lookupType('A.B.C.Foo',0),foo);same(g.lookupType('A.B.C.Foo',1),foo1);assert.equal(inner.getTypeMembers('Foo').length,2);assert.equal(foo.containingNamespace,inner);assert.equal(foo.toDisplayString(),'A.B.C.Foo');
  assert.deepEqual(inner.getMembers('Foo'),[foo,foo1]);assert.deepEqual(g.getMembers('A').map(m=>m.kind),[SymbolKind.Namespace]);assert.deepEqual([...g.allTypes()],[foo,foo1]);
});
test('A02-T16 the merged global namespace unions source and metadata namespaces',()=>{
  const source=new NamespaceSymbol('',null,NamespaceExtent.Source,{name:'App'}),meta=new NamespaceSymbol('',null,NamespaceExtent.Metadata,{name:'Lib'});
  const mine=source.ensureNamespace('System.Text').addType(new NamedTypeSymbol({name:'Mine'})),theirs=meta.ensureNamespace('System.Text').addType(new NamedTypeSymbol({name:'StringBuilder'})),other=meta.ensureNamespace('Other').addType(new NamedTypeSymbol({name:'Mine'}));
  const merged=mergeGlobalNamespaces(source,meta);assert(merged instanceof MergedNamespaceSymbol);assert.equal(merged.isGlobalNamespace,true);assert.equal(merged.extent,NamespaceExtent.Compilation);
  const text=merged.lookupNamespace('System.Text');assert.equal(text.constituentNamespaces.length,2);assert.equal(text.qualifiedName,'System.Text');assert.deepEqual(text.getTypeMembers().map(t=>t.name),['Mine','StringBuilder'],'source declarations come first');
  same(merged.lookupType('System.Text.StringBuilder'),theirs);same(merged.lookupType('Other.Mine'),other);same(merged.lookupType('System.Text.Mine'),mine);assert.equal(text,merged.lookupNamespace('System.Text'),'merged namespaces are cached');
  assert.deepEqual(merged.getNamespaceMembers().map(n=>n.name).sort(),['Other','System']);assert.equal(theirs.containingNamespace.module.name,'Lib');
  assert.equal(mergeGlobalNamespaces(source),source);assert.throws(()=>merged.addType(mine),TypeError);assert.throws(()=>mergeGlobalNamespaces(source.getNamespace('System')),TypeError);
  const alias=new AliasSymbol('SB',theirs);assert.equal(alias.kind,SymbolKind.Alias);assert.equal(alias.target,theirs);
  const withFramework=mergeGlobalNamespaces(source,bridge.globalNamespace);assert.equal(withFramework.lookupType('System.Text.StringBuilder'),bridge.typeFromName('System.Text.StringBuilder'));
});
test('A02-T18 special and well-known type tables',()=>{
  assert.equal(SpecialType.System_Object,'System_Object');assert.equal(specialTypeIds()[0],'System_Object');assert(specialTypeIds().includes('System_Nullable_T')&&specialTypeIds().includes('System_IDisposable'));
  assert.deepEqual(specialTypeDescriptor('System_Int32'),{id:'System_Int32',namespace:'System',name:'Int32',arity:0,typeKind:TypeKind.Struct,baseId:'System_ValueType',metadataName:'System.Int32'});
  assert.equal(specialTypeDescriptor('System_Collections_Generic_IEnumerable_T').metadataName,'System.Collections.Generic.IEnumerable`1');
  for(const id of ['System_Index','System_Range','System_Span_T','System_Threading_Tasks_Task_T','System_Runtime_CompilerServices_AsyncTaskMethodBuilder','System_ValueTuple_T2','System_ValueTuple_TRest','System_Func_T2','System_Action'])assert(wellKnownTypeDescriptor(WellKnownType[id]),id);
  assert.equal(specialTypeFromKeyword('int'),'System_Int32');assert.equal(specialTypeFromKeyword('nuint'),'System_UIntPtr');assert.equal(specialTypeFromKeyword('toString'),null);assert.equal(specialTypeFromMetadataName('System.Nullable`1'),'System_Nullable_T');assert.equal(specialTypeFromMetadataName('System.Console'),null);
});
test('A02-T18 TypeProvider resolves predefined types and reports CS0518 once when one is missing',()=>{
  const g=new NamespaceSymbol(),declared=declareCoreTypes(g);assert.equal(declared.length,specialTypeIds().length);assert.equal(declareCoreTypes(g).length,0,'idempotent');
  const reports=[],provider=new TypeProvider(g,(node,code,args)=>reports.push([code,...args]));
  const int=provider.getSpecialType('System_Int32');assert.equal(int.specialType,'System_Int32');assert.equal(int.toDisplayString(),'int');assert.equal(int.baseType,provider.getSpecialType('System_ValueType'));assert.equal(int.baseType.baseType.specialType,'System_Object');assert.equal(provider.getSpecialType('System_Object').baseType,null);
  assert.equal(provider.getKeywordType('string'),provider.getSpecialType('System_String'));assert.equal(provider.getKeywordType('Foo'),null);
  const nullable=provider.getSpecialType('System_Nullable_T');assert.equal(nullable.construct(int).toDisplayString(),'int?');assert.equal(provider.getSpecialType('System_Collections_Generic_IEnumerable_T').typeParameters[0].variance,'out');
  assert.deepEqual(reports,[]);
  const index=provider.getWellKnownType('System_Index');assert(index instanceof ErrorTypeSymbol);provider.getWellKnownType('System_Index');assert.deepEqual(reports,[['CS0518','System.Index']],'reported once');assert.equal(provider.has('System_Index'),false);assert.equal(provider.has('System_Int32'),true);
  assert.equal(formatMessage('CS0518',['System.Index']),"Predefined type 'System.Index' is not defined or imported");
  assert.throws(()=>provider.getSpecialType('System_Index'),RangeError);assert.throws(()=>provider.getCoreType('Nope'),RangeError);
  const empty=new TypeProvider(new NamespaceSymbol(),(n,code,args)=>reports.push([code,...args]));assert(empty.getSpecialType('System_Object').isErrorType());assert.deepEqual(reports.at(-1),['CS0518','System.Object']);
  declareCoreTypes(g,['System_Index','System_ValueTuple_T2','System_Func_T2']);assert.equal(new TypeProvider(g).getWellKnownType('System_Index').toDisplayString(),'System.Index');assert.equal(new TypeProvider(g).getWellKnownType('System_Func_T2').toDisplayString(),'System.Func<T, TResult>');
});
test('A02-T18 well-known members resolve through the table and report CS0656 when missing',()=>{
  const reports=[],members=new WellKnownMembers(bridge.typeProvider,(node,code,args)=>reports.push([code,...args]));
  const format=members.get(WellKnownMember.SharpForge_Runtime_Formatting__FormatValue);assert.equal(format.toDisplayString(F.Test),'System.String SharpForge.Runtime.Formatting.FormatValue(System.Object arg0, System.String arg1, System.Int32 arg2, System.String arg3)');
  assert.equal(format.contract,findContracts('SharpForge.Runtime.Formatting','FormatValue',true)[0]);assert.equal(members.get('SharpForge_Runtime_Formatting__FormatValue'),format,'cached');
  assert.equal(members.get('SharpForge_Runtime_Formatting__BoxValue').contract,findContracts('SharpForge.Runtime.Formatting','BoxValue',true)[0]);
  assert.equal(members.get('SharpForge_Runtime_Async__Await_Task').contract.kind,'await');assert.equal(members.get('System_Exception__ctor_String').builtin,BuiltinMap.get('Exception.new'));assert.equal(members.get('System_Exception__get_Message').getMethod.builtin,BuiltinMap.get('Exception.Message'));
  assert.equal(members.get('System_String__Concat_String_String').toDisplayString(),'string.Concat(string, string)');assert.equal(members.get('System_String__Concat_StringArray').toDisplayString(),'string.Concat(params string[])');assert.equal(members.get('System_Console__WriteLine_Object').builtin.name,'Console.WriteLine');
  assert.equal(members.get('System_Object__ToString').builtin.name,'object.ToString');assert.equal(members.get('System_IDisposable__Dispose').toDisplayString(),'System.IDisposable.Dispose()');assert.deepEqual(reports,[]);
  assert.equal(members.get('System_Index__ctor',{start:3}),null);assert.equal(members.get('System_Index__ctor'),null);assert.equal(members.get('System_Delegate__Combine'),null);
  assert.deepEqual(reports,[['CS0656','System.Index','.ctor'],['CS0656','System.Delegate','Combine']]);assert.equal(formatMessage('CS0656',reports[0].slice(1)),"Missing compiler required member 'System.Index..ctor'");assert.equal(members.has('System_Range__ctor'),false);
  for(const id of wellKnownMemberIds()){const d=wellKnownMemberDescriptor(id);assert(specialTypeDescriptor(d.type)||wellKnownTypeDescriptor(d.type),id+' names a core type');}
  assert.throws(()=>members.get('Nope'),RangeError);assert(hasDiagnosticCode('CS0656')&&hasDiagnosticCode('CS0518'));
  // Generic declaring types resolve against a construction.
  const g=new NamespaceSymbol();declareCoreTypes(g);const provider=new TypeProvider(g),nullable=provider.getSpecialType('System_Nullable_T');assert.equal(new WellKnownMembers(provider).find('System_Nullable_T__get_HasValue',nullable.construct(provider.getSpecialType('System_Int32'))),null,'no members declared');
});
test('A02-T19 every registry type is reachable as a symbol',()=>{
  for(const [name,entry] of types){const type=bridge.typeFromName(name);assert(type instanceof NamedTypeSymbol,name);const {path,arity}=parseRegistryName(name);assert.equal(type.name,path.slice(path.lastIndexOf('.')+1),name);assert.equal(type.arity,arity,name);
    assert.equal(bridge.registryName(type)===name||!!type.specialType,true,name);if(entry.kind==='enum')assert.equal(type.typeKind,TypeKind.Enum);if(entry.kind==='delegate')assert.equal(type.typeKind,TypeKind.Delegate);
    const found=arity?bridge.globalNamespace.lookupType(path,arity)?.construct(type.typeArguments):name.includes('.')&&!type.containingType?bridge.globalNamespace.lookupType(path,0):type;same(found,type,name+' is reachable through the namespace tree');}
  assert.equal(bridge.globalNamespace.extent,NamespaceExtent.Metadata);assert.equal(bridge.typeFromName('System.Text.Json.JsonElement.ArrayEnumerator').containingType,bridge.typeFromName('System.Text.Json.JsonElement'));
  assert.equal(bridge.typeFromName('Microsoft.UI.Xaml.Controls.Button').baseType,bridge.typeFromName('Microsoft.UI.Xaml.Controls.ContentControl'));assert.equal(bridge.typeFromName('Microsoft.UI.Xaml.Visibility').baseType.specialType,'System_Enum');
  same(bridge.typeFromName('Button'),bridge.typeFromName('Microsoft.UI.Xaml.Controls.Button'),'registry aliases resolve');same(bridge.typeFromName('List<int>'),bridge.typeFromName('System.Collections.Generic.List`1<int>'));same(bridge.typeFromName('NoSuchType'),null);
  const list=bridge.typeFromName('List<int>');assert.equal(list.toDisplayString(),'System.Collections.Generic.List<int>');same(list.originalDefinition.construct(bridge.typeFromName('int')),list,'constructing the definition finds the registry instantiation');
  const unlisted=list.originalDefinition.construct(bridge.typeFromName('long')).getMembers();assert(unlisted.length>0&&unlisted.every(m=>!m.contract),'an instantiation outside the closed registry has the open members, none of them a contract');
  assert(bridge.typeFromName('int[]') instanceof ArrayTypeSymbol);same(bridge.typeFromName('int[]'),bridge.typeFromName('int[]'));assert.equal(bridge.registryName(bridge.typeFromName('double[]')),'double[]');
});
test('A02-T19 every registry contract and builtin is reachable as a member symbol',()=>{
  for(const c of contracts){const m=bridge.symbolForContract(c);assert(m,`${c.owner}.${c.name}`);same(m.contract,c);assert.equal(m.isStatic,c.isStatic,c.owner+'.'+c.name);assert.equal(m.parameters.length,c.parameters.length);
    const owner=bridge.typeFromName(c.owner);assert(owner.getMembers(c.name).includes(m),`${c.owner}.${c.name} is a member of its owner`);same(m.containingType,owner);
    if(c.kind==='constructor')assert.equal(m.methodKind,MethodKind.Constructor);if(c.kind==='get'){assert.equal(m.methodKind,MethodKind.PropertyGet);assert.equal(m.associatedSymbol.name,c.property);same(owner.getMembers(c.property)[0].getMethod,m);}
    if(c.kind==='eventAdd')same(owner.getMembers(c.event)[0].addMethod,m);}
  for(const b of Builtins.filter(b=>!b.contract&&!b.name.startsWith('$'))){const m=bridge.symbolForBuiltin(b);assert(m,b.name);same(m.builtin,b);}
  const add=bridge.typeFromName('List<string>').getMembers('Add')[0];assert.equal(add.toDisplayString(F.Test),'void System.Collections.Generic.List<System.String>.Add(System.String arg0)');
  const dictionary=bridge.typeFromName('Dictionary<string, int>'),indexer=dictionary.getMembers('this[]')[0];assert.equal(indexer.isIndexer,true);assert.equal(indexer.toDisplayString(),'System.Collections.Generic.Dictionary<string, int>.this[string]');assert.equal(indexer.setMethod.contract.name,'set_Item');
  const click=bridge.typeFromName('Button').getMembers('Click')[0];assert.equal(click.kind,SymbolKind.Event);same(click.type,bridge.typeFromName('Microsoft.UI.Xaml.RoutedEventHandler'));assert.equal(click.type.delegateInvokeMethod.methodKind,MethodKind.DelegateInvoke);
  const collapsed=bridge.typeFromName('Microsoft.UI.Xaml.Visibility').getMembers('Collapsed')[0];assert.equal(collapsed.isConst,true);assert.equal(collapsed.constantValue,1);
  assert.equal(bridge.typeFromName('string').getMembers('Length')[0].getMethod.contract,findContracts('System.String','get_Length',false)[0]);
  assert.equal(bridge.typeFromName('System.Console').getMembers('WriteLine')[0].parameters[0].isOptional,true,'Console.WriteLine() and WriteLine(value) share one builtin');
  const custom=new RegistryBridge({types:new Map([['Demo.Widget',{name:'Demo.Widget',base:'object',properties:{},events:{},kind:'object'}]]),contracts:[{id:0,owner:'Demo.Widget',name:'Ping',parameters:['int'],result:'bool',isStatic:false,kind:'method'}],builtins:[]});
  assert.equal(custom.typeFromName('Demo.Widget').getMembers('Ping')[0].toDisplayString(),'Demo.Widget.Ping(int)');
});
test('integrated runtime type properties and static identity helpers have correct symbol signatures',()=>{
  for(const name of ['Type.Name','Type.FullName']){
    const symbol=bridge.symbolForBuiltin(BuiltinMap.get(name));
    assert.equal(symbol.kind,SymbolKind.Property);assert.equal(symbol.isStatic,false);
    assert.equal(symbol.getMethod.parameters.length,0);assert.equal(symbol.type.specialType,'System_String');
  }
  assert.equal(bridge.typeFromName('System.Type').isStatic,false);
  for(const [name,count] of [['string.Intern',1],['string.IsInterned',1],['object.ReferenceEquals',2]]){
    const symbol=bridge.symbolForBuiltin(BuiltinMap.get(name));assert.equal(symbol.isStatic,true,name);assert.equal(symbol.parameters.length,count,name);
  }
  const flag=bridge.symbolForBuiltin(BuiltinMap.get('Enum.HasFlag'));assert.equal(flag.isStatic,false);assert.equal(flag.parameters.length,1);
});
test('A02-T14 the legacy adapter keeps string-typed call sites working',()=>{
  const userType=new NamedTypeSymbol({name:'Foo'}),adapter=new LegacyTypeAdapter({bridge,sourceType:name=>name==='Foo'?userType:null});
  for(const name of ['int','double','bool','string','object','void','Exception','int[]','string[][]','Foo','Foo[]',...types.keys(),'System.Threading.Tasks.Task[]']){const symbol=adapter.symbol(name);assert(symbol,name);assert.equal(adapter.symbol(name),symbol,'interned: '+name);assert.equal(adapter.name(symbol)===name||name==='System.String',true,name+' round-trips, got '+adapter.name(symbol));}
  assert.equal(adapter.symbol('null'),null);assert.equal(adapter.name(null),'null');assert.equal(adapter.symbol('error'),ErrorTypeSymbol.unknown);assert.equal(adapter.name(ErrorTypeSymbol.unknown),'error');
  assert.equal(adapter.symbol('int').specialType,'System_Int32');assert.equal(adapter.symbol('Foo'),userType);assert.equal(adapter.symbol('Foo[]').elementType,userType);assert.equal(adapter.symbol('Exception').toDisplayString(),'System.Exception');
  const missing=adapter.symbol('Missing');assert(missing instanceof ErrorTypeSymbol);assert.equal(adapter.name(missing),'Missing');assert.equal(adapter.name(adapter.symbol('error[]')),'error[]');
  assert.equal(adapter.symbol("System.Collections.Generic.List`1<int>").toDisplayString(F.MinimallyQualified),'List<int>');assert.equal(adapter.symbol(userType),userType);
  for(const [name] of types)assert.equal(!!frameworkType(name),true);
});
