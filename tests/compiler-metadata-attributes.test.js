import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importAssembly} from '../packages/compiler/src/metadata-import/pe-symbols.js';
import {AssemblyIdentity} from '../packages/compiler/src/metadata-import/assembly-identity.js';
import {WellKnownAttribute,decodeAttributeBlob,decodeWellKnownAttributes,unsupportedCompilerFeature,obsoleteDiagnostic,grantsInternalsAccess,applyNullableTransform,applyDynamicTransform,applyTupleElementNames,applyNativeIntegerTransform,ByRefLikeObsoleteMarker} from '../packages/compiler/src/metadata-import/attributes.js';
import {NullableAnnotation,RefKind,SymbolDisplayFormat,TypeWithAnnotations,ArrayTypeSymbol,DynamicTypeSymbol,TypeKind} from '../packages/compiler/src/symbols/types.js';
import {DeclarationModifiers} from '../packages/compiler/src/symbols/members.js';
import {formatMessage,hasDiagnosticCode} from '../packages/compiler/src/diagnostics/codes.js';

const fixture=name=>new Uint8Array(readFileSync(new URL('./fixtures/metadata/'+name,import.meta.url)));
const T=SymbolDisplayFormat.Test,show=s=>s.toDisplayString(T);
const core=importAssembly(fixture('MiniStandard.dll'));
const type=name=>{const t=core.getTypeByMetadataName(name);assert.ok(t,name+' is imported');return t;};
const member=(t,name)=>{const m=t.getMembers(name);assert.equal(m.length,1,`${show(t)} has one member '${name}'`);return m[0];};
const {Annotated,NotAnnotated,Oblivious}=NullableAnnotation;

test('A02-T21 custom attribute blobs decode to typed constructor and named arguments',()=>{
  // prolog, string "ab", int 7, bool[] {true,false}, then one named property: bool Flag = true
  const blob=Uint8Array.from([1,0, 2,0x61,0x62, 7,0,0,0, 2,0,0,0,1,0, 1,0, 0x54,0x02,4,0x46,0x6c,0x61,0x67,1]);
  const decoded=decodeAttributeBlob(blob,[{kind:'primitive',code:14},{kind:'primitive',code:8},{kind:'szarray',element:{kind:'primitive',code:2}}]);
  assert.equal(decoded.hasErrors,false);assert.deepEqual(decoded.constructorArguments.map(a=>[a.kind,a.type]),[['primitive','System.String'],['primitive','System.Int32'],['array',null]]);
  assert.deepEqual([decoded.constructorArguments[0].value,decoded.constructorArguments[1].value,decoded.constructorArguments[2].value.map(v=>v.value)],['ab',7,[true,false]]);
  assert.deepEqual(decoded.namedArguments.map(a=>[a.name,a.isField,a.value.value]),[['Flag',false,true]]);
  assert.equal(decodeAttributeBlob(Uint8Array.from([1,0,0xff,0,0]),[{kind:'primitive',code:14}]).constructorArguments[0].value,null,'0xFF is the null string');
  assert.equal(decodeAttributeBlob(Uint8Array.from([2,0]),[]).hasErrors,true);assert.equal(decodeAttributeBlob(Uint8Array.from([1,0,5]),[{kind:'primitive',code:14}]).hasErrors,true);
  // Attributes of an imported symbol: an enum-typed constructor argument (sized by the enum's underlying type) and a named argument.
  const usage=type('System.ObsoleteAttribute').attributes.filter(a=>a.attributeClassName===WellKnownAttribute.AttributeUsage);assert.equal(usage.length,1);assert.equal(usage[0].attributeClassName,WellKnownAttribute.AttributeUsage);assert.equal(usage[0].attributeClass,type('System.AttributeUsageAttribute'));
  assert.deepEqual(usage[0].constructorArguments.map(a=>[a.kind,a.type,a.value]),[['enum','System.AttributeTargets',32767]]);assert.deepEqual(usage[0].namedArguments.map(a=>[a.name,a.isField,a.value.value]),[['Inherited',false,false]]);
  assert.deepEqual(type('System.Int32').attributes,[]);assert.equal(type('System.AttributeTargets').isFlagsEnum,true);
  assert.deepEqual(member(type('Mini.NewApi'),'Trace').attributes.filter(a=>a.attributeClassName===WellKnownAttribute.Conditional).map(a=>a.constructorArguments[0].value),['DEBUG','TRACE']);
});

