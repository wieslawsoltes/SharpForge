import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importAssembly,PEAssemblySymbol,specialTypeId} from '../packages/compiler/src/metadata-import/pe-symbols.js';
import {SymbolKind,TypeKind,Accessibility,RefKind,Variance,SymbolDisplayFormat,ErrorTypeSymbol,ArrayTypeSymbol,PointerTypeSymbol,FunctionPointerTypeSymbol} from '../packages/compiler/src/symbols/types.js';
import {MethodKind,DeclarationModifiers} from '../packages/compiler/src/symbols/members.js';
import {NamespaceSymbol,NamespaceExtent,mergeGlobalNamespaces} from '../packages/compiler/src/symbols/namespaces.js';

// The fixtures are real assemblies built by csc (tests/fixtures/metadata/build-fixtures.mjs); the tests only read them.
const fixture=name=>new Uint8Array(readFileSync(new URL('./fixtures/metadata/'+name,import.meta.url)));
const T=SymbolDisplayFormat.Test,show=s=>s.toDisplayString(T);
const core=importAssembly(fixture('MiniStandard.dll'));
const type=name=>{const t=core.getTypeByMetadataName(name);assert.ok(t,name+' is imported');return t;};
const member=(t,name)=>{const m=t.getMembers(name);assert.equal(m.length,1,`${show(t)} has one member '${name}'`);return m[0];};

test('A02-T20 an assembly image becomes an assembly symbol with identity and a metadata namespace tree',()=>{
  assert.ok(core instanceof PEAssemblySymbol);assert.equal(core.kind,SymbolKind.Assembly);assert.equal(core.name,'MiniStandard');
  assert.match(core.identity.getDisplayName(),/^MiniStandard, Version=2\.1\.0\.0, Culture=neutral, PublicKeyToken=[0-9a-f]{16}$/);
  assert.equal(core.isCorLibrary,true);assert.deepEqual(core.referencedAssemblyIdentities,[]);
  const global=core.globalNamespace;assert.equal(global.isGlobalNamespace,true);assert.equal(global.extent,NamespaceExtent.Metadata);
  assert.deepEqual(global.getNamespaceMembers().map(n=>n.name).sort(),['Microsoft','Mini','System']);
  assert.equal(global.lookupNamespace('System.Collections.Generic').qualifiedName,'System.Collections.Generic');
  assert.equal(global.lookupType('System.Collections.Generic.List',1),type('System.Collections.Generic.List`1'));
  assert.equal(global.lookupType('<Module>'),null,'the module type is not a symbol');
});

test('A02-T20 a reference to a netstandard-style DLL binds System.Console.WriteLine with a string argument',()=>{
  // Lookup runs over the merged global namespace: the source module first, then the referenced assembly.
  const source=new NamespaceSymbol(''),merged=mergeGlobalNamespaces(source,core.globalNamespace);
  const console_=merged.lookupType('System.Console'),string=merged.lookupType('System.String');
  assert.equal(show(console_),'System.Console');assert.equal(console_.isStatic,true);assert.equal(string.specialType,'System_String');
  const overloads=console_.getMembers('WriteLine');
  assert.deepEqual(overloads.map(show),['void System.Console.WriteLine()','void System.Console.WriteLine(System.Boolean value)','void System.Console.WriteLine(System.Int32 value)','void System.Console.WriteLine(System.Double value)',
    'void System.Console.WriteLine(System.String? value)','void System.Console.WriteLine(System.Object? value)','void System.Console.WriteLine(System.String format, params System.Object?[] arg)']);
  // Overload resolution for one string argument: identity conversion beats the reference conversion to object.
  const applicable=overloads.filter(m=>m.parameters.length===1&&(m.parameters[0].type.equals(string)||m.parameters[0].type.specialType==='System_Object'));
  assert.equal(applicable.length,2);const best=applicable.find(m=>m.parameters[0].type.equals(string));
  assert.equal(show(best),'void System.Console.WriteLine(System.String? value)');
  assert.equal(best.toDisplayString(),'System.Console.WriteLine(string?)');
  assert.equal(best.isStatic,true);assert.equal(best.returnsVoid,true);assert.equal(best.declaredAccessibility,Accessibility.Public);assert.equal(best.containingType,console_);
});

