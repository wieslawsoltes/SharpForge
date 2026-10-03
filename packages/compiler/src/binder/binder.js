import {SymbolKind} from '../symbols/types.js';
/**
 * The binder chain. A binder answers "what does this name mean here?" for one lexical scope and defers to `next`
 * for enclosing scopes. From innermost to outermost a method body sees:
 *
 *   LocalScopeBinder* -> InMethodBinder -> InContainerBinder(type)* -> InContainerBinder(namespace)/WithUsingsBinder* -> BuckStopsHereBinder
 *
 * which yields the C# shadowing order: locals, parameters, type members, enclosing types, namespaces, usings.
 * Context flags (checked/unchecked, unsafe, nullable context) propagate down the chain unless a binder overrides them.
 */
export const BinderFlags=Object.freeze({None:0,CheckedContext:1,UncheckedContext:2,UnsafeRegion:4,NullableAnnotations:8,NullableWarnings:16,InCatchBlock:32,InFinallyBlock:64,InLoop:128,InSwitch:256,InNameof:512,InAsyncMethod:1024});
const overflowMask=BinderFlags.CheckedContext|BinderFlags.UncheckedContext,nullableMask=BinderFlags.NullableAnnotations|BinderFlags.NullableWarnings;
export const LookupResultKind=Object.freeze({Empty:'empty',Viable:'viable',Ambiguous:'ambiguous',WrongArity:'wrongArity',NotATypeOrNamespace:'notATypeOrNamespace',Inaccessible:'inaccessible'});
/** What a lookup may return. `namespacesAndTypesOnly` is the type-name context; `mustBeInvocable` keeps methods and delegates. */
export const LookupOptions=Object.freeze({Default:0,NamespacesAndTypesOnly:1,MustBeInvocable:2,MustNotBeNamespace:4,LabelsOnly:8,IgnoreUsings:16,AllArities:32});
export class LookupResult {
  constructor(){this.kind=LookupResultKind.Empty;this.symbols=[];this.binder=null;this.nonViable=[];}
  get isViable(){return this.kind===LookupResultKind.Viable;}
  get isAmbiguous(){return this.kind===LookupResultKind.Ambiguous;}
  get isEmpty(){return this.kind===LookupResultKind.Empty;}
  /** The single symbol of a viable result, else null. */
  get symbol(){return this.isViable&&this.symbols.length===1?this.symbols[0]:null;}
  /** Records the symbols one binder found. Several methods form one viable group; several of anything else are ambiguous. */
  setFrom(symbols,binder){
    if(!symbols.length)return this;this.binder=binder;this.symbols=symbols;
    const methods=symbols.every(s=>s.kind===SymbolKind.Method);this.kind=symbols.length===1||methods?LookupResultKind.Viable:LookupResultKind.Ambiguous;return this;
  }
  /** Remembers a near miss (wrong arity, not a type) to explain an otherwise empty result. */
  note(kind,symbols){if(this.isEmpty&&!this.nonViable.length)this.nonViable=[kind,symbols];return this;}
}
const typesOnly=options=>!!(options&LookupOptions.NamespacesAndTypesOnly);
const acceptable=(symbol,options)=>{
  if(options&LookupOptions.LabelsOnly)return symbol.kind===SymbolKind.Label;if(symbol.kind===SymbolKind.Label)return false;
  if(typesOnly(options))return [SymbolKind.NamedType,SymbolKind.Namespace,SymbolKind.TypeParameter,SymbolKind.Alias,SymbolKind.ErrorType].includes(symbol.kind);
  if(options&LookupOptions.MustNotBeNamespace&&symbol.kind===SymbolKind.Namespace)return false;
  if(options&LookupOptions.MustBeInvocable)return symbol.kind===SymbolKind.Method||symbol.kind===SymbolKind.Event||symbol.type?.typeKind==='delegate'||symbol.kind===SymbolKind.Local||symbol.kind===SymbolKind.Parameter||symbol.kind===SymbolKind.Field||symbol.kind===SymbolKind.Property;
  return true;
};
const arityMatches=(symbol,arity,options)=>options&LookupOptions.AllArities||![SymbolKind.NamedType,SymbolKind.Method].includes(symbol.kind)||symbol.kind===SymbolKind.Method&&arity===0||symbol.arity===arity;
/** Filters candidates by lookup options and arity, noting wrong-arity near misses on the result. */
export function viableSymbols(candidates,arity,options,result){
  const kindOk=candidates.filter(s=>acceptable(s,options));if(candidates.length&&!kindOk.length)result.note(LookupResultKind.NotATypeOrNamespace,candidates);
  const ok=kindOk.filter(s=>arityMatches(s,arity,options));if(kindOk.length&&!ok.length)result.note(LookupResultKind.WrongArity,kindOk);return ok;
}
export class Binder {
  constructor(next=null,flags=undefined){this.next=next;this.flags=flags===undefined?next?.flags??BinderFlags.None:flags;}
  get compilation(){return this.next?.compilation??null;}
  /** The method, property or type whose code is being bound. */
  get containingMember(){return this.next?.containingMember??null;}
  get containingType(){return this.next?.containingType??null;}
  get containingNamespace(){return this.next?.containingNamespace??null;}
  has(flag){return (this.flags&flag)===flag;}
  /** null when neither a checked nor an unchecked context is active (the compilation default applies). */
  get checkedContext(){return this.has(BinderFlags.CheckedContext)?true:this.has(BinderFlags.UncheckedContext)?false:null;}
  get isUnsafe(){return this.has(BinderFlags.UnsafeRegion);}
  get nullableContext(){return {annotations:this.has(BinderFlags.NullableAnnotations),warnings:this.has(BinderFlags.NullableWarnings)};}
  /** A binder for the same scope with flags added and removed. Checked and unchecked replace each other, as do nullable settings. */
  withFlags(add,remove=0){let flags=this.flags&~remove;if(add&overflowMask)flags&=~overflowMask;return new Binder(this,flags|add);}
  withCheckedContext(checked){return this.withFlags(checked?BinderFlags.CheckedContext:BinderFlags.UncheckedContext);}
  withNullableContext(annotations,warnings){return new Binder(this,this.flags&~nullableMask|(annotations?BinderFlags.NullableAnnotations:0)|(warnings?BinderFlags.NullableWarnings:0));}
  /** Adds what this binder alone knows about `name` to `result`. Overridden by scope binders. */
  lookupInSingleBinder(result,name,arity,options,originalBinder){}
  /** Looks `name` up through the chain, innermost scope first, stopping at the first scope that yields anything. */
  lookup(name,arity=0,options=LookupOptions.Default){
    const result=new LookupResult();for(let b=this;b;b=b.next){b.lookupInSingleBinder(result,name,arity,options,this);if(!result.isEmpty)break;}return result;
  }
  /** The nearest binder of a class, or null. */
  enclosing(binderClass){for(let b=this;b;b=b.next)if(b instanceof binderClass)return b;return null;}
  /** Every binder from this one outward. */
  *chain(){for(let b=this;b;b=b.next)yield b;}
  /** All names visible here with their symbols, innermost first (IDE completion). Shadowed names keep the inner symbol. */
  lookupSymbols(options=LookupOptions.Default){const seen=new Set(),out=[];for(const b of this.chain()){const added=new Set();for(const s of b.declaredSymbols(options)){if(!acceptable(s,options)||seen.has(s.name))continue;added.add(s.name);out.push(s);}for(const name of added)seen.add(name);}return out;}
  declaredSymbols(options){return [];}
}
/** The end of every chain: knows the compilation and the compilation-wide context flags, and finds nothing. */
export class BuckStopsHereBinder extends Binder {
  constructor(compilation=null,flags=BinderFlags.None){super(null,flags);this._compilation=compilation;}
  get compilation(){return this._compilation;}
}
/** Names declared by a namespace (types, namespaces) or by a type (members, nested types, type parameters, inherited members). */
export class InContainerBinder extends Binder {
  constructor(container,next){super(next);this.container=container;}
  get isType(){return this.container.kind===SymbolKind.NamedType;}
  get containingType(){return this.isType?this.container:this.next?.containingType??null;}
  get containingMember(){return this.isType?this.container:this.next?.containingMember??null;}
  get containingNamespace(){return this.isType?this.container.containingNamespace:this.container;}
  membersNamed(name){
    if(!this.isType)return this.container.getMembers(name);
    const found=[],parameters=this.container.typeParameters.filter(p=>p.name===name);if(parameters.length)return parameters;
    // Members of the type hide same-named members of its base types, except that methods accumulate into one group.
    for(let t=this.container;t;t=t.baseType){const own=t.getMembers(name);if(!own.length)continue;if(found.length&&!(found.every(s=>s.kind===SymbolKind.Method)&&own.every(s=>s.kind===SymbolKind.Method)))break;found.push(...own);if(!own.every(s=>s.kind===SymbolKind.Method))break;}
    return found;
  }
  lookupInSingleBinder(result,name,arity,options){result.setFrom(viableSymbols(this.membersNamed(name),arity,options,result),this);}
  declaredSymbols(){if(!this.isType)return this.container.getMembers();const all=[...this.container.typeParameters];for(let t=this.container;t;t=t.baseType)all.push(...t.getMembers());return all;}
}
/** Names brought in by using directives: aliases first, then types of used namespaces and static members of `using static` types. */
export class WithUsingsBinder extends Binder {
  /** @param {object} usings `{aliases:Map<string,AliasSymbol>, namespaces:NamespaceSymbol[], staticTypes:NamedTypeSymbol[]}` (see usings.js). */
  constructor(usings,next){super(next);this.usings=usings;}
  lookupInSingleBinder(result,name,arity,options){
    if(options&LookupOptions.IgnoreUsings)return;const alias=arity===0?this.usings.aliases.get(name):null;if(alias){result.setFrom([alias],this);return;}
    const found=[];for(const n of this.usings.namespaces)for(const t of n.getTypeMembers(name))if(!found.includes(t))found.push(t);
    for(const t of this.usings.staticTypes)for(const m of t.getMembers(name))if((m.kind===SymbolKind.NamedType||m.isStatic)&&!found.includes(m))found.push(m);
    result.setFrom(viableSymbols(found,arity,options,result),this);
  }
  declaredSymbols(){return [...this.usings.aliases.values(),...this.usings.namespaces.flatMap(n=>n.getTypeMembers()),...this.usings.staticTypes.flatMap(t=>t.getMembers().filter(m=>m.kind===SymbolKind.NamedType||m.isStatic))];}
}
/** Parameters and type parameters of the method being bound. */
export class InMethodBinder extends Binder {
  constructor(method,next,flags=undefined){super(next,flags);this.method=method;}
  get containingMember(){return this.method;}
  lookupInSingleBinder(result,name,arity,options){
    if(arity===0&&!typesOnly(options)){const parameter=this.method.parameters.find(p=>p.name===name);if(parameter){result.setFrom([parameter],this);return;}}
    const typeParameter=this.method.typeParameters.find(p=>p.name===name);if(typeParameter&&arity===0)result.setFrom([typeParameter],this);
  }
  declaredSymbols(){return [...this.method.parameters,...this.method.typeParameters];}
}
/** One block scope of locals and labels. */
export class LocalScopeBinder extends Binder {
  constructor(next,syntax=null){super(next);this.locals=new Map();this.labels=new Map();this.syntax=syntax;}
  /** Declares a local in this scope. The caller checks for conflicts with `findLocalInEnclosingScopes` first. */
  declare(local){this.locals.set(local.name,local);return local;}
  declareLabel(label){this.labels.set(label.name,label);return label;}
  /** The local or parameter with this name in this scope or an enclosing local/method scope: C# forbids redeclaring it (CS0136). */
  findLocalInEnclosingScopes(name){for(let b=this;b;b=b.next){if(b instanceof LocalScopeBinder){const l=b.locals.get(name);if(l)return l;}else if(b instanceof InMethodBinder)return b.method.parameters.find(p=>p.name===name)??null;}return null;}
  lookupInSingleBinder(result,name,arity,options){
    if(options&LookupOptions.LabelsOnly){const label=this.labels.get(name);if(label)result.setFrom([label],this);return;}
    if(arity!==0||typesOnly(options))return;const local=this.locals.get(name);if(local)result.setFrom([local],this);
  }
  declaredSymbols(options){return options&LookupOptions.LabelsOnly?[...this.labels.values()]:[...this.locals.values()];}
}