test('A02-T21 ParamArray and Extension: isParams and isExtensionMethod',()=>{
  const writeLine=type('System.Console').getMembers('WriteLine').find(m=>m.parameters.length===2);
  assert.deepEqual(writeLine.parameters.map(p=>p.isParams),[false,true]);assert.equal(show(writeLine.parameters[1]),'params System.Object?[] arg');
  assert.equal(member(type('Mini.Refs'),'Kinds').parameters.at(-1).isParams,true);assert.equal(member(type('Mini.Refs'),'Kinds').parameters[0].isParams,false);
  const extensions=type('Mini.Extensions'),countOf=member(extensions,'CountOf'),join=member(extensions,'Join'),plain=member(extensions,'NotAnExtension');
  assert.equal(extensions.mightContainExtensionMethods,true);assert.equal(type('System.Console').mightContainExtensionMethods,false);
  assert.deepEqual([countOf.isExtensionMethod,join.isExtensionMethod,plain.isExtensionMethod],[true,true,false]);
  assert.deepEqual([countOf.parameters[0].isThis,join.parameters[0].isThis,join.parameters[1].isThis,plain.parameters[0].isThis],[true,true,false,false]);
  assert.equal(join.parameters[1].isParams,true);assert.equal(show(countOf),'System.Int32 Mini.Extensions.CountOf<T>(System.Collections.Generic.IEnumerable<T> source)');
  assert.equal(member(type('System.String'),'Concat').isExtensionMethod,false);
});

test('A02-T21 Obsolete: message, error flag, DiagnosticId and UrlFormat, with the Roslyn diagnostics',()=>{
  const oldApi=type('Mini.OldApi'),newApi=type('Mini.NewApi');
  assert.deepEqual(oldApi.obsolete,{message:'Use NewApi instead',isError:true,diagnosticId:null,urlFormat:null});assert.equal(newApi.obsolete,null);
  assert.deepEqual(member(newApi,'Plain').obsolete,{message:null,isError:false,diagnosticId:null,urlFormat:null});assert.deepEqual(member(newApi,'WithMessage').obsolete,{message:'Slow path',isError:false,diagnosticId:null,urlFormat:null});
  assert.deepEqual(member(newApi,'Tagged').obsolete,{message:'Custom',isError:false,diagnosticId:'MINI001',urlFormat:'https://example.test/{0}'});assert.equal(member(newApi,'Current').obsolete,null);
  assert.deepEqual(obsoleteDiagnostic(oldApi),{code:'CS0619',args:['Mini.OldApi','Use NewApi instead']});assert.deepEqual(obsoleteDiagnostic(member(newApi,'Plain')),{code:'CS0612',args:['Mini.NewApi.Plain()']});
  assert.deepEqual(obsoleteDiagnostic(member(newApi,'WithMessage')),{code:'CS0618',args:['Mini.NewApi.WithMessage()','Slow path']});
  assert.deepEqual(obsoleteDiagnostic(member(newApi,'Tagged')),{code:'CS0618',args:['Mini.NewApi.Tagged','Custom'],customId:'MINI001',helpLink:'https://example.test/MINI001'});assert.equal(obsoleteDiagnostic(member(newApi,'Current')),null);
  for(const code of ['CS0612','CS0618','CS0619'])assert.ok(hasDiagnosticCode(code),code+' is in the catalog');
  assert.equal(formatMessage('CS0619',obsoleteDiagnostic(oldApi).args),"'Mini.OldApi' is obsolete: 'Use NewApi instead'");assert.equal(formatMessage('CS0612',obsoleteDiagnostic(member(newApi,'Plain')).args),"'Mini.NewApi.Plain()' is obsolete");
});

test('A02-T21 Conditional and DefaultMember',()=>{
  assert.deepEqual(member(type('Mini.NewApi'),'Trace').conditionalSymbols,['DEBUG','TRACE']);assert.deepEqual(member(type('Mini.NewApi'),'Current').conditionalSymbols,[]);
  assert.deepEqual(type('Mini.DebugOnlyAttribute').conditionalSymbols,['MINI_ATTRIBUTES']);assert.deepEqual(type('System.ObsoleteAttribute').conditionalSymbols,[]);
  const list=type('System.Collections.Generic.List`1');assert.equal(list.defaultMemberName,'Item');assert.equal(member(list,'this[]').metadataName,'Item');assert.equal(member(list,'this[]').isIndexer,true);
  assert.equal(type('System.Console').defaultMemberName,null);assert.equal(type('System.String').defaultMemberName,'Chars','IndexerName changes the DefaultMember value');
});

