import {contractForMember,frameworkType} from '@sharpforge/framework';
import { AssemblyInspector } from './inspector.js';
import { CilError } from './binary.js';
// Broad decoding is deliberately separate from this managed execution allowlist.
const simple = new Set(('ldftn nop break ldnull dup pop ret switch ldstr newobj call callvirt throw rethrow endfinally ldlen newarr ldfld stfld ldsfld stsfld ldflda ldsflda ldobj stobj initobj ldelema ldelem stelem box unbox unbox.any cpobj sizeof castclass isinst ckfinite').split(' '));
const arithmetic = /^(add|sub|mul)(\.ovf(\.un)?)?$|^(div|rem|shr)(\.un)?$|^(and|or|xor|shl|neg|not|ceq|cgt|clt)(\.un)?$/;
const indexed = /^(ldarg|ldarga|starg|ldloc|ldloca|stloc)(\.[0-3s])?$/;
const numeric = /^ldc\.(i4(\.(m1|[0-8]|s))?|i8|r4|r8)$/;
const branches = /^(br|brtrue|brfalse|leave)(\.s)?$|^(beq|bge|bgt|ble|blt|bne)(\.un)?(\.s)?$/;
const conversions = /^conv\.(ovf\.)?(i1|u1|i2|u2|i4|u4|i8|u8|i|u|r4|r8|r)(\.un)?$/;
export function isExecutableOpcode(name){return simple.has(name)||arithmetic.test(name)||indexed.test(name)||numeric.test(name)||branches.test(name)||conversions.test(name)||/^(ldelem|stelem|ldind|stind)\.(i1|u1|i2|u2|i4|u4|i8|i|r4|r8|ref)$/.test(name);}
export const primitiveSizes=Object.freeze({'System.Boolean':1,'System.SByte':1,'System.Byte':1,'System.Char':2,'System.Int16':2,'System.UInt16':2,'System.Int32':4,'System.UInt32':4,'System.Int64':8,'System.UInt64':8,'System.Single':4,'System.Double':8});
const aliases={object:'System.Object',string:'System.String',Exception:'System.Exception',int:'System.Int32',double:'System.Double',long:'System.Int64',bool:'System.Boolean'};
export const systemType=name=>aliases[name]??name;
export function supportedIntrinsic(d){
  if(d.kind==='method'&&contractForMember(d))return true;
  if(d.kind!=='method'||d.genericArguments||d.signature.genericArity||d.signature.callingConvention)return false;
  const owner=systemType(d.owner),{parameters:p,returnType:r,isStatic:s}=d.signature,name=d.name;
  const primitives=new Set(['int','uint','long','ulong','double','float','bool','char','string','object']);
  if(owner==='System.Console'&&s&&r==='void'&&['Write','WriteLine'].includes(name))return p.length===0&&name==='WriteLine'||p.length===1&&primitives.has(p[0]);
  if(owner==='System.Object')return name==='.ctor'&&!s&&p.length===0&&r==='void'||name==='ToString'&&!s&&p.length===0&&r==='string';
  if(owner==='System.Exception')return name==='.ctor'&&!s&&r==='void'&&(p.length===0||p.length===1&&p[0]==='string')||name==='get_Message'&&!s&&p.length===0&&r==='string';
  if(owner==='System.String'){
    if(s&&name==='Concat'&&r==='string')return p.length>=2&&p.length<=4&&p.every(t=>t==='string')||p.length===2&&p.every(t=>t==='object');
    if(s&&['op_Equality','op_Inequality','Equals'].includes(name))return p.join(',')==='string,string'&&r==='bool';
    if(s&&name==='IsNullOrEmpty')return p.join(',')==='string'&&r==='bool';
    if(!s&&name==='get_Length')return !p.length&&r==='int';
    if(!s&&name==='get_Chars')return p.join(',')==='int'&&r==='char';
    if(!s&&['ToUpperInvariant','ToLowerInvariant','ToUpper','ToLower','Trim','ToString'].includes(name))return !p.length&&r==='string';
    if(!s&&['Contains','StartsWith','EndsWith'].includes(name))return p.join(',')==='string'&&r==='bool';
    if(!s&&name==='IndexOf')return p.join(',')==='string'&&r==='int';
    if(!s&&name==='Replace')return p.join(',')==='string,string'&&r==='string';
    if(!s&&name==='Substring')return ['int','int,int'].includes(p.join(','))&&r==='string';
  }
  if(owner==='System.Math'&&s){
    if(['Abs','Min','Max'].includes(name))return p.length===(name==='Abs'?1:2)&&['int','double','long','float'].includes(r)&&p.every(t=>t===r);
    if(['Sqrt','Floor','Ceiling','Round','Sin','Cos','Tan','Log','Exp','Pow'].includes(name))return r==='double'&&p.length===(name==='Pow'?2:1)&&p.every(t=>t==='double');
  }
  if(owner==='System.GC'&&s)return name==='Collect'&&r==='void'&&!p.length||name==='GetTotalMemory'&&r==='long'&&p.join(',')==='bool'||name==='CollectionCount'&&r==='int'&&p.join(',')==='int';
  if(owner==='System.Convert'&&s&&p.length===1)return name==='ToInt32'&&r==='int'&&['int','double','bool','string','object'].includes(p[0])||name==='ToDouble'&&r==='double'&&['int','double','string'].includes(p[0])||name==='ToString'&&r==='string'&&primitives.has(p[0]);
  if(s&&name==='Parse'&&p.join(',')==='string')return owner==='System.Int32'&&r==='int'||owner==='System.Double'&&r==='double'||owner==='System.Int64'&&r==='long';
  return false;
}
export function selectMethod(inspector,selection,args){
  if(selection===undefined||selection===null){if(!inspector.pe.entryPoint)throw new CilError('This DLL has no entry point. Select a static method to invoke.');return inspector.pe.entryPoint;}
  if(typeof selection==='number')return selection;
  if(/^0x[0-9a-f]+$/i.test(selection))return Number(selection);
  const matches=[...inspector.methods.values()].filter(m=>(m.owner+'::'+m.name===selection||m.owner+'.'+m.name===selection||m.name===selection)&&(args===undefined||inspector.signature(m.token).parameters.length===args.length));
  if(matches.length!==1)throw new CilError(matches.length?'Ambiguous method; use its MethodDef token':'Selected method not found');return matches[0].token;
}
export function stackEffect(inspector,m,i){
  const n=i.name;
  if(n==='nop'||n==='break'||n==='endfinally'||n==='rethrow'||/^br(\.s)?$/.test(n)||/^leave/.test(n))return [0,0];
  if(n==='ldftn'||n==='sizeof'||n==='ldnull'||n==='ldstr'||numeric.test(n)||/^ld(arg|loc)/.test(n)||n==='ldsfld'||n==='ldsflda')return [0,1];
  if(/^st(arg|loc)/.test(n)||n==='pop'||n==='stsfld'||n==='throw'||n==='switch'||/^br(true|false)/.test(n)||n==='initobj')return [1,0];
  if(n==='dup')return [1,2];
  if(n==='ret')return [m.signature.returnType==='void'?0:1,0];
  if(n==='call'||n==='callvirt'||n==='newobj'){const d=inspector.resolveToken(i.operand);return [d.signature.parameters.length+(n!=='newobj'&&!d.signature.isStatic?1:0),n==='newobj'||d.signature.returnType!=='void'?1:0];}
  if(n==='cpobj'||n==='stfld'||n==='stobj'||n.startsWith('stind.'))return [2,0];
  if(n==='stelem'||n.startsWith('stelem.'))return [3,0];
  if(n==='ldelema'||n==='ldelem'||n.startsWith('ldelem.'))return [2,1];
  if(/^b(eq|ge|gt|le|lt|ne)/.test(n))return [2,0];
  if(arithmetic.test(n)&&!['neg','not'].includes(n))return [2,1];
  return [1,1];
}
/** Whole reachable-method stack-height verification plus explicit unsupported-operation diagnostics.
 * This is a constrained runtime verifier, NOT an implementation of the CLR verifier/type system. */