test('A02-T20 a generic List<T>.Add call binds on the constructed type with the parameter substituted',()=>{
  const list=core.globalNamespace.lookupType('System.Collections.Generic.List',1),int=core.globalNamespace.lookupType('System.Int32');
  assert.equal(show(list),'System.Collections.Generic.List<T>');assert.equal(list.metadataName,'List`1');assert.equal(list.arity,1);
  const definitionAdd=member(list,'Add');assert.equal(show(definitionAdd),'void System.Collections.Generic.List<T>.Add(T item)');assert.equal(definitionAdd.parameters[0].type,list.typeParameters[0]);
  const listOfInt=list.construct(int),add=member(listOfInt,'Add');
  assert.equal(show(add),'void System.Collections.Generic.List<System.Int32>.Add(System.Int32 item)');
  assert.equal(add.toDisplayString(),'System.Collections.Generic.List<int>.Add(int)');
  assert.ok(add.parameters[0].type.equals(int));assert.equal(add.originalDefinition,definitionAdd);assert.ok(add.containingType.equals(listOfInt));
  assert.equal(show(member(listOfInt,'this[]')),'System.Int32 System.Collections.Generic.List<System.Int32>.this[System.Int32 index] { get; set; }');
  assert.equal(show(member(listOfInt,'Count')),'System.Int32 System.Collections.Generic.List<System.Int32>.Count { get; }');
  assert.deepEqual(listOfInt.interfaces.map(show),['System.Collections.Generic.IEnumerable<System.Int32>','System.Collections.IEnumerable']);
  // A generic method on a generic type: T comes from the type, TOutput from the method.
  const convert=member(listOfInt,'ConvertAll'),string=type('System.String');
  assert.equal(show(convert),'TOutput[] System.Collections.Generic.List<System.Int32>.ConvertAll<TOutput>(System.Converter<System.Int32, TOutput> converter)');
  assert.equal(show(convert.construct(string)),'System.String[] System.Collections.Generic.List<System.Int32>.ConvertAll<System.String>(System.Converter<System.Int32, System.String> converter)');
});

test('A02-T20 core types carry special-type ids and display as keywords',()=>{
  for(const [name,keyword] of [['System.Object','object'],['System.Void','void'],['System.Boolean','bool'],['System.Int32','int'],['System.Double','double'],['System.String','string'],['System.Char','char'],['System.Int64','long'],['System.Decimal','decimal']]){
    const t=type(name);assert.equal(t.specialType,specialTypeId(name));assert.equal(t.toDisplayString(),keyword);assert.equal(show(t),name==='System.Void'?'void':name);assert.equal(core.getSpecialType(t.specialType),t);
  }
  assert.equal(type('System.Nullable`1').specialType,'System_Nullable_T');assert.equal(type('System.Collections.Generic.IEnumerable`1').specialType,'System_Collections_Generic_IEnumerable_T');
  assert.equal(type('System.Console').specialType,null);assert.equal(type('Mini.Refs').specialType,null);
  const missing=core.getSpecialType('System_DateTime');assert.ok(missing instanceof ErrorTypeSymbol);assert.deepEqual(missing.reason,{code:'CS0518',args:['System.DateTime']});
});

test('A02-T20 type kinds, accessibility, modifiers, base types and interfaces come from TypeDef rows',()=>{
  const kinds=n=>type(n).typeKind;
  assert.deepEqual(['System.Object','System.ValueType','System.Enum','System.Int32','System.AttributeTargets','System.IDisposable','System.Action`1','System.String'].map(kinds),[TypeKind.Class,TypeKind.Class,TypeKind.Class,TypeKind.Struct,TypeKind.Enum,TypeKind.Interface,TypeKind.Delegate,TypeKind.Class]);
  assert.equal(type('System.Object').baseType,null);assert.equal(type('System.IDisposable').baseType,null);assert.equal(show(type('System.Int32').baseType),'System.ValueType');assert.equal(show(type('Mini.LoudNotifier').baseType),'Mini.Notifier');
  assert.equal(type('Mini.LoudNotifier').isDerivedFrom(type('System.Object')),true);
  const console_=type('System.Console'),notifier=type('Mini.Notifier'),string=type('System.String');
  assert.deepEqual([console_.isStatic,console_.isAbstract,console_.isSealed],[true,false,false]);assert.deepEqual([notifier.isStatic,notifier.isAbstract,notifier.isSealed],[false,true,false]);assert.deepEqual([string.isAbstract,string.isSealed],[false,true]);
  assert.equal(type('System.Collections.Generic.List`1').isReferenceType,true);assert.equal(type('Mini.Point').isValueType,true);
  assert.equal(show(type('System.AttributeTargets').enumUnderlyingType),'System.Int32');assert.equal(show(type('Mini.Outer`1+Kind').enumUnderlyingType),'System.Byte');
  const invoke=type('System.Func`2').delegateInvokeMethod;assert.equal(invoke.methodKind,MethodKind.DelegateInvoke);assert.equal(show(invoke),'TResult System.Func<T, TResult>.Invoke(T arg)');
  assert.deepEqual(type('System.Collections.Generic.List`1+Enumerator').allInterfaces.map(show),['System.Collections.Generic.IEnumerator<T>','System.Collections.IEnumerator','System.IDisposable']);
});

