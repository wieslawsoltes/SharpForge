import {appendRegistryBuiltins} from './registry-builtin-members.js';
import {declareVarargsTypes} from './varargs-types.js';
import {registryTypeKind, registryTypeOptions, registryInterfaces, registryVariance} from './registry-type-shapes.js';
import {types as frameworkTypes,contracts as frameworkContracts,canonicalType} from '@sharpforge/framework';
import {visibleRegistryBuiltins,indexRegistryBuiltins,registryBuiltinOwner} from './registry-builtin-owners.js';
import {NamedTypeSymbol,ConstructedNamedTypeSymbol,ArrayTypeSymbol,TypeWithAnnotations,TypeKind,Accessibility} from './types.js';
import {MethodSymbol,FieldSymbol,PropertySymbol,EventSymbol,ParameterSymbol,MethodKind,DeclarationModifiers} from './members.js';
import {NamespaceSymbol,NamespaceExtent} from './namespaces.js';
import {attachOpenMembers} from './registry-open-members.js';
import {registryParameter,registryContractMethod} from './registry-contracts.js';
import {appendRegistryIndexers} from './registry-indexers.js';
import {appendRegistryFields} from './registry-fields.js';
import {declareCoreTypes,TypeProvider,specialTypeFromKeyword,coreTypeDescriptor,specialTypeIds} from './special-types.js';
/**
 * Bridges the closed framework registry (packages/framework) and the bytecode builtin table to read-only,
 * metadata-like symbols, so the binder can run before real assembly references exist.
 *
 * The registry lists closed generic instantiations (List`1<int>) rather than open definitions. The bridge creates
 * one open definition per generic name and exposes every registry instantiation as a constructed type whose
 * members are the registry contracts of exactly that instantiation. Each member symbol carries its `contract`
 * (framework members) or `builtin` (bytecode builtins) so code generation can find the ABI entry again.
 */
