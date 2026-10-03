import { AssemblyInspector, ilLabel, tokenHex } from './inspector.js';
import { formatAssembly } from './disassembler.js';
const identifier=s=>{s=s.replace(/[^\p{L}\p{N}_]/gu,'_');return /^\p{N}/u.test(s)?'_'+s:s;};
const numericTypes=new Set(['int','uint','long','ulong','short','ushort','byte','sbyte','nint','nuint','double','float','char']);
const typeName=s=>({"System.Int32":"int","System.Int64":"long","System.Boolean":"bool","System.Double":"double","System.Single":"float","System.String":"string","System.Object":"object","System.Char":"char"}[s]??s.replaceAll('+','.'));
/** Conservative stack-to-expression decompilation. Unsupported/control-flow stack merges return
 * complete method IL with explicit diagnostics, NEVER misleading empty C# method stubs. */
export function decompileMethod(input,methodToken){
  const inspector=input instanceof AssemblyInspector?input:new AssemblyInspector(input),m=inspector.getMethod(methodToken),diagnostics=[];
  const fallback=message=>({token:m.token,name:m.owner+'::'+m.name,language:'cil',complete:false,diagnostics:[...diagnostics,{code:'DECOMPILER_FALLBACK',message}],source:formatAssembly(inspector.pe.bytes,{methodToken:m.token})});
  if(!m.hasBody)return {token:m.token,name:m.owner+'::'+m.name,language:'csharp',complete:false,diagnostics:[{code:'NO_IL_BODY',message:'Abstract, native or runtime-supplied method has no CIL body'}],source:`// No IL body: ${inspector.describeToken(m.token)}`};
  if(m.handlers.length)return fallback('Exception-region structuring is not implemented; complete IL is shown.');
  if(m.signature.genericArity||[m.signature.returnType,...m.signature.parameters,...m.locals].some(t=>/[!*]|`[0-9]/.test(t)))return fallback('Generic and pointer signatures are preserved as IL.');
  const stack=[],statements=[],targets=new Set(m.instructions.flatMap(i=>i.operandKind==='switch'?i.operand:i.operandKind.startsWith('br')?[i.operand]:[]));let temp=0,reachable=true;
  const pop=()=>{if(!stack.length)throw new Error('Control-flow stack merge requires SSA reconstruction');return stack.pop();};
  const push=(text,type='int')=>stack.push({text,type});
  const coerce=(v,type)=>v.type===type?v.text:type==='bool'&&numericTypes.has(v.type)?`(${v.text} != 0)`:v.type==='bool'&&numericTypes.has(type)?`(${v.text} ? 1 : 0)`:v.text;
  const truth=v=>v.type==='bool'?v.text:`(${v.text} != ${numericTypes.has(v.type)?'0':'null'})`;
  const arg=(index)=>!m.signature.isStatic&&index===0?{text:'this',type:m.owner}:{text:'arg'+(index-(m.signature.isStatic?0:1)),type:m.signature.parameters[index-(m.signature.isStatic?0:1)]};
  const emit=s=>statements.push('    '+s);
  const capture=(text,type='int')=>{const name='stack'+temp++;emit(`${typeName(type)} ${name} = ${text};`);push(name,type);};
  try{
    for(const i of m.instructions){
      const n=i.name,a=i.operand;if(targets.has(i.offset)){if(stack.length)throw new Error('Non-empty evaluation stack at a branch target');statements.push(`  ${i.label}:`);reachable=true;}
      if(!reachable)continue;
      if(n==='nop'||n==='break')continue;
      if(n==='ldnull'){push('null','object');continue;}
      if(n==='ldstr'){push(JSON.stringify(inspector.metadata.userString(a)),'string');continue;}
      if(n.startsWith('ldc.')){if(n==='ldc.i8'){push(a.toString()+'L','long');continue;}if(n==='ldc.r4'||n==='ldc.r8'){const type=n==='ldc.r4'?'float':'double',suffix=type==='float'?'f':'d';push(Number.isNaN(a)?`${type}.NaN`:a===Infinity?`${type}.PositiveInfinity`:a===-Infinity?`${type}.NegativeInfinity`:(Object.is(a,-0)?'-0':String(a))+suffix,type);continue;}push(String(n==='ldc.i4.m1'?-1:a??Number(n.slice(7))));continue;}
      if(/^ldarg(\.|$)/.test(n)){const v=arg(a??Number(n.split('.').at(-1)));capture(v.text,v.type);continue;}
      if(/^starg(\.|$)/.test(n)){const v=arg(a??Number(n.split('.').at(-1)));emit(`${v.text} = ${coerce(pop(),v.type)};`);continue;}
      if(/^ldloc(\.|$)/.test(n)){const index=a??Number(n.split('.').at(-1));capture('v'+index,m.locals[index]);continue;}
      if(/^stloc(\.|$)/.test(n)){const index=a??Number(n.split('.').at(-1));emit(`v${index} = ${coerce(pop(),m.locals[index])};`);continue;}
      if(n==='dup'){const v=pop(),name='stack'+temp++;emit(`${typeName(v.type)} ${name} = ${v.text};`);push(name,v.type);push(name,v.type);continue;}
      if(n==='pop'){const v=pop();emit(`_ = ${v.text};`);continue;}
      if(['call','callvirt','newobj'].includes(n)){
        const d=inspector.resolveToken(a);if(/[^A-Za-z0-9_.+]/.test(d.owner))throw new Error('Compiler-generated owner name requires IL fallback');if(d.genericArguments||d.name==='.ctor'&&n!=='newobj')throw new Error('Constructor-chain or generic call reconstruction requires IL fallback');
        const args=d.signature.parameters.map(()=>pop()).reverse().map((v,i)=>coerce(v,d.signature.parameters[i])),receiver=n==='newobj'||d.signature.isStatic?null:pop();
        let expr=n==='newobj'?`new ${typeName(d.owner)}(${args.join(', ')})`:`${receiver?'('+receiver.text+')':typeName(d.owner)}.${identifier(d.name)}(${args.join(', ')})`;
        if(receiver&&d.name==='get_Length'&&!args.length)expr=`(${receiver.text}).Length`;
        const result=n==='newobj'?d.owner:d.signature.returnType;if(result==='void')emit(expr+';');else{const name='stack'+temp++;emit(`${typeName(result)} ${name} = ${expr};`);push(name,result);}continue;
      }
      if(['ldfld','ldsfld','stfld','stsfld'].includes(n)){const d=inspector.resolveToken(a),v=n.startsWith('st')?pop():null,receiver=n.endsWith('sfld')?typeName(d.owner):'('+pop().text+')',text=receiver+'.'+identifier(d.name);if(v)emit(text+' = '+coerce(v,d.signature.type)+';');else capture(text,d.signature.type);continue;}
      if(n==='newarr'){const length=pop(),type=typeName(inspector.metadata.typeName(a));capture(`new ${type}[${length.text}]`,type+'[]');continue;}
      if(n==='ldlen'){const v=pop();capture(`(${v.text}).Length`);continue;}
      if(n==='ldelem'||n.startsWith('ldelem.')){const at=pop(),arr=pop();capture(`(${arr.text})[${at.text}]`,arr.type.replace(/\[\]$/,''));continue;}
      if(n==='stelem'||n.startsWith('stelem.')){const v=pop(),at=pop(),arr=pop();emit(`(${arr.text})[${at.text}] = ${coerce(v,arr.type.replace(/\[\]$/,''))};`);continue;}
      if(n==='box'){const v=pop(),type=typeName(inspector.metadata.typeName(a));capture(`(object)(${coerce(v,type)})`,'object');continue;}
      if(n==='castclass'||n==='unbox.any'){const v=pop(),type=typeName(inspector.metadata.typeName(a));capture(`(${type})(${v.text})`,type);continue;}
      if(n==='isinst'){const v=pop(),type=typeName(inspector.metadata.typeName(a));capture(`(${v.text} as ${type})`,type);continue;}
      if(n==='neg'||n==='not'){const v=pop();capture(`(${n==='neg'?'-':'~'}${v.text})`,v.type);continue;}
      if(n.startsWith('conv.')){const v=pop(),target=n.replace('conv.','').replace('ovf.',''),type={i1:'sbyte',u1:'byte',i2:'short',u2:'ushort',i4:'int',u4:'uint',i8:'long',u8:'ulong',r4:'float',r8:'double',i:'nint',u:'nuint'}[target];if(!type)throw new Error(`Conversion ${n} needs signedness analysis`);const expr=`(${type})(${v.text})`;capture(n.includes('ovf')?`checked(${expr})`:`unchecked(${expr})`,type);continue;}
      const ops={add:'+',sub:'-',mul:'*',div:'/',rem:'%',and:'&',or:'|',xor:'^',shl:'<<',shr:'>>',ceq:'==',cgt:'>',clt:'<'};
      if(ops[n]||/^(add|sub|mul)\.ovf$/.test(n)){const r=pop(),l=pop(),op=ops[n.split('.')[0]],comparison=['ceq','cgt','clt'].includes(n),expr=`(${l.text} ${op} ${r.text})`;capture(n.endsWith('.ovf')?`checked(${expr})`:!comparison&&['add','sub','mul'].includes(n)?`unchecked(${expr})`:expr,comparison?'bool':l.type);continue;}
      if(n==='ret'){if(m.signature.returnType==='void')emit('return;');else emit('return '+coerce(pop(),m.signature.returnType)+';');if(stack.length)throw new Error('Unexpected return stack');reachable=false;continue;}
      if(n==='throw'){emit('throw '+pop().text+';');reachable=false;continue;}
      if(n==='switch'){const v=pop();if(stack.length)throw new Error('Switch stack merge is not reconstructable');emit(`switch (${v.text}) {`);a.forEach((at,j)=>emit(`    case ${j}: goto ${ilLabel(at)};`));emit('}');continue;}
      if(i.operandKind.startsWith('br')){
        if(n.includes('.un'))throw new Error('Unsigned/unordered branch needs typed data-flow reconstruction');
        let condition;if(/^br(\.s)?$/.test(n))condition=null;else if(/^br(true|false)/.test(n)){const v=truth(pop());condition=n.startsWith('brtrue')?v:`!(${v})`;}else{const r=pop(),l=pop(),op={beq:'==',bne:'!=',bge:'>=',bgt:'>',ble:'<=',blt:'<'}[n.split('.')[0]];if(!op)throw new Error(`Branch ${n} requires exception-region reconstruction`);condition=`${l.text} ${op} ${r.text}`;}
        if(stack.length)throw new Error('Non-empty branch stack requires SSA reconstruction');emit(condition?`if (${condition}) goto ${ilLabel(a)};`:`goto ${ilLabel(a)};`);if(!condition)reachable=false;continue;
      }
      throw new Error(`Opcode '${n}' has no proven C# reconstruction`);
    }
    const declaration=`public ${m.signature.isStatic?'static ':''}${typeName(m.signature.returnType)} ${identifier(m.name)}(${m.signature.parameters.map((t,i)=>typeName(t)+' arg'+i).join(', ')})`;
    return {token:m.token,name:m.owner+'::'+m.name,language:'csharp',complete:true,diagnostics,source:[`// Reconstructed from ${tokenHex(m.token)} IL; original names/source formatting are not recovered.`,declaration,'{',...m.locals.map((t,i)=>`    ${typeName(t)} v${i}${m.initLocals?' = default':''};`),...statements,'}'].join('\n')+'\n'};
  }catch(error){return fallback(error.message);}
}
export function decompileAssembly(input){const inspector=input instanceof AssemblyInspector?input:new AssemblyInspector(input),methods=[];for(const m of inspector.methods.values()){try{methods.push(decompileMethod(inspector,m.token));}catch(error){methods.push({token:m.token,name:m.owner+'::'+m.name,language:'cil',complete:false,source:'// '+error.message,diagnostics:[{code:'INVALID_METHOD',message:error.message}]});}}return {name:inspector.summary({includeMethods:false}).name,methods,reconstructed:methods.filter(m=>m.complete).length,total:methods.length,source:methods.map(m=>`// ${m.name}\n${m.source}`).join('\n')};}
