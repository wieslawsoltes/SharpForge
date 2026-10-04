import {DiagnosticId} from '../diagnostics/codes.js';
import {SymbolKind,ErrorTypeSymbol,NamedTypeSymbol,ArrayTypeSymbol,PointerTypeSymbol,FunctionPointerTypeSymbol,typeOf} from '../symbols/types.js';
import {mergeGlobalNamespaces,AliasSymbol} from '../symbols/namespaces.js';
import {AssemblyIdentity,IdentityComparison,compareAssemblyIdentity,compareVersions} from './assembly-identity.js';
import {PEAssemblySymbol,importAssembly} from './pe-symbols.js';
export {AssemblyIdentity,AssemblyIdentityParts,IdentityComparison,compareAssemblyIdentity,referenceMatchesDefinition,compareVersions,publicKeyToken} from './assembly-identity.js';
/**
 * The reference manager: turns a compilation's metadata references into bound assembly symbols.
 *
 * It follows Roslyn's CommonReferenceManager:
 *  - references with the same full identity are one assembly (their aliases merge); strongly named references that
 *    are equivalent but not identical are CS1703, weakly named ones that share a simple name are CS1704;
 *  - every AssemblyRef of every assembly is bound to the supplied definitions: an exact (or weakly named, or
 *    policy-unified) match first, otherwise the lowest higher version (CS1701 when major/minor differ, CS1702 when
 *    only build/revision differ), otherwise the highest lower version (CS1705);
 *  - a type whose assembly is not referenced is an error type carrying CS0012; type forwarders (ExportedType) are
 *    followed to the destination assembly;
 *  - references are visible through extern aliases; a reference without aliases is in the `global` alias.
 * CS1701/CS1702/CS1705 are use-site diagnostics in Roslyn; `useSiteDiagnostics(symbol)` reports them where a symbol
 * is used and `unifications` lists them all.
 */
export const GlobalAlias='global';
/**
 * Binds one assembly reference to a list of definition identities (Roslyn ResolveReferencedAssembly).
 * @param {AssemblyIdentity} reference
 * @param {AssemblyIdentity[]} definitions
 * @param {object} [options] isFrameworkAssembly(identity): versions of such definitions unify silently
 * @returns {{index:number,versionDifference:number}} index -1 when unbound; versionDifference is +1 when the bound
 *   definition has a higher version than the reference, -1 when lower, 0 for a match
 */
export function resolveAssemblyReference(reference,definitions,options={}){
  let minHigher=-1,maxLower=-1;
  for(let i=0;i<definitions.length;i++){
    const definition=definitions[i],{result}=compareAssemblyIdentity(reference,definition,{ignoreVersion:true,isFrameworkAssembly:options.isFrameworkAssembly});
    if(result===IdentityComparison.Equivalent)return {index:i,versionDifference:0};if(result===IdentityComparison.NotEquivalent)continue;
    if(compareVersions(reference.version,definition.version)<0){if(minHigher<0||compareVersions(definition.version,definitions[minHigher].version)<0)minHigher=i;}
    else if(maxLower<0||compareVersions(definition.version,definitions[maxLower].version)>0)maxLower=i;
  }
  return minHigher>=0?{index:minHigher,versionDifference:1}:maxLower>=0?{index:maxLower,versionDifference:-1}:{index:-1,versionDifference:0};
}
/** The CS1701 / CS1702 / CS1705 diagnostic for a unified reference of `owner` that was bound to `definition`. */
export function unificationDiagnostic(owner,referenceIdentity,definition){
  const d=definition.identity;
  if(compareVersions(d.version,referenceIdentity.version)>0)return {code:d.version[0]===referenceIdentity.version[0]&&d.version[1]===referenceIdentity.version[1]?DiagnosticId.CS1702:DiagnosticId.CS1701,args:[referenceIdentity.getDisplayName(),owner.name,d.getDisplayName(),definition.name]};
  return {code:DiagnosticId.CS1705,args:[owner.name,owner.identity.getDisplayName(),referenceIdentity.getDisplayName(),definition.name,d.getDisplayName()]};
}
/** The use-site diagnostics of a unified assembly reference. */
export const unificationCodes=new Set([DiagnosticId.CS1701,DiagnosticId.CS1702,DiagnosticId.CS1705]);
const sameDiagnostic=(a,b)=>a.code===b.code&&a.args.length===b.args.length&&a.args.every((x,i)=>x===b.args[i]);