test('A02-T20 type parameters import variance and constraints',()=>{
  const variant=type('Mini.IVariant`2');assert.deepEqual(variant.typeParameters.map(p=>[p.name,p.ordinal,p.variance]),[['TIn',0,Variance.In],['TOut',1,Variance.Out]]);
  assert.equal(variant.typeParameters[0].containingSymbol,variant);
  const [key,value,item]=type('Mini.Constrained`3').typeParameters;
  assert.deepEqual([key.hasValueTypeConstraint,key.hasReferenceTypeConstraint,key.hasConstructorConstraint,key.constraintTypes.length],[true,false,false,0]);assert.equal(key.isValueType,true);
  assert.deepEqual([value.hasReferenceTypeConstraint,value.hasConstructorConstraint,value.constraintTypes.map(show)],[true,true,['System.IDisposable']]);assert.equal(value.isReferenceType,true);
  assert.deepEqual([item.hasUnmanagedTypeConstraint,item.hasValueTypeConstraint],[true,true]);
  const bind=member(type('Mini.Constrained`3'),'Bind'),other=bind.typeParameters[0];
  assert.equal(other.typeParameterKind,'method');assert.equal(other.containingSymbol,bind);assert.equal(other.constraintTypes[0].type,value,'a method type parameter constrained to a type parameter of its type');
  assert.equal(type('System.Collections.Generic.Dictionary`2').typeParameters[0].hasNotNullConstraint,true);assert.equal(type('System.Collections.Generic.Dictionary`2').typeParameters[1].hasNotNullConstraint,false);
});

test('A02-T20 nested types and generic signatures map VAR/MVAR/GENERICINST to the right symbols',()=>{
  const outer=type('Mini.Outer`1'),inner=type('Mini.Outer`1+Inner`1'),plain=type('Mini.Outer`1+Plain'),kind=type('Mini.Outer`1+Kind');
  assert.equal(inner.containingType,outer);assert.equal(inner.name,'Inner');assert.equal(inner.arity,1);assert.equal(inner.metadataName,'Inner`1');assert.equal(inner.metadataFullName,'Mini.Outer`1+Inner`1');
  assert.equal(show(inner),'Mini.Outer<T>.Inner<U>');assert.equal(plain.arity,0);assert.equal(plain.isGenericType,true);assert.equal(kind.typeKind,TypeKind.Enum);
  assert.deepEqual(outer.getTypeMembers().map(t=>t.name),['Inner','Plain','Kind']);assert.equal(outer.getTypeMembers('Inner',1)[0],inner);
  // VAR 0 inside the nested type is the outer T, VAR 1 is its own U.
  assert.equal(member(inner,'First').type,outer.typeParameters[0]);assert.equal(member(inner,'Second').type,inner.typeParameters[0]);
  assert.equal(show(member(inner,'Map')),'System.Collections.Generic.Dictionary<T, U>? Mini.Outer<T>.Inner<U>.Map');
  assert.equal(show(member(inner,'Swap')),'Mini.Outer<U>.Inner<T>? Mini.Outer<T>.Inner<U>.Swap()');
  assert.equal(show(member(outer,'Make')),'Mini.Outer<T>.Inner<System.Int32>? Mini.Outer<T>.Make()');
  const fixed=member(outer,'Fixed').type;assert.equal(show(fixed),'Mini.Outer<System.String>.Plain');assert.equal(show(member(fixed,'Item')),'System.String? Mini.Outer<System.String>.Plain.Item');
  // Constructing the outer type substitutes through nested signatures.
  const swap=member(outer.construct(type('System.Boolean')),'Make');assert.equal(show(swap.returnType),'Mini.Outer<System.Boolean>.Inner<System.Int32>');
  assert.deepEqual(kind.getMembers().map(f=>[f.name,f.constantValue,f.isConst,f.isStatic]),[['None',0,true,true],['Some',5,true,true]]);assert.ok(member(kind,'Some').type.equals(kind));
});

