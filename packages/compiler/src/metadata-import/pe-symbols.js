import {DiagnosticId} from '../diagnostics/codes.js';
import {SymbolBase,SymbolKind,TypeKind,Accessibility,NullableAnnotation,Variance,RefKind,TypeWithAnnotations,NamedTypeSymbol,ConstructedNamedTypeSymbol,ArrayTypeSymbol,PointerTypeSymbol,FunctionPointerTypeSymbol,TypeParameterSymbol,ErrorTypeSymbol} from '../symbols/types.js';
import {MethodSymbol,FieldSymbol,PropertySymbol,EventSymbol,ParameterSymbol,MethodKind,DeclarationModifiers} from '../symbols/members.js';
import {NamespaceSymbol,NamespaceExtent} from '../symbols/namespaces.js';
import {AssemblyIdentity} from './assembly-identity.js';
import {MetadataView,Table,tokenOf,tableOf,ridOf,parseMethodSignature,parseFieldSignature,parseTypeSignature} from './pe-metadata.js';
import {decodeWellKnownAttributes,decodeAttributeBlob,applyTypeTransforms,unsupportedCompilerFeature,grantsInternalsAccess,RequiredMembersObsoleteMarker} from './attributes.js';
/**
 * Symbols imported from a referenced assembly (ECMA-335 metadata read through @sharpforge/cil).
 *
 * `importAssembly(bytes)` returns a `PEAssemblySymbol`: its identity, its AssemblyRef identities, a metadata
 * namespace tree of `NamedTypeSymbol`s and the type forwarders. Type shells are created eagerly; base types,
 * interfaces, members, constraints and attributes are decoded on first use, so cross-assembly references are
 * resolved lazily through `setReferencedAssemblies` (the reference manager calls it; a core library needs no
 * references). Bind references before reading members: resolved signatures are cached.
 * A type that cannot be resolved becomes an `ErrorTypeSymbol` whose `reason` is `{code,args}` (CS0012 for an
 * unreferenced assembly, CS7069 for a type missing from its assembly, CS0731 for a forwarder cycle, CS0518 for
 * a missing predefined type).
 */