/** The bound references of one compilation. */
export class ReferenceManager {
  /**
   * @param {object[]} references each {assembly: PEAssemblySymbol} or {bytes: Uint8Array}, with optional `aliases`
   *   (extern alias names; none means `global`), `display` (the path shown in diagnostics) and import `options`
   * @param {object} [options] isFrameworkAssembly(identity): unification policy for framework assemblies;
   *   resolveMissing(identity, referencingAssembly) -> PEAssemblySymbol | Uint8Array | null: supplies an assembly for an
   *   unbound AssemblyRef (it joins with the aliases of the assembly that needs it);
   *   report(node, code, args): receives every declaration-level diagnostic as it is produced
   */
  constructor(references=[],options={}){
    this.options=options;this.diagnostics=[];
    /** Per input reference: {reference, assembly, aliases, duplicateOf}. `duplicateOf` is the entry that replaced a dropped duplicate. */
    this.references=references.map(reference=>{const assembly=reference.assembly instanceof PEAssemblySymbol?reference.assembly:importAssembly(reference.bytes,{filePath:reference.display??null,...reference.options});return {reference,assembly,aliases:normalizeAliases(reference.aliases),display:reference.display??assembly.filePath??null,duplicateOf:null,isImplicit:false};});
    this._resolveDuplicates();
    /** The distinct assemblies, in reference order. */
    this.assemblies=this.references.filter(r=>!r.duplicateOf).map(r=>r.assembly);
    /** owner assembly -> [{referenceIdentity, definition, versionDifference, diagnostic}] for references bound to another version. */
    this._unified=new Map();this._bindAll();
    /** The assembly that defines System.Object, or null. */
    this.corLibrary=this.assemblies.find(a=>a.isCorLibrary)??null;for(const a of this.assemblies)if(this.corLibrary)a.corLibrary=this.corLibrary;
    this._aliasNamespaces=new Map();
  }
  _report(code,args){const d={code,args};this.diagnostics.push(d);this.options.report?.(null,code,args);return d;}
  _comparison(a,b){return compareAssemblyIdentity(a,b,{isFrameworkAssembly:this.options.isFrameworkAssembly}).result===IdentityComparison.Equivalent;}
  /** Roslyn walks the references last to first, so of two duplicates the later one is kept. */
  _resolveDuplicates(){
    const kept=[];
    for(let i=this.references.length-1;i>=0;i--){
      const entry=this.references[i],identity=entry.assembly.identity,sameName=kept.filter(k=>k.assembly.identity.name.toLowerCase()===identity.name.toLowerCase());
      const equivalent=identity.isStrongName?sameName.find(k=>k.assembly===entry.assembly||this._comparison(identity,k.assembly.identity)):sameName[0];
      if(!equivalent){kept.push(entry);continue;}
      entry.duplicateOf=equivalent;
      if(equivalent.assembly===entry.assembly||identity.equals(equivalent.assembly.identity)){equivalent.aliases=mergeAliases(entry.aliases,equivalent.aliases);continue;}
      const other=equivalent.display??equivalent.assembly.identity.getDisplayName();
      if(identity.isStrongName)this._report(DiagnosticId.CS1703,[entry.display??identity.getDisplayName(),other]);else this._report(DiagnosticId.CS1704,[identity.name,entry.display??identity.getDisplayName()]);
    }
  }
  _bindAll(){
    const pending=[...this.assemblies],bound=new Set();
    while(pending.length){
      const owner=pending.shift();if(bound.has(owner))continue;bound.add(owner);
      const targets=owner.referencedAssemblyIdentities.map(referenceIdentity=>{
        let binding=resolveAssemblyReference(referenceIdentity,this.assemblies.map(a=>a.identity),this.options);
        if(binding.index<0&&this.options.resolveMissing){const supplied=this.options.resolveMissing(referenceIdentity,owner);if(supplied&&this._addImplicit(supplied,owner)){pending.push(this.assemblies[this.assemblies.length-1]);binding=resolveAssemblyReference(referenceIdentity,this.assemblies.map(a=>a.identity),this.options);}}
        if(binding.index<0)return null;const definition=this.assemblies[binding.index];
        if(binding.versionDifference){let list=this._unified.get(owner);if(!list)this._unified.set(owner,list=[]);list.push({owner,referenceIdentity,definition,versionDifference:binding.versionDifference,diagnostic:unificationDiagnostic(owner,referenceIdentity,definition)});}
        return definition;
      });
      owner.setReferencedAssemblies(targets);
    }
    // An assembly added while binding can satisfy references of assemblies bound before it.
    for(const owner of this.assemblies)if(owner.boundReferences.some(a=>!a)){const identities=this.assemblies.map(a=>a.identity),current=owner.boundReferences;let changed=false;const next=owner.referencedAssemblyIdentities.map((id,i)=>{if(current[i])return current[i];const b=resolveAssemblyReference(id,identities,this.options);if(b.index<0||b.versionDifference)return null;changed=true;return this.assemblies[b.index];});if(changed)owner.setReferencedAssemblies(next);}
  }
  _addImplicit(supplied,owner){
    const assembly=supplied instanceof PEAssemblySymbol?supplied:importAssembly(supplied);if(this.assemblies.includes(assembly))return false;
    const requester=this.references.find(r=>r.assembly===owner&&!r.duplicateOf);this.references.push({reference:null,assembly,aliases:requester?[...requester.aliases]:[GlobalAlias],display:assembly.filePath,duplicateOf:null,isImplicit:true});this.assemblies.push(assembly);return true;
  }
  /** Every unified reference: [{owner, referenceIdentity, definition, versionDifference, diagnostic}]. */
  get unifications(){return [...this._unified.values()].flat();}
  /** CS1701 / CS1702 / CS1705 for every unified reference, without duplicates. */
  get unificationDiagnostics(){const result=[];for(const u of this.unifications)if(!result.some(d=>sameDiagnostic(d,u.diagnostic)))result.push(u.diagnostic);return result;}
  /** The extern aliases an assembly is visible under. */
  aliasesOf(assembly){return this.references.find(r=>r.assembly===assembly&&!r.duplicateOf)?.aliases??[];}
  /** All alias names in use except `global`. */
  get externAliases(){return [...new Set(this.references.filter(r=>!r.duplicateOf).flatMap(r=>r.aliases))].filter(a=>a!==GlobalAlias);}
  /** The merged global namespace of the references in the `global` alias (the one unqualified lookup uses). */
  get globalNamespace(){return this._namespaceOf(GlobalAlias);}
  _namespaceOf(alias){if(!this._aliasNamespaces.has(alias)){const roots=this.references.filter(r=>!r.duplicateOf&&r.aliases.includes(alias)).map(r=>r.assembly.globalNamespace);this._aliasNamespaces.set(alias,roots.length?mergeGlobalNamespaces(...roots):null);}return this._aliasNamespaces.get(alias);}
  /**
   * Resolves `extern alias X;`. Returns {alias: AliasSymbol} whose target is the merged global namespace of the
   * references carrying that alias, or {diagnostic}: CS0430 when no reference has it, CS1681 for `global`.
   */
  resolveExternAlias(name,syntax=null){
    if(name===GlobalAlias)return {alias:null,diagnostic:{code:DiagnosticId.CS1681,args:[]}};const target=this._namespaceOf(name);
    return target?{alias:new AliasSymbol(name,target,{isExtern:true,syntax}),diagnostic:null}:{alias:null,diagnostic:{code:DiagnosticId.CS0430,args:[name]}};
  }
  /** The display name of the assembly a type forwarder for `metadataName` points to when that assembly is not referenced, or null. */
  forwardedToMissingAssembly(metadataName,alias=GlobalAlias){
    for(const r of this.references){if(r.duplicateOf||!r.aliases.includes(alias))continue;const type=r.assembly.resolveType(metadataName);if(type instanceof ErrorTypeSymbol&&type.reason?.code===DiagnosticId.CS0012)return type.reason.args[1];}
    return null;
  }
  /** The bound assembly with exactly this identity (an AssemblyIdentity or a display name), or null. */
  findAssembly(identity){const id=typeof identity==='string'?AssemblyIdentity.parse(identity):identity;return this.assemblies.find(a=>a.identity.equals(id))??null;}
  /** The assembly a reference identity binds to under the unification rules, or null. */
  resolveAssembly(referenceIdentity){const b=resolveAssemblyReference(referenceIdentity,this.assemblies.map(a=>a.identity),this.options);return b.index<0?null:this.assemblies[b.index];}
  /**
   * Finds a type by CLR name across the references of an alias: defining assemblies first, then type forwarders.
   * Returns null when no assembly defines or forwards it; an ErrorTypeSymbol when a forwarder cannot be followed.
   */
  getTypeByMetadataName(metadataName,alias=GlobalAlias){
    const visible=this.references.filter(r=>!r.duplicateOf&&r.aliases.includes(alias)).map(r=>r.assembly);
    for(const a of visible){const type=a.getTypeByMetadataName(metadataName);if(type)return type;}
    for(const a of visible){const type=a.resolveType(String(metadataName).split('+')[0]);if(type)return type instanceof ErrorTypeSymbol?type:type.containingAssembly.getTypeByMetadataName(metadataName);}
    return null;
  }
  /**
   * The use-site diagnostics of an imported symbol, as {code,args} records: the reason of every error type in its
   * signature (CS0012, CS7069, CS0731, CS0518) and CS1701/CS1702/CS1705 when the symbol's assembly reaches a
   * type through a unified reference. For a type the base types and interfaces are checked; for a member its
   * return, parameter, field, property or event types. `options.missingBases: false` leaves out the errors of a
   * type's base types and interfaces: Roslyn reports those where a member is looked up, not where the type is named.
   */
  useSiteDiagnostics(symbol,options={}){
    const result=[],add=d=>{if(d&&!result.some(x=>sameDiagnostic(x,d)))result.push(d);},seen=new Set();
    const visit=(t,owner)=>{
      t=typeOf(t);if(!t||seen.has(t))return;seen.add(t);
      if(t instanceof ErrorTypeSymbol){add(t.reason);t.typeArguments.forEach(a=>visit(a,owner));return;}
      if(t instanceof ArrayTypeSymbol)return visit(t.elementTypeWithAnnotations,owner);
      if(t instanceof PointerTypeSymbol)return visit(t.pointedAtTypeWithAnnotations,owner);
      if(t instanceof FunctionPointerTypeSymbol){visit(t.signature.returnType,owner);t.signature.parameters.forEach(p=>visit(p.type,owner));return;}
      if(t instanceof NamedTypeSymbol){
        const dependent=t.originalDefinition.containingAssembly;
        if(owner&&dependent&&dependent!==owner)for(const u of this._unified.get(owner)??[])if(u.definition===dependent)add(u.diagnostic);
        if(!t.isDefinition)t.typeArguments.forEach(a=>visit(a,owner));if(t.containingType)visit(t.containingType,owner);
      }
    };
    if(symbol instanceof ErrorTypeSymbol)add(symbol.reason);
    else if(symbol.kind===SymbolKind.NamedType){const reported=result.length;for(let t=symbol.originalDefinition,depth=0;t&&depth<64&&!(t instanceof ErrorTypeSymbol);t=typeOf(t.baseType)?.originalDefinition,depth++){const owner=t.containingAssembly;seen.clear();visit(t.baseType,owner);for(const i of t.interfaces)visit(i,owner);}if(options.missingBases===false)return result.slice(0,reported).concat(result.slice(reported).filter(d=>unificationCodes.has(d.code)));}
    else{
      const owner=symbol.containingType?.originalDefinition.containingAssembly??null;
      visit(symbol.returnTypeWithAnnotations??symbol.typeWithAnnotations,owner);for(const p of symbol.parameters??[])visit(p.typeWithAnnotations,owner);
    }
    return result;
  }
}
const normalizeAliases=aliases=>{const list=[...new Set((aliases??[]).filter(Boolean))];return list.length?list:[GlobalAlias];};
const mergeAliases=(a,b)=>[...new Set([...a,...b])];
/**
 * Binds a compilation's references.
 * @param {object[]} references see `ReferenceManager`
 * @param {object} [options] see `ReferenceManager`
 * @returns {ReferenceManager} `.assemblies`, `.globalNamespace`, `.diagnostics`, `.unificationDiagnostics`, `.corLibrary`, ...
 */
export function bindReferences(references,options={}){return new ReferenceManager(references,options);}
