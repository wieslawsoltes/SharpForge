import {DiagnosticId} from '../diagnostics/codes.js';
import {SymbolKind,TypeKind,Accessibility} from '../symbols/types.js';
/**
 * Accessibility checking (C# spec "Accessibility domains", following Roslyn's AccessCheck).
 *
 * Pure symbol logic: nothing here reports or formats. `isAccessible` answers whether `symbol` may be used from
 * `within`; `checkAccess` returns the diagnostic to report instead: CS0122 for an inaccessible symbol and CS1540
 * when a protected instance member is reachable from the accessing type but not through the given qualifier type.
 *
 * `within` is the NamedTypeSymbol the access is written in (any other symbol stands for its containing type; null is
 * namespace scope). Assemblies are identified by the `module` object of a symbol's outermost namespace
 * (`NamespaceSymbol.module`); symbols without one belong to the current compilation, as does a null `within` unless
 * `options.withinModule` says otherwise.
 *
 * Options:
 *   throughType          type of the qualifier of an instance member access (`q.M` -> type of q; `this.M` -> the accessing type).
 *   withinModule         module of the accessing code when it differs from the module of `within`.
 *   internalsVisibleTo   who sees whose internals: a function (declaringModule,withinModule)->boolean, or a collection of
 *                        declaring modules (or their names) that grant access to the accessing assembly. A declaring module
 *                        may also carry `internalsVisibleTo`: an array of accessing modules or assembly names.
 *   assemblyName         name of the accessing assembly when its module is null or has no `name`.
 */
