import { readPE } from './pe.js';
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
      for(let f=row[4];f<(rows[i+1]?.[4]??(md.counts[4]??0)+1);f++){
        const ft=token(4,f),fr=md.row(ft),field={token:ft,owner:type.name,ownerToken:t,name:md.string(fr[1]),flags:fr[0],isStatic:!!(fr[0]&16),signatureToken:fr[2]};
        this.owners.set(ft,type);this.fields.set(ft,field);type.fields.push(field);
      }
      for(let m=row[5];m<(rows[i+1]?.[5]??(md.counts[6]??0)+1);m++){
        const mt=token(6,m),mr=md.row(mt),method={token:mt,owner:type.name,ownerToken:t,name:md.string(mr[3]),flags:mr[2],implFlags:mr[1],rva:mr[0],hasBody:mr[0]!==0,isEntryPoint:mt===this.pe.entryPoint};
        this.owners.set(mt,type);this.methods.set(mt,method);type.methods.push(method);
      }
    }
    // Declaration tables remain useful even when no method is executable by this runtime.
    for(const [mapTable,itemTable,key]of [[21,23,'properties'],[18,20,'events']]){
      const maps=md.rows[mapTable]??[];
      maps.forEach((r,i)=>{const owner=this.types[r[0]-1];if(!owner)return;for(let j=r[1];j<(maps[i+1]?.[1]??(md.counts[itemTable]??0)+1);j++){const item=md.row(token(itemTable,j));owner[key].push({token:token(itemTable,j),flags:item[0],name:md.string(item[1]),signatureOrType:item[2]});}});
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
    const md=this.metadata,signature=this.signature(t),row=md.row(t),next=md.rows[6]?.[(t&0xffffff)],parameters=[];
    for(let p=row[5];p<(next?.[5]??(md.counts[8]??0)+1);p++){const r=md.row(token(8,p));parameters.push({sequence:r[1],name:md.string(r[2]),flags:r[0]});}
    const info=this.debug?.methods?.find(m=>m.token===t),points=new Map((this.debug?.sequencePoints??[]).filter(p=>p.methodToken===t).map(p=>[p.ilOffset,p]));
    let method={...definition,signature,parameters,id:info?.id??null,locals:[],instructions:[],handlers:[],codeSize:0,maxStack:0};
    if(definition.hasBody){
      const body=this.pe.methodBody(t),locals=body.localSignature?this.signature(body.localSignature).types:[];
      const instructions=decodeInstructions(body.code,this.options).map(i=>({...i,label:ilLabel(i.offset),operandText:i.operandKind==='token'?this.describeToken(i.operand):i.operandKind==='switch'?'('+i.operand.map(ilLabel).join(', ')+')':i.operandKind.startsWith('br')?ilLabel(i.operand):i.operand===undefined?'':String(i.operand),point:points.get(i.offset)??null}));
      method={...method,locals,instructions,handlers:body.handlers,maxStack:body.maxStack,codeSize:body.code.length,localSignature:body.localSignature,initLocals:body.initLocals};
    }
    this.cache.set(t,method);return method;
  }
  summary({includeMethods=true}={}){
    const md=this.metadata,row=md.rows[32]?.[0],name=row?md.string(row[7]):md.string(md.rows[0]?.[0]?.[1]??0),methods=[];
    for(const m of this.methods.values()){
      if(!includeMethods){methods.push({...m});continue;}
      try{methods.push(this.getMethod(m.token));}catch(error){methods.push({...m,error:error.message,instructions:[],locals:[],handlers:[],codeSize:0});}
    }
    return {name,version:row?row.slice(1,5).join('.'):null,entryPoint:this.pe.entryPoint,bytes:this.pe.bytes.length,format:'ECMA-335 PE/CLI',profile:this.debug?.format??null,
      machine:this.pe.machine,cliFlags:this.pe.flags,streams:[...md.streams].map(([name,bytes])=>({name,bytes:bytes.length})),tables:{...md.counts},
      references:(md.rows[35]??[]).map(r=>({name:md.string(r[6]),version:r.slice(0,4).join('.')})),
      resources:(md.rows[40]??[]).map(r=>({offset:r[0],flags:r[1],name:md.string(r[2]),implementation:decodeCoded('Implementation',r[3])})),
      customAttributes:(md.rows[12]??[]).map(r=>({parent:decodeCoded('HasCustomAttribute',r[0]),constructor:decodeCoded('CustomAttributeType',r[1]),blobBytes:md.blob(r[2]).length})),
      genericParameters:(md.rows[42]??[]).map(r=>({index:r[0],flags:r[1],owner:decodeCoded('TypeOrMethodDef',r[2]),name:md.string(r[3])})),
      types:this.types.map(t=>({...t,methods:t.methods.map(m=>m.token),fields:t.fields.map(f=>{try{return {...f,type:this.signature(f.token).type};}catch(error){return {...f,error:error.message};}})})),methods,diagnostics:[...this.diagnostics]};
  }
  callGraph(){const edges=[];for(const m of this.methods.values()){try{for(const i of this.getMethod(m.token).instructions)if(['call','callvirt','newobj','ldftn','ldvirtftn','jmp'].includes(i.name))edges.push({caller:m.token,callee:i.operand,offset:i.offset,kind:i.name});}catch(error){edges.push({caller:m.token,error:error.message});}}return edges;}
}
export function inspectAssembly(bytes,options={}){return new AssemblyInspector(bytes,options).summary(options);}