const coreIds=['System_Object','System_Enum','System_MulticastDelegate','System_Delegate','System_ValueType','System_Void','System_Boolean','System_Char','System_SByte','System_Byte','System_Int16','System_UInt16','System_Int32','System_UInt32','System_Int64','System_UInt64','System_Decimal','System_Single','System_Double','System_String','System_IntPtr','System_UIntPtr','System_Array','System_IDisposable','System_Exception','System_Math','System_Console','System_Type'];
/** Splits "A.B.Name`2<x, y<z>>" into {path:'A.B.Name', arity:2, args:['x','y<z>']}. */
export function parseRegistryName(name){
  const open=name.indexOf('<');if(open<0||!name.endsWith('>'))return {path:name.replace(/`\d+$/,''),arity:0,args:[]};
  const args=[];let depth=0,start=open+1;for(let i=open+1;i<name.length-1;i++){const c=name[i];if(c==='<')depth++;else if(c==='>')depth--;else if(c===','&&depth===0){args.push(name.slice(start,i).trim());start=i+1;}}args.push(name.slice(start,-1).trim());
  return {path:name.slice(0,open).replace(/`\d+$/,''),arity:args.length,args};
}
class RegistryConstructedType extends ConstructedNamedTypeSymbol {
  constructor(definition,args,bridge,registryName){super(definition,args,null);this.bridge=bridge;this.registryName=registryName;this._own=null;}
  get baseType(){return this.typeKind===TypeKind.Interface?null:this.bridge.baseOf(this.registryName);}
  get interfaces(){return this._registryInterfaces??=registryInterfaces(this.bridge,this.registryName);}
  getMembers(name){this._own??=this.bridge.membersOf(this.registryName,this);return name===undefined?this._own:this._own.filter(m=>m.name===name);}
}
export class RegistryBridge {
  /** @param {object} registry `{types:Map,contracts:[],builtins:[]}`; defaults to the live framework registry and builtin table. */
  constructor(registry={}){
    this.types=registry.types??frameworkTypes;this.contracts=registry.contracts??frameworkContracts;this.builtins=registry.builtins??visibleRegistryBuiltins();
    this.module=Object.freeze({name:'SharpForge.Framework',kind:'registry'});this.globalNamespace=new NamespaceSymbol('',null,NamespaceExtent.Metadata,this.module);
    declareCoreTypes(this.globalNamespace,coreIds);this.typeProvider=new TypeProvider(this.globalNamespace);
    this.byName=new Map();this.names=new Map();this.arrays=new Map();this.contractSymbols=new Map();this.builtinSymbols=new Map();this.byOwner=new Map();this.builtinsByOwner=new Map();
    for(const c of this.contracts){if(!this.byOwner.has(c.owner))this.byOwner.set(c.owner,[]);this.byOwner.get(c.owner).push(c);}
    indexRegistryBuiltins(this);
    for(const id of coreIds){const d=coreTypeDescriptor(id),type=this.typeProvider.getCoreType(id),full=d.metadataName;this.remember(full,type);this.attach(type,full);}
    for(const [keyword] of Object.entries({object:1,void:1,bool:1,char:1,sbyte:1,byte:1,short:1,ushort:1,int:1,uint:1,long:1,ulong:1,decimal:1,float:1,double:1,string:1,nint:1,nuint:1}))this.byName.set(keyword,this.typeProvider.getCoreType(specialTypeFromKeyword(keyword)));
    this.byName.set('Exception',this.typeProvider.getCoreType('System_Exception'));this.keywords=new Map([...this.byName].filter(([k])=>!k.includes('.')).map(([k,v])=>[v,k]));
    for(const name of this.types.keys())this.declare(name);
    declareVarargsTypes(this);
    for(const owner of this.builtinsByOwner.keys())if(!this.byName.has(owner)){const dot=owner.lastIndexOf('.'),type=this.globalNamespace.ensureNamespace(owner.slice(0,dot)).addType(new NamedTypeSymbol({name:owner.slice(dot+1),isStatic:owner!=='System.Type',baseType:()=>this.objectType}));this.remember(owner,type);this.attach(type,owner);}
  }
  get objectType(){return this.typeProvider.getCoreType('System_Object');}
  /** A special or well-known type by id, declared in the bridge's core library on first use (Nullable<T>, IEnumerable<T>, Func<...>, ...). */
  coreType(id){let type=this.typeProvider.getCoreTypeQuiet(id);if(!type.isErrorType()){if(type._specialType==null&&specialTypeIds().includes(id)){type._specialType=id;if(/IEnumerable_T|IEnumerator_T|IReadOnly/.test(id))for(const p of type.typeParameters)p.variance='out';}return type;}declareCoreTypes(this.globalNamespace,[id]);this.typeProvider.cache.delete(id);type=this.typeProvider.getCoreType(id);const d=coreTypeDescriptor(id);if(!this.byName.has(d.metadataName)){this.remember(d.metadataName,type);}return type;}
  remember(name,type){this.byName.set(name,type);if(!this.names.has(type))this.names.set(type,name);}
  attach(type,registryName){type._members=()=>this.membersOf(registryName,type);}
  /** Declares the symbol for one registry type name (idempotent). */
  declare(name){
    if(this.byName.has(name))return this.byName.get(name);const entry=this.types.get(name),{path,arity,args}=parseRegistryName(name);
    // A dotted prefix that is itself a registry type makes this a nested type (JsonElement.ArrayEnumerator).
    const dot=path.lastIndexOf('.'),outerName=dot>0?path.slice(0,dot):'',outer=outerName&&this.types.has(outerName)?this.declare(outerName):null,simple=path.slice(dot+1),container=outer??this.globalNamespace.ensureNamespace(outerName);
    // Nested types are tracked on the outer type directly: asking it for members here would bind its contracts too early.
    const nested=(n,a)=>(outer?(outer._nested??[]).filter(t=>t.name===n&&t.arity===a):container.getTypeMembers(n,a))[0];
    const kind=registryTypeKind(entry);
    if(arity){
      let definition=nested(simple,arity);
      if(!definition){definition=new NamedTypeSymbol({name:simple,arity,...registryTypeOptions(this,name,kind)});if(outer){(outer._nested??=[]).push(definition);definition.containingSymbol=outer;}else container.addType(definition);}
      // Constructing the definition with the arguments of a registry instantiation yields that instantiation.
      registryVariance(definition,entry);definition.instanceProvider=(d,typeArguments)=>this.closedInstance(d,typeArguments);definition.instances??=[];const type=new RegistryConstructedType(definition,args.map(a=>new TypeWithAnnotations(this.typeFromName(a)??this.objectType)),this,name);definition.instances.push(type);attachOpenMembers(this,definition);this.remember(name,type);return type;
    }
    const existing=nested(simple,0);if(existing){this.remember(name,existing);this.attach(existing,name);return existing;}
    const type=new NamedTypeSymbol({name:simple,...registryTypeOptions(this,name,kind)});
    type.registryKind=entry?.kind??null;if(outer){this.remember(name,type);(outer._nested??=[]).push(type);type.containingSymbol=outer;}else{container.addType(type);this.remember(name,type);}this.attach(type,name);return type;
  }
  /** The registry instantiation matching a definition and type arguments, or null. */
  closedInstance(definition,typeArguments){return definition.instances?.find(t=>t.typeArguments.length===typeArguments.length&&t.typeArguments.every((a,i)=>a.type.equals(typeArguments[i].type)))??null;}
  baseOf(registryName){const entry=this.types.get(registryName),base=entry?.base;if(!base)return this.objectType;return this.typeFromName(base==='object'?'object':base)??this.objectType;}
  /**
   * Resolves a registry type name: keywords (int), canonical registry names, arrays (X[]), 'Exception',
   * and unqualified registry aliases (List<int>). Returns null when the name is not a framework type.
   */
  typeFromName(name){
    if(typeof name!=='string')return null;let type=this.byName.get(name);if(type)return type;if(this.types.has(name))return this.declare(name);
    if(name.endsWith('[]')){if(this.arrays.has(name))return this.arrays.get(name);const element=this.typeFromName(name.slice(0,-2));if(!element)return null;type=new ArrayTypeSymbol(element,1,{baseType:()=>this.typeProvider.getCoreType('System_Array')});this.arrays.set(name,type);return type;}
    const canonical=canonicalType(name);if(canonical!==name)return this.typeFromName(canonical);
    return null;
  }
  /** The registry (legacy) name of a bridged type, or null. */
  registryName(type){if(type instanceof ArrayTypeSymbol){const element=this.registryName(type.elementType);return element?element+'[]':null;}return this.keywords.get(type)??this.names.get(type)??null;}
  parameter(typeName,index,isParams=false){return registryParameter(this,typeName,index,isParams);}
  /** Builds the member symbols of a registry type from its contracts, registry properties and builtins. */
  membersOf(registryName,owner){
    const entry=this.types.get(registryName),members=[...(owner._nested??[])],properties=new Map(),events=new Map(),pub={declaredAccessibility:Accessibility.Public,containingSymbol:owner};
    const method=(contract,kind)=>registryContractMethod(this,contract,kind,pub);
    for(const c of this.byOwner.get(registryName)??[]){
      if(c.kind==='constructor')members.push(method(c,MethodKind.Constructor));
      else if(c.kind==='get'||c.kind==='set'){const p=properties.get(c.property)??{};p[c.kind]=method(c,c.kind==='get'?MethodKind.PropertyGet:MethodKind.PropertySet);p.isStatic=c.isStatic;properties.set(c.property,p);}
      else if(c.kind==='eventAdd'||c.kind==='eventRemove'){const e=events.get(c.event)??{};e[c.kind]=method(c,c.kind==='eventAdd'?MethodKind.EventAdd:MethodKind.EventRemove);events.set(c.event,e);}
      else members.push(method(c,owner.typeKind===TypeKind.Delegate&&c.name==='Invoke'?MethodKind.DelegateInvoke:MethodKind.Ordinary));
    }
    for(const [name,p] of properties){const type=p.get?.returnType??p.set.parameters[0].type;members.push(new PropertySymbol({...pub,name,type,getMethod:p.get??null,setMethod:p.set??null,modifiers:p.isStatic?DeclarationModifiers.Static:0}),...[p.get,p.set].filter(Boolean));}
    for(const [name,e] of events){const type=this.typeFromName(entry?.events?.[name])??e.eventAdd?.parameters[0].type??this.objectType;members.push(new EventSymbol({...pub,name,type,addMethod:e.eventAdd??null,removeMethod:e.eventRemove??null}),...[e.eventAdd,e.eventRemove].filter(Boolean));}
    appendRegistryIndexers(members,owner,entry,this.types);
    appendRegistryFields(members,entry,this,pub);
    if(entry?.kind==='enum')for(const [name,value] of Object.entries(entry.values??{}))members.push(new FieldSymbol({...pub,name,type:owner,modifiers:DeclarationModifiers.Const,constantValue:{value}}));
    appendRegistryBuiltins(this,registryName,members,pub);
    if(registryName==='System.IDisposable')members.push(new MethodSymbol({...pub,name:'Dispose',returnType:this.byName.get('void'),modifiers:DeclarationModifiers.Abstract}));
    return members;
  }
  /** The method symbol for a framework contract (materialises the owner's members on demand). */
  symbolForContract(contract){if(!this.contractSymbols.has(contract.id))this.typeFromName(contract.owner)?.getMembers();return this.contractSymbols.get(contract.id)??null;}
  /** The symbol for a bytecode builtin descriptor. */
  symbolForBuiltin(builtin){if(!this.builtinSymbols.has(builtin.id)){const owner=registryBuiltinOwner(builtin);this.byName.get(owner)?.getMembers();}return this.builtinSymbols.get(builtin.id)??null;}
  /** Every bridged named type (definitions, closed instantiations and nested types). */
  allTypes(){return [...new Set([...this.byName.values()].filter(t=>t instanceof NamedTypeSymbol))];}
}
let shared=null;
/** The bridge over the live framework registry; built once because the registry is immutable after module load. */
export function frameworkBridge(){return shared??=new RegistryBridge();}
