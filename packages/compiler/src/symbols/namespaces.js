import {SymbolBase,SymbolKind,SymbolDisplayFormat} from './types.js';
/**
 * Namespace symbols and the merged global namespace.
 *
 * Each module (the source compilation, the framework registry, every referenced assembly) owns a tree of
 * `NamespaceSymbol`s. `MergedNamespaceSymbol` presents several trees as one: namespaces with the same name
 * merge recursively and their types are the union, source declarations first. Name lookup always runs over
 * the merged global namespace, so a type is identified by its namespace path, never by a flattened name.
 */
export const NamespaceExtent=Object.freeze({Source:'source',Metadata:'metadata',Compilation:'compilation'});
export class NamespaceSymbol extends SymbolBase {
  constructor(name='',container=null,extent=NamespaceExtent.Source,module=null){super(SymbolKind.Namespace,name);this.containingSymbol=container;this.extent=extent;this.module=module??container?.module??null;this._types=[];this._typesByName=new Map();this._namespaces=new Map();this.locations=[];}
  get isGlobalNamespace(){return this.containingSymbol===null;}
  get isNamespace(){return true;}
  get containingNamespace(){return this.containingSymbol;}
  /** The namespaces this symbol was merged from; a plain namespace is its own only constituent. */
  get constituentNamespaces(){return [this];}
  /** Dotted name without `global::`; the global namespace is the empty string. */
  get qualifiedName(){const parts=[];for(let n=this;n&&!n.isGlobalNamespace;n=n.containingSymbol)parts.unshift(n.name);return parts.join('.');}
  getNamespaceMembers(){return [...this._namespaces.values()];}
  /** The types declared directly in this namespace, in declaration order; `name` is looked up in an index, not by scanning. */
  getTypeMembers(name,arity){const types=name===undefined?this._types:this._typesByName.get(name)??[];return types.filter(t=>arity===undefined||t.arity===arity);}
  /** Types and namespaces declared directly in this namespace. */
  getMembers(name){const namespaces=name===undefined?this.getNamespaceMembers():this.getNamespace(name)?[this.getNamespace(name)]:[];return [...namespaces,...this.getTypeMembers(name)];}
  /** The directly nested namespace with this simple name, or null. */
  getNamespace(name){return this._namespaces.get(name)??null;}
  /** Resolves a dotted namespace name relative to this namespace; null when any segment is missing. */
  lookupNamespace(qualifiedName){let n=this;if(qualifiedName)for(const part of String(qualifiedName).split('.')){n=n.getNamespace(part);if(!n)return null;}return n;}
  /** Resolves `A.B.Type` relative to this namespace; arity selects among generic overloads. */
  lookupType(qualifiedName,arity){const parts=String(qualifiedName).split('.'),name=parts.pop(),n=this.lookupNamespace(parts.join('.'));return n?.getTypeMembers(name,arity)[0]??null;}
  addType(type){this._types.push(type);const named=this._typesByName.get(type.name);if(named)named.push(type);else this._typesByName.set(type.name,[type]);type.containingSymbol=this;return type;}
  getOrAddNamespace(name){let n=this._namespaces.get(name);if(!n){n=new NamespaceSymbol(name,this,this.extent,this.module);this._namespaces.set(name,n);}return n;}
  /** Creates the namespaces of a dotted name as needed and returns the innermost. */
  ensureNamespace(qualifiedName){let n=this;if(qualifiedName)for(const part of String(qualifiedName).split('.'))n=n.getOrAddNamespace(part);return n;}
  /** Every type in this namespace and below. */
  *allTypes(){yield* this.getTypeMembers();for(const n of this.getNamespaceMembers())yield* n.allTypes();}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){return this.isGlobalNamespace?'<global namespace>':(format===SymbolDisplayFormat.FullyQualified?'global::':'')+(format===SymbolDisplayFormat.MinimallyQualified?this.name:this.qualifiedName);}
}
/** A read-only union of same-named namespaces from several modules. */
/** A merged metadata namespace remembers at most this many lookups by name (misses included) before it starts over. */
const MAX_REMEMBERED_LOOKUPS=8192;
export class MergedNamespaceSymbol extends NamespaceSymbol {
  constructor(constituents,container=null){
    super(constituents[0]?.name??'',container,NamespaceExtent.Compilation);this._constituents=constituents;this._merged=new Map();
    this._typesByKey=new Map();this._immutable=null;
  }
  get constituentNamespaces(){return this._constituents;}
  getNamespace(name){
    if(this._merged.has(name))return this._merged.get(name);const parts=this._constituents.map(c=>c.getNamespace(name)).filter(Boolean),result=parts.length?new MergedNamespaceSymbol(parts,this):null;this._merged.set(name,result);return result;
  }
  getNamespaceMembers(){const names=new Set(this._constituents.flatMap(c=>c.getNamespaceMembers().map(n=>n.name)));return [...names].map(n=>this.getNamespace(n));}
  /**
   * The union of the constituents' types. A merge of metadata namespaces only (the references of a compilation: one
   * namespace per assembly) never changes, so a lookup by name is remembered instead of asking every assembly again.
   */
  getTypeMembers(name,arity){
    if(name===undefined||!this.isImmutable)return this._constituents.flatMap(c=>c.getTypeMembers(name,arity));
    const key=arity===undefined?name:name+'`'+arity;let found=this._typesByKey.get(key);
    if(!found){
      if(this._typesByKey.size>=MAX_REMEMBERED_LOOKUPS)this._typesByKey.clear();
      found=this._constituents.flatMap(c=>c.getTypeMembers(name,arity));this._typesByKey.set(key,found);
    }
    return found.slice();
  }
  /** True when every constituent was read from metadata. */
  get isImmutable(){return this._immutable??=this._constituents.every(c=>c.extent===NamespaceExtent.Metadata||c.isImmutable===true);}
  addType(){throw new TypeError('Types are declared in a module namespace, not in the merged namespace');}
  getOrAddNamespace(){throw new TypeError('Namespaces are declared in a module namespace, not in the merged namespace');}
}
/** The merged global namespace of a compilation: the source module first, then referenced modules in order. */
export function mergeGlobalNamespaces(...globals){const list=globals.filter(Boolean);if(list.some(g=>!g.isGlobalNamespace))throw new TypeError('Only global namespaces can be merged');return list.length===1?list[0]:new MergedNamespaceSymbol(list,null);}
/** A `using X = ...;` alias or an extern alias. `target` is a namespace or a type symbol. */
export class AliasSymbol extends SymbolBase {
  constructor(name,target,options={}){super(SymbolKind.Alias,name);this.target=target;this.isExtern=!!options.isExtern;this.isGlobal=!!options.isGlobal;this.syntax=options.syntax??null;this.locations=options.locations??[];}
  toDisplayString(format=SymbolDisplayFormat.ErrorMessage){return this.name;}
}
