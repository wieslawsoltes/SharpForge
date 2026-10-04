import { writeAssemblyReference } from './metadata/assembly-references.js';
import { initializeMetadataBuilder } from './metadata/builder-state.js';
import { encodeTypeSignature } from './metadata/signature-writer.js';
import { parseSignatureType } from './metadata/signature-parser.js';
import { MetadataTypeNames } from './metadata/type-names.js';
import {canonicalType} from '@sharpforge/framework';

export { validateMetadata, metadataDiagnosticCatalog } from './metadata/validate.js';
import { readMetadataTables, writeMetadataTables } from './metadata/table-stream.js';
import { metadataList } from './metadata/pointer-tables.js';
import { sortMetadataRows } from './metadata/sorting.js';
export { metadataSortedMask } from './metadata/sorting.js';
import { Writer, Reader, CilError, align, utf8, text, buildId } from './binary.js';
/** ECMA-335 II.22 tables and II.24 heaps. Table/index widths are computed, never fixed. */
import { writeMetadataRow } from './metadata/row-writer.js';
export * from './metadata/rows-definitions.js';
import { codedIndex, decodeCoded, token } from './metadata/indices.js';
export { Tables, TableId, tableDefinitions, metadataSchemas } from './metadata/tables.js';
export { metadataCodedIndices, codedIndex, decodeCoded, token, metadataIndexWidth } from './metadata/indices.js';
export class MetadataBuilder {
  constructor(name='Application', options={}) { initializeMetadataBuilder(this,name,options); }
  add(table,row) { const rows=this.rows[table]??=[];rows.push(row);return token(table,rows.length); }
  addRow(table,values) { return writeMetadataRow(this,table,values); }
  string(value) { return this.heaps.string(value); }
  blob(bytes) { return this.heaps.blob(bytes); }
  guid(bytes) { return this.heaps.guid(bytes); }
  userString(value) { return this.heaps.userString(value); }
  assemblyRef(name) { return writeAssemblyReference(this,name); }
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
  const typeNames=new MetadataTypeNames();
  const result={version,streams,...tableData,
    list(owner,column){return metadataList(this,owner,column);},
    guid(index){const data=streams.get('#GUID')??new Uint8Array();if(index===0)return new Uint8Array(16);if(!Number.isInteger(index)||index<1||index*16>data.length)throw new CilError('Invalid GUID heap index');return new Uint8Array(data.subarray((index-1)*16,index*16));},
    row(t){const value=rows[t>>>24]?.[(t&0xffffff)-1];if(!value)throw new CilError(`Invalid metadata token 0x${t.toString(16)}`);return value;},
    string(index){if(stringCache.has(index))return stringCache.get(index);if(index>=strings.length)throw new CilError('Invalid string heap index');let end=index;while(end<strings.length&&strings[end])end++;if(end===strings.length)throw new CilError('Unterminated metadata string');const s=text(strings.subarray(index,end));stringCache.set(index,s);return s;},
    blob(index){if(index>=blobs.length)throw new CilError('Invalid blob heap index');const br=new Reader(blobs,index);return br.take(br.compressed());},
    userString(t){if(t>>>24!==0x70)throw new CilError('Invalid user-string token');const ur=new Reader(us,t&0xffffff),size=ur.compressed();if(size<1||(size&1)!==1)throw new CilError('Invalid UTF-16 user string');const raw=ur.take(size);let s='';for(let i=0;i<size-1;i+=2)s+=String.fromCharCode(raw[i]|(raw[i+1]<<8));return s;},
    typeName(t,depth=0){return typeNames.read(this,t,depth);}
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
export { encodeCustomAttribute } from './metadata/custom-attributes.js';
export { customAttributeDiagnosticCatalog } from './metadata/custom-attribute-types.js';
export { decodeCustomAttribute } from './metadata/custom-attribute-reader.js';
export { encodeConstant, decodeConstant, constantDiagnosticCatalog } from './metadata/constants.js';
