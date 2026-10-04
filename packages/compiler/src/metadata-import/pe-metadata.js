import {readPE,Reader,decodeCoded,decodeConstant,CilError} from '@sharpforge/cil';
import {AssemblyIdentity} from './assembly-identity.js';
/**
 * A read-only view over the ECMA-335 tables of one module, built on the @sharpforge/cil reader.
 *
 * The cil reader exposes raw rows (arrays of column values), the string and blob heaps and coded-index
 * decoding. Everything the importer needs beyond that lives here: member-list ranges, owner lookups, the
 * GenericParam / NestedClass / CustomAttribute / Constant / MethodSemantics / ExportedType indexes, a
 * structural signature parser (the cil reader only renders signatures as text) and constant decoding.
 * This module is private to metadata-import; it creates no symbols.
 */
export const Table=Object.freeze({Module:0,TypeRef:1,TypeDef:2,Field:4,MethodDef:6,Param:8,InterfaceImpl:9,MemberRef:10,Constant:11,CustomAttribute:12,EventMap:18,Event:20,PropertyMap:21,Property:23,MethodSemantics:24,MethodImpl:25,ModuleRef:26,TypeSpec:27,Assembly:32,AssemblyRef:35,File:38,ExportedType:39,NestedClass:41,GenericParam:42,MethodSpec:43,GenericParamConstraint:44});
export const tokenOf=(table,rid)=>(table*0x1000000+rid)>>>0;
export const tableOf=token=>token>>>24;
export const ridOf=token=>token&0xffffff;
/** ECMA-335 II.23.1.16 element types used by signatures and constants. */
export const ElementType=Object.freeze({Void:1,Boolean:2,Char:3,I1:4,U1:5,I2:6,U2:7,I4:8,U4:9,I8:10,U8:11,R4:12,R8:13,String:14,Ptr:15,ByRef:16,ValueType:17,Class:18,Var:19,Array:20,GenericInst:21,TypedByRef:22,I:24,U:25,FnPtr:27,Object:28,SZArray:29,MVar:30,CModReqd:31,CModOpt:32,Sentinel:0x41,Pinned:0x45});
const primitiveCodes=new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,22,24,25,28]);

/**
 * Parses signature blobs into trees. Node kinds: primitive {code}, type {token,isValueType}, var/mvar {index},
 * szarray {element}, array {element,rank,sizes,lowerBounds}, pointer {element}, byref {element},
 * generic {token,isValueType,arguments}, fnptr {signature}. Every node may carry `modifiers`
 * ([{isOptional,token}], outermost first) and `pinned`.
 */
export class SignatureParser {
  constructor(bytes){this.r=new Reader(bytes);this.budget=8192;}
  get atEnd(){return this.r.position>=this.r.end;}
  typeToken(){return decodeCoded('TypeDefOrRef',this.r.compressed());}
  type(depth=0){
    if(--this.budget<0||depth>96)throw new CilError('Signature complexity limit exceeded');
    const r=this.r,modifiers=[];let pinned=false,e=r.u8();
    for(;;){if(e===ElementType.CModReqd||e===ElementType.CModOpt){modifiers.push({isOptional:e===ElementType.CModOpt,token:this.typeToken()});e=r.u8();}else if(e===ElementType.Pinned){pinned=true;e=r.u8();}else break;}
    let node;
    if(primitiveCodes.has(e))node={kind:'primitive',code:e};
    else if(e===ElementType.Class||e===ElementType.ValueType)node={kind:'type',token:this.typeToken(),isValueType:e===ElementType.ValueType};
    else if(e===ElementType.Var||e===ElementType.MVar)node={kind:e===ElementType.Var?'var':'mvar',index:r.compressed()};
    else if(e===ElementType.SZArray)node={kind:'szarray',element:this.type(depth+1)};
    else if(e===ElementType.Ptr)node={kind:'pointer',element:this.type(depth+1)};
    else if(e===ElementType.ByRef)node={kind:'byref',element:this.type(depth+1)};
    else if(e===ElementType.Array){const element=this.type(depth+1),rank=r.compressed(),sizes=Array.from({length:r.compressed()},()=>r.compressed()),lowerBounds=Array.from({length:r.compressed()},()=>r.signedCompressed());node={kind:'array',element,rank,sizes,lowerBounds};}
    else if(e===ElementType.GenericInst){const tag=r.u8();if(tag!==ElementType.Class&&tag!==ElementType.ValueType)throw new CilError('Invalid generic instantiation');const token=this.typeToken(),count=r.compressed();if(count>4096)throw new CilError('Signature count limit exceeded');node={kind:'generic',token,isValueType:tag===ElementType.ValueType,arguments:Array.from({length:count},()=>this.type(depth+1))};}
    else if(e===ElementType.FnPtr)node={kind:'fnptr',signature:this.method(depth+1)};
    else throw new CilError(`Unsupported signature element 0x${e.toString(16)}`);
    if(modifiers.length)node.modifiers=modifiers;if(pinned)node.pinned=true;return node;
  }
  /** MethodDefSig / MethodRefSig / PropertySig: {callingConvention,hasThis,isProperty,genericArity,returnType,parameters,sentinel}. */
  method(depth=0){
    const r=this.r,header=r.u8(),genericArity=header&0x10?r.compressed():0,count=r.compressed();if(count>65535)throw new CilError('Signature count limit exceeded');
    const returnType=this.type(depth+1),parameters=[];let sentinel=-1;
    for(let i=0;i<count;i++){if(r.bytes[r.position]===ElementType.Sentinel){r.u8();sentinel=i;}parameters.push(this.type(depth+1));}
    return {callingConvention:header&15,hasThis:!!(header&0x20),isProperty:(header&15)===8,genericArity,returnType,parameters,sentinel};
  }
  field(){if(this.r.u8()!==6)throw new CilError('Expected a field signature');return this.type();}
}
export const parseMethodSignature=blob=>new SignatureParser(blob).method();
export const parseFieldSignature=blob=>new SignatureParser(blob).field();
export const parseTypeSignature=blob=>new SignatureParser(blob).type();

