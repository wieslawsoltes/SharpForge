/**
 * The type-symbol model: the semantic representation of C# types that replaces string-typed type names.
 *
 * Symbols are immutable once published. A generic definition's type arguments are its own type parameters;
 * constructed types are produced by `construct` or by substitution and compare by `equals`, never by identity.
 * Display follows Roslyn's SymbolDisplayFormat families (see `SymbolDisplayFormat`).
 * The string adapter that keeps the string-typed profile working lives in ./legacy-types.js.
 */
import {tupleDisplay} from './tuple-elements.js';
import {withTypeArgumentAnnotations} from './annotated-instantiations.js';
import {membersNamed} from './member-index.js';
export const SymbolKind=Object.freeze({Assembly:'Assembly',Namespace:'Namespace',NamedType:'NamedType',ArrayType:'ArrayType',PointerType:'PointerType',FunctionPointerType:'FunctionPointerType',DynamicType:'DynamicType',ErrorType:'ErrorType',TypeParameter:'TypeParameter',Method:'Method',Field:'Field',Property:'Property',Event:'Event',Parameter:'Parameter',Local:'Local',Label:'Label',Alias:'Alias',RangeVariable:'RangeVariable',Discard:'Discard'});
export const TypeKind=Object.freeze({Class:'class',Struct:'struct',Interface:'interface',Enum:'enum',Delegate:'delegate',Array:'array',Pointer:'pointer',FunctionPointer:'functionPointer',TypeParameter:'typeParameter',Dynamic:'dynamic',Error:'error',Submission:'submission',Module:'module'});
export const Accessibility=Object.freeze({NotApplicable:'notApplicable',Private:'private',ProtectedAndInternal:'privateProtected',Protected:'protected',Internal:'internal',ProtectedOrInternal:'protectedInternal',Public:'public'});
export const NullableAnnotation=Object.freeze({Oblivious:'oblivious',NotAnnotated:'notAnnotated',Annotated:'annotated'});
export const Variance=Object.freeze({None:'none',Out:'out',In:'in'});
export const RefKind=Object.freeze({None:'none',Ref:'ref',Out:'out',In:'in',RefReadOnly:'ref readonly',RefReadOnlyParameter:'ref readonly parameter'});
/**
 * Options for `TypeSymbol.equals` (Roslyn TypeCompareKind). Combine with `|`. Nullable annotations of reference types
 * are not part of the identity of a type (`List<string?>` is `List<string>` for conversions, overrides and
 * implementations): they are compared only with `StrictNullability`.
 */
export const TypeCompareKind=Object.freeze({ConsiderEverything:0,IgnoreCustomModifiers:1,IgnoreDynamic:2,IgnoreTupleNames:4,IgnoreNullableModifiersForReferenceTypes:8,IgnoreNativeIntegers:16,AllIgnoreOptions:31,StrictNullability:32});
/** Roslyn display format families. ErrorMessage is the format diagnostics use. */
export const SymbolDisplayFormat=Object.freeze({ErrorMessage:'errorMessage',MinimallyQualified:'minimal',FullyQualified:'fullyQualified',Test:'test',Signature:'signature'});
const keywords=Object.freeze({System_Object:'object',System_Void:'void',System_Boolean:'bool',System_Char:'char',System_SByte:'sbyte',System_Byte:'byte',System_Int16:'short',System_UInt16:'ushort',System_Int32:'int',System_UInt32:'uint',System_Int64:'long',System_UInt64:'ulong',System_Decimal:'decimal',System_Single:'float',System_Double:'double',System_String:'string'});
/** C# keyword for a special-type id (for example System_Int32 is int), or null. */
export const specialTypeKeyword=id=>keywords[id]??null;

