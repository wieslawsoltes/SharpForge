import { readPE } from './pe.js';
import { assemblySummary } from './browser/summary.js';
import { inspectorCallGraph } from './browser/analyzers-call-graph.js';
import { metadataTokenUri, resolveMetadataUri } from './browser/navigation.js';
import { readSignature, token, decodeCoded } from './metadata.js';
import { decodeInstructions } from './opcodes.js';
import { CilError, Reader, text } from './binary.js';
export const ilLabel = value=>'IL_'+value.toString(16).padStart(4,'0');
export const tokenHex = value=>'0x'+value.toString(16).padStart(8,'0');
/** Lazy, read-only managed PE inspection. Reading an assembly never runs its code. */
export class AssemblyInspector {
  constructor(bytes,options={}) {
    this.pe=readPE(bytes,{...options,inspection:true});this.metadata=this.pe.metadata;
    this.options=options;this.cache=new Map();this.owners=new Map();this.fields=new Map();this.methods=new Map();this.types=[];this.diagnostics=[];
    const md=this.metadata,rows=md.rows[2]??[];this.debug=null;
    try{if(md.streams.has('#SF'))this.debug=JSON.parse(text(md.streams.get('#SF')));}catch{this.diagnostics.push({message:'Malformed optional #SF debug metadata'});}
    for(let i=0;i<rows.length;i++){
      const row=rows[i],t=token(2,i+1),type={token:t,name:md.typeName(t),flags:row[0],baseToken:decodeCoded('TypeDefOrRef',row[3]),fields:[],methods:[],properties:[],events:[],interfaces:[]};this.types.push(type);
      for(const ft of md.list(t,'FieldList')){
        const fr=md.row(ft),field={token:ft,owner:type.name,ownerToken:t,name:md.string(fr[1]),flags:fr[0],isStatic:!!(fr[0]&16),signatureToken:fr[2]};
        this.owners.set(ft,type);this.fields.set(ft,field);type.fields.push(field);
      }
      for(const mt of md.list(t,'MethodList')){
        const mr=md.row(mt),method={token:mt,owner:type.name,ownerToken:t,name:md.string(mr[3]),flags:mr[2],implFlags:mr[1],rva:mr[0],hasBody:mr[0]!==0,isEntryPoint:mt===this.pe.entryPoint};
        this.owners.set(mt,type);this.methods.set(mt,method);type.methods.push(method);
      }
    }
    // Declaration tables remain useful even when no method is executable by this runtime.
    for(const [mapTable,itemTable,key]of [[21,23,'properties'],[18,20,'events']]){
      const maps=md.rows[mapTable]??[];
      maps.forEach((r,i)=>{const owner=this.types[r[0]-1];if(!owner)return;for(const itemToken of md.list(token(mapTable,i+1),mapTable===21?'PropertyList':'EventList')){const item=md.row(itemToken);owner[key].push({token:itemToken,flags:item[0],name:md.string(item[1]),signatureOrType:item[2]});}});
    }
    for(const r of md.rows[9]??[])this.types[r[0]-1]?.interfaces.push(decodeCoded('TypeDefOrRef',r[1]));
  }
  signature(t){const md=this.metadata,r=md.row(t),table=t>>>24;return readSignature(md.blob(r[table===43?1:table===6?4:table===4||table===10||table===23?2:0]),md);}
  resolveToken(t,depth=0){
    if(depth>64)throw new CilError('Metadata token recursion limit exceeded');
    const md=this.metadata,table=t>>>24;
    if(table===0x70)return {kind:'string',value:md.userString(t),token:t};
    const r=md.row(t);
    if(table===1||table===2||table===27)return {kind:'type',name:md.typeName(t),token:t};
    if(table===4){const f=this.fields.get(t);return {...f,kind:'field',signature:this.signature(t)};}
    if(table===6){const m=this.methods.get(t);if(!m)throw new CilError('Orphan MethodDef');return {...m,kind:'method',signature:this.signature(t)};}
    if(table===10){const parent=decodeCoded('MemberRefParent',r[0]),parentTable=parent>>>24,signature=this.signature(t),owner=parentTable===6?this.resolveToken(parent,depth+1).owner:parentTable===26?md.string(md.row(parent)[0]):md.typeName(parent);
      const name=md.string(r[1]),target=parentTable===2?(signature.kind==='field'?this.types[(parent&0xffffff)-1]?.fields:this.types[(parent&0xffffff)-1]?.methods)?.find(x=>x.name===name&&JSON.stringify(this.signature(x.token))===JSON.stringify(signature)):null;
      return {kind:signature.kind,name,owner,ownerToken:parent,token:t,signature,resolvedToken:target?.token};
    }
    if(table===43){const base=decodeCoded('MethodDefOrRef',r[0]),args=this.signature(t).arguments;return {...this.resolveToken(base,depth+1),token:t,genericArguments:args,definitionToken:base};}
    if(table===17)return {kind:'signature',token:t,signature:this.signature(t)};
    return {kind:'metadata',token:t,row:[...r]};
  }
  describeToken(t){
    const d=this.resolveToken(t);
    if(d.kind==='string')return JSON.stringify(d.value);
    if(d.kind==='type')return d.name;
    if(d.kind==='field')return `${d.signature.type} ${d.owner}::${d.name}`;
    if(d.kind==='method')return `${d.signature.isStatic?'':'instance '}${d.signature.returnType} ${d.owner}::${d.name}${d.genericArguments?'<'+d.genericArguments.join(', ')+'>':''}(${d.signature.parameters.join(', ')})`;
    return tokenHex(t);
  }
  getMethod(t){
    if(this.cache.has(t))return this.cache.get(t);
    const definition=this.methods.get(t);if(!definition)throw new CilError('MethodDef not found');
    const md=this.metadata,signature=this.signature(t),parameters=[];
    for(const parameterToken of md.list(t,'ParamList')){const r=md.row(parameterToken);parameters.push({sequence:r[1],name:md.string(r[2]),flags:r[0]});}
    const info=this.debug?.methods?.find(m=>m.token===t),points=new Map((this.debug?.sequencePoints??[]).filter(p=>p.methodToken===t).map(p=>[p.ilOffset,p]));
    let method={...definition,signature,parameters,id:info?.id??null,locals:[],instructions:[],handlers:[],codeSize:0,maxStack:0};
    if(definition.hasBody){
      const body=this.pe.methodBody(t),locals=body.localSignature?this.signature(body.localSignature).types:[];
      const instructions=decodeInstructions(body.code,this.options).map(i=>({...i,label:ilLabel(i.offset),operandText:i.operandKind==='token'?this.describeToken(i.operand):i.operandKind==='switch'?'('+i.operand.map(ilLabel).join(', ')+')':i.operandKind.startsWith('br')?ilLabel(i.operand):i.operand===undefined?'':String(i.operand),point:points.get(i.offset)??null}));
      method={...method,locals,instructions,handlers:body.handlers,maxStack:body.maxStack,codeSize:body.code.length,localSignature:body.localSignature,initLocals:body.initLocals};
    }
    this.cache.set(t,method);return method;
  }
  /** Stable module/token URI without decoding the referenced member. */
  tokenUri(token) {
    return metadataTokenUri(this.metadata, token);
  }
  /** Resolve a URI against this module, returning owned scalar identity facts. */
  resolveUri(uri) {
    return resolveMetadataUri(this.metadata, uri);
  }
  summary(options = {}) {
    return assemblySummary(this, options);
  }
  callGraph() { return inspectorCallGraph(this); }
}
export function inspectAssembly(bytes,options={}){return new AssemblyInspector(bytes,options).summary(options);}