test('A02-T21 Nullable and NullableContext give every type position its annotation',()=>{
  const n=type('Mini.Nullability'),annotation=name=>member(n,name).typeWithAnnotations.nullableAnnotation;
  assert.deepEqual(['MaybeNull','NotNull','Oblivious'].map(annotation),[Annotated,NotAnnotated,Oblivious]);
  const maybeInt=member(n,'MaybeInt').type;assert.equal(maybeInt.isNullableValueType,true);assert.equal(show(maybeInt),'System.Int32?');
  const method=member(n,'Method'),[a,b,c,d]=method.parameters.map(p=>p.typeWithAnnotations);
  assert.equal(show(method),'System.Collections.Generic.List<System.String?>? Mini.Nullability.Method(System.String a, System.String? b, System.Int32? c, System.String?[] d)');
  assert.deepEqual([a.nullableAnnotation,b.nullableAnnotation,d.nullableAnnotation,d.type.elementTypeWithAnnotations.nullableAnnotation],[NotAnnotated,Annotated,NotAnnotated,Annotated]);assert.equal(c.type.isNullableValueType,true);
  assert.deepEqual([method.returnTypeWithAnnotations.nullableAnnotation,method.returnType.typeArguments[0].nullableAnnotation],[Annotated,Annotated]);
  // the annotations only: the underlying symbols are the same types
  assert.ok(a.type.equals(type('System.String')));assert.ok(method.returnType.originalDefinition===type('System.Collections.Generic.List`1'));
  const generic=member(n,'Generic'),notNull=member(n,'NotNullConstraint'),oblivious=member(n,'ObliviousMethod');
  assert.deepEqual([generic.returnTypeWithAnnotations.nullableAnnotation,generic.parameters[0].typeWithAnnotations.nullableAnnotation,generic.typeParameters[0].hasReferenceTypeConstraint,generic.typeParameters[0].referenceTypeConstraintIsNullable,generic.typeParameters[0].hasNotNullConstraint],[Annotated,Annotated,true,false,false]);
  assert.deepEqual([notNull.typeParameters[0].hasNotNullConstraint,notNull.parameters[0].typeWithAnnotations.nullableAnnotation],[true,NotAnnotated]);
  assert.deepEqual([oblivious.returnTypeWithAnnotations.nullableAnnotation,oblivious.parameters[0].typeWithAnnotations.nullableAnnotation],[Oblivious,Oblivious]);
  // NullableContext on the type or method supplies the default when a member has no Nullable attribute of its own.
  const console_=type('System.Console'),format=console_.getMembers('WriteLine').find(m=>m.parameters.length===2);
  assert.deepEqual([format.parameters[0].typeWithAnnotations.nullableAnnotation,format.parameters[1].typeWithAnnotations.nullableAnnotation,format.parameters[1].type.elementTypeWithAnnotations.nullableAnnotation],[NotAnnotated,NotAnnotated,Annotated]);
  assert.equal(member(type('System.Object'),'ToString').returnTypeWithAnnotations.nullableAnnotation,Annotated);assert.equal(member(type('Mini.Person'),'Nickname').typeWithAnnotations.nullableAnnotation,Annotated);assert.equal(member(type('Mini.Person'),'Name').typeWithAnnotations.nullableAnnotation,NotAnnotated);
  const map=member(type('Mini.Outer`1+Inner`1'),'Map').typeWithAnnotations;assert.deepEqual([map.nullableAnnotation,...map.type.typeArguments.map(x=>x.nullableAnnotation)],[Annotated,NotAnnotated,NotAnnotated]);
  // a function pointer: its own slot, then the parameter and return slots (value types take none)
  assert.equal(member(type('Mini.Native'),'Managed').type.signature.parameters[1].type.nullableAnnotation,NotAnnotated);
  // value types never take an annotation
  assert.equal(member(type('Mini.Refs'),'Max').typeWithAnnotations.nullableAnnotation,Oblivious);
});

