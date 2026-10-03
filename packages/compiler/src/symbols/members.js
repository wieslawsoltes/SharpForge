import {SymbolBase,SymbolKind,Accessibility,RefKind,TypeWithAnnotations,TypeMap,TypeParameterSymbol,SymbolDisplayFormat} from './types.js';
/**
 * Member, parameter, local and label symbols.
 *
 * Declaration modifiers are a bit set (`DeclarationModifiers`) plus an `Accessibility`; the boolean getters
 * (isStatic, isAbstract, ...) read the bit set. Members of constructed types are produced by `asMemberOf`
 * and constructed generic methods by `construct`; both keep `originalDefinition` pointing at the declaration.
 */
export const MethodKind=Object.freeze({Ordinary:'ordinary',Constructor:'constructor',StaticConstructor:'staticConstructor',Destructor:'destructor',PropertyGet:'propertyGet',PropertySet:'propertySet',EventAdd:'eventAdd',EventRemove:'eventRemove',EventRaise:'eventRaise',UserDefinedOperator:'userDefinedOperator',Conversion:'conversion',DelegateInvoke:'delegateInvoke',LocalFunction:'localFunction',AnonymousFunction:'anonymousFunction',ExplicitInterfaceImplementation:'explicitInterfaceImplementation',ReducedExtension:'reducedExtension',BuiltinOperator:'builtinOperator',FunctionPointerSignature:'functionPointerSignature'});
export const DeclarationModifiers=Object.freeze({None:0,Static:1,Abstract:2,Virtual:4,Override:8,Sealed:16,ReadOnly:32,Const:64,Volatile:128,Extern:256,Async:512,Partial:1024,New:2048,Unsafe:4096,Required:8192,Ref:16384,File:32768,Fixed:65536});
const modifierBits=Object.freeze({static:1,abstract:2,virtual:4,override:8,sealed:16,readonly:32,const:64,volatile:128,extern:256,async:512,partial:1024,new:2048,unsafe:4096,required:8192,ref:16384,file:32768,fixed:65536});
const accessWords=['public','private','protected','internal'];
/** Declaration modifier bits for a list of modifier keywords (accessibility keywords are ignored here). */
export function modifiersFromSyntax(keywords=[]){let flags=0;for(const k of keywords)flags|=modifierBits[k]??0;return flags;}
/** Declared accessibility for a list of modifier keywords; `fallback` applies when none is written. */
export function accessibilityFromSyntax(keywords=[],fallback=Accessibility.Private){
  const has=k=>keywords.includes(k);
  if(has('protected')&&has('internal'))return Accessibility.ProtectedOrInternal;if(has('private')&&has('protected'))return Accessibility.ProtectedAndInternal;
  if(has('public'))return Accessibility.Public;if(has('protected'))return Accessibility.Protected;if(has('internal'))return Accessibility.Internal;if(has('private'))return Accessibility.Private;return fallback;
}
/** The modifier keywords a bit set stands for, in C# canonical order. */
export function modifierKeywords(flags){return Object.entries(modifierBits).filter(([,bit])=>flags&bit).map(([k])=>k);}
export const isAccessibilityKeyword=k=>accessWords.includes(k);
const twa=t=>t instanceof TypeWithAnnotations?t:t?new TypeWithAnnotations(t):null;
const refPrefix=kind=>kind&&kind!==RefKind.None?(kind===RefKind.RefReadOnlyParameter?'ref readonly':kind)+' ':'';
const containerPrefix=(symbol,format)=>{const c=symbol.containingSymbol;return c&&c.kind===SymbolKind.NamedType?c.toDisplayString(format)+'.':'';};

