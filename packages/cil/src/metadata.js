import { writeAssemblyReference } from './metadata/assembly-references.js';
import { initializeMetadataBuilder } from './metadata/builder-state.js';
import { encodeTypeSignature } from './metadata/signature-writer.js';
import { parseSignatureType } from './metadata/signature-parser.js';
export { readMetadata } from './metadata/reader.js';
export { metadataReaderDiagnosticCatalog } from './metadata/reader-budget.js';
import {canonicalType} from '@sharpforge/framework';
export { validateMetadata, metadataDiagnosticCatalog } from './metadata/validate.js';
import { writeMetadataTables } from './metadata/table-stream.js';
import { sortMetadataRows } from './metadata/sorting.js';
export { metadataSortedMask } from './metadata/sorting.js';
import { Writer, CilError, align, utf8, buildId } from './binary.js';
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