/** Base of every symbol. `containingSymbol` is the lexical/metadata owner. */
export class SymbolBase {
  constructor(kind,name){this.kind=kind;this.name=name??'';this.containingSymbol=null;this.declaredAccessibility=Accessibility.NotApplicable;this.locations=[];this.isImplicitlyDeclared=false;}
  get originalDefinition(){return this;}
  get isDefinition(){return this.originalDefinition===this;}
  get containingType(){for(let s=this.containingSymbol;s;s=s.containingSymbol)if(s.kind===SymbolKind.NamedType)return s;return null;}
  get containingNamespace(){for(let s=this.containingSymbol;s;s=s.containingSymbol)if(s.kind===SymbolKind.Namespace)return s;return null;}
  get metadataName(){return this.name;}
  equals(other){return this===other;}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){return this.name;}
  toString(){return this.toDisplayString();}
}
const annotationSuffix=(t,format)=>format!=='signature'&&t.nullableAnnotation===NullableAnnotation.Annotated&&t.type.isReferenceType!==false&&!t.type.isNullableValueType?'?':'';
/** A type together with its nullable annotation and custom modifiers (Roslyn TypeWithAnnotations). */
export class TypeWithAnnotations {
  constructor(type,nullableAnnotation=NullableAnnotation.Oblivious,customModifiers=[]){this.type=type;this.nullableAnnotation=nullableAnnotation;this.customModifiers=Object.freeze([...customModifiers]);Object.freeze(this);}
  /** Accepts a TypeSymbol or an existing TypeWithAnnotations. */
  static create(type,nullableAnnotation,customModifiers){if(type instanceof TypeWithAnnotations)return nullableAnnotation===undefined&&customModifiers===undefined?type:new TypeWithAnnotations(type.type,nullableAnnotation??type.nullableAnnotation,customModifiers??type.customModifiers);return new TypeWithAnnotations(type,nullableAnnotation,customModifiers);}
  get isAnnotated(){return this.nullableAnnotation===NullableAnnotation.Annotated;}
  withAnnotation(annotation){return annotation===this.nullableAnnotation?this:new TypeWithAnnotations(this.type,annotation,this.customModifiers);}
  withType(type){return type===this.type?this:new TypeWithAnnotations(type,this.nullableAnnotation,this.customModifiers);}
  equals(other,compare=TypeCompareKind.ConsiderEverything){
    if(!(other instanceof TypeWithAnnotations)||!this.type.equals(other.type,compare))return false;
    if(compare&TypeCompareKind.StrictNullability&&this.nullableAnnotation!==other.nullableAnnotation&&this.nullableAnnotation!==NullableAnnotation.Oblivious&&other.nullableAnnotation!==NullableAnnotation.Oblivious)return false;
    if(!(compare&TypeCompareKind.IgnoreCustomModifiers)&&(this.customModifiers.length!==other.customModifiers.length||this.customModifiers.some((m,i)=>m.isOptional!==other.customModifiers[i].isOptional||!m.modifier.equals(other.customModifiers[i].modifier,compare))))return false;
    return true;
  }
  substitute(map){const type=this.type.substitute(map);if(type instanceof TypeWithAnnotations)return this.isAnnotated&&!type.isAnnotated?type.withAnnotation(NullableAnnotation.Annotated):type;return this.withType(type);}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){return this.type.toDisplayString(format)+annotationSuffix(this,format);}
  toString(){return this.toDisplayString();}
}
const twa=t=>t instanceof TypeWithAnnotations?t:new TypeWithAnnotations(t);
const viewKinds=Object.freeze({delegate:TypeKind.Delegate,oblivious:NullableAnnotation.Oblivious});
const sameList=(a,b,compare)=>a.length===b.length&&a.every((x,i)=>x.equals(b[i],compare));

/** Maps type parameters to type arguments; the basis of constructed types and members. */
export class TypeMap {
  constructor(from=[],to=[]){if(from.length!==to.length)throw new RangeError('TypeMap needs one type argument per type parameter');this.map=new Map(from.map((p,i)=>[p,twa(to[i])]));}
  static empty=new TypeMap();
  get isEmpty(){return this.map.size===0;}
  get(parameter){return this.map.get(parameter)??null;}
  /** A map that applies this map and then falls back to `other` for parameters this map does not bind. */
  with(from,to){const result=new TypeMap();for(const [k,v] of this.map)result.map.set(k,v);from.forEach((p,i)=>result.map.set(p,twa(to[i])));return result;}
  substituteType(type){return type instanceof TypeWithAnnotations?type.substitute(this):twa(type).substitute(this);}
  substituteTypes(types){return types.map(t=>this.substituteType(t));}
}

