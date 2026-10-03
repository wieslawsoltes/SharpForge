import {frameworkType,canonicalType} from '@sharpforge/framework';
import { Writer, Reader, CilError, align, utf8, text, buildId } from './binary.js';
/** ECMA-335 II.22 tables and II.24 heaps. Table/index widths are computed, never fixed. */
export const Tables = Object.freeze({Module:0,TypeRef:1,TypeDef:2,Field:4,MethodDef:6,Param:8,MemberRef:10,StandAloneSig:17,Assembly:32,AssemblyRef:35});
export const metadataSchemas = {
  0:['u16','str','guid','guid','guid'],1:['ResolutionScope','str','str'],2:['u32','str','str','TypeDefOrRef','t4','t6'],3:['t4'],4:['u16','str','blob'],5:['t6'],6:['u32','u16','u16','str','blob','t8'],7:['t8'],8:['u16','u16','str'],9:['t2','TypeDefOrRef'],10:['MemberRefParent','str','blob'],11:['u16','HasConstant','blob'],12:['HasCustomAttribute','CustomAttributeType','blob'],13:['HasFieldMarshal','blob'],14:['u16','HasDeclSecurity','blob'],15:['u16','u32','t2'],16:['u32','t4'],17:['blob'],18:['t2','t20'],19:['t20'],20:['u16','str','TypeDefOrRef'],21:['t2','t23'],22:['t23'],23:['u16','str','blob'],24:['u16','t6','HasSemantics'],25:['t2','MethodDefOrRef','MethodDefOrRef'],26:['str'],27:['blob'],28:['u16','MemberForwarded','str','t26'],29:['u32','t4'],30:['u32','u32'],31:['u32'],32:['u32','u16','u16','u16','u16','u32','blob','str','str'],33:['u32'],34:['u32','u32','u32'],35:['u16','u16','u16','u16','u32','blob','str','str','blob'],36:['u32','t35'],37:['u32','u32','u32','t35'],38:['u32','str','blob'],39:['u32','u32','str','str','Implementation'],40:['u32','u32','str','Implementation'],41:['t2','t2'],42:['u16','u16','TypeOrMethodDef','str'],43:['MethodDefOrRef','blob'],44:['t42','TypeDefOrRef'],48:['blob','guid','blob','guid'],49:['t48','blob'],50:['t6','t53','t51','t52','u32','u32'],51:['u16','u16','str'],52:['str','blob'],53:['t53','blob'],54:['t6','t6'],55:['HasCustomDebugInformation','guid','blob']
};
const schemas=metadataSchemas;
export const metadataCodedIndices = {
  ResolutionScope:[2,[0,26,35,1]],TypeDefOrRef:[2,[2,1,27]],MemberRefParent:[3,[2,1,26,6,27]],HasConstant:[2,[4,8,23]],HasCustomAttribute:[5,[6,4,1,2,8,9,10,0,14,23,20,17,26,27,32,35,38,39,40,42,44,43]],CustomAttributeType:[3,[null,null,6,10,null]],HasFieldMarshal:[1,[4,8]],HasDeclSecurity:[2,[2,6,32]],HasSemantics:[1,[20,23]],MethodDefOrRef:[1,[6,10]],MemberForwarded:[1,[4,6]],Implementation:[2,[38,35,39]],TypeOrMethodDef:[1,[2,6]],HasCustomDebugInformation:[5,[6,4,1,2,8,9,10,0,14,23,20,17,26,27,32,35,38,39,40,42,44,43,48,50,51,52,53]]
};
const coded=metadataCodedIndices;
export function token(table, row) { return (table * 0x1000000 + row) >>> 0; }
export function codedIndex(kind, metadataToken) { if (!metadataToken) return 0; const [bits,tables] = coded[kind], table = metadataToken >>> 24, tag = tables.indexOf(table); if (tag < 0) throw new CilError(`Token cannot be encoded as ${kind}`); return ((metadataToken & 0xffffff) << bits) | tag; }
export function decodeCoded(kind, value) { if (!value) return 0; const [bits,tables] = coded[kind],table=tables[value & ((1<<bits)-1)]; if (table === undefined || table === null) throw new CilError(`Invalid ${kind} tag`); return token(table,value>>>bits); }
export function metadataIndexWidth(kind, counts, heaps) { if (kind==='u16') return 2; if(kind==='u32')return 4; if(kind==='str')return heaps&1?4:2;if(kind==='guid')return heaps&2?4:2;if(kind==='blob')return heaps&4?4:2;if(/^t\d+$/.test(kind))return (counts[+kind.slice(1)]??0)<65536?2:4;const [bits,refs]=coded[kind];return Math.max(...refs.map(t=>counts[t]??0))<(1<<(16-bits))?2:4; }
export class MetadataBuilder {
  constructor(name='Application', {framework='net8'}={}) {
    this.name=name;this.framework=framework;this.rows={};this.strings=new Writer().u8(0);this.blobs=new Writer().u8(0);this.userStrings=new Writer().u8(0);this.stringMap=new Map([['',0]]);this.blobMap=new Map();this.userStringMap=new Map();this.typeRefs=new Map();this.members=new Map();this.assemblyRefs=new Map();
    this.add(0,[0,this.string(name+'.dll'),1,0,0]);this.add(32,[0x8004,0,2,0,0,0,0,this.string(name),0]);
  }
  add(table,row) { const rows=this.rows[table]??=[];rows.push(row);return token(table,rows.length); }
  string(value) { value=String(value);if(value.includes('\0'))throw new CilError('Metadata identifiers cannot contain NUL');if(this.stringMap.has(value))return this.stringMap.get(value);const at=this.strings.length;this.strings.bytes(utf8(value)).u8(0);this.stringMap.set(value,at);return at; }
  blob(bytes) { const key=Array.from(bytes).join(',');if(this.blobMap.has(key))return this.blobMap.get(key);const at=this.blobs.length;this.blobs.compressed(bytes.length).bytes(bytes);this.blobMap.set(key,at);return at; }
  userString(value) { if(this.userStringMap.has(value))return this.userStringMap.get(value);const at=this.userStrings.length,w=new Writer();let special=0;for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);w.u16(c);if(c>0xff||(c>=1&&c<=8)||(c>=14&&c<=31)||c===39||c===45||c===127)special=1;}w.u8(special);this.userStrings.compressed(w.length).bytes(w.finish());if(at>0xffffff)throw new CilError('User-string heap exceeds CLI token range');this.userStringMap.set(value,at);return at; }
  assemblyRef(name) { if(this.assemblyRefs.has(name))return this.assemblyRefs.get(name);const custom=name==='SharpForge.WinUI'||name==='SharpForge.Runtime';const legacy=this.framework==='mscorlib4';const publicKey=legacy?[0xb7,0x7a,0x5c,0x56,0x19,0x34,0xe0,0x89]:[0xb0,0x3f,0x5f,0x7f,0x11,0xd5,0x0a,0x3a];const t=this.add(35,[custom?0:legacy?4:8,custom?10:0,0,0,0,custom?0:this.blob(Uint8Array.from(publicKey)),this.string(name),0,0]);this.assemblyRefs.set(name,t);return t; }
  typeRef(fullName,assembly) { const canonical=canonicalType(fullName);if(canonical!==fullName)fullName=canonical;const generic=/^(.+`\d+)<(.+)>$/.exec(fullName);if(generic){const key='typespec:'+fullName;if(this.typeRefs.has(key))return this.typeRefs.get(key);const data=signatureType(new Writer(),fullName,t=>this.typeRef(t));const token=this.add(27,[this.blob(data.finish())]);this.typeRefs.set(key,token);return token;}assembly??=fullName.startsWith('Microsoft.UI.')||fullName.startsWith('Windows.UI.')?'SharpForge.WinUI':fullName.startsWith('SharpForge.Runtime.')?'SharpForge.Runtime':this.framework==='mscorlib4'?'mscorlib':fullName==='System.Console'?'System.Console':fullName==='System.Diagnostics.Debug'?'System.Diagnostics.Debug':'System.Runtime';const key=assembly+':'+fullName;if(this.typeRefs.has(key))return this.typeRefs.get(key);const split=fullName.lastIndexOf('.'),ns=split<0?'':fullName.slice(0,split),name=fullName.slice(split+1);const t=this.add(1,[codedIndex('ResolutionScope',this.assemblyRef(assembly)),this.string(name),this.string(ns)]);this.typeRefs.set(key,t);return t; }
  member(owner,name,signature) { const key=`${owner}:${name}:${Array.from(signature)}`;if(this.members.has(key))return this.members.get(key);const t=this.add(10,[codedIndex('MemberRefParent',owner),this.string(name),this.blob(signature)]);this.members.set(key,t);return t; }
  finish(debug,identityBytes) {
    const counts=Object.fromEntries(Object.entries(this.rows).map(([t,r])=>[t,r.length]));const heapFlags=(this.strings.length>=65536?1:0)|(this.blobs.length>=65536?4:0);const tables=new Writer().u32(0).u8(2).u8(0).u8(heapFlags).u8(1);let low=0,high=0;for(const id of Object.keys(this.rows).map(Number)){if(id<32)low|=1<<id;else high|=1<<(id-32);}tables.u32(low).u32(high).u32(0).u32(0);
    for(let i=0;i<64;i++)if(counts[i])tables.u32(counts[i]);for(let i=0;i<64;i++)for(const row of this.rows[i]??[]){const schema=schemas[i];if(!schema||schema.length!==row.length)throw new CilError('Invalid metadata table row');row.forEach((value,j)=>metadataIndexWidth(schema[j],counts,heapFlags)===2?tables.u16(value):tables.u32(value));}
    const streams=[['#~',tables.finish()],['#Strings',this.strings.finish()],['#US',this.userStrings.finish()],['#GUID',buildId(identityBytes)],['#Blob',this.blobs.finish()]];if(debug)streams.push(['#SF',utf8(JSON.stringify(debug))]);
    const version=utf8('v4.0.30319\0'),root=new Writer().u32(0x424a5342).u16(1).u16(1).u32(0).u32(align(version.length)).bytes(version).pad().u16(0).u16(streams.length);const headers=[];
    for(const [name,data]of streams){headers.push(root.length);root.u32(0).u32(data.length).bytes(utf8(name)).u8(0).pad();}
    streams.forEach(([name,data],i)=>{root.pad();root.patch32(headers[i],root.length);root.bytes(data);});return root.finish();
  }
}
export function readMetadata(bytes) {
  const r=new Reader(bytes);if(r.u32()!==0x424a5342)throw new CilError('Invalid CLI metadata signature');r.u16();r.u16();r.u32();const versionLength=r.u32();if(versionLength>256)throw new CilError('Metadata version string is too long');const version=text(r.take(versionLength)).replace(/\0+$/,'');r.u16();const count=r.u16();if(count>32)throw new CilError('Too many metadata streams');const streams=new Map(),ranges=[];
  for(let i=0;i<count;i++){const offset=r.u32(),size=r.u32();let name='';for(let j=0;j<32;j++){const b=r.u8();if(!b)break;name+=String.fromCharCode(b);if(j===31)throw new CilError('Invalid stream name');}r.position=align(r.position);if(offset+size>bytes.length||streams.has(name))throw new CilError('Invalid or duplicate metadata stream');streams.set(name,bytes.subarray(offset,offset+size));ranges.push([offset,offset+size]);}
  for(let i=0;i<ranges.length;i++){if(ranges[i][0]<r.position)throw new CilError('Metadata stream overlaps its header');for(let j=0;j<i;j++)if(ranges[i][0]<ranges[j][1]&&ranges[j][0]<ranges[i][1])throw new CilError('Overlapping metadata streams');}
  const tableBytes=streams.get('#~')??streams.get('#-');if(!tableBytes)throw new CilError('Missing metadata tables');const tr=new Reader(tableBytes);tr.u32();const major=tr.u8();tr.u8();const heaps=tr.u8();tr.u8();if(major!==2)throw new CilError('Unsupported metadata table version');const low=tr.u32(),high=tr.u32();tr.u32();tr.u32();const counts={},rows={},rowOffsets={};let total=0;
  for(let i=0;i<64;i++)if((i<32?low>>>(i):high>>>(i-32))&1){if(!schemas[i])throw new CilError(`Unsupported metadata table ${i}`);counts[i]=tr.u32();total+=counts[i];if(total>1_000_000)throw new CilError('Metadata row limit exceeded');}
  const externalCounts={};const pdbStream=streams.get('#Pdb');if(pdbStream){const pr=new Reader(pdbStream);pr.take(24);const lo=pr.u32(),hi=pr.u32();for(let t=0;t<64;t++)if((t<32?lo>>>t:hi>>>(t-32))&1){externalCounts[t]=pr.u32();if(externalCounts[t]>0xffffff)throw new CilError('Invalid external PDB row count');}if(pr.position!==pr.end)throw new CilError('Trailing #Pdb bytes');}
  const indexCounts={...externalCounts,...counts};
  for(let i=0;i<64;i++){if(!counts[i])continue;rows[i]=[];rowOffsets[i]=[];for(let n=0;n<counts[i];n++){rowOffsets[i].push(tr.position);rows[i].push(schemas[i].map(kind=>metadataIndexWidth(kind,indexCounts,heaps)===2?tr.u16():tr.u32()));}}
  const strings=streams.get('#Strings')??new Uint8Array([0]),blobs=streams.get('#Blob')??new Uint8Array([0]),us=streams.get('#US')??new Uint8Array([0]);const stringCache=new Map();
  const result={version,streams,counts,externalCounts,rows,rowOffsets,tableOffset:tableBytes.byteOffset-bytes.byteOffset,
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