const specialTypeNames=['System.Object','System.Enum','System.MulticastDelegate','System.Delegate','System.ValueType','System.Void','System.Boolean','System.Char','System.SByte','System.Byte','System.Int16','System.UInt16','System.Int32','System.UInt32','System.Int64','System.UInt64','System.Decimal','System.Single','System.Double','System.String','System.IntPtr','System.UIntPtr','System.Array','System.Collections.IEnumerable','System.Collections.Generic.IEnumerable`1','System.Collections.Generic.IList`1','System.Collections.Generic.ICollection`1','System.Collections.IEnumerator','System.Collections.Generic.IEnumerator`1','System.Collections.Generic.IReadOnlyList`1','System.Collections.Generic.IReadOnlyCollection`1','System.Nullable`1','System.DateTime','System.Runtime.CompilerServices.IsVolatile','System.IDisposable','System.TypedReference','System.ArgIterator','System.RuntimeArgumentHandle','System.RuntimeFieldHandle','System.RuntimeMethodHandle','System.RuntimeTypeHandle','System.IAsyncResult','System.AsyncCallback'];
/** Special-type id of a metadata type name (System.Collections.Generic.IEnumerable`1 is System_Collections_Generic_IEnumerable_T). */
export const specialTypeId=metadataName=>metadataName.replace(/`\d+$/,'_T').replace(/\./g,'_');
const specialIds=new Map(specialTypeNames.map(n=>[n,specialTypeId(n)])),specialNames=new Map(specialTypeNames.map(n=>[specialTypeId(n),n]));
const primitiveNames=Object.freeze({1:'System.Void',2:'System.Boolean',3:'System.Char',4:'System.SByte',5:'System.Byte',6:'System.Int16',7:'System.UInt16',8:'System.Int32',9:'System.UInt32',10:'System.Int64',11:'System.UInt64',12:'System.Single',13:'System.Double',14:'System.String',22:'System.TypedReference',24:'System.IntPtr',25:'System.UIntPtr',28:'System.Object'});
const enumCodes=Object.freeze({System_Boolean:2,System_Char:3,System_SByte:4,System_Byte:5,System_Int16:6,System_UInt16:7,System_Int32:8,System_UInt32:9,System_Int64:10,System_UInt64:11});
const memberAccess=[Accessibility.Private,Accessibility.Private,Accessibility.ProtectedAndInternal,Accessibility.Internal,Accessibility.Protected,Accessibility.ProtectedOrInternal,Accessibility.Public,Accessibility.Private];
const typeAccess=[Accessibility.Internal,Accessibility.Public,Accessibility.Public,Accessibility.Private,Accessibility.Protected,Accessibility.Internal,Accessibility.ProtectedAndInternal,Accessibility.ProtectedOrInternal];
const accessRank=[Accessibility.Private,Accessibility.ProtectedAndInternal,Accessibility.Internal,Accessibility.Protected,Accessibility.ProtectedOrInternal,Accessibility.Public];
const mostAccessible=list=>list.reduce((a,b)=>accessRank.indexOf(b)>accessRank.indexOf(a)?b:a,Accessibility.Private);
const noAttributes=Object.freeze([]),noData=decodeWellKnownAttributes([]);
const qualified=(namespace,name)=>namespace?namespace+'.'+name:name;
/** Splits `List`1` into {name:'List',arity:1}; a name without a matching suffix has arity 0. */
const unmangle=metadataName=>{const m=/^(.+)`(\d+)$/.exec(metadataName);return m?{name:m[1],arity:Number(m[2])}:{name:metadataName,arity:0};};
const lazy=(target,property,compute)=>Object.defineProperty(target,property,{configurable:true,enumerable:true,get(){const value=compute();Object.defineProperty(target,property,{value,writable:true,configurable:true,enumerable:true});return value;},set(value){Object.defineProperty(target,property,{value,writable:true,configurable:true,enumerable:true});}});

/** A type definition read from metadata. Adds the metadata identity and decoded well-known attribute state. */
export class PENamedTypeSymbol extends NamedTypeSymbol {
  constructor(assembly,rid,init,extra){
    super(init);this.containingAssembly=assembly;this.metadataToken=tokenOf(Table.TypeDef,rid);this._metadataName=extra.metadataName;this._enumUnderlying=extra.enumUnderlyingType??null;
    /** {message,isError,diagnosticId,urlFormat} or null. */
    this.obsolete=extra.data.obsolete;this.defaultMemberName=extra.data.defaultMemberName;this.conditionalSymbols=Object.freeze([...extra.data.conditionalSymbols]);this.hasRequiredMembers=extra.data.requiredMember;this.isFlagsEnum=extra.data.isFlagsEnum;
    /** The first CompilerFeatureRequired feature this compiler does not know (the type is then unusable), or null. */
    this.unsupportedCompilerFeature=unsupportedCompilerFeature(extra.data);this.mightContainExtensionMethods=extra.mightContainExtensionMethods;this.nullableContext=extra.nullableContext;this._allTypeParameters=extra.allTypeParameters;
    lazy(this,'attributes',()=>assembly._attributes(this.metadataToken));
  }
  get metadataName(){return this._metadataName;}
  /** The underlying integral type of an enum (the type of its value__ field), or null. */
  get enumUnderlyingType(){return typeof this._enumUnderlying==='function'?this._enumUnderlying=this._enumUnderlying():this._enumUnderlying;}
  set enumUnderlyingType(value){if(value)this._enumUnderlying=value;}
}
/** An imported property; indexers are named `this[]` and keep their metadata name (usually Item). */
export class PEPropertySymbol extends PropertySymbol {
  constructor(init,metadataName){super(init);this._metadataName=metadataName;}
  get metadataName(){return this._metadataName;}
}

/** One referenced assembly: identity, namespaces, type forwarders and reference bindings. */
export class PEAssemblySymbol extends SymbolBase {
  /**
   * @param {Uint8Array|ArrayBuffer} bytes the PE image
   * @param {object} [options] name: simple name for a module without an assembly manifest; filePath: where the
   *   image came from (diagnostics only); importOptions: 'public' (default: public and protected members, plus internal
   *   ones when the assembly declares InternalsVisibleTo), 'internal' or 'all' (private members too)
   */
  constructor(bytes,options={}){
    super(SymbolKind.Assembly,'');const md=this.metadata=new MetadataView(bytes);
    this.identity=md.assemblyIdentity??new AssemblyIdentity({name:options.name??(md.count(Table.Module)?md.string(md.row(Table.Module,1)[1]).replace(/\.(dll|exe|netmodule)$/i,''):'module')});
    this.name=this.identity.name;this.filePath=options.filePath??null;this.importOptions=options.importOptions??'public';
    /** Identities of the AssemblyRef rows, in metadata order. */
    this.referencedAssemblyIdentities=md.assemblyReferences;this._bound=this.referencedAssemblyIdentities.map(()=>null);this._corLibrary=null;this._special=new Map();this._typeRefs=new Map();
    const assemblyData=md.count(Table.Assembly)?decodeWellKnownAttributes(md.customAttributes(tokenOf(Table.Assembly,1))):noData;
    /** The raw InternalsVisibleTo declarations. */
    this.internalsVisibleTo=Object.freeze([...assemblyData.internalsVisibleTo]);this._importInternal=this.importOptions!=='public'||this.internalsVisibleTo.length>0;
    this._moduleNullableContext=md.count(Table.Module)?decodeWellKnownAttributes(md.customAttributes(tokenOf(Table.Module,1))).nullableContext??0:0;
    this.globalNamespace=new NamespaceSymbol('',null,NamespaceExtent.Metadata,this);this._types=new Array(md.count(Table.TypeDef)+1).fill(null);this._topLevel=new Map();this._nested=new Map();
    this.isCorLibrary=false;
    // The core library declares System.Object and references nothing; only its types are special types.
    const rows=md.rows(Table.TypeDef);this.isCorLibrary=this.referencedAssemblyIdentities.length===0&&rows.some((row,i)=>md.string(row[1])==='Object'&&md.string(row[2])==='System'&&!md.nesting.enclosing.has(i+1));
    for(let rid=1;rid<=rows.length;rid++)this._type(rid);
    /** Top-level type forwarders: metadata full name -> index of the AssemblyRef that now defines the type. */
    this._forwarders=new Map();for(const e of md.exportedTypes)if(e.isForwarder&&tableOf(e.implementation)===Table.AssemblyRef)this._forwarders.set(qualified(e.namespace,e.name),ridOf(e.implementation)-1);
    lazy(this,'attributes',()=>md.count(Table.Assembly)?this._attributes(tokenOf(Table.Assembly,1)):noAttributes);
  }
  get containingAssembly(){return this;}
  /** The assemblies the AssemblyRef rows are bound to (null for an unresolved reference). */
  get boundReferences(){return [...this._bound];}
  /** Binds the AssemblyRef rows, in order, to imported assemblies (null leaves a reference unresolved). */
  setReferencedAssemblies(assemblies){if(assemblies.length!==this._bound.length)throw new RangeError(`'${this.name}' has ${this._bound.length} assembly references, not ${assemblies.length}`);this._bound=[...assemblies];this._special.clear();this._typeRefs.clear();return this;}
  /** The assembly that defines System.Object for this assembly: itself, an explicit setting, or the first one reachable through bound references. */
  get corLibrary(){
    if(this._corLibrary)return this._corLibrary;if(this.isCorLibrary)return this;const seen=new Set([this]),queue=[this];
    while(queue.length){for(const next of queue.shift()._bound){if(!next||seen.has(next))continue;if(next.isCorLibrary)return next;seen.add(next);queue.push(next);}}return null;
  }
  set corLibrary(assembly){this._corLibrary=assembly;this._special.clear();}
  /** The forwarded top-level types as [{metadataName,assembly}] where `assembly` is the destination identity. */
  get forwardedTypes(){return [...this._forwarders].map(([metadataName,index])=>({metadataName,assembly:this.referencedAssemblyIdentities[index]}));}
  /** Whether this assembly's InternalsVisibleTo declarations name the given identity. */
  givesInternalsAccessTo(identity){return grantsInternalsAccess(this.internalsVisibleTo,identity);}
  /** A type defined in this assembly by CLR name (`System.Collections.Generic.List`1`, nested types after `+`), or null. */
  getTypeByMetadataName(metadataName){const [top,...nested]=String(metadataName).split('+');let type=this._topLevel.get(top)??null;for(const name of nested)type=type?this._nested.get(type)?.get(name)??null:null;return type;}
  /**
   * Resolves a top-level type by CLR name the way a TypeRef into this assembly is resolved: defined here, or
   * followed through type forwarders. Returns the type, an ErrorTypeSymbol describing the failure, or null when
   * this assembly neither defines nor forwards the name.
   */
  resolveType(metadataName){const result=this._resolveTopLevel(metadataName,[]);return result?result.type??this._missing(metadataName,result.error):null;}
  _resolveTopLevel(metadataName,visited){
    const own=this._topLevel.get(metadataName);if(own)return {type:own};const index=this._forwarders.get(metadataName);if(index===undefined)return null;
    if(visited.includes(this))return {error:{code:DiagnosticId.CS0731,args:[displayName(metadataName),this.identity.getDisplayName()]}};
    const target=this._bound[index];if(!target)return {error:{code:DiagnosticId.CS0012,args:[missingTypeName(metadataName),this.referencedAssemblyIdentities[index].getDisplayName()]}};
    return target._resolveTopLevel(metadataName,[...visited,this])??{error:{code:DiagnosticId.CS7069,args:[displayName(metadataName),target.name]}};
  }
  _missing(metadataName,reason,nestedName){const dot=metadataName.lastIndexOf('.'),{name,arity}=unmangle(nestedName??metadataName.slice(dot+1)),error=new ErrorTypeSymbol(name,arity,{reason});error.metadataFullName=nestedName?metadataName+'+'+nestedName:metadataName;return error;}
  /** The special type with this id (for example System_Int32) from the core library, or an ErrorTypeSymbol with CS0518. */
  getSpecialType(id){
    const cached=this._special.get(id);if(cached)return cached;const metadataName=specialNames.get(id),type=metadataName?this.corLibrary?._topLevel.get(metadataName)??null:null;
    if(type){this._special.set(id,type);return type;}return this._missing(metadataName??id,{code:DiagnosticId.CS0518,args:[metadataName??id]});
  }
  /** The symbol a TypeDef, TypeRef or TypeSpec token of this module denotes. */
  typeFromToken(token){return this._typeFromToken(token,{type:null,methodTypeParameters:[]});}

  // ---- type definitions ----
  _type(rid){
    if(rid<1||rid>=this._types.length)return null;if(this._types[rid])return this._types[rid];const md=this.metadata,row=md.row(Table.TypeDef,rid),flags=row[0],metadataName=md.string(row[1]),namespace=md.string(row[2]);
    const outerRid=md.nesting.enclosing.get(rid),outer=outerRid?this._type(outerRid):null,token=tokenOf(Table.TypeDef,rid);
    if(!outer&&metadataName==='<Module>')return null;
    const data=decodeWellKnownAttributes(md.customAttributes(token)),nullableContext=data.nullableContext??outer?.nullableContext??this._moduleNullableContext;
    const context={type:null,methodTypeParameters:[]},generic=md.genericParameters(token),outerCount=outer?outer._allTypeParameters.length:0,own=generic.slice(outerCount).map(g=>this._typeParameter(g,context,nullableContext));
    const suffix='`'+own.length,name=own.length&&metadataName.endsWith(suffix)?metadataName.slice(0,-suffix.length):metadataName;
    const baseToken=row[3]?decodeBase(row[3]):0,baseName=baseToken?md.typeTokenName(baseToken):null,baseFull=baseName?qualified(baseName.namespace,baseName.name):'',full=qualified(namespace,metadataName);
    const isInterface=!!(flags&0x20),typeKind=isInterface?TypeKind.Interface:baseFull==='System.Enum'?TypeKind.Enum:baseFull==='System.ValueType'&&!(this.isCorLibrary&&full==='System.Enum')?TypeKind.Struct:baseFull==='System.MulticastDelegate'?TypeKind.Delegate:TypeKind.Class;
    const isAbstract=!!(flags&0x80),isSealed=!!(flags&0x100),isStatic=typeKind===TypeKind.Class&&isAbstract&&isSealed;
    const [methodStart,methodEnd]=md.listRange(Table.TypeDef,rid,5,Table.MethodDef);let isRecord=false;for(let m=methodStart;m<methodEnd&&!isRecord;m++)isRecord=md.string(md.row(Table.MethodDef,m)[3])==='<Clone>$';
    const type=new PENamedTypeSymbol(this,rid,{name,typeKind,typeParameters:own,containingSymbol:outer,declaredAccessibility:typeAccess[flags&7],specialType:!outer&&this.isCorLibrary?specialIds.get(full)??null:null,
      isStatic,isAbstract:isAbstract&&!isSealed&&!isInterface||isInterface,isSealed:isSealed&&!isAbstract,isReadOnly:data.isReadOnly,isRefLikeType:data.isByRefLike,isRecord,
      baseType:()=>isInterface||!baseToken?null:applyTypeTransforms(this._typeFromToken(baseToken,context),data,{nullableContext}).type,
      interfaces:()=>md.interfaceImplementations(rid).map(i=>applyTypeTransforms(this._typeFromToken(i.token,context),decodeWellKnownAttributes(md.customAttributes(tokenOf(Table.InterfaceImpl,i.rid))),{nullableContext}).type),
      members:()=>this._members(type,rid)},
      {metadataName,data,nullableContext,allTypeParameters:Object.freeze([...(outer?outer._allTypeParameters:[]),...own]),mightContainExtensionMethods:isStatic&&!outer&&!generic.length&&data.isExtension,
        enumUnderlyingType:typeKind===TypeKind.Enum?()=>this._enumUnderlying(type,rid):null});
    context.type=type;this._types[rid]=type;
    if(outer){let map=this._nested.get(outer);if(!map)this._nested.set(outer,map=new Map());map.set(metadataName,type);}
    else{this._topLevel.set(full,type);this.globalNamespace.ensureNamespace(namespace).addType(type);}
    return type;
  }
  _enumUnderlying(type,rid){const md=this.metadata,[start,end]=md.listRange(Table.TypeDef,rid,4,Table.Field);for(let f=start;f<end;f++){const row=md.row(Table.Field,f);if(!(row[0]&0x10))return this._twa(parseFieldSignature(md.blob(row[2])),{type,methodTypeParameters:[]}).type;}return this.getSpecialType('System_Int32');}
  _typeParameter(g,context,nullableContext){
    const md=this.metadata,data=decodeWellKnownAttributes(md.customAttributes(tokenOf(Table.GenericParam,g.rid))),flag=Array.isArray(data.nullable)?data.nullable[0]??0:data.nullable??nullableContext;
    const hasReference=!!(g.flags&4),hasValue=!!(g.flags&8);
    const parameter=new TypeParameterSymbol({name:g.name,ordinal:g.number,variance:(g.flags&3)===1?Variance.Out:(g.flags&3)===2?Variance.In:Variance.None,hasReferenceTypeConstraint:hasReference,hasValueTypeConstraint:hasValue,hasUnmanagedTypeConstraint:data.isUnmanaged,
      hasNotNullConstraint:!hasReference&&!hasValue&&flag===1,hasConstructorConstraint:!!(g.flags&0x10)&&!hasValue,allowsRefLikeType:!!(g.flags&0x20),
      constraintTypes:()=>md.genericConstraints(g.rid).map(c=>applyTypeTransforms(this._typeFromToken(c.token,context),decodeWellKnownAttributes(md.customAttributes(tokenOf(Table.GenericParamConstraint,c.rid))),{nullableContext})).filter(t=>!(hasValue&&t.type.specialType==='System_ValueType'))});
    /** For `where T : class?` in a nullable-enabled context. */
    parameter.referenceTypeConstraintIsNullable=hasReference&&flag===2;parameter.metadataToken=tokenOf(Table.GenericParam,g.rid);return parameter;
  }
  _shouldImport(access,isVirtual=false){return access>=4||(access===2||access===3?this._importInternal:this.importOptions==='all'||isVirtual);}

  // ---- members ----
  _members(type,rid){
    const md=this.metadata,members=[],methods=new Map();
    const [fieldStart,fieldEnd]=md.listRange(Table.TypeDef,rid,4,Table.Field);
    for(let f=fieldStart;f<fieldEnd;f++){const field=this._field(type,f);if(field)members.push(field);}
    const [methodStart,methodEnd]=md.listRange(Table.TypeDef,rid,5,Table.MethodDef);
    for(let m=methodStart;m<methodEnd;m++){const method=this._method(type,m);if(method){methods.set(m,method);members.push(method);}}
    const [propertyStart,propertyEnd]=md.memberMapRange(Table.PropertyMap,Table.Property,rid);
    for(let p=propertyStart;p<propertyEnd;p++){const property=this._property(type,p,methods);if(property)members.push(property);}
    const [eventStart,eventEnd]=md.memberMapRange(Table.EventMap,Table.Event,rid);
    for(let e=eventStart;e<eventEnd;e++){const event=this._event(type,e,methods);if(event)members.push(event);}
    for(const nestedRid of md.nesting.nested.get(rid)??[]){const visibility=md.row(Table.TypeDef,nestedRid)[0]&7;if(visibility===3?this.importOptions==='all':visibility===5||visibility===6?this._importInternal:true){const nested=this._type(nestedRid);if(nested)members.push(nested);}}
    for(const member of members)member.containingSymbol=type;return members;
  }
  _hasRequiredModifier(node,name){return !!node.modifiers?.some(m=>!m.isOptional&&this.metadata.typeTokenName(m.token)?.name===name);}
  /** Decodes one return/parameter/field/property slot: by-reference marker, custom modifiers and attribute transforms. */
  _slot(node,context,attributeToken,nullableContext,{isReturn=false,flags=0}={}){
    const data=attributeToken?decodeWellKnownAttributes(this.metadata.customAttributes(attributeToken)):noData,isByRef=node.kind==='byref',readOnly=isByRef&&(data.isReadOnly||this._hasRequiredModifier(node,'InAttribute'));
    const refKind=!isByRef?RefKind.None:isReturn?(readOnly?RefKind.RefReadOnly:RefKind.Ref):(flags&2)&&!(flags&1)?RefKind.Out:data.requiresLocation?RefKind.RefReadOnlyParameter:readOnly?RefKind.In:RefKind.Ref;
    const type=applyTypeTransforms(this._twa(isByRef?node.element:node,context),data,{refKind,refCustomModifierCount:isByRef?node.modifiers?.length??0:0,nullableContext});
    return {type,refKind,data};
  }
  _field(type,rid){
    const md=this.metadata,[flags,nameIndex,signature]=md.row(Table.Field,rid),name=md.string(nameIndex),access=flags&7,isStatic=!!(flags&0x10),token=tokenOf(Table.Field,rid);
    if(type.typeKind===TypeKind.Enum&&!isStatic)return null;
    // Private instance fields of structs are kept: definite assignment and the unmanaged constraint depend on them.
    if(!this._shouldImport(access)&&!(type.typeKind===TypeKind.Struct&&!isStatic))return null;
    const node=parseFieldSignature(md.blob(signature)),slot=this._slot(node,{type,methodTypeParameters:[]},token,type.nullableContext,{isReturn:true}),isConst=!!(flags&0x40);
    const modifiers=(isStatic&&!isConst?DeclarationModifiers.Static:0)|(flags&0x20?DeclarationModifiers.ReadOnly:0)|(isConst?DeclarationModifiers.Const:0)|(this._hasRequiredModifier(node,'IsVolatile')?DeclarationModifiers.Volatile:0)|(slot.data.requiredMember?DeclarationModifiers.Required:0);
    const constant=isConst?md.constant(token):undefined;
    const field=new FieldSymbol({name,type:slot.type,containingSymbol:type,declaredAccessibility:memberAccess[access],modifiers,refKind:slot.refKind,obsolete:slot.data.obsolete,...(constant?{constantValue:constant}:{})});
    return this._finish(field,token,slot.data);
  }
  _finish(symbol,token,data){symbol.metadataToken=token;symbol.unsupportedCompilerFeature=unsupportedCompilerFeature(data);lazy(symbol,'attributes',()=>this._attributes(token));return symbol;}
  _method(type,rid){
    const md=this.metadata,[,implFlags,flags,nameIndex,signatureIndex]=md.row(Table.MethodDef,rid),name=md.string(nameIndex),access=flags&7,token=tokenOf(Table.MethodDef,rid);
    const isStatic=!!(flags&0x10),isFinal=!!(flags&0x20),isVirtual=!!(flags&0x40),isNewSlot=!!(flags&0x100),isAbstract=!!(flags&0x400),isSpecialName=!!(flags&0x800),isInterface=type.typeKind===TypeKind.Interface;
    if(!this._shouldImport(access,isVirtual))return null;
    const data=decodeWellKnownAttributes(md.customAttributes(token)),nullableContext=data.nullableContext??type.nullableContext,context={type,methodTypeParameters:[]};
    const typeParameters=md.genericParameters(token).map(g=>this._typeParameter(g,context,nullableContext));context.methodTypeParameters=typeParameters;
    const signature=parseMethodSignature(md.blob(signatureIndex)),[paramStart,paramEnd]=md.listRange(Table.MethodDef,rid,5,Table.Param),rows=new Map();
    for(let p=paramStart;p<paramEnd;p++){const row=md.row(Table.Param,p);rows.set(row[1],{rid:p,flags:row[0],name:md.string(row[2])});}
    const returnRow=rows.get(0),returnSlot=this._slot(signature.returnType,context,returnRow?tokenOf(Table.Param,returnRow.rid):0,nullableContext,{isReturn:true});
    const semantics=md.semantics.byMethod.get(rid)?.semantics??0;
    let methodKind=MethodKind.Ordinary;
    if(flags&0x1000&&name==='.ctor')methodKind=MethodKind.Constructor;else if(flags&0x1000&&name==='.cctor')methodKind=MethodKind.StaticConstructor;
    else if(semantics&2)methodKind=MethodKind.PropertyGet;else if(semantics&1)methodKind=MethodKind.PropertySet;else if(semantics&8)methodKind=MethodKind.EventAdd;else if(semantics&0x10)methodKind=MethodKind.EventRemove;else if(semantics&0x20)methodKind=MethodKind.EventRaise;
    else if(type.typeKind===TypeKind.Delegate&&name==='Invoke')methodKind=MethodKind.DelegateInvoke;
    else if(isSpecialName&&isStatic&&/^op_(Implicit|Explicit|CheckedExplicit)$/.test(name))methodKind=MethodKind.Conversion;else if(isSpecialName&&isStatic&&name.startsWith('op_'))methodKind=MethodKind.UserDefinedOperator;
    else if(name==='Finalize'&&!isStatic&&isVirtual&&access===4&&!signature.parameters.length&&type.typeKind===TypeKind.Class&&signature.returnType.code===1)methodKind=MethodKind.Destructor;
    else if(access<=1&&name.includes('.'))methodKind=MethodKind.ExplicitInterfaceImplementation;
    const isExtensionMethod=methodKind===MethodKind.Ordinary&&isStatic&&data.isExtension&&signature.parameters.length>0&&type.mightContainExtensionMethods;
    const parameters=signature.parameters.map((node,i)=>{
      const row=rows.get(i+1),paramToken=row?tokenOf(Table.Param,row.rid):0,slot=this._slot(node,context,paramToken,nullableContext,{flags:row?.flags??0}),constant=row&&row.flags&0x1000?md.constant(paramToken):undefined;
      const parameter=new ParameterSymbol({name:row?.name??'',type:slot.type,refKind:slot.refKind,isParams:slot.data.isParamArray||slot.data.isParamCollection,isOptional:!!((row?.flags??0)&0x10),isThis:isExtensionMethod&&i===0,...(constant?{explicitDefaultValue:constant}:{})});
      parameter.metadataToken=paramToken;if(paramToken)lazy(parameter,'attributes',()=>this._attributes(paramToken));return parameter;
    });
    const isOverride=isVirtual&&!isNewSlot&&!isInterface&&methodKind!==MethodKind.Destructor;
    const modifiers=(isStatic?DeclarationModifiers.Static:0)|(isAbstract?DeclarationModifiers.Abstract:0)|(isVirtual&&!isAbstract&&!isFinal&&(isNewSlot||isInterface)?DeclarationModifiers.Virtual:0)|(isOverride?DeclarationModifiers.Override:0)|(isOverride&&isFinal?DeclarationModifiers.Sealed:0)
      |(flags&0x2000||implFlags&0x1000?DeclarationModifiers.Extern:0)|(data.isReadOnly||type.isReadOnly&&!isStatic&&methodKind!==MethodKind.Constructor?DeclarationModifiers.ReadOnly:0);
    const isConstructor=methodKind===MethodKind.Constructor;
    const method=new MethodSymbol({name,methodKind,returnType:returnSlot.type,refKind:returnSlot.refKind,parameters,typeParameters,containingSymbol:type,declaredAccessibility:memberAccess[access],modifiers,isExtensionMethod,isVararg:signature.callingConvention===5,
      isInitOnly:this._hasRequiredModifier(signature.returnType,'IsExternalInit'),obsolete:isConstructor&&data.obsolete?.message===RequiredMembersObsoleteMarker?null:data.obsolete});
    method.conditionalSymbols=Object.freeze([...data.conditionalSymbols]);method.setsRequiredMembers=data.setsRequiredMembers;
    return this._finish(method,token,data);
  }
  _accessors(token,methods){const result={};for(const {semantics,method} of this.metadata.semantics.byAssociation.get(token)??[]){const symbol=methods.get(method);if(!symbol)continue;if(semantics&2)result.get=symbol;else if(semantics&1)result.set=symbol;else if(semantics&8)result.add=symbol;else if(semantics&0x10)result.remove=symbol;else if(semantics&0x20)result.raise=symbol;}return result;}
  _property(type,rid,methods){
    const md=this.metadata,[,nameIndex,signatureIndex]=md.row(Table.Property,rid),metadataName=md.string(nameIndex),token=tokenOf(Table.Property,rid),accessors=this._accessors(token,methods),primary=accessors.get??accessors.set;
    if(!primary)return null;
    const signature=parseMethodSignature(md.blob(signatureIndex)),slot=this._slot(signature.returnType,{type,methodTypeParameters:[]},token,type.nullableContext,{isReturn:true});
    const source=accessors.get?accessors.get.parameters:accessors.set.parameters.slice(0,-1);
    const parameters=source.map(p=>{const copy=new ParameterSymbol({name:p.name,type:p.typeWithAnnotations,refKind:p.refKind,isParams:p.isParams,isOptional:p.isOptional,...(p.hasExplicitDefaultValue?{explicitDefaultValue:{value:p.explicitDefaultValue}}:{})});copy.metadataToken=p.metadataToken;return copy;});
    const isIndexer=parameters.length>0&&metadataName===type.defaultMemberName,inherited=DeclarationModifiers.Static|DeclarationModifiers.Abstract|DeclarationModifiers.Virtual|DeclarationModifiers.Override|DeclarationModifiers.Sealed|DeclarationModifiers.Extern;
    const property=new PEPropertySymbol({name:isIndexer?'this[]':metadataName,type:slot.type,refKind:accessors.get?.refKind??slot.refKind,parameters,getMethod:accessors.get??null,setMethod:accessors.set??null,containingSymbol:type,
      declaredAccessibility:mostAccessible([accessors.get,accessors.set].filter(Boolean).map(a=>a.declaredAccessibility)),modifiers:(primary.modifiers&inherited)|(slot.data.requiredMember?DeclarationModifiers.Required:0),obsolete:slot.data.obsolete},metadataName);
    return this._finish(property,token,slot.data);
  }
  _event(type,rid,methods){
    const md=this.metadata,[,nameIndex,typeIndex]=md.row(Table.Event,rid),token=tokenOf(Table.Event,rid),accessors=this._accessors(token,methods),primary=accessors.add??accessors.remove;if(!primary)return null;
    const data=decodeWellKnownAttributes(md.customAttributes(token)),eventType=applyTypeTransforms(this._typeFromToken(decodeBase(typeIndex),{type,methodTypeParameters:[]}),data,{nullableContext:type.nullableContext});
    const inherited=DeclarationModifiers.Static|DeclarationModifiers.Abstract|DeclarationModifiers.Virtual|DeclarationModifiers.Override|DeclarationModifiers.Sealed|DeclarationModifiers.Extern;
    const event=new EventSymbol({name:md.string(nameIndex),type:eventType,addMethod:accessors.add??null,removeMethod:accessors.remove??null,raiseMethod:accessors.raise??null,containingSymbol:type,declaredAccessibility:primary.declaredAccessibility,modifiers:primary.modifiers&inherited,obsolete:data.obsolete});
    return this._finish(event,token,data);
  }

  // ---- attributes ----
  _attributes(token){
    const raw=this.metadata.customAttributes(token);if(!raw.length)return noAttributes;const md=this.metadata,assembly=this;
    const env={typeName:t=>{const n=md.typeTokenName(t);return n?qualified(n.namespace,n.name):'';},enumUnderlyingType:(name,t)=>{const type=t?this.typeFromToken(t):this._typeByQualifiedName(name);return enumCodes[type?.enumUnderlyingType?.specialType]??8;}};
    return Object.freeze(raw.map(r=>{const decoded=decodeAttributeBlob(r.blob,r.parameterTypes,env);return Object.freeze({attributeClassName:r.fullName,get attributeClass(){return r.typeToken?assembly.typeFromToken(r.typeToken):null;},constructorArguments:Object.freeze(decoded.constructorArguments),namedArguments:Object.freeze(decoded.namedArguments),hasErrors:decoded.hasErrors});}));
  }
  /** Finds a type named in an attribute blob (`Ns.Type+Nested, Assembly, ...`) here or in a bound reference. */
  _typeByQualifiedName(text){const metadataName=String(text??'').split(',')[0].trim();return this.getTypeByMetadataName(metadataName)??this._bound.map(a=>a?.getTypeByMetadataName(metadataName)).find(Boolean)??null;}

  // ---- type references and signatures ----
  _typeFromToken(token,context){
    const rid=ridOf(token);
    switch(tableOf(token)){
      case Table.TypeDef:return this._type(rid)??new ErrorTypeSymbol('<Module>');
      case Table.TypeRef:return this._typeRef(rid);
      case Table.TypeSpec:return this._twa(parseTypeSignature(this.metadata.blob(this.metadata.row(Table.TypeSpec,rid)[0])),context).type;
      default:return ErrorTypeSymbol.unknown;
    }
  }
  _typeRef(rid){
    const cached=this._typeRefs.get(rid);if(cached)return cached;const md=this.metadata,row=md.row(Table.TypeRef,rid),metadataName=md.string(row[1]),full=qualified(md.string(row[2]),metadataName),scope=row[0]?decodeScope(row[0]):0;let result;
    if(tableOf(scope)===Table.TypeRef&&scope){const outer=this._typeRef(ridOf(scope));result=outer instanceof ErrorTypeSymbol?this._missing(outer.metadataFullName??outer.name,outer.reason,metadataName):outer.containingAssembly._nested.get(outer)?.get(metadataName)??this._missing(outer.metadataFullName,{code:DiagnosticId.CS7069,args:[displayName(outer.metadataFullName+'+'+metadataName),outer.containingAssembly.name]},metadataName);}
    else if(tableOf(scope)===Table.AssemblyRef&&scope){const index=ridOf(scope)-1,target=this._bound[index];
      if(!target)result=this._missing(full,{code:DiagnosticId.CS0012,args:[missingTypeName(full),this.referencedAssemblyIdentities[index].getDisplayName()]});
      else{const found=target._resolveTopLevel(full,[]);result=found?found.type??this._missing(full,found.error):this._missing(full,{code:DiagnosticId.CS7069,args:[displayName(full),target.name]});}}
    else if(tableOf(scope)===Table.ModuleRef&&scope)result=this._missing(full,{code:DiagnosticId.CS7069,args:[displayName(full),this.name]});
    else{const found=this._resolveTopLevel(full,[]);result=found?found.type??this._missing(full,found.error):this._missing(full,{code:DiagnosticId.CS7069,args:[displayName(full),this.name]});}
    this._typeRefs.set(rid,result);return result;
  }
  /** Signature node -> TypeWithAnnotations (custom modifiers kept, nullability oblivious until the Nullable transform). */
  _twa(node,context){
    const type=this._symbol(node,context);if(!node.modifiers)return new TypeWithAnnotations(type);
    return new TypeWithAnnotations(type,NullableAnnotation.Oblivious,node.modifiers.map(m=>({isOptional:m.isOptional,modifier:this._typeFromToken(m.token,context)})));
  }
  _symbol(node,context){
    switch(node.kind){
      case 'primitive':return this.getSpecialType(specialTypeId(primitiveNames[node.code]));
      case 'type':return this._typeFromToken(node.token,context);
      case 'var':return context.type?._allTypeParameters[node.index]??new ErrorTypeSymbol('!'+node.index);
      case 'mvar':return context.methodTypeParameters?.[node.index]??new ErrorTypeSymbol('!!'+node.index);
      case 'szarray':return new ArrayTypeSymbol(this._twa(node.element,context),1,{baseType:()=>this.getSpecialType('System_Array')});
      case 'array':return node.rank>=1&&node.rank<=32?new ArrayTypeSymbol(this._twa(node.element,context),node.rank,{isSZArray:false,baseType:()=>this.getSpecialType('System_Array')}):ErrorTypeSymbol.unknown;
      case 'pointer':return new PointerTypeSymbol(this._twa(node.element,context));
      case 'byref':return this._symbol(node.element,context);
      case 'generic':return constructGeneric(this._typeFromToken(node.token,context),node.arguments.map(a=>this._twa(a,context)));
      case 'fnptr':{
        const s=node.signature,convention=s.callingConvention,slot=(n,isReturn)=>{const isByRef=n.kind==='byref',readOnly=isByRef&&this._hasRequiredModifier(n,'InAttribute'),isOut=isByRef&&!isReturn&&this._hasRequiredModifier(n,'OutAttribute');
          return {type:this._twa(isByRef?n.element:n,context),refKind:!isByRef?RefKind.None:isReturn?(readOnly?RefKind.RefReadOnly:RefKind.Ref):isOut?RefKind.Out:readOnly?RefKind.In:RefKind.Ref};};
        const result=slot(s.returnType,true),named=['Cdecl','Stdcall','Thiscall','Fastcall'][convention-1];
        const conventions=named?[named]:convention===9?(s.returnType.modifiers??[]).map(m=>this.metadata.typeTokenName(m.token)?.name??'').filter(n=>n.startsWith('CallConv')).map(n=>n.slice(8)):[];
        return new FunctionPointerTypeSymbol({callingConvention:convention===0?'managed':'unmanaged',unmanagedConventions:conventions,returnType:result.type,returnRefKind:result.refKind,parameters:s.parameters.map(p=>slot(p,false))});
      }
      default:return ErrorTypeSymbol.unknown;
    }
  }
}
const decodeBase=coded=>{const tables=[Table.TypeDef,Table.TypeRef,Table.TypeSpec];return tokenOf(tables[coded&3],coded>>>2);};
const decodeScope=coded=>{const tables=[Table.Module,Table.ModuleRef,Table.AssemblyRef,Table.TypeRef];return tokenOf(tables[coded&3],coded>>>2);};
/** `Ns.List`1` -> `Ns.List<>` for diagnostics about types that have no symbol. */
/** How Roslyn names a type of an unreferenced assembly in CS0012: without its namespace (pinned in test/references). */
const missingTypeName=metadataName=>{const outer=metadataName.split('+')[0],dot=outer.lastIndexOf('.');return displayName(metadataName.slice(dot+1));};
const displayName=metadataName=>metadataName.replace(/\+/g,'.').replace(/`(\d+)/g,(_,n)=>'<'+','.repeat(Number(n)-1)+'>');
/** Applies the flattened type arguments of a GENERICINST to a definition and its containing types. */
function constructGeneric(definition,args){
  if(definition instanceof ErrorTypeSymbol){const error=new ErrorTypeSymbol(definition.name,definition.arity,{reason:definition.reason,candidates:definition.candidates,containingSymbol:definition.containingSymbol,typeArguments:args});error.metadataFullName=definition.metadataFullName;return error;}
  if(!(definition instanceof NamedTypeSymbol))return ErrorTypeSymbol.unknown;
  const chain=[];for(let t=definition;t;t=t.containingType)chain.unshift(t);
  if(chain.reduce((n,t)=>n+t.arity,0)!==args.length)return new ErrorTypeSymbol(definition.name,definition.arity,{typeArguments:args});
  let container=null,at=0;
  for(const t of chain){if(!t.arity&&!container)continue;container=new ConstructedNamedTypeSymbol(t,args.slice(at,at+t.arity),container);at+=t.arity;}
  return container??definition;
}
/**
 * Imports an assembly image.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {object} [options] see `PEAssemblySymbol`
 * @returns {PEAssemblySymbol} `.identity`, `.globalNamespace`, `.referencedAssemblyIdentities`, `.forwardedTypes`, ...
 */
export function importAssembly(bytes,options={}){return new PEAssemblySymbol(bytes,options);}