test('A02-T21 the nullable transform follows the metadata encoding and rejects data that does not fit',()=>{
  const string=type('System.String'),int=type('System.Int32'),list=type('System.Collections.Generic.List`1'),nullable=type('System.Nullable`1'),tuple=type('System.ValueTuple`2'),dictionary=type('System.Collections.Generic.Dictionary`2');
  const of=(t,flags,context)=>applyNullableTransform(t,flags,context);
  assert.equal(of(string,null,0).nullableAnnotation,Oblivious);assert.equal(of(string,null,2).nullableAnnotation,Annotated);assert.equal(of(string,1,2).nullableAnnotation,NotAnnotated,'the attribute wins over the context');
  assert.equal(of(int,null,2).nullableAnnotation,Oblivious);assert.equal(show(of(dictionary.construct(string,list.construct(string)),[1,2,2,1])),'System.Collections.Generic.Dictionary<System.String?, System.Collections.Generic.List<System.String>?>');
  // Nullable<T> and non-generic value types take no byte; a generic struct takes one (always 0).
  assert.equal(show(of(list.construct(nullable.construct(int)),[2])),'System.Collections.Generic.List<System.Int32?>?');
  assert.equal(show(of(tuple.construct(int,string),[0,2])),'(System.Int32, System.String?)');
  const array=new ArrayTypeSymbol(new ArrayTypeSymbol(string));assert.equal(show(of(array,[1,2,1])),'System.String[]?[]');
  // too few or too many bytes: the type is left oblivious
  for(const flags of [[1],[1,2,1],[]]){const result=of(list.construct(string),flags);assert.equal(result.nullableAnnotation,Oblivious);assert.equal(result.type.typeArguments[0].nullableAnnotation,Oblivious);}
});

test('A02-T21 TupleElementNames and Dynamic transforms',()=>{
  const tuples=type('Mini.Tuples'),pair=member(tuples,'Pair').returnType,nested=member(tuples,'Nested').type,unnamed=member(tuples,'Unnamed').type;
  assert.equal(pair.isTupleType,true);assert.deepEqual(pair.tupleElementNames,['count','name']);assert.equal(show(pair),'(System.Int32 count, System.String name)');
  assert.equal(show(nested),'System.Collections.Generic.List<(System.Int32 a, (System.String b, System.Boolean c) d)>');assert.deepEqual(nested.typeArguments[0].type.tupleElementNames,['a','d']);assert.deepEqual(nested.typeArguments[0].type.typeArguments[1].type.tupleElementNames,['b','c']);
  assert.equal(unnamed.tupleElementNames,null);assert.equal(show(unnamed),'(System.Int32, System.String)');assert.ok(unnamed.originalDefinition===type('System.ValueTuple`2'));
  const dynamics=type('Mini.Dynamics'),method=member(dynamics,'Method'),field=member(dynamics,'Field');
  assert.ok(field.type instanceof DynamicTypeSymbol);assert.equal(field.typeWithAnnotations.nullableAnnotation,Annotated);
  assert.equal(show(method),'dynamic Mini.Dynamics.Method(dynamic first, System.Collections.Generic.List<dynamic> second, System.Object third, dynamic[] fourth)');
  assert.equal(method.parameters[2].type.specialType,'System_Object','object stays object');assert.equal(method.parameters[1].type.typeArguments[0].type.typeKind,TypeKind.Dynamic);
  // the transforms on their own
  const object=type('System.Object'),string=type('System.String'),int=type('System.Int32'),list=type('System.Collections.Generic.List`1'),tuple=type('System.ValueTuple`2'),intPtr=type('System.IntPtr');
  assert.equal(show(applyDynamicTransform(list.construct(object),[false,true])),'System.Collections.Generic.List<dynamic>');assert.equal(show(applyDynamicTransform(object,[false,true],RefKind.Ref)),'dynamic','a by-reference slot takes a leading flag');
  assert.equal(show(applyDynamicTransform(list.construct(object),[false])),'System.Collections.Generic.List<System.Object>','too few flags: unchanged');assert.equal(show(applyDynamicTransform(string,[true])),'System.String','only object can be dynamic');
  const inner=tuple.construct(string,int);assert.equal(show(applyTupleElementNames(tuple.construct(inner,inner),['x','y','a','b',null,null])),'((System.String a, System.Int32 b) x, (System.String, System.Int32) y)');
  assert.equal(show(applyTupleElementNames(inner,['only'])),'(System.String, System.Int32)','a name count that does not fit is ignored');
  const native=applyNativeIntegerTransform(list.construct(intPtr),[true]).type.typeArguments[0].type;assert.equal(native.isNativeInteger,true);assert.equal(native.toDisplayString(),'nint');assert.equal(applyNativeIntegerTransform(intPtr,[false]).type.isNativeInteger,false);
  assert.ok(applyNullableTransform(new TypeWithAnnotations(string),2) instanceof TypeWithAnnotations);
});