/** Base of all type symbols. */
export class TypeSymbol extends SymbolBase {
  get typeKind(){return TypeKind.Error;}
  get specialType(){return null;}
  /** true/false when known; null when it depends on an unconstrained type parameter. */
  get isReferenceType(){return false;}
  get isValueType(){return false;}
  get isNullableValueType(){return false;}
  get baseType(){return null;}
  get interfaces(){return [];}
  /** The transitive interface set, most derived first. */
  get allInterfaces(){const result=[],add=t=>{for(const i of t.interfaces){if(!result.some(x=>x.equals(i))){result.push(i);add(i);}}};for(let t=this;t;t=t.baseType)add(t);return result;}
  getMembers(name){return [];}
  isErrorType(){return this.typeKind===TypeKind.Error;}
  substitute(map){return this;}
  equals(other,compare=TypeCompareKind.ConsiderEverything){return this===other;}
  /** True when `this` is `other` or derives from it (classes only; interfaces use allInterfaces). */
  isDerivedFrom(other,compare=TypeCompareKind.ConsiderEverything){for(let t=this.baseType;t;t=t.baseType)if(t.equals(other,compare))return true;return false;}
}
const dynamicOrObject=(a,b)=>a.typeKind===TypeKind.Dynamic&&b.specialType==='System_Object'||b.typeKind===TypeKind.Dynamic&&a.specialType==='System_Object';
const qualifiedName=(symbol,format)=>{
  const parts=[];for(let n=symbol.containingNamespace;n&&!n.isGlobalNamespace;n=n.containingNamespace)parts.unshift(n.name);
  return (format===SymbolDisplayFormat.FullyQualified?'global::':'')+parts.map(p=>p+'.').join('');
};

