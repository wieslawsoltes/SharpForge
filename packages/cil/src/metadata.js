import { encodeTypeSignature } from './metadata/signature-writer.js';
import { parseSignatureType } from './metadata/signature-parser.js';
import { readTypeSignature } from './metadata/signature-members.js';
import {canonicalType} from '@sharpforge/framework';
import { Writer, Reader, CilError, align, utf8, text, buildId } from './binary.js';
/** ECMA-335 II.22 tables and II.24 heaps. Table/index widths are computed, never fixed. */
import { metadataSchemas as schemas } from './metadata/tables.js';
import { codedIndex, decodeCoded, token, metadataIndexWidth } from './metadata/indices.js';
export { Tables, TableId, tableDefinitions, metadataSchemas } from './metadata/tables.js';
export { metadataCodedIndices, codedIndex, decodeCoded, token, metadataIndexWidth } from './metadata/indices.js';
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
  typeRef(fullName,assembly) { const canonical=fullName.includes('<')?fullName:canonicalType(fullName);if(canonical!==fullName)fullName=canonical;const generic=fullName.endsWith('>')&&fullName.indexOf('<')>0;if(generic){const key='typespec:'+fullName;if(this.typeRefs.has(key))return this.typeRefs.get(key);const token=this.typeSpec(parseSignatureType(fullName,t=>this.typeRef(t)));this.typeRefs.set(key,token);return token;}assembly??=fullName.startsWith('Microsoft.UI.')||fullName.startsWith('Windows.UI.')?'SharpForge.WinUI':fullName.startsWith('SharpForge.Runtime.')?'SharpForge.Runtime':this.framework==='mscorlib4'?'mscorlib':fullName==='System.Console'?'System.Console':fullName==='System.Diagnostics.Debug'?'System.Diagnostics.Debug':'System.Runtime';const key=assembly+':'+fullName;if(this.typeRefs.has(key))return this.typeRefs.get(key);const split=fullName.lastIndexOf('.'),ns=split<0?'':fullName.slice(0,split),name=fullName.slice(split+1);const t=this.add(1,[codedIndex('ResolutionScope',this.assemblyRef(assembly)),this.string(name),this.string(ns)]);this.typeRefs.set(key,t);return t; }
  /** Intern a TypeSpec by encoded bytes, independent of spelling or object identity. */
  typeSpec(type) {
    const blob = this.blob(encodeTypeSignature(type));
    this.typeSpecs ??= new Map();
    if (!this.typeSpecs.has(blob)) this.typeSpecs.set(blob, this.add(27, [blob]));
    return this.typeSpecs.get(blob);
  }
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
export {
  cliSystemName, signatureType, methodSignature, propertySignature, localSignature, fieldSignature,
  methodSpecSignature, readTypeSignature, readSignature,
} from './metadata/signature-members.js';
export { decodeSignature, decodeTypeSignature } from './metadata/signatures.js';
export { encodeSignature, encodeTypeSignature } from './metadata/signature-writer.js';
export { parseSignatureType } from './metadata/signature-parser.js';
export { formatSignature, formatSignatureType } from './metadata/signature-format.js';