test('A02-T21 IsReadOnly, IsByRefLike, RequiredMember and CompilerFeatureRequired',()=>{
  const point=type('Mini.Point'),mutable=type('Mini.Mutable'),window=type('Mini.Window'),person=type('Mini.Person'),refs=type('Mini.Refs');
  assert.deepEqual([point.isReadOnly,mutable.isReadOnly,window.isReadOnly],[true,false,false]);assert.deepEqual([member(mutable,'Peek').isReadOnly,member(mutable,'Bump').isReadOnly],[true,false]);
  assert.equal(member(refs,'Kinds').parameters[2].refKind,RefKind.In);assert.equal(member(refs,'ReturnsRefReadOnly').refKind,RefKind.RefReadOnly);
  // a ref struct: IsByRefLike, and the Obsolete + CompilerFeatureRequired markers that accompany it are not user-visible state
  assert.deepEqual([window.isRefLikeType,point.isRefLikeType],[true,false]);assert.equal(window.obsolete,null);assert.equal(window.unsupportedCompilerFeature,null);
  const raw=core.metadata.customAttributes(window.metadataToken),data=decodeWellKnownAttributes(raw);
  assert.deepEqual(raw.map(r=>r.fullName).sort(),[WellKnownAttribute.Obsolete,WellKnownAttribute.CompilerFeatureRequired,WellKnownAttribute.IsByRefLike]);assert.equal(window.attributes.find(a=>a.attributeClassName===WellKnownAttribute.Obsolete).constructorArguments[0].value,ByRefLikeObsoleteMarker);
  assert.deepEqual(data.compilerFeatureRequired,[{featureName:'RefStructs',isOptional:false}]);assert.equal(unsupportedCompilerFeature(data),null);assert.equal(unsupportedCompilerFeature(data,['RequiredMembers']),'RefStructs','an unknown feature makes the symbol unusable');
  // required members
  assert.equal(person.hasRequiredMembers,true);assert.equal(point.hasRequiredMembers,false);
  assert.deepEqual([member(person,'Name').isRequired,member(person,'Age').isRequired,member(person,'Nickname').isRequired],[true,true,false]);assert.ok(member(person,'Age').modifiers&DeclarationModifiers.Required);
  const [parameterless,withName]=person.getMembers('.ctor');
  assert.equal(parameterless.obsolete,null,'the marker on constructors of types with required members is not an obsoletion');assert.equal(parameterless.unsupportedCompilerFeature,null);assert.deepEqual([parameterless.setsRequiredMembers,withName.setsRequiredMembers],[false,true]);
  assert.deepEqual(parameterless.attributes.map(a=>a.attributeClassName).sort(),[WellKnownAttribute.Obsolete,WellKnownAttribute.CompilerFeatureRequired]);
  assert.equal(member(person,'Name').setMethod.isInitOnly,true);
});

test('A02-T21 InternalsVisibleTo declarations and friend checks',()=>{
  assert.deepEqual(core.internalsVisibleTo.map(d=>d.split(',')[0]),['MiniStandard.Tests','Friend.Assembly']);assert.match(core.internalsVisibleTo[0],/^MiniStandard\.Tests, PublicKey=[0-9a-f]{320}$/);
  const key=core.identity.publicKey;assert.equal(key.length,320);
  assert.equal(core.givesInternalsAccessTo(new AssemblyIdentity({name:'Friend.Assembly',publicKey:key})),true);assert.equal(core.givesInternalsAccessTo(new AssemblyIdentity({name:'friend.assembly',version:'9.9.9.9',publicKey:key})),true);
  assert.equal(core.givesInternalsAccessTo(new AssemblyIdentity({name:'Friend.Assembly'})),false,'the declaration names a key');assert.equal(core.givesInternalsAccessTo(new AssemblyIdentity({name:'Stranger',publicKey:key})),false);
  assert.equal(grantsInternalsAccess(['Weak.Friend'],new AssemblyIdentity({name:'Weak.Friend'})),true);assert.equal(importAssembly(fixture('VersionedLib.1.0.0.0.dll')).internalsVisibleTo.length,0);
  // internal members are imported because the assembly has friends; an assembly without friends drops them
  assert.equal(member(type('Mini.Refs'),'InternalField').name,'InternalField');
  assert.deepEqual(decodeWellKnownAttributes(core.metadata.customAttributes(0x20000001)).internalsVisibleTo,core.internalsVisibleTo);
});