/** A class, struct, interface, enum or delegate; generic definitions and their constructions. */
export class NamedTypeSymbol extends TypeSymbol {
  /**
   * @param {object} init name, arity or typeParameters, typeKind, containingSymbol (namespace or type), declaredAccessibility,
   *   specialType, modifier flags (isStatic,isAbstract,isSealed,isReadOnly,isRefLikeType,isRecord), baseType/interfaces/members
   *   (values or thunks), enumUnderlyingType, tupleElementNames, isNativeInteger.
   */
  constructor(init={}){
    super(SymbolKind.NamedType,init.name);this._typeKind=init.typeKind??TypeKind.Class;this.containingSymbol=init.containingSymbol??null;this.declaredAccessibility=init.declaredAccessibility??Accessibility.Public;
    this._specialType=init.specialType??null;this.isStatic=!!init.isStatic;this.isAbstract=!!init.isAbstract;this.isSealed=!!init.isSealed;this.isReadOnly=!!init.isReadOnly;this.isRefLikeType=!!init.isRefLikeType;this.isRecord=!!init.isRecord;this.isNativeInteger=!!init.isNativeInteger;
    this.typeParameters=Object.freeze(init.typeParameters?init.typeParameters.map((p,i)=>{p.containingSymbol=this;p.ordinal=i;return p;}):Array.from({length:init.arity??0},(_,i)=>new TypeParameterSymbol({name:(init.arity===1?'T':'T'+(i+1)),ordinal:i,containingSymbol:this})));
    this._base=init.baseType??null;this._interfaces=init.interfaces??[];this._members=init.members??[];this.enumUnderlyingType=init.enumUnderlyingType??null;this.tupleElementNames=init.tupleElementNames??null;this.locations=init.locations??[];this.isImplicitlyDeclared=!!init.isImplicitlyDeclared;this._constructed=new Map();this._typeArguments=null;
  }
  get typeKind(){return this._typeKind;}
  get specialType(){return this._specialType;}
  get arity(){return this.typeParameters.length;}
  get metadataName(){return this.arity?this.name+'`'+this.arity:this.name;}
  /** Namespace-qualified CLR name, with `+` between nested types (System.Collections.Generic.List`1). */
  get metadataFullName(){const outer=this.containingType;return outer?outer.metadataFullName+'+'+this.metadataName:qualifiedName(this,SymbolDisplayFormat.Test)+this.metadataName;}
  get constructedFrom(){return this;}
  get typeArguments(){return this._typeArguments??=Object.freeze(this.typeParameters.map(p=>new TypeWithAnnotations(p)));}
  get isGenericType(){return this.arity>0||!!this.containingType?.isGenericType;}
  get isUnboundGenericType(){return false;}
  get isReferenceType(){return [TypeKind.Class,TypeKind.Interface,TypeKind.Delegate].includes(this.typeKind);}
  get isValueType(){return this.typeKind===TypeKind.Struct||this.typeKind===TypeKind.Enum;}
  get isNullableValueType(){return this.originalDefinition.specialType==='System_Nullable_T';}
  /** The T of Nullable<T>, or null. */
  get nullableUnderlyingType(){return this.isNullableValueType?this.typeArguments[0].type:null;}
  get isTupleType(){const d=this.originalDefinition;return d.name==='ValueTuple'&&d.arity>0&&d.containingNamespace?.name==='System'&&!!d.containingNamespace.containingNamespace?.isGlobalNamespace;}
  get baseType(){const b=typeof this._base==='function'?this._base=this._base():this._base;return b;}
  get interfaces(){return typeof this._interfaces==='function'?this._interfaces=this._interfaces():this._interfaces;}
  get delegateInvokeMethod(){return this.typeKind===TypeKind.Delegate?this.getMembers('Invoke').find(m=>m.kind===SymbolKind.Method)??null:null;}
  /** Members declared by this type; pass a name to filter. */
  getMembers(name){
    const all=typeof this._members==='function'?this._members=this._members():this._members;
    return name===undefined?all:membersNamed(this,all,name);
  }
  getTypeMembers(name,arity){return this.getMembers(name).filter(m=>m.kind===SymbolKind.NamedType&&(arity===undefined||m.arity===arity));}
  /** Registers a member on a definition while it is being built. */
  addMember(member){if(typeof this._members==='function')this._members=this._members();this._members.push(member);member.containingSymbol=this;return member;}
  /** Constructs this generic definition (or re-constructs a construction) with type arguments. */
  construct(...typeArguments){
    if(typeArguments.length===1&&Array.isArray(typeArguments[0]))typeArguments=typeArguments[0];const definition=this.originalDefinition;
    if(typeArguments.length!==definition.arity)throw new RangeError(`'${definition.metadataName}' takes ${definition.arity} type arguments, not ${typeArguments.length}`);
    if(!definition.arity)return this;const args=typeArguments.map(twa);
    // A module whose instantiations carry their own members (the closed framework registry) supplies them here.
    return withTypeArgumentAnnotations(definition.instanceProvider?.(definition,args),args,viewKinds)??new ConstructedNamedTypeSymbol(definition,args,this.containingType);
  }
  substitute(map){
    if(map.isEmpty||!this.isGenericType)return this;const container=this.containingType,newContainer=container?container.substitute(map):null,args=this.typeArguments.map(a=>a.substitute(map));
    if(newContainer===container&&args.every((a,i)=>a===this.typeArguments[i]||a.equals(this.typeArguments[i])&&a.nullableAnnotation===this.typeArguments[i].nullableAnnotation))return this;
    return new ConstructedNamedTypeSymbol(this.originalDefinition,args,newContainer);
  }
  equals(other,compare=TypeCompareKind.ConsiderEverything){
    if(this===other)return true;if(!(other instanceof TypeSymbol))return false;
    if(compare&TypeCompareKind.IgnoreDynamic&&dynamicOrObject(this,other))return true;
    if(!(other instanceof NamedTypeSymbol)||this.originalDefinition!==other.originalDefinition)return false;
    if(!(compare&TypeCompareKind.IgnoreNativeIntegers)&&this.isNativeInteger!==other.isNativeInteger)return false;
    const a=this.containingType,b=other.containingType;if(a&&b?!a.equals(b,compare):a!==b)return false;
    if(!sameList(this.typeArguments,other.typeArguments,compare))return false;
    if(!(compare&TypeCompareKind.IgnoreTupleNames)&&(this.tupleElementNames||other.tupleElementNames)&&JSON.stringify(this.tupleElementNames??[])!==JSON.stringify(other.tupleElementNames??[]))return false;
    return true;
  }
  /** A copy of this tuple type carrying element names. */
  withTupleElementNames(names){const copy=new ConstructedNamedTypeSymbol(this.originalDefinition,this.typeArguments,this.containingType);copy.tupleElementNames=names?Object.freeze([...names]):null;return copy;}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){
    const test=format===SymbolDisplayFormat.Test;
    if(this.isNullableValueType&&!this.isDefinition)return this.typeArguments[0].toDisplayString(format)+'?';
    if(this.isTupleType&&!this.isDefinition&&this.arity>1)return tupleDisplay(this,a=>a.toDisplayString(format));
    if(test&&this.specialType==='System_Void')return 'void';
    if(!test){if(this.isNativeInteger)return this.specialType==='System_UIntPtr'?'nuint':'nint';const keyword=specialTypeKeyword(this.specialType);if(keyword)return keyword;}
    const outer=this.containingType,prefix=outer?outer.toDisplayString(format)+'.':format===SymbolDisplayFormat.MinimallyQualified?'':qualifiedName(this,format);
    return prefix+this.name+(this.arity?'<'+this.typeArguments.map(a=>a.toDisplayString(format)).join(', ')+'>':'');
  }
}
/** A generic type applied to type arguments. Members, base type and interfaces are substituted lazily. */
export class ConstructedNamedTypeSymbol extends NamedTypeSymbol {
  constructor(definition,typeArguments,containingType=null){
    super({name:definition.name,typeKind:definition.typeKind,containingSymbol:containingType??definition.containingSymbol,declaredAccessibility:definition.declaredAccessibility,specialType:null,typeParameters:[]});
    this._definition=definition;this._args=Object.freeze([...typeArguments]);this._substituted=null;this._map=null;
    for(const flag of ['isStatic','isAbstract','isSealed','isReadOnly','isRefLikeType','isRecord','isNativeInteger'])this[flag]=definition[flag];this.locations=definition.locations;this.typeParameters=definition.typeParameters;
  }
  get originalDefinition(){return this._definition;}
  get constructedFrom(){return this._definition;}
  get specialType(){return this._definition.arity?null:this._definition.specialType;}
  get typeArguments(){return this._args;}
  get enumUnderlyingTypeSymbol(){return this._definition.enumUnderlyingType;}
  /** The substitution from the definition's type parameters (including enclosing types') to this construction's arguments. */
  get typeMap(){if(this._map)return this._map;const outer=this.containingType;let map=outer instanceof ConstructedNamedTypeSymbol?outer.typeMap:TypeMap.empty;return this._map=map.with(this._definition.typeParameters,this._args);}
  get baseType(){const b=this._definition.baseType;return b?b.substitute(this.typeMap):null;}
  get interfaces(){return this._definition.interfaces.map(i=>i.substitute(this.typeMap));}
  /** Members are substituted on first use, one name at a time: a construction rarely needs more than a few of them. */
  getMembers(name){
    if(name===undefined)return this._substituted??=this._definition.getMembers().map(m=>this._memberOf(m));
    let list=this._byName?.get(name);if(!list){list=this._definition.getMembers(name).map(m=>this._memberOf(m));(this._byName??=new Map()).set(name,list);}
    return list.slice();
  }
  _memberOf(member){
    if(!member.asMemberOf)return member;
    let own=this._memberMap?.get(member);if(!own){own=member.asMemberOf(this);(this._memberMap??=new Map()).set(member,own);}
    return own;
  }
  addMember(){throw new TypeError('Members are added to the generic definition, not to a constructed type');}
}

