import { AssemblyInspector, tokenHex, ilLabel } from './inspector.js';
import { parseILInteger as integer } from './il-document-body.js';
import { rebuildILDocument } from './il-document-image.js';
import { stripILComment } from './il-document-strings.js';
import { CilError } from './binary.js';
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
export function assembleILDocument(source,{maxCharacters=128*1024*1024,relaxBranches=false,maxUserStringBytes}={}){
  if(typeof relaxBranches!=='boolean')throw new CilError('Invalid IL branch layout option');
  if(typeof source!=='string'||source.length>maxCharacters)throw new CilError('IL document size limit exceeded');
  let image=null,method=null,assemblySeen=false;const methods=new Map();
  const lines=source.split(/\r?\n/);
  for(let line=0;line<lines.length;line++){
    let s=lines[line].trim();if(!s||s.startsWith('//'))continue;
    try{
      if(s.startsWith('.image ')){if(image||method)throw new CilError('Duplicate or misplaced .image');image=decode64(JSON.parse(s.slice(7)));continue;}
      s=stripILComment(s).trim();
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
  return rebuildILDocument(image,methods,{relaxBranches,maxUserStringBytes});
}