const group=(map,key,value)=>{const list=map.get(key);if(list)list.push(value);else map.set(key,[value]);};
/** The table view. Row ids are 1-based, as in metadata tokens. */
export class MetadataView {
  /** @param {Uint8Array|ArrayBuffer} bytes a PE image with CLI metadata */
  constructor(bytes){const pe=readPE(bytes instanceof ArrayBuffer?new Uint8Array(bytes):bytes,{inspection:true});this.pe=pe;this.md=pe.metadata;this._cache=new Map();}
  rows(table){return this.md.rows[table]??[];}
  count(table){return this.md.rows[table]?.length??0;}
  row(table,rid){const row=this.md.rows[table]?.[rid-1];if(!row)throw new CilError(`Invalid metadata row ${table}:${rid}`);return row;}
  string(index){return this.md.string(index);}
  blob(index){return this.md.blob(index);}
  _lazy(key,build){let value=this._cache.get(key);if(value===undefined){value=build();this._cache.set(key,value);}return value;}
  /** The [start,end) row-id range of a member list column (TypeDef.FieldList, MethodDef.ParamList, ...). */
  listRange(ownerTable,rid,column,targetTable){const start=this.row(ownerTable,rid)[column],end=rid<this.count(ownerTable)?this.row(ownerTable,rid+1)[column]:this.count(targetTable)+1;return [start,Math.max(start,Math.min(end,this.count(targetTable)+1))];}
  _owner(column,rid){const rows=this.rows(Table.TypeDef);let lo=0,hi=rows.length-1,result=0;while(lo<=hi){const mid=(lo+hi)>>1;if(rows[mid][column]<=rid){result=mid+1;lo=mid+1;}else hi=mid-1;}return result;}
  /** TypeDef row id that declares a MethodDef / Field row. */
  methodOwner(rid){return this._owner(5,rid);}
  fieldOwner(rid){return this._owner(4,rid);}
  typeDefName(rid){const row=this.row(Table.TypeDef,rid);return {namespace:this.string(row[2]),name:this.string(row[1])};}
  typeRefName(rid){const row=this.row(Table.TypeRef,rid);return {namespace:this.string(row[2]),name:this.string(row[1])};}
  /** Namespace and name of a TypeDef or TypeRef token without resolving it; null for a TypeSpec. */
  typeTokenName(token){return tableOf(token)===Table.TypeDef?this.typeDefName(ridOf(token)):tableOf(token)===Table.TypeRef?this.typeRefName(ridOf(token)):null;}
  get nesting(){return this._lazy('nesting',()=>{const enclosing=new Map(),nested=new Map();for(const [inner,outer] of this.rows(Table.NestedClass)){enclosing.set(inner,outer);group(nested,outer,inner);}return {enclosing,nested};});}
  /** GenericParam rows of a TypeDef or MethodDef token, ordered by position: [{rid,number,flags,name}]. */
  genericParameters(ownerToken){return this._lazy('generics',()=>{const map=new Map();this.rows(Table.GenericParam).forEach((row,i)=>group(map,decodeCoded('TypeOrMethodDef',row[2]),{rid:i+1,number:row[0],flags:row[1],name:this.string(row[3])}));for(const list of map.values())list.sort((a,b)=>a.number-b.number);return map;}).get(ownerToken)??[];}
  /** Constraint rows of a GenericParam row: [{rid,token}]. */
  genericConstraints(parameterRid){return this._lazy('constraints',()=>{const map=new Map();this.rows(Table.GenericParamConstraint).forEach((row,i)=>group(map,row[0],{rid:i+1,token:decodeCoded('TypeDefOrRef',row[1])}));return map;}).get(parameterRid)??[];}
  /** InterfaceImpl rows of a TypeDef: [{rid,token}] in declaration order. */
  interfaceImplementations(typeRid){return this._lazy('interfaces',()=>{const map=new Map();this.rows(Table.InterfaceImpl).forEach((row,i)=>group(map,row[0],{rid:i+1,token:decodeCoded('TypeDefOrRef',row[1])}));return map;}).get(typeRid)??[];}
  get semantics(){return this._lazy('semantics',()=>{const byMethod=new Map(),byAssociation=new Map();for(const [flags,method,association] of this.rows(Table.MethodSemantics)){const owner=decodeCoded('HasSemantics',association);byMethod.set(method,{semantics:flags,association:owner});group(byAssociation,owner,{semantics:flags,method});}return {byMethod,byAssociation};});}
  /** [start,end) of the Property (or Event) rows a TypeDef declares. */
  memberMapRange(mapTable,targetTable,typeRid){const index=this._lazy('map'+mapTable,()=>new Map(this.rows(mapTable).map((row,i)=>[row[0],i+1]))),rid=index.get(typeRid);return rid?this.listRange(mapTable,rid,1,targetTable):[0,0];}
  /** The constant of a Field, Param or Property token as `{value}`, or undefined when there is none. */
  constant(parentToken){
    const entry=this._lazy('constants',()=>new Map(this.rows(Table.Constant).map(row=>[decodeCoded('HasConstant',row[1]),row]))).get(parentToken);if(!entry)return undefined;
    return {value:decodeConstant(entry[0],this.blob(entry[2]))};
  }
  /** Declaring type name and signature blob of a custom-attribute constructor (MethodDef or MemberRef). */
  attributeConstructor(token){
    if(tableOf(token)===Table.MethodDef){const row=this.row(Table.MethodDef,ridOf(token)),owner=this.methodOwner(ridOf(token));return {...this.typeDefName(owner),typeToken:tokenOf(Table.TypeDef,owner),signature:row[4]};}
    const row=this.row(Table.MemberRef,ridOf(token));let parent=decodeCoded('MemberRefParent',row[0]);
    if(tableOf(parent)===Table.TypeSpec){const node=parseTypeSignature(this.blob(this.row(Table.TypeSpec,ridOf(parent))[0]));parent=node.token??0;}
    const name=parent?this.typeTokenName(parent):null;return {namespace:name?.namespace??'',name:name?.name??'',typeToken:parent,signature:row[2]};
  }
  /**
   * Raw custom attributes of a token: [{namespace,name,fullName,constructorToken,typeToken,blob,parameterTypes}].
   * `blob` and `parameterTypes` (signature nodes of the constructor parameters) are read on demand.
   */
  customAttributes(parentToken){
    const rows=this._lazy('attributes',()=>{const map=new Map();for(const row of this.rows(Table.CustomAttribute)){let parent,ctor;try{parent=decodeCoded('HasCustomAttribute',row[0]);ctor=decodeCoded('CustomAttributeType',row[1]);}catch{continue;}group(map,parent,{ctor,blob:row[2]});}return map;}).get(parentToken);if(!rows)return [];
    return this._lazy('ca'+parentToken,()=>rows.map(({ctor,blob})=>{const info=this.attributeConstructor(ctor),view=this;let parameters=null;
      return {namespace:info.namespace,name:info.name,fullName:info.namespace?info.namespace+'.'+info.name:info.name,constructorToken:ctor,typeToken:info.typeToken,get blob(){return view.blob(blob);},get parameterTypes(){return parameters??=parseMethodSignature(view.blob(info.signature)).parameters;}};}));
  }
  /** Identity of the assembly this module is the manifest module of, or null for a netmodule. */
  get assemblyIdentity(){return this._lazy('identity',()=>{const row=this.rows(Table.Assembly)[0];if(!row)return null;return new AssemblyIdentity({name:this.string(row[7]),version:[row[1],row[2],row[3],row[4]],cultureName:this.string(row[8]),publicKey:row[6]?this.blob(row[6]):null,isRetargetable:!!(row[5]&0x100),contentType:(row[5]&0xe00)===0x200?'windowsRuntime':'default'});});}
  /** Identities of the AssemblyRef rows, in row order. */
  get assemblyReferences(){return this._lazy('references',()=>this.rows(Table.AssemblyRef).map(row=>{const key=row[5]?this.blob(row[5]):null;return new AssemblyIdentity({name:this.string(row[6]),version:[row[0],row[1],row[2],row[3]],cultureName:this.string(row[7]),...(row[4]&1?{publicKey:key}:{publicKeyToken:key}),isRetargetable:!!(row[4]&0x100),contentType:(row[4]&0xe00)===0x200?'windowsRuntime':'default'});}));}
  /** ExportedType rows: [{rid,flags,namespace,name,implementation,isForwarder}]. */
  get exportedTypes(){return this._lazy('exported',()=>this.rows(Table.ExportedType).map((row,i)=>({rid:i+1,flags:row[0],name:this.string(row[2]),namespace:this.string(row[3]),implementation:decodeCoded('Implementation',row[4]),isForwarder:!!(row[0]&0x200000)})));}
}