/** T[] and T[,]. `rank` is the number of dimensions; `isSZArray` distinguishes T[] from a rank-1 multi-dimensional T[*]. */
export class ArrayTypeSymbol extends TypeSymbol {
  constructor(elementType,rank=1,options={}){super(SymbolKind.ArrayType,'');if(!Number.isInteger(rank)||rank<1||rank>32)throw new RangeError('Array rank must be 1-32');this.elementTypeWithAnnotations=twa(elementType);this.rank=rank;this.isSZArray=rank===1&&options.isSZArray!==false;this._base=options.baseType??null;this._interfaces=options.interfaces??[];}
  get elementType(){return this.elementTypeWithAnnotations.type;}
  get typeKind(){return TypeKind.Array;}
  get isReferenceType(){return true;}
  get baseType(){return typeof this._base==='function'?this._base=this._base():this._base;}
  get interfaces(){return typeof this._interfaces==='function'?this._interfaces=this._interfaces(this):this._interfaces;}
  substitute(map){const element=this.elementTypeWithAnnotations.substitute(map);return element===this.elementTypeWithAnnotations?this:new ArrayTypeSymbol(element,this.rank,{isSZArray:this.isSZArray,baseType:this._base,interfaces:this._interfaces});}
  equals(other,compare=TypeCompareKind.ConsiderEverything){return this===other||other instanceof ArrayTypeSymbol&&other.rank===this.rank&&other.isSZArray===this.isSZArray&&this.elementTypeWithAnnotations.equals(other.elementTypeWithAnnotations,compare);}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){
    // C# writes rank specifiers outermost first: an array of int[,] is int[][,].
    let ranks='',t=this,element;for(;;){ranks+=t.isSZArray?'[]':'['+(t.rank===1?'*':','.repeat(t.rank-1))+']';element=t.elementTypeWithAnnotations;if(element.type instanceof ArrayTypeSymbol&&!element.isAnnotated)t=element.type;else break;}
    return element.toDisplayString(format)+ranks;
  }
}
export class PointerTypeSymbol extends TypeSymbol {
  constructor(pointedAtType){super(SymbolKind.PointerType,'');this.pointedAtTypeWithAnnotations=twa(pointedAtType);}
  get pointedAtType(){return this.pointedAtTypeWithAnnotations.type;}
  get typeKind(){return TypeKind.Pointer;}
  substitute(map){const t=this.pointedAtTypeWithAnnotations.substitute(map);return t===this.pointedAtTypeWithAnnotations?this:new PointerTypeSymbol(t);}
  equals(other,compare=TypeCompareKind.ConsiderEverything){return this===other||other instanceof PointerTypeSymbol&&this.pointedAtTypeWithAnnotations.equals(other.pointedAtTypeWithAnnotations,compare);}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){return this.pointedAtTypeWithAnnotations.toDisplayString(format)+'*';}
}
const refPrefix=kind=>kind&&kind!==RefKind.None?(kind===RefKind.RefReadOnlyParameter?'ref readonly':kind)+' ':'';
/** delegate*<...>: `signature` is {callingConvention:'managed'|'unmanaged', unmanagedConventions:string[], returnType, returnRefKind, parameters:[{type,refKind}]}. */
export class FunctionPointerTypeSymbol extends TypeSymbol {
  constructor(signature){super(SymbolKind.FunctionPointerType,'');this.signature=Object.freeze({callingConvention:signature.callingConvention??'managed',unmanagedConventions:Object.freeze([...(signature.unmanagedConventions??[])]),returnType:twa(signature.returnType),returnRefKind:signature.returnRefKind??RefKind.None,parameters:Object.freeze((signature.parameters??[]).map(p=>Object.freeze({type:twa(p.type??p),refKind:p.refKind??RefKind.None})))});}
  get typeKind(){return TypeKind.FunctionPointer;}
  substitute(map){const s=this.signature,returnType=s.returnType.substitute(map),parameters=s.parameters.map(p=>({type:p.type.substitute(map),refKind:p.refKind}));if(returnType===s.returnType&&parameters.every((p,i)=>p.type===s.parameters[i].type))return this;return new FunctionPointerTypeSymbol({...s,returnType,parameters});}
  equals(other,compare=TypeCompareKind.ConsiderEverything){if(this===other)return true;if(!(other instanceof FunctionPointerTypeSymbol))return false;const a=this.signature,b=other.signature;
    return a.callingConvention===b.callingConvention&&a.unmanagedConventions.join()===b.unmanagedConventions.join()&&a.returnRefKind===b.returnRefKind&&a.returnType.equals(b.returnType,compare)&&a.parameters.length===b.parameters.length&&a.parameters.every((p,i)=>p.refKind===b.parameters[i].refKind&&p.type.equals(b.parameters[i].type,compare));}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){const s=this.signature,convention=s.callingConvention==='unmanaged'?' unmanaged'+(s.unmanagedConventions.length?'['+s.unmanagedConventions.join(', ')+']':''):'';
    return 'delegate*'+convention+'<'+[...s.parameters.map(p=>refPrefix(p.refKind)+p.type.toDisplayString(format)),refPrefix(s.returnRefKind)+s.returnType.toDisplayString(format)].join(', ')+'>';}
}
/** A type parameter of a generic type or method. Constraint flags mirror Roslyn's ITypeParameterSymbol. */
export class TypeParameterSymbol extends TypeSymbol {
  constructor(init={}){super(SymbolKind.TypeParameter,init.name);this.ordinal=init.ordinal??0;this.containingSymbol=init.containingSymbol??null;this.variance=init.variance??Variance.None;this.hasReferenceTypeConstraint=!!init.hasReferenceTypeConstraint;this.hasValueTypeConstraint=!!init.hasValueTypeConstraint;this.hasUnmanagedTypeConstraint=!!init.hasUnmanagedTypeConstraint;this.hasNotNullConstraint=!!init.hasNotNullConstraint;this.hasConstructorConstraint=!!init.hasConstructorConstraint;this.allowsRefLikeType=!!init.allowsRefLikeType;this._constraintTypes=init.constraintTypes??[];this.locations=init.locations??[];}
  get typeKind(){return TypeKind.TypeParameter;}
  /** 'method' for method type parameters, 'type' otherwise. */
  get typeParameterKind(){return this.containingSymbol?.kind===SymbolKind.Method?'method':'type';}
  get constraintTypes(){return typeof this._constraintTypes==='function'?this._constraintTypes=this._constraintTypes():this._constraintTypes;}
  get isReferenceType(){return this.hasReferenceTypeConstraint||this.constraintTypes.some(c=>(c.type??c).typeKind===TypeKind.Class&&(c.type??c).specialType!=='System_Object'&&(c.type??c).specialType!=='System_ValueType'&&(c.type??c).specialType!=='System_Enum')?true:this.isValueType?false:null;}
  get isValueType(){return this.hasValueTypeConstraint||this.hasUnmanagedTypeConstraint;}
  substitute(map){return map.get(this)??this;}
  toDisplayString(){return this.name;}
}
export class DynamicTypeSymbol extends TypeSymbol {
  constructor(){super(SymbolKind.DynamicType,'dynamic');}
  static instance=new DynamicTypeSymbol();
  get typeKind(){return TypeKind.Dynamic;}
  get isReferenceType(){return true;}
  equals(other,compare=TypeCompareKind.ConsiderEverything){return other instanceof DynamicTypeSymbol||!!(compare&TypeCompareKind.IgnoreDynamic)&&other instanceof TypeSymbol&&other.specialType==='System_Object';}
  toDisplayString(){return 'dynamic';}
}
/** Stands in for a type that could not be bound. `candidates` and `reason` describe why (diagnostic id plus arguments). */
export class ErrorTypeSymbol extends TypeSymbol {
  constructor(name='',arity=0,options={}){super(SymbolKind.ErrorType,name);this.arity=arity;this.candidates=options.candidates??[];this.reason=options.reason??null;this.containingSymbol=options.containingSymbol??null;this._args=options.typeArguments?options.typeArguments.map(twa):[];}
  /** The anonymous error type used when there is nothing better to report. */
  static unknown=new ErrorTypeSymbol('');
  get typeKind(){return TypeKind.Error;}
  get typeArguments(){return this._args;}
  get metadataName(){return this.arity?this.name+'`'+this.arity:this.name;}
  substitute(map){if(!this._args.length)return this;const args=this._args.map(a=>a.substitute(map));return args.every((a,i)=>a===this._args[i])?this:new ErrorTypeSymbol(this.name,this.arity,{candidates:this.candidates,reason:this.reason,containingSymbol:this.containingSymbol,typeArguments:args});}
  equals(other,compare=TypeCompareKind.ConsiderEverything){return this===other||other instanceof ErrorTypeSymbol&&this.name!==''&&other.name===this.name&&other.arity===this.arity&&this.containingSymbol===other.containingSymbol&&sameList(this._args,other._args,compare);}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){const text=(this.name||'?')+(this._args.length?'<'+this._args.map(a=>a.toDisplayString(format)).join(', ')+'>':'');return format===SymbolDisplayFormat.Test?text+'[missing]':text;}
}
/** Element type of an array, or null. */
export const elementTypeOf=type=>type instanceof ArrayTypeSymbol?type.elementType:null;
/** Strips any TypeWithAnnotations wrapper. */
export const typeOf=t=>t instanceof TypeWithAnnotations?t.type:t;
/** Substitutes through a TypeMap and returns the bare TypeSymbol. */
export const substituteType=(type,map)=>typeOf(map.substituteType(type));