class MemberSymbol extends SymbolBase {
  constructor(kind,init){super(kind,init.name);this.containingSymbol=init.containingSymbol??null;this.declaredAccessibility=init.declaredAccessibility??Accessibility.Private;this.modifiers=init.modifiers??0;this.locations=init.locations??[];this.syntax=init.syntax??null;this.isImplicitlyDeclared=!!init.isImplicitlyDeclared;this._original=null;this.attributes=init.attributes??[];this.obsolete=init.obsolete??null;}
  get originalDefinition(){return this._original??this;}
  get isStatic(){return !!(this.modifiers&DeclarationModifiers.Static);}
  get isAbstract(){return !!(this.modifiers&DeclarationModifiers.Abstract);}
  get isVirtual(){return !!(this.modifiers&DeclarationModifiers.Virtual);}
  get isOverride(){return !!(this.modifiers&DeclarationModifiers.Override);}
  get isSealed(){return !!(this.modifiers&DeclarationModifiers.Sealed);}
  get isExtern(){return !!(this.modifiers&DeclarationModifiers.Extern);}
  get isNew(){return !!(this.modifiers&DeclarationModifiers.New);}
  get isRequired(){return !!(this.modifiers&DeclarationModifiers.Required);}
  equals(other){return this===other||other instanceof MemberSymbol&&other.kind===this.kind&&other.originalDefinition===this.originalDefinition&&(this.containingType&&other.containingType?this.containingType.equals(other.containingType):this.containingType===other.containingType)&&sameTypeArguments(this,other);}
}
const sameTypeArguments=(a,b)=>{const x=a.typeArguments??[],y=b.typeArguments??[];return x.length===y.length&&x.every((t,i)=>t.equals(y[i]));};