const withinTypeOf=within=>!within?null:within.kind===SymbolKind.NamedType?within:within.containingType??null;
/** The module (assembly identity) a symbol was declared in, or null for the current compilation. */
export function moduleOf(symbol){
  let s=symbol?.originalDefinition??symbol;if(!s)return null;
  for(let guard=0;s.containingSymbol&&guard<256;guard++)s=s.containingSymbol.originalDefinition??s.containingSymbol;
  return s.module??null;
}
/** True when code in `withinModule` may use internal symbols of `declaringModule` (same assembly, or InternalsVisibleTo). */
export function hasInternalAccessTo(withinModule,declaringModule,options={}){
  if(withinModule===declaringModule)return true;
  const grants=options.internalsVisibleTo,withinName=withinModule?.name??options.assemblyName??null;
  if(typeof grants==='function'){if(grants(declaringModule,withinModule))return true;}
  else if(grants){for(const g of grants)if(g===declaringModule||typeof g==='string'&&declaringModule?.name===g)return true;}
  const declared=declaringModule?.internalsVisibleTo;
  if(declared)for(const friend of declared)if(withinModule&&friend===withinModule||typeof friend==='string'&&friend===withinName)return true;
  return false;
}
/** `type` is `base` or derives from / implements it, comparing original definitions (constructions are ignored). */
function inheritsFromOrImplements(type,base,depth=0){
  if(!type||depth>64)return false;
  if(type.kind===SymbolKind.TypeParameter)return type.constraintTypes.some(c=>inheritsFromOrImplements(c.type??c,base,depth+1));
  const isInterface=base.typeKind===TypeKind.Interface;let guard=0;
  for(let t=type;t&&guard++<256;t=t.baseType){
    if(t.originalDefinition===base)return true;
    if(isInterface&&t.allInterfaces.some(i=>i.originalDefinition===base))return true;
  }
  return false;
}
const isNestedWithin=(withinType,container)=>{for(let t=withinType?.originalDefinition;t;t=t.containingType?.originalDefinition)if(t===container)return true;return false;};
function check(symbol,within,options){
  const state={withinType:withinTypeOf(within),options,failedThroughTypeCheck:false};
  state.withinModule=options.withinModule!==undefined?options.withinModule:state.withinType?moduleOf(state.withinType):within?moduleOf(within):null;
  const ok=symbolAccessible(symbol,state,options.throughType?.type??options.throughType??null);
  return {ok,failedThroughTypeCheck:!ok&&state.failedThroughTypeCheck};
}
function symbolAccessible(symbol,state,throughType){
  switch(symbol?.kind){
    case SymbolKind.ArrayType:return symbolAccessible(symbol.elementType,state,null);
    case SymbolKind.PointerType:return symbolAccessible(symbol.pointedAtType,state,null);
    case SymbolKind.FunctionPointerType:return symbolAccessible(symbol.signature.returnType.type,state,null)&&symbol.signature.parameters.every(p=>symbolAccessible(p.type.type,state,null));
    case SymbolKind.NamedType:return namedTypeAccessible(symbol,state);
    case SymbolKind.Method:case SymbolKind.Property:case SymbolKind.Event:case SymbolKind.Field:{
      const container=symbol.containingType;
      // Local functions, lambdas and members of the implicit top-level container have no accessibility domain of their own.
      if(!container||symbol.containingSymbol?.kind!==SymbolKind.NamedType)return true;
      // Static members are not accessed through an instance.
      return memberAccessible(container,symbol.declaredAccessibility,state,symbol.isStatic?null:throughType);
    }
    default:return true; // error types, type parameters, dynamic, namespaces, parameters, locals, labels, aliases
  }
}
function namedTypeAccessible(type,state){
  if(!type.isDefinition)for(const argument of type.typeArguments){const t=argument.type??argument;if(t.kind!==SymbolKind.TypeParameter&&!symbolAccessible(t,state,null))return false;}
  const container=type.containingType;
  if(container)return memberAccessible(container,type.declaredAccessibility,state,null);
  switch(type.declaredAccessibility){
    case Accessibility.Public:case Accessibility.NotApplicable:return true;
    case Accessibility.Internal:case Accessibility.ProtectedOrInternal:return hasInternalAccessTo(state.withinModule,moduleOf(type),state.options);
    default:return false; // private and protected make no sense on a non-nested type
  }
}
function memberAccessible(containingType,declared,state,throughType){
  const withinType=state.withinType;
  if(withinType&&(containingType===withinType||containingType.equals(withinType)))return true;
  // A member is never more accessible than its containing type.
  if(!namedTypeAccessible(containingType,state))return false;
  if(declared===Accessibility.Public)return true;
  const original=containingType.originalDefinition,internal=()=>hasInternalAccessTo(state.withinModule,moduleOf(containingType),state.options);
  switch(declared){
    case Accessibility.NotApplicable:return true;
    case Accessibility.Private:return !!withinType&&isNestedWithin(withinType,original);
    case Accessibility.Internal:return internal();
    case Accessibility.ProtectedAndInternal:return internal()&&protectedAccessible(original,state,throughType);
    case Accessibility.ProtectedOrInternal:return internal()||protectedAccessible(original,state,throughType);
    case Accessibility.Protected:return protectedAccessible(original,state,throughType);
    default:return false;
  }
}
function protectedAccessible(originalContainingType,state,throughType){
  const withinType=state.withinType;if(!withinType)return false;
  // Inside the declaring type (or a type nested in it) protected is as good as private access.
  if(isNestedWithin(withinType,originalContainingType))return true;
  const through=throughType?throughType.originalDefinition??throughType:null;
  // The accessing type or one of its enclosing types must derive from the declaring type, and an instance member must be
  // reached through a qualifier of that deriving type (or a type derived from it).
  for(let current=withinType.originalDefinition;current;current=current.containingType?.originalDefinition){
    if(!inheritsFromOrImplements(current,originalContainingType))continue;
    if(!through||inheritsFromOrImplements(through,current))return true;
    state.failedThroughTypeCheck=true;
  }
  return false;
}
/** True when `symbol` may be used from `within`; see the module header for the options. */
export function isAccessible(symbol,within=null,options={}){return check(symbol,within,options).ok;}
/**
 * The diagnostic an access to `symbol` from `within` deserves: null when accessible, otherwise
 * `{code:'CS0122',args:[symbol]}` or `{code:'CS1540',args:[member,qualifierType,accessingType]}` (display strings).
 * Constructors never yield CS1540: Roslyn reports CS0122 for a protected constructor called on the wrong type.
 */
export function checkAccess(symbol,within=null,options={}){
  const result=check(symbol,within,options);if(result.ok)return null;
  const through=options.throughType?.type??options.throughType??null,withinType=withinTypeOf(within);
  if(result.failedThroughTypeCheck&&through&&withinType&&!(symbol.kind===SymbolKind.Method&&symbol.isConstructor))return {code:DiagnosticId.CS1540,args:[symbol.toDisplayString(),through.toDisplayString(),withinType.toDisplayString()]};
  return {code:DiagnosticId.CS0122,args:[symbol.toDisplayString()]};
}
/**
 * Accessibility of an instance constructor for `new T(...)` written in `within`. Roslyn checks a protected constructor
 * through the constructed type itself, so `new Base()` inside a derived class is an error; pass
 * `allowProtectedConstructorsOfBaseType` for constructor initializers (`: base(...)`), where the derived type may call it.
 */
export function checkConstructorAccess(constructor,within=null,options={}){
  return checkAccess(constructor,within,{...options,throughType:options.allowProtectedConstructorsOfBaseType||!withinTypeOf(within)?null:constructor.containingType});
}
