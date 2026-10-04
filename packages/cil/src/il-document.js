import { AssemblyInspector, tokenHex, ilLabel } from './inspector.js';
import { compileILBody, parseILInteger as integer } from './il-document-body.js';
import { Reader, Writer, CilError, align } from './binary.js';
const encode64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
const decode64=s=>{if(s.length>90_000_000||s.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw new CilError('Invalid or oversized image scaffold');const b=atob(s),bytes=new Uint8Array(b.length);for(let i=0;i<b.length;i++)bytes[i]=b.charCodeAt(i);return bytes;};
/** Lossless editable IL workspace. .image retains metadata/resources, not an executable fallback.
 * The assembler requires and replaces EVERY method body from the visible instruction text.
 * This is a documented SharpForge dialect, not general Microsoft ilasm syntax. */
export function formatILDocument(bytes){
  const inspector=new AssemblyInspector(bytes),a=inspector.summary();
  const lines=['// SharpForge.IL/1 — metadata-preserving IL workspace',
    '// Every method body below is authoritative. Numeric metadata tokens reference .image.',
    '// Editing declarations/signature tokens requires existing compatible metadata.',
    `.image "${encode64(inspector.pe.bytes)}"`,`.assembly ${JSON.stringify(a.name)}`];
  for(const m of a.methods){if(m.error)throw new CilError(`Cannot export method ${tokenHex(m.token)}: ${m.error}`);if(!m.hasBody)continue;
    lines.push('',`// ${m.owner}::${m.name}(${m.signature.parameters.join(', ')}) -> ${m.signature.returnType}`,`.method ${tokenHex(m.token)}`,`{`,`  .maxstack ${m.maxStack}`,`  .locals ${tokenHex(m.localSignature??0)}`,`  .initlocals ${m.initLocals?1:0}`);
    for(const i of m.instructions){const operand=i.operandKind==='token'?tokenHex(i.operand):i.operandKind==='switch'?'('+i.operand.map(ilLabel).join(', ')+')':i.operandKind.startsWith('br')?ilLabel(i.operand):i.operand===undefined?'':String(i.operand);lines.push(`  ${i.label}: ${i.name}${operand?' '+operand:''}${i.operandKind==='token'?' // '+i.operandText:''}`);}
    for(const h of m.handlers)lines.push(`  .eh ${h.flags} ${ilLabel(h.start)} ${ilLabel(h.end)} ${ilLabel(h.target)} ${ilLabel(h.handlerEnd)} ${h.flags===1?ilLabel(h.catchType):tokenHex(h.catchType)}`);
    lines.push('}');
  }
  return lines.join('\n')+'\n';
}
export function assembleILDocument(source,{maxCharacters=128*1024*1024,relaxBranches=false}={}){
  if(typeof relaxBranches!=='boolean')throw new CilError('Invalid IL branch layout option');
  if(typeof source!=='string'||source.length>maxCharacters)throw new CilError('IL document size limit exceeded');
  let image=null,method=null,assemblySeen=false;const methods=new Map();
  const lines=source.split(/\r?\n/);
  for(let line=0;line<lines.length;line++){
    let s=lines[line].trim();if(!s||s.startsWith('//'))continue;
    try{
      if(s.startsWith('.image ')){if(image||method)throw new CilError('Duplicate or misplaced .image');image=decode64(JSON.parse(s.slice(7)));continue;}
      s=s.replace(/\s*\/\/.*$/,'').trim();
      if(s.startsWith('.assembly ')){if(assemblySeen||method)throw new CilError('Duplicate or misplaced .assembly');JSON.parse(s.slice(10));assemblySeen=true;continue;}
      if(s.startsWith('.method ')){if(method)throw new CilError('Nested .method');const token=integer(s.slice(8),0x06000001,0x06ffffff);if(methods.has(token))throw new CilError('Duplicate .method');method={token,instructions:[],handlers:[],directives:new Set(),opened:false};methods.set(token,method);continue;}
      if(s==='{'){if(!method||method.opened)throw new CilError('Unexpected {');method.opened=true;continue;}
      if(s==='}'){if(!method?.opened)throw new CilError('Unexpected }');if(method.directives.size!==3)throw new CilError('Each method requires .maxstack, .locals and .initlocals');method=null;continue;}
      if(!method?.opened)throw new CilError('Instruction outside .method');
      if(s.startsWith('.')){
        const [directive,...parts]=s.split(/\s+/);
        if(directive==='.eh'){if(parts.length!==6)throw new CilError('Invalid .eh directive');const flags=integer(parts[0],0,4);if(![0,1,2,4].includes(flags))throw new CilError('Invalid exception flags');method.handlers.push({flags,start:parts[1],end:parts[2],target:parts[3],handlerEnd:parts[4],catchType:parts[5]});continue;}
        if(parts.length!==1||method.directives.has(directive))throw new CilError('Invalid or duplicate method directive');
        if(directive==='.maxstack')method.maxStack=integer(parts[0],0,65535);else if(directive==='.locals')method.localSignature=integer(parts[0],0,0x11ffffff);else if(directive==='.initlocals')method.initLocals=!!integer(parts[0],0,1);else throw new CilError(`Unknown directive ${directive}`);method.directives.add(directive);continue;
      }
      const match=s.match(/^(IL_[0-9a-f]+):\s*([a-z0-9.]+)(?:\s+(.*))?$/i);if(!match)throw new CilError('Expected IL_label: opcode operand');method.instructions.push({label:match[1],name:match[2],operand:match[3]??''});
    }catch(error){throw new CilError(`IL line ${line+1}: ${error.message}`);}
  }
  if(method||!image||!assemblySeen)throw new CilError('Incomplete IL document');
  const inspector=new AssemblyInspector(image),pe=inspector.pe,md=inspector.metadata;
  if(!(pe.flags&1)||pe.flags&0x10)throw new CilError('Only IL-only managed images can be rebuilt');
  const expected=[...inspector.methods.values()].filter(m=>m.hasBody);
  if(methods.size!==expected.length||expected.some(m=>!methods.has(m.token)))throw new CilError('All original method bodies must be supplied exactly once; no embedded-code fallback is allowed');
  const section=[...pe.sections].sort((a,b)=>b.offset-a.offset)[0];if(pe.sections.some(s=>s!==section&&s.rva>=section.rva))throw new CilError('Unsupported PE section ordering for rewriting');
  const data=new Writer(image.length+4096).bytes(image).pad(4),patches=[];
  for(const m of expected){
    const body=methods.get(m.token);
    body.originalSize=inspector.getMethod(m.token).codeSize;
    if(body.localSignature&&body.localSignature>>>24!==17)throw new CilError('Expected StandAloneSig locals token');
    if(body.localSignature&&inspector.signature(body.localSignature).kind!=='locals')throw new CilError('Invalid locals signature');
    data.pad(4);
    patches.push([md.rowOffsets[6][(m.token&0xffffff)-1],section.rva+data.length-section.offset]);
    data.bytes(compileILBody(body,{relaxBranches}));
  }
  const fileAlignment=new DataView(image.buffer,image.byteOffset,image.byteLength).getUint32(pe.optionalStart+36,true),sectionAlignment=new DataView(image.buffer,image.byteOffset,image.byteLength).getUint32(pe.optionalStart+32,true);
  if(!fileAlignment||!sectionAlignment||fileAlignment>65536||sectionAlignment>1048576)throw new CilError('Unsupported PE alignment');
  const virtualSize=data.length-section.offset;data.pad(fileAlignment);const output=data.finish(),view=new DataView(output.buffer);
  view.setUint32(section.headerOffset+8,virtualSize,true);view.setUint32(section.headerOffset+16,output.length-section.offset,true);view.setUint32(section.headerOffset+36,view.getUint32(section.headerOffset+36,true)|0x60000020,true);
  view.setUint32(pe.optionalStart+56,align(section.rva+virtualSize,sectionAlignment),true);view.setUint32(pe.optionalStart+4,view.getUint32(pe.optionalStart+4,true)+output.length-image.length,true);view.setUint32(pe.optionalStart+64,0,true);
  for(const [offset,rva]of patches)view.setUint32(pe.metadataOffset+md.tableOffset+offset,rva,true);
  // Old custom debug maps and signatures do not describe the rewritten bodies.
  const r=new Reader(output,pe.metadataOffset);r.take(12);const versionLength=r.u32();r.take(versionLength);r.u16();const count=r.u16();
  for(let i=0;i<count;i++){r.u32();r.u32();const at=r.position;let name='';for(let c;(c=r.u8());)name+=String.fromCharCode(c);r.position=align(r.position);if(name==='#SF'){output[at+1]=0x49;output[at+2]=0x4c;}}
  const directory=pe.optionalStart+(pe.magic===0x10b?96:112),cliRva=view.getUint32(directory+14*8,true),cli=pe.offsetOf(cliRva,72);view.setUint32(cli+16,pe.flags&~8,true);
  const signatureRva=view.getUint32(cli+32,true),signatureSize=view.getUint32(cli+36,true);if(signatureRva&&signatureSize){const at=pe.offsetOf(signatureRva,signatureSize);output.fill(0,at,at+signatureSize);}view.setUint32(cli+32,0,true);view.setUint32(cli+36,0,true);
  // Authenticode certificates cannot authenticate a modified PE.
  view.setUint32(directory+4*8,0,true);view.setUint32(directory+4*8+4,0,true);
  const check=new AssemblyInspector(output);for(const m of expected)check.getMethod(m.token);
  return {bytes:output,methods:expected.length,format:'ECMA-335 PE/CLI',profile:'SharpForge.ManagedIL/1',warnings:['Rewritten assemblies are unsigned. #SF debug maps were invalidated. Metadata and resources were preserved; method bodies came only from IL text.']};
}