test('A02-T20 members import kinds, accessibility and declaration modifiers',()=>{
  const refs=type('Mini.Refs'),access=n=>member(refs,n).declaredAccessibility;
  assert.deepEqual(['Max','ProtectedField','InternalField','ProtectedInternalField','PrivateProtectedField'].map(access),[Accessibility.Public,Accessibility.Protected,Accessibility.Internal,Accessibility.ProtectedOrInternal,Accessibility.ProtectedAndInternal]);
  assert.equal(refs.getMembers('_privateField').length,0,'private members are not imported by default');
  assert.equal(importAssembly(fixture('MiniStandard.dll'),{importOptions:'all'}).getTypeByMetadataName('Mini.Refs').getMembers('_privateField')[0].declaredAccessibility,Accessibility.Private);
  const max=member(refs,'Max'),name=member(refs,'Name'),shared=member(refs,'Shared'),counter=member(refs,'Counter');
  assert.deepEqual([max.isConst,max.hasConstantValue,max.constantValue,max.isStatic],[true,true,42,true]);assert.equal(name.constantValue,'mini');
  assert.deepEqual([shared.isStatic,shared.isReadOnly,shared.isConst],[true,true,false]);assert.equal(counter.isVolatile,true);assert.equal(counter.kind,SymbolKind.Field);
  const optional=member(refs,'Optional');
  assert.deepEqual(optional.parameters.map(p=>[p.name,p.isOptional,p.hasExplicitDefaultValue,p.explicitDefaultValue]),[['count',true,true,5],['text',true,true,null],['flag',true,true,true],['scale',true,true,1.5],['name',true,true,'none']]);
  const constructors=type('System.Exception').getMembers('.ctor');assert.deepEqual(constructors.map(c=>[c.methodKind,c.parameters.length]),[[MethodKind.Constructor,0],[MethodKind.Constructor,1]]);
  // virtual / abstract / override / sealed
  const notifier=type('Mini.Notifier'),loud=type('Mini.LoudNotifier'),flags=m=>[m.isAbstract,m.isVirtual,m.isOverride,m.isSealed];
  assert.deepEqual(flags(member(notifier,'OnChanged')),[false,true,false,false]);assert.deepEqual(flags(member(loud,'OnChanged')),[false,false,true,true]);assert.equal(member(notifier,'OnChanged').declaredAccessibility,Accessibility.Protected);
  assert.deepEqual(flags(member(type('System.Object'),'ToString')),[false,true,false,false]);assert.deepEqual(flags(member(type('System.IDisposable'),'Dispose')),[true,false,false,false]);
  // properties, indexers, events and their accessors
  const level=member(notifier,'Level'),title=member(notifier,'Title'),changed=member(notifier,'Changed'),global=member(notifier,'Global');
  assert.equal(show(level),'System.Int32 Mini.Notifier.Level { get; set; }');assert.deepEqual([level.isAbstract,level.declaredAccessibility,level.getMethod.declaredAccessibility,level.setMethod.declaredAccessibility],[true,Accessibility.Public,Accessibility.Public,Accessibility.Protected]);
  assert.equal(level.getMethod.methodKind,MethodKind.PropertyGet);assert.equal(level.setMethod.associatedSymbol,level);assert.equal(member(notifier,'get_Level'),level.getMethod);assert.deepEqual([title.isReadOnly,title.isVirtual],[true,true]);assert.equal(member(loud,'Level').isOverride,true);
  assert.equal(show(changed),'event System.EventHandler Mini.Notifier.Changed');assert.deepEqual([changed.isAbstract,changed.addMethod.methodKind,changed.removeMethod.methodKind],[true,MethodKind.EventAdd,MethodKind.EventRemove]);assert.equal(global.isStatic,true);
  const chars=member(type('System.String'),'this[]');assert.equal(chars.isIndexer,true);assert.equal(chars.metadataName,'Chars');assert.equal(type('System.String').defaultMemberName,'Chars');
  // operators and conversions
  const point=type('Mini.Point');assert.deepEqual(point.getMembers().filter(m=>m.kind===SymbolKind.Method&&m.methodKind!==MethodKind.Constructor).map(m=>[m.name,m.methodKind]),[['op_Addition',MethodKind.UserDefinedOperator],['op_Implicit',MethodKind.Conversion],['op_Explicit',MethodKind.Conversion]]);
  assert.equal(member(point,'op_Addition').toDisplayString(),'Mini.Point.operator +(Mini.Point, Mini.Point)');
  // explicit interface implementations are imported although they are private
  const explicit=type('System.Collections.Generic.List`1').getMembers('System.Collections.IEnumerable.GetEnumerator')[0];assert.equal(explicit.methodKind,MethodKind.ExplicitInterfaceImplementation);assert.equal(explicit.declaredAccessibility,Accessibility.Private);
  assert.equal(member(type('Mini.Person'),'Name').isInitOnly,true);assert.equal(member(type('Mini.Person'),'Nickname').isInitOnly,false);
});