export class ParameterSymbol extends SymbolBase {
  /** @param {object} init name, type, ordinal, refKind, isParams, isOptional, explicitDefaultValue ({value}), isThis, isDiscard, scoped. */
  constructor(init={}){super(SymbolKind.Parameter,init.name);this.typeWithAnnotations=twa(init.type);this.ordinal=init.ordinal??0;this.refKind=init.refKind??RefKind.None;this.isParams=!!init.isParams;this.isThis=!!init.isThis;this.isDiscard=!!init.isDiscard;this.scoped=init.scoped??null;
    this.hasExplicitDefaultValue=init.explicitDefaultValue!==undefined;this.explicitDefaultValue=init.explicitDefaultValue?.value;this.isOptional=init.isOptional??this.hasExplicitDefaultValue;this.containingSymbol=init.containingSymbol??null;this.locations=init.locations??[];this.syntax=init.syntax??null;this.attributes=init.attributes??[];this._original=null;}
  get type(){return this.typeWithAnnotations?.type??null;}
  get originalDefinition(){return this._original??this;}
  substitute(map,container){const type=this.typeWithAnnotations.substitute(map),copy=new ParameterSymbol({name:this.name,type,ordinal:this.ordinal,refKind:this.refKind,isParams:this.isParams,isThis:this.isThis,isDiscard:this.isDiscard,scoped:this.scoped,isOptional:this.isOptional,...(this.hasExplicitDefaultValue?{explicitDefaultValue:{value:this.explicitDefaultValue}}:{}),containingSymbol:container,locations:this.locations,syntax:this.syntax,attributes:this.attributes});copy._original=this.originalDefinition;return copy;}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){return (this.isParams?'params ':'')+refPrefix(this.refKind)+this.typeWithAnnotations.toDisplayString(format)+(this.name?' '+this.name:'');}
}
export class MethodSymbol extends MemberSymbol {
  /**
   * @param {object} init name, methodKind, returnType, refKind (of the return), parameters, typeParameters, containingSymbol,
   *   declaredAccessibility, modifiers, isExtensionMethod, isVararg, associatedSymbol (property or event of an accessor),
   *   explicitInterfaceImplementations, overriddenMethod, isInitOnly.
   */
  constructor(init={}){
    super(SymbolKind.Method,init);this.methodKind=init.methodKind??MethodKind.Ordinary;this.returnTypeWithAnnotations=twa(init.returnType);this.refKind=init.refKind??RefKind.None;
    this.parameters=Object.freeze((init.parameters??[]).map((p,i)=>{p.ordinal=i;p.containingSymbol=this;return p;}));
    this.typeParameters=Object.freeze((init.typeParameters??[]).map((p,i)=>{p.ordinal=i;p.containingSymbol=this;return p;}));this._typeArguments=init.typeArguments??null;
    this.isExtensionMethod=!!init.isExtensionMethod;this.isVararg=!!init.isVararg;this.associatedSymbol=init.associatedSymbol??null;this.explicitInterfaceImplementations=init.explicitInterfaceImplementations??[];this.overriddenMethod=init.overriddenMethod??null;this.isInitOnly=!!init.isInitOnly;this._constructedFrom=null;
  }
  get returnType(){return this.returnTypeWithAnnotations?.type??null;}
  get returnsVoid(){return this.returnType?.specialType==='System_Void';}
  get arity(){return this.typeParameters.length;}
  get isGenericMethod(){return this.arity>0;}
  get typeArguments(){return this._typeArguments??this.typeParameters.map(p=>new TypeWithAnnotations(p));}
  get constructedFrom(){return this._constructedFrom??this;}
  get isAsync(){return !!(this.modifiers&DeclarationModifiers.Async);}
  get isPartialDefinition(){return !!(this.modifiers&DeclarationModifiers.Partial);}
  get isReadOnly(){return !!(this.modifiers&DeclarationModifiers.ReadOnly);}
  get isConstructor(){return this.methodKind===MethodKind.Constructor||this.methodKind===MethodKind.StaticConstructor;}
  get isAccessor(){return [MethodKind.PropertyGet,MethodKind.PropertySet,MethodKind.EventAdd,MethodKind.EventRemove,MethodKind.EventRaise].includes(this.methodKind);}
  get parameterTypes(){return this.parameters.map(p=>p.typeWithAnnotations);}
  get metadataName(){return this.methodKind===MethodKind.Constructor?'.ctor':this.methodKind===MethodKind.StaticConstructor?'.cctor':this.name;}
  /** Name, arity and parameter types with ref kinds: two members with equal keys collide (CS0111). Type parameters compare by position. */
  get signatureKey(){const positional=new Map(this.originalDefinition.typeParameters.map((p,i)=>[p,'!!'+i]));const text=t=>positional.get(t.type)??t.type.toDisplayString(SymbolDisplayFormat.Test).replace(/\bdynamic\b/g,'System.Object').replace(/\b([A-Za-z_]\w*)\b/g,m=>{for(const [p,v] of positional)if(p.name===m)return v;return m;});
    return this.name+'`'+this.arity+'('+this.parameters.map(p=>(p.refKind===RefKind.None?'':'ref ')+text(p.typeWithAnnotations)).join(',')+')';}
  /** The same method viewed as a member of a constructed containing type. */
  asMemberOf(type){return substituteMethod(this,type.typeMap,type,null);}
  /** Constructs a generic method with type arguments. */
  construct(...typeArguments){if(typeArguments.length===1&&Array.isArray(typeArguments[0]))typeArguments=typeArguments[0];const definition=this.constructedFrom;if(typeArguments.length!==definition.arity)throw new RangeError(`'${this.name}' takes ${definition.arity} type arguments, not ${typeArguments.length}`);
    if(!definition.arity)return this;const args=typeArguments.map(twa),result=substituteMethod(definition,new TypeMap(definition.typeParameters,args),definition.containingSymbol,args);result._constructedFrom=definition;return result;}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){
    if(this.methodKind===MethodKind.AnonymousFunction)return 'lambda expression';
    const generic=this.arity?'<'+this.typeArguments.map(a=>a.toDisplayString(format)).join(', ')+'>':'',parameters='('+this.parameters.map(p=>format===SymbolDisplayFormat.Test?p.toDisplayString(format):(p.isParams?'params ':'')+refPrefix(p.refKind)+p.typeWithAnnotations.toDisplayString(format)).join(', ')+(this.isVararg?(this.parameters.length?', ':'')+'__arglist':'')+')';
    let name=this.name;const owner=this.containingType;
    if(this.isConstructor)name=format===SymbolDisplayFormat.Test?this.metadataName:owner?.name??this.name;else if(this.methodKind===MethodKind.Destructor)name='~'+(owner?.name??'');
    else if(this.isAccessor&&this.associatedSymbol){const suffix={propertyGet:'get',propertySet:this.isInitOnly?'init':'set',eventAdd:'add',eventRemove:'remove',eventRaise:'raise'}[this.methodKind];const text=this.associatedSymbol.qualifiedNameText(format)+'.'+suffix;return format===SymbolDisplayFormat.Test?this.returnTypeWithAnnotations.toDisplayString(format)+' '+text:text;}
    else if(this.methodKind===MethodKind.UserDefinedOperator||this.methodKind===MethodKind.Conversion)name=operatorDisplayName(this.name,this.returnTypeWithAnnotations,format);
    const prefix=this.methodKind===MethodKind.LocalFunction?'':containerPrefix(this,format),text=prefix+name+generic+parameters;
    return format===SymbolDisplayFormat.Test&&!this.isConstructor?refPrefix(this.refKind)+this.returnTypeWithAnnotations.toDisplayString(format)+' '+text:text;
  }
}
const operatorTokens=Object.freeze({op_Addition:'+',op_Subtraction:'-',op_Multiply:'*',op_Division:'/',op_Modulus:'%',op_Equality:'==',op_Inequality:'!=',op_LessThan:'<',op_GreaterThan:'>',op_LessThanOrEqual:'<=',op_GreaterThanOrEqual:'>=',op_BitwiseAnd:'&',op_BitwiseOr:'|',op_ExclusiveOr:'^',op_LeftShift:'<<',op_RightShift:'>>',op_UnsignedRightShift:'>>>',op_UnaryNegation:'-',op_UnaryPlus:'+',op_LogicalNot:'!',op_OnesComplement:'~',op_Increment:'++',op_Decrement:'--',op_True:'true',op_False:'false'});
function operatorDisplayName(name,returnType,format){if(name==='op_Implicit'||name==='op_Explicit')return (name==='op_Implicit'?'implicit':'explicit')+' operator '+returnType.toDisplayString(format);return 'operator '+(operatorTokens[name.replace(/^op_Checked/,'op_')]??name);}
function substituteMethod(method,map,container,typeArguments){
  const result=new MethodSymbol({name:method.name,methodKind:method.methodKind,returnType:method.returnTypeWithAnnotations.substitute(map),refKind:method.refKind,parameters:method.parameters.map(p=>p.substitute(map,null)),containingSymbol:container,declaredAccessibility:method.declaredAccessibility,modifiers:method.modifiers,isExtensionMethod:method.isExtensionMethod,isVararg:method.isVararg,associatedSymbol:method.associatedSymbol,explicitInterfaceImplementations:method.explicitInterfaceImplementations,overriddenMethod:method.overriddenMethod,isInitOnly:method.isInitOnly,locations:method.locations,syntax:method.syntax,isImplicitlyDeclared:method.isImplicitlyDeclared,typeArguments});
  // Type parameters stay those of the definition so that further construction maps the same symbols.
  result.typeParameters=method.typeParameters;result._original=method.originalDefinition;result._constructedFrom=typeArguments?method:null;if(!typeArguments&&method.arity)result._substitutedGeneric=true;return result;
}
export class FieldSymbol extends MemberSymbol {
  /** @param {object} init name, type, constantValue ({value}), associatedSymbol (auto-property or event), isFixedSizeBuffer, refKind. */
  constructor(init={}){super(SymbolKind.Field,init);this.typeWithAnnotations=twa(init.type);this.hasConstantValue=init.constantValue!==undefined;this.constantValue=init.constantValue?.value;this.associatedSymbol=init.associatedSymbol??null;this.isFixedSizeBuffer=!!init.isFixedSizeBuffer;this.refKind=init.refKind??RefKind.None;}
  get type(){return this.typeWithAnnotations?.type??null;}
  get isConst(){return !!(this.modifiers&DeclarationModifiers.Const);}
  get isStatic(){return !!(this.modifiers&(DeclarationModifiers.Static|DeclarationModifiers.Const));}
  get isReadOnly(){return !!(this.modifiers&DeclarationModifiers.ReadOnly);}
  get isVolatile(){return !!(this.modifiers&DeclarationModifiers.Volatile);}
  asMemberOf(type){const copy=new FieldSymbol({name:this.name,type:this.typeWithAnnotations.substitute(type.typeMap),containingSymbol:type,declaredAccessibility:this.declaredAccessibility,modifiers:this.modifiers,...(this.hasConstantValue?{constantValue:{value:this.constantValue}}:{}),associatedSymbol:this.associatedSymbol,locations:this.locations,syntax:this.syntax,refKind:this.refKind});copy._original=this.originalDefinition;return copy;}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){const text=containerPrefix(this,format)+this.name;return format===SymbolDisplayFormat.Test?this.typeWithAnnotations.toDisplayString(format)+' '+text:text;}
}
export class PropertySymbol extends MemberSymbol {
  /** @param {object} init name, type, parameters (indexers), getMethod, setMethod, refKind, explicitInterfaceImplementations. */
  constructor(init={}){super(SymbolKind.Property,init);this.typeWithAnnotations=twa(init.type);this.refKind=init.refKind??RefKind.None;this.parameters=Object.freeze((init.parameters??[]).map((p,i)=>{p.ordinal=i;p.containingSymbol=this;return p;}));this.getMethod=init.getMethod??null;this.setMethod=init.setMethod??null;this.explicitInterfaceImplementations=init.explicitInterfaceImplementations??[];this.backingField=init.backingField??null;
    for(const accessor of [this.getMethod,this.setMethod])if(accessor)accessor.associatedSymbol=this;}
  get type(){return this.typeWithAnnotations?.type??null;}
  get isIndexer(){return this.parameters.length>0;}
  get isReadOnly(){return !!this.getMethod&&!this.setMethod;}
  get isWriteOnly(){return !this.getMethod&&!!this.setMethod;}
  get isInitOnly(){return !!this.setMethod?.isInitOnly;}
  get metadataName(){return this.name;}
  asMemberOf(type){const map=type.typeMap,copy=new PropertySymbol({name:this.name,type:this.typeWithAnnotations.substitute(map),refKind:this.refKind,parameters:this.parameters.map(p=>p.substitute(map,null)),getMethod:this.getMethod?.asMemberOf(type)??null,setMethod:this.setMethod?.asMemberOf(type)??null,containingSymbol:type,declaredAccessibility:this.declaredAccessibility,modifiers:this.modifiers,locations:this.locations,syntax:this.syntax});copy._original=this.originalDefinition;return copy;}
  /** Containing type plus name (or this[...]) without the property type. */
  qualifiedNameText(format=SymbolDisplayFormat.ErrorMessage){const name=this.isIndexer?'this['+this.parameters.map(p=>format===SymbolDisplayFormat.Test?p.toDisplayString(format):refPrefix(p.refKind)+p.typeWithAnnotations.toDisplayString(format)).join(', ')+']':this.name;return containerPrefix(this,format)+name;}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){const text=this.qualifiedNameText(format);
    return format===SymbolDisplayFormat.Test?this.typeWithAnnotations.toDisplayString(format)+' '+text+' { '+(this.getMethod?'get; ':'')+(this.setMethod?(this.isInitOnly?'init; ':'set; '):'')+'}':text;}
}
export class EventSymbol extends MemberSymbol {
  /** @param {object} init name, type (the delegate type), addMethod, removeMethod, raiseMethod, isFieldLike. */
  constructor(init={}){super(SymbolKind.Event,init);this.typeWithAnnotations=twa(init.type);this.addMethod=init.addMethod??null;this.removeMethod=init.removeMethod??null;this.raiseMethod=init.raiseMethod??null;this.isFieldLike=!!init.isFieldLike;this.associatedField=init.associatedField??null;
    for(const accessor of [this.addMethod,this.removeMethod,this.raiseMethod])if(accessor)accessor.associatedSymbol=this;}
  get type(){return this.typeWithAnnotations?.type??null;}
  asMemberOf(type){const copy=new EventSymbol({name:this.name,type:this.typeWithAnnotations.substitute(type.typeMap),addMethod:this.addMethod?.asMemberOf(type)??null,removeMethod:this.removeMethod?.asMemberOf(type)??null,isFieldLike:this.isFieldLike,containingSymbol:type,declaredAccessibility:this.declaredAccessibility,modifiers:this.modifiers,locations:this.locations,syntax:this.syntax});copy._original=this.originalDefinition;return copy;}
  qualifiedNameText(format=SymbolDisplayFormat.ErrorMessage){return containerPrefix(this,format)+this.name;}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){const text=this.qualifiedNameText(format);return format===SymbolDisplayFormat.Test?'event '+this.typeWithAnnotations.toDisplayString(format)+' '+text:text;}
}
export const LocalDeclarationKind=Object.freeze({Regular:'regular',Constant:'constant',Using:'using',Foreach:'foreach',Catch:'catch',Fixed:'fixed',Pattern:'pattern',Out:'out',For:'for',Synthesized:'synthesized'});
export class LocalSymbol extends SymbolBase {
  /** @param {object} init name, type, declarationKind, constantValue ({value}), refKind, containingSymbol (the method), synthesizedKind, syntax. */
  constructor(init={}){super(SymbolKind.Local,init.name);this.typeWithAnnotations=twa(init.type);this.declarationKind=init.declarationKind??LocalDeclarationKind.Regular;this.hasConstantValue=init.constantValue!==undefined;this.constantValue=init.constantValue?.value;this.refKind=init.refKind??RefKind.None;this.containingSymbol=init.containingSymbol??null;this.synthesizedKind=init.synthesizedKind??null;this.syntax=init.syntax??null;this.locations=init.locations??[];this.isImplicitlyDeclared=!!this.synthesizedKind;}
  get type(){return this.typeWithAnnotations?.type??null;}
  /** Locals are typed once: `var` locals get their type when the initializer is bound. */
  setType(type){this.typeWithAnnotations=twa(type);return this;}
  get isConst(){return this.declarationKind===LocalDeclarationKind.Constant;}
  get isUsing(){return this.declarationKind===LocalDeclarationKind.Using;}
  get isForEach(){return this.declarationKind===LocalDeclarationKind.Foreach;}
  get isRef(){return this.refKind!==RefKind.None;}
  get isCompilerGenerated(){return !!this.synthesizedKind;}
  /** A local that the user may not assign after its declaration, with the Roslyn CS1656 description. */
  get readOnlyReason(){return this.isUsing?'using variable':this.isForEach?'foreach iteration variable':this.declarationKind===LocalDeclarationKind.Fixed?'fixed variable':null;}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){return format===SymbolDisplayFormat.Test?(this.typeWithAnnotations?.toDisplayString(format)??'var')+' '+this.name:this.name;}
}
export class LabelSymbol extends SymbolBase {
  constructor(init={}){super(SymbolKind.Label,init.name);this.containingSymbol=init.containingSymbol??null;this.syntax=init.syntax??null;this.locations=init.locations??[];}
}
/** Convenience: a type parameter list for a generic method or type declaration. */
export function createTypeParameters(names,owner=null){return names.map((name,ordinal)=>new TypeParameterSymbol({name,ordinal,containingSymbol:owner}));}