export function verifyCilAssembly(input,{methodToken,arguments:args=[],maxMethods=10000,...options}={}){
  const inspector=input instanceof AssemblyInspector?input:new AssemblyInspector(input,options),issues=[],visited=new Set(),pending=[],stackHeights={},entry=selectMethod(inspector,methodToken,args);
  const issue=(m,i,code,message)=>{if(issues.length<200)issues.push({methodToken:m?.token,method:m?m.owner+'::'+m.name:undefined,offset:i?.offset,code,message});};
  if(!(inspector.pe.flags&1)||inspector.pe.flags&0x10)issue(null,null,'IL_IMAGE','Only IL-only managed images are executable');pending.push(entry);
  // Static initializers can be reached by allocation, field access or method invocation.
  const enqueueType=t=>{const type=inspector.types.find(x=>x.token===t);for(const m of type?.methods??[])if(m.name==='.cctor')pending.push(m.token);};
  while(pending.length){
    const t=pending.pop();if(visited.has(t))continue;visited.add(t);if(visited.size>maxMethods){issue(null,null,'IL_LIMIT','Reachable method limit exceeded');break;}
    let m;try{m=inspector.getMethod(t);}catch(error){issue({token:t},null,'IL_METADATA',error.message);continue;}
    enqueueType(m.ownerToken);
    if(!m.hasBody||m.implFlags&3||m.flags&0x2000){issue(m,null,'IL_NATIVE','Native, runtime and abstract methods are not executable');continue;}
    if(m.signature.genericArity||m.signature.callingConvention||m.signature.parameters.concat(m.locals,m.signature.returnType).some(t=>!frameworkType(t.replace(/\[\]$/,''))&&/[!*]|`[0-9]|\bpinned\b|\bmod(req|opt)\b/.test(t))){issue(m,null,'IL_SIGNATURE','Generic, native-pointer and modified signatures are inspection-only');continue;}
    const map=new Map(m.instructions.map((i,index)=>[i.offset,index]));
    for(const h of m.handlers)if(h.flags===1)issue(m,null,'IL_FILTER','Exception filters are inspection-only');
    for(const i of m.instructions){
      if(!isExecutableOpcode(i.name)){issue(m,i,'IL_OPCODE',`Opcode '${i.name}' is inspection-only`);continue;}
      if(['sizeof','cpobj','unbox'].includes(i.name)){try{const type=inspector.metadata.typeName(i.operand);if(!primitiveSizes[type])issue(m,i,'IL_TYPE',`${i.name} is implemented only for fixed-width primitive types`);}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
      if(indexed.test(i.name)){
        const index=i.operand??Number(i.name.split('.').at(-1)),limit=i.name.includes('arg')?m.signature.parameters.length+(m.signature.isStatic?0:1):m.locals.length;
        if(!Number.isInteger(index)||index<0||index>=limit)issue(m,i,'IL_SLOT','Invalid argument/local slot');
      }
      if(i.name==='ldftn'){try{const d=inspector.resolveToken(i.operand),target=d.resolvedToken??(d.token>>>24===6?d.token:null);if(!target)throw new CilError('External delegate target is not supported');pending.push(target);}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
      if(['call','callvirt','newobj'].includes(i.name)){
        try{const d=inspector.resolveToken(i.operand);if(d.kind!=='method')throw new CilError('Call operand is not a method');const target=d.resolvedToken??(d.token>>>24===6?d.token:null);
          if(d.genericArguments)issue(m,i,'IL_GENERIC','Generic method instantiations are inspection-only');
          else if(target)pending.push(target);else if(!supportedIntrinsic(d))issue(m,i,'IL_REFERENCE',`External member '${d.owner}::${d.name}' is not implemented`);
          if(i.name==='newobj'&&(d.name!=='.ctor'||d.signature.isStatic))issue(m,i,'IL_CTOR','newobj requires an instance constructor');
        }catch(error){issue(m,i,'IL_TOKEN',error.message);}
      }
      if(['ldsfld','stsfld','ldsflda','newobj'].includes(i.name)){try{enqueueType(inspector.resolveToken(i.operand).ownerToken);}catch{/* Reported by token validation. */}}
      if(['ldfld','stfld','ldsfld','stsfld','ldflda','ldsflda'].includes(i.name)){try{const d=inspector.resolveToken(i.operand);if(d.kind!=='field'||d.token>>>24!==4&&!d.resolvedToken)issue(m,i,'IL_FIELD','External fields are inspection-only');}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
    }
    const queue=[[0,0]],heights=new Map();for(const h of m.handlers)if(h.flags!==1)queue.push([map.get(h.target),h.flags===0?1:0]);
    while(queue.length&&issues.length<200){
      const [index,height]=queue.pop(),i=m.instructions[index];if(!i){issue(m,null,'IL_FLOW','Control flow leaves the method');continue;}
      if(heights.has(index)){if(heights.get(index)!==height)issue(m,i,'IL_STACK','Inconsistent evaluation stack height at join');continue;}heights.set(index,height);
      let pop,push;try{[pop,push]=stackEffect(inspector,m,i);}catch(error){issue(m,i,'IL_STACK',error.message);continue;}
      if(height<pop){issue(m,i,'IL_STACK','Evaluation stack underflow');continue;}const after=height-pop+push;if(after>m.maxStack)issue(m,i,'IL_STACK','Evaluation stack exceeds maxstack');
      if(i.name==='ret'){if(height!==pop)issue(m,i,'IL_STACK','Invalid return stack');continue;}
      if(['throw','rethrow','endfinally'].includes(i.name)){if(i.name==='endfinally'&&height!==0)issue(m,i,'IL_STACK','endfinally requires an empty stack');continue;}
      if(i.operandKind.startsWith('br'))queue.push([map.get(i.operand),i.name.startsWith('leave')?0:after]);
      if(i.name==='switch')for(const target of i.operand)queue.push([map.get(target),after]);
      if(!/^(br|leave)(\.s)?$/.test(i.name))queue.push([index+1,after]);
    }
    stackHeights[t]=Object.fromEntries(heights);
  }
  return {stackHeights,success:issues.length===0,entryPoint:entry,methods:[...visited],issues,profile:'SharpForge.ManagedIL/1'};
}