test('A02-T20 by-reference parameters and returns become RefKind; arrays, pointers and function pointers import structurally',()=>{
  const refs=type('Mini.Refs'),kinds=member(refs,'Kinds');
  assert.deepEqual(kinds.parameters.map(p=>[p.name,p.refKind,p.isParams]),[['a',RefKind.Ref,false],['b',RefKind.Out,false],['c',RefKind.In,false],['d',RefKind.RefReadOnlyParameter,false],['rest',RefKind.None,true]]);
  assert.equal(show(kinds),'void Mini.Refs.Kinds(ref System.Int32 a, out System.Int32 b, in System.Int32 c, ref readonly System.Int32 d, params System.Int32[] rest)');
  assert.ok(kinds.parameters[0].type.equals(type('System.Int32')),'the by-reference marker is a RefKind, not part of the type');
  assert.equal(member(refs,'ReturnsRef').refKind,RefKind.Ref);assert.equal(member(refs,'ReturnsRefReadOnly').refKind,RefKind.RefReadOnly);
  assert.equal(member(type('System.Collections.Generic.Dictionary`2'),'TryGetValue').parameters[1].refKind,RefKind.Out);
  const native=type('Mini.Native'),of=n=>member(native,n).type;
  assert.ok(of('Pointer') instanceof PointerTypeSymbol);assert.equal(show(of('Pointer')),'System.Int32*');assert.equal(show(of('Raw')),'void**');
  const matrix=of('Matrix'),jagged=of('Jagged');assert.ok(matrix instanceof ArrayTypeSymbol);assert.deepEqual([matrix.rank,matrix.isSZArray,show(matrix)],[2,false,'System.Int32[,]']);assert.deepEqual([jagged.rank,jagged.isSZArray,show(jagged),show(jagged.elementType)],[1,true,'System.Int32[][]','System.Int32[]']);
  assert.equal(show(matrix.baseType),'System.Array');
  const managed=of('Managed'),unmanaged=of('Unmanaged');assert.ok(managed instanceof FunctionPointerTypeSymbol);
  assert.equal(show(managed),'delegate*<System.Int32, ref System.String, void>');assert.deepEqual(managed.signature.parameters.map(p=>p.refKind),[RefKind.None,RefKind.Ref]);
  assert.equal(show(unmanaged),'delegate* unmanaged[Cdecl]<System.Int32, System.Int32>');assert.equal(unmanaged.signature.callingConvention,'unmanaged');
  const handle=of('Handle');assert.equal(handle.specialType,'System_IntPtr');assert.equal(handle.isNativeInteger,true);assert.equal(handle.toDisplayString(),'nint');
});

test('A02-T20 types from assemblies that are not bound are error types with a reason',()=>{
  const consumer=importAssembly(fixture('ConsumerOfV1.dll')),holder=consumer.getTypeByMetadataName('App.Holder');
  assert.deepEqual(consumer.referencedAssemblyIdentities.map(i=>[i.name,i.versionText]),[['MiniStandard','2.1.0.0'],['VersionedLib','1.0.0.0']]);assert.equal(consumer.isCorLibrary,false);
  assert.ok(holder.baseType instanceof ErrorTypeSymbol);assert.equal(holder.baseType.reason.code,'CS0012');assert.equal(holder.baseType.reason.args[0],'Lib.Widget');assert.match(holder.baseType.reason.args[1],/^VersionedLib, Version=1\.0\.0\.0, Culture=neutral, PublicKeyToken=[0-9a-f]{16}$/);
  // Binding the references afterwards resolves the same signatures.
  const bound=importAssembly(fixture('ConsumerOfV1.dll')).setReferencedAssemblies([core,importAssembly(fixture('VersionedLib.1.0.0.0.dll')).setReferencedAssemblies([core])]),boundHolder=bound.getTypeByMetadataName('App.Holder');
  assert.equal(show(boundHolder.baseType),'Lib.Widget');assert.equal(boundHolder.baseType.containingAssembly.identity.versionText,'1.0.0.0');
  assert.equal(show(boundHolder.getMembers('All')[0]),'System.Collections.Generic.List<Lib.Widget> App.Holder.All');assert.equal(boundHolder.getMembers('All')[0].type.originalDefinition,type('System.Collections.Generic.List`1'));
  assert.equal(bound.corLibrary,core);assert.throws(()=>bound.setReferencedAssemblies([core]),RangeError);
  const weak=importAssembly(fixture('WeakLib.1.0.0.0.dll'));assert.equal(weak.identity.isStrongName,false);assert.equal(weak.identity.getDisplayName(),'WeakLib, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null');
  assert.throws(()=>importAssembly(new Uint8Array(64)),/PE/);
});
