import { readMetadataTables, writeMetadataTables } from './metadata/table-stream.js';
import { metadataList } from './metadata/pointer-tables.js';
import { sortMetadataRows } from './metadata/sorting.js';
export { metadataSortedMask } from './metadata/sorting.js';
import { interopRowWriters } from './metadata/rows-interop.js';
import { manifestRowWriters } from './metadata/rows-manifest.js';
import {frameworkType,canonicalType} from '@sharpforge/framework';
import { Writer, Reader, CilError, align, utf8, text, buildId } from './binary.js';
/** ECMA-335 II.22 tables and II.24 heaps. Table/index widths are computed, never fixed. */
import { writeMetadataRow } from './metadata/row-writer.js';
import { definitionRowWriters } from './metadata/rows-definitions.js';
export * from './metadata/rows-definitions.js';
import { MetadataHeaps } from './metadata/heaps.js';
import { codedIndex, decodeCoded, token } from './metadata/indices.js';
export { Tables, TableId, tableDefinitions, metadataSchemas } from './metadata/tables.js';
export { metadataCodedIndices, codedIndex, decodeCoded, token, metadataIndexWidth } from './metadata/indices.js';
export class MetadataBuilder {
  constructor(name='Application', {framework='net8',uncompressed=false,extraData}={}) {
    this.name=name;this.framework=framework;this.uncompressed=uncompressed;this.extraData=extraData;this.rows={};this.heaps=new MetadataHeaps();this.definitions=definitionRowWriters(this);this.manifest=manifestRowWriters(this);this.interop=interopRowWriters(this);this.typeRefs=new Map();this.members=new Map();this.assemblyRefs=new Map();
    this.add(0,[0,this.string(name+'.dll'),1,0,0]);this.add(32,[0x8004,0,2,0,0,0,0,this.string(name),0]);
  }
  add(table,row) { const rows=this.rows[table]??=[];rows.push(row);return token(table,rows.length); }
  addRow(table,values) { return writeMetadataRow(this,table,values); }
  string(value) { return this.heaps.string(value); }
  blob(bytes) { return this.heaps.blob(bytes); }
  guid(bytes) { return this.heaps.guid(bytes); }
  userString(value) { return this.heaps.userString(value); }
  assemblyRef(name) { if(this.assemblyRefs.has(name))return this.assemblyRefs.get(name);const custom=name==='SharpForge.WinUI'||name==='SharpForge.Runtime';const legacy=this.framework==='mscorlib4';const publicKey=legacy?[0xb7,0x7a,0x5c,0x56,0x19,0x34,0xe0,0x89]:[0xb0,0x3f,0x5f,0x7f,0x11,0xd5,0x0a,0x3a];const t=this.add(35,[custom?0:legacy?4:8,custom?10:0,0,0,0,custom?0:this.blob(Uint8Array.from(publicKey)),this.string(name),0,0]);this.assemblyRefs.set(name,t);return t; }
  typeRef(fullName,assembly) { const canonical=canonicalType(fullName);if(canonical!==fullName)fullName=canonical;const generic=/^(.+`\d+)<(.+)>$/.exec(fullName);if(generic){const key='typespec:'+fullName;if(this.typeRefs.has(key))return this.typeRefs.get(key);const data=signatureType(new Writer(),fullName,t=>this.typeRef(t));const token=this.add(27,[this.blob(data.finish())]);this.typeRefs.set(key,token);return token;}assembly??=fullName.startsWith('Microsoft.UI.')||fullName.startsWith('Windows.UI.')?'SharpForge.WinUI':fullName.startsWith('SharpForge.Runtime.')?'SharpForge.Runtime':this.framework==='mscorlib4'?'mscorlib':fullName==='System.Console'?'System.Console':fullName==='System.Diagnostics.Debug'?'System.Diagnostics.Debug':'System.Runtime';const key=assembly+':'+fullName;if(this.typeRefs.has(key))return this.typeRefs.get(key);const split=fullName.lastIndexOf('.'),ns=split<0?'':fullName.slice(0,split),name=fullName.slice(split+1);const t=this.add(1,[codedIndex('ResolutionScope',this.assemblyRef(assembly)),this.string(name),this.string(ns)]);this.typeRefs.set(key,t);return t; }
  member(owner,name,signature) { const key=`${owner}:${name}:${Array.from(signature)}`;if(this.members.has(key))return this.members.get(key);const t=this.add(10,[codedIndex('MemberRefParent',owner),this.string(name),this.blob(signature)]);this.members.set(key,t);return t; }
  finish(debug,identityBytes) {
    const {rows,sortedMask,tokenMap}=sortMetadataRows(this.rows);this.tokenMap=tokenMap;
    const heapFlags=this.heaps.flags|(this.extraData===undefined?0:0x40);
    const tables=writeMetadataTables(rows,{heapFlags,sortedMask,uncompressed:this.uncompressed,extraData:this.extraData});
    const streams=[[this.uncompressed?'#-':'#~',tables],...this.heaps.finish(buildId(identityBytes??new Uint8Array()))];if(debug)streams.push(['#SF',utf8(JSON.stringify(debug))]);
    const version=utf8('v4.0.30319\0'),root=new Writer().u32(0x424a5342).u16(1).u16(1).u32(0).u32(align(version.length)).bytes(version).pad().u16(0).u16(streams.length);const headers=[];
    for(const [name,data]of streams){headers.push(root.length);root.u32(0).u32(data.length).bytes(utf8(name)).u8(0).pad();}
    streams.forEach(([name,data],i)=>{root.pad();root.patch32(headers[i],root.length);root.bytes(data);});return root.finish();
  }
}
export function readMetadata(bytes) {
  const r=new Reader(bytes);if(r.u32()!==0x424a5342)throw new CilError('Invalid CLI metadata signature');r.u16();r.u16();r.u32();const versionLength=r.u32();if(versionLength>256)throw new CilError('Metadata version string is too long');const version=text(r.take(versionLength)).replace(/\0+$/,'');r.u16();const count=r.u16();if(count>32)throw new CilError('Too many metadata streams');const streams=new Map(),ranges=[];
  for(let i=0;i<count;i++){const offset=r.u32(),size=r.u32();let name='';for(let j=0;j<32;j++){const b=r.u8();if(!b)break;name+=String.fromCharCode(b);if(j===31)throw new CilError('Invalid stream name');}r.position=align(r.position);if(offset+size>bytes.length||streams.has(name))throw new CilError('Invalid or duplicate metadata stream');streams.set(name,bytes.subarray(offset,offset+size));ranges.push([offset,offset+size]);}
  for(let i=0;i<ranges.length;i++){if(ranges[i][0]<r.position)throw new CilError('Metadata stream overlaps its header');for(let j=0;j<i;j++)if(ranges[i][0]<ranges[j][1]&&ranges[j][0]<ranges[i][1])throw new CilError('Overlapping metadata streams');}
  const tableData=readMetadataTables(streams,bytes),{rows}=tableData;
  const strings=streams.get('#Strings')??new Uint8Array([0]),blobs=streams.get('#Blob')??new Uint8Array([0]),us=streams.get('#US')??new Uint8Array([0]);const stringCache=new Map();
  const result={version,streams,...tableData,
    list(owner,column){return metadataList(this,owner,column);},
    guid(index){const data=streams.get('#GUID')??new Uint8Array();if(index===0)return new Uint8Array(16);if(!Number.isInteger(index)||index<1||index*16>data.length)throw new CilError('Invalid GUID heap index');return data.slice((index-1)*16,index*16);},
    row(t){const value=rows[t>>>24]?.[(t&0xffffff)-1];if(!value)throw new CilError(`Invalid metadata token 0x${t.toString(16)}`);return value;},
    string(index){if(stringCache.has(index))return stringCache.get(index);if(index>=strings.length)throw new CilError('Invalid string heap index');let end=index;while(end<strings.length&&strings[end])end++;if(end===strings.length)throw new CilError('Unterminated metadata string');const s=text(strings.subarray(index,end));stringCache.set(index,s);return s;},
    blob(index){if(index>=blobs.length)throw new CilError('Invalid blob heap index');const br=new Reader(blobs,index);return br.take(br.compressed());},
    userString(t){if(t>>>24!==0x70)throw new CilError('Invalid user-string token');const ur=new Reader(us,t&0xffffff),size=ur.compressed();if(size<1||(size&1)!==1)throw new CilError('Invalid UTF-16 user string');const raw=ur.take(size);let s='';for(let i=0;i<size-1;i+=2)s+=String.fromCharCode(raw[i]|(raw[i+1]<<8));return s;},
    typeName(t,depth=0){if(depth>64)throw new CilError('Recursive TypeSpec or nesting limit exceeded');const row=this.row(t);if(t>>>24===27)return readTypeSignature(this.blob(row[0]),this,depth+1);if(t>>>24!==1&&t>>>24!==2)throw new CilError('Unsupported CLI type token');const name=this.string(row[1]),ns=this.string(row[2]);const nested=t>>>24===2?(rows[41]??[]).find(r=>r[0]===(t&0xffffff)):null;if(nested)return this.typeName(token(2,nested[1]),depth+1)+'+'+name;if(t>>>24===1&&decodeCoded('ResolutionScope',row[0])>>>24===1)return this.typeName(decodeCoded('ResolutionScope',row[0]),depth+1)+'+'+name;return ns?ns+'.'+name:name;}
  };return result;
}
const elements={void:0x01,bool:0x02,int:0x08,long:0x0a,double:0x0d,string:0x0e,object:0x1c,nint:0x18,nuint:0x19};
const systemNames={bool:'System.Boolean',int:'System.Int32',long:'System.Int64',double:'System.Double',string:'System.String',object:'System.Object',Exception:'System.Exception',Array:'System.Array'};
export function cliSystemName(type) { return systemNames[type]??type; }
export function signatureType(writer,type,resolveToken) { type=canonicalType(type);const generic=/^(.+`\d+)<(.+)>$/.exec(type);if(generic){const args=generic[2].split(',').map(x=>x.trim());writer.u8(0x15).u8(0x12).compressed(codedIndex('TypeDefOrRef',resolveToken(generic[1]))).compressed(args.length);for(const arg of args)signatureType(writer,arg,resolveToken);return writer;}if(type.endsWith('[]')){writer.u8(0x1d);signatureType(writer,type.slice(0,-2),resolveToken);}else if(type in elements)writer.u8(elements[type]);else writer.u8(['enum','value'].includes(frameworkType(type)?.kind)?0x11:0x12).compressed(codedIndex('TypeDefOrRef',resolveToken(type)));return writer; }
export function methodSignature(result,parameters,isStatic,resolveToken) {const w=new Writer().u8(isStatic?0:0x20).compressed(parameters.length);signatureType(w,result,resolveToken);parameters.forEach(p=>signatureType(w,p,resolveToken));return w.finish();}
export function localSignature(types,resolveToken) {const w=new Writer().u8(0x07).compressed(types.length);types.forEach(t=>signatureType(w,t,resolveToken));return w.finish();}
export function fieldSignature(type,resolveToken) {return signatureType(new Writer().u8(0x06),type,resolveToken).finish();}
// A bounded signature reader for inspection. The executable profiles validate types separately.
const primitiveTypes={1:'void',2:'bool',3:'char',4:'sbyte',5:'byte',6:'short',7:'ushort',8:'int',9:'uint',10:'long',11:'ulong',12:'float',13:'double',14:'string',22:'typedref',24:'nint',25:'nuint',28:'object'};
function signatureReader(bytes,metadata,initialDepth=0) {
  const r=new Reader(bytes);let budget=4096;
  const count=()=>{const n=r.compressed();if(n>65535)throw new CilError('Signature count limit exceeded');return n;};
  function type(depth=initialDepth){
    if(--budget<0||depth>64)throw new CilError('Signature complexity limit exceeded');
    const e=r.u8();if(primitiveTypes[e])return primitiveTypes[e];
    if(e===0x1d)return type(depth+1)+'[]';
    if(e===0x0f||e===0x10)return type(depth+1)+(e===0x0f?'*':'&');
    if(e===0x45)return type(depth+1)+' pinned';
    if(e===0x1f||e===0x20){const modifier=metadata.typeName(decodeCoded('TypeDefOrRef',r.compressed()),depth+1);return type(depth+1)+(e===0x1f?' modreq(':' modopt(')+modifier+')';}
    if(e===0x13||e===0x1e)return (e===0x13?'!':'!!')+count();
    if(e===0x12||e===0x11){const full=metadata.typeName(decodeCoded('TypeDefOrRef',r.compressed()),depth+1);return Object.entries(systemNames).find(([,name])=>name===full)?.[0]??full;}
    if(e===0x15){const base=type(depth+1),n=count();return base+'<'+Array.from({length:n},()=>type(depth+1)).join(', ')+'>';}
    if(e===0x14){const base=type(depth+1),rank=count();if(rank>32)throw new CilError('Array rank limit exceeded');const sizes=Array.from({length:count()},()=>count()),bounds=Array.from({length:count()},()=>r.signedCompressed());if(sizes.length>rank||bounds.length>rank)throw new CilError('Invalid array shape');return base+'['+Array.from({length:rank},(_,i)=>sizes[i]!==undefined?`${bounds[i]??0}...${(bounds[i]??0)+sizes[i]-1}`:bounds[i]!==undefined?`${bounds[i]}...`:'').join(',')+(rank===1&&sizes.length===0&&bounds.length===0?'*':'')+']';}
    if(e===0x1b){const s=method(depth+1);return 'method '+s.returnType+' *('+s.parameters.join(', ')+')';}
    throw new CilError(`Unsupported signature element 0x${e.toString(16)}`);
  }
  function method(depth=initialDepth){
    const header=r.u8(),kind=header&15;if(kind>5&&kind!==8&&kind!==9&&kind!==11)throw new CilError('Invalid method calling convention');
    const genericArity=header&0x10?count():0,n=count(),returnType=type(depth+1),parameters=[];let sentinel=-1;
    for(let i=0;i<n;i++){if(r.bytes[r.position]===0x41){if(sentinel>=0)throw new CilError('Duplicate vararg sentinel');r.u8();sentinel=i;}parameters.push(type(depth+1));}
    const result={kind:kind===8?'property':'method',isStatic:!(header&0x20),returnType,parameters};if(genericArity)result.genericArity=genericArity;if(kind!==0)result.callingConvention=kind;if(sentinel>=0)result.sentinel=sentinel;return result;
  }
  return {r,type,method,count};
}
export function readTypeSignature(bytes,metadata,depth=0){const p=signatureReader(bytes,metadata,depth),result=p.type();if(p.r.position!==p.r.end)throw new CilError('Trailing type signature bytes');return result;}
export function readSignature(bytes,metadata) {
  const p=signatureReader(bytes,metadata),{r}=p,header=r.bytes[r.position];let result;
  if(header===6){r.u8();result={kind:'field',type:p.type()};}
  else if(header===7){r.u8();result={kind:'locals',types:Array.from({length:p.count()},()=>p.type())};}
  else if(header===10){r.u8();result={kind:'methodSpec',arguments:Array.from({length:p.count()},()=>p.type())};}
  else result=p.method();
  if(r.position!==r.end)throw new CilError('Trailing signature bytes');return result;
}
