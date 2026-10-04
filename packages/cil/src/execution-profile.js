import {validVarargsSignature} from './varargs-profile.js';
import {verifyManagedFunctionPointers,verifyIndirectSignature} from './function-pointer-profile.js';
import {reachableAsyncMethods} from './async-profile.js';
import {numericFieldDefinition} from './numeric-field-profile.js';
import {resolveExecutionField} from './field-profile.js';
import {resolveExecutionMethod,supportedDelegateCall,callStorageType,methodGenericParameters,callSignatureKey} from './call-profile.js';
import {verifyControlRegions} from './control-flow-profile.js';
import {SizeOfProfile} from './sizeof-profile.js';
import { AssemblyInspector } from './inspector.js';
import { CilError } from './binary.js';
import {CilDispatchTable} from './dispatch-profile.js';
// Broad decoding is deliberately separate from this managed execution allowlist.
const simple = new Set(('arglist mkrefany refanyval refanytype jmp localloc cpblk initblk unaligned. volatile. tail. constrained. readonly. ldtoken ldftn ldvirtftn calli endfilter nop break ldnull dup pop ret switch ldstr newobj call callvirt throw rethrow endfinally ldlen newarr ldfld stfld ldsfld stsfld ldflda ldsflda ldobj stobj initobj ldelema ldelem stelem box unbox unbox.any cpobj sizeof castclass isinst ckfinite').split(' '));
const arithmetic = /^(add|sub|mul)(\.ovf(\.un)?)?$|^(div|rem|shr)(\.un)?$|^(and|or|xor|shl|neg|not|ceq|cgt|clt)(\.un)?$/;
const indexed = /^(ldarg|ldarga|starg|ldloc|ldloca|stloc)(\.[0-3s])?$/;
const numeric = /^ldc\.(i4(\.(m1|[0-8]|s))?|i8|r4|r8)$/;
const branches = /^(br|brtrue|brfalse|leave)(\.s)?$|^(beq|bge|bgt|ble|blt|bne)(\.un)?(\.s)?$/;
const conversions = /^conv\.(ovf\.)?(i1|u1|i2|u2|i4|u4|i8|u8|i|u|r4|r8|r)(\.un)?$/;
export function isExecutableOpcode(name){return simple.has(name)||arithmetic.test(name)||indexed.test(name)||numeric.test(name)||branches.test(name)||conversions.test(name)||/^(ldelem|stelem|ldind|stind)\.(i1|u1|i2|u2|i4|u4|i8|i|r4|r8|ref)$/.test(name);}
export const primitiveSizes=Object.freeze({'System.Boolean':1,'System.SByte':1,'System.Byte':1,'System.Char':2,'System.Int16':2,'System.UInt16':2,'System.Int32':4,'System.UInt32':4,'System.Int64':8,'System.UInt64':8,'System.Single':4,'System.Double':8});
export {systemType} from './intrinsic-profile.js';
import {intrinsicDefinition} from './intrinsic-profile.js';
export function supportedIntrinsic(descriptor){return intrinsicDefinition(descriptor)!==null;}
export function selectMethod(inspector,selection,args){
  if(selection===undefined||selection===null){if(!inspector.pe.entryPoint)throw new CilError('This DLL has no entry point. Select a static method to invoke.');return inspector.pe.entryPoint;}
  if(typeof selection==='number')return selection;
  if(/^0x[0-9a-f]+$/i.test(selection))return Number(selection);
  const matches=[...inspector.methods.values()].filter(m=>(m.owner+'::'+m.name===selection||m.owner+'.'+m.name===selection||m.name===selection)&&(args===undefined||inspector.signature(m.token).parameters.length===args.length));
  if(matches.length!==1)throw new CilError(matches.length?'Ambiguous method; use its MethodDef token':'Selected method not found');return matches[0].token;
}
export function stackEffect(inspector,m,i){
  const n=i.name;
  if(['unaligned.','volatile.','tail.','constrained.','readonly.'].includes(n)||n==='jmp'||n==='nop'||n==='break'||n==='endfinally'||n==='rethrow'||/^br(\.s)?$/.test(n)||/^leave/.test(n))return [0,0];
  if(n==='arglist'||n==='ldtoken'||n==='ldftn'||n==='sizeof'||n==='ldnull'||n==='ldstr'||numeric.test(n)||/^ld(arg|loc)/.test(n)||n==='ldsfld'||n==='ldsflda')return [0,1];
  if(/^st(arg|loc)/.test(n)||n==='pop'||n==='stsfld'||n==='throw'||n==='endfilter'||n==='switch'||/^br(true|false)/.test(n)||n==='initobj')return [1,0];
  if(n==='cpblk'||n==='initblk')return [3,0];
  if(n==='dup')return [1,2];
  if(n==='ret')return [m.signature.returnType==='void'?0:1,0];
  if(['call','callvirt','calli','newobj'].includes(n)){const signature=n==='calli'?inspector.signature(i.operand):resolveExecutionMethod(inspector,i.operand).signature;return [signature.parameters.length+(n!=='newobj'&&!signature.isStatic?1:0)+(n==='calli'?1:0),n==='newobj'||signature.returnType!=='void'?1:0];}
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
  const dispatch=new CilDispatchTable(inspector);
  const sizes=new SizeOfProfile(inspector);
  const issue=(m,i,code,message,details={})=>{if(issues.length<200)issues.push({methodToken:m?.token,method:m?m.owner+'::'+m.name:undefined,offset:i?.offset,code,message,...details});};
  if(!(inspector.pe.flags&1)||inspector.pe.flags&0x10)issue(null,null,'IL_IMAGE','Only IL-only managed images are executable');pending.push(entry);
  // Static initializers can be reached by allocation, field access or method invocation.
  const enqueueType=t=>{const type=inspector.types.find(x=>x.token===t);for(const m of type?.methods??[])if(m.name==='.cctor')pending.push(m.token);};
  while(pending.length){
    const t=pending.pop();if(visited.has(t))continue;visited.add(t);if(visited.size>maxMethods){issue(null,null,'IL_LIMIT','Reachable method limit exceeded');break;}
    let m;try{m=inspector.getMethod(t);}catch(error){issue({token:t},null,'IL_METADATA',error.message);continue;}
    enqueueType(m.ownerToken);
    if(m.flags&0x2000){issue(m,null,'IL_UNMANAGED','Unmanaged P/Invoke is unavailable: '+m.owner+'::'+m.name,{exceptionType:'NotSupportedException',member:m.owner+'::'+m.name});continue;}
    if(!m.hasBody||m.implFlags&3){issue(m,null,'IL_NATIVE','Native, runtime and abstract methods are not executable');continue;}
    if(!Number.isInteger(m.maxStack)||m.maxStack<0||m.maxStack>65535){issue(m,null,'IL_STACK','Invalid method maxstack');continue;}
    // Memory pointers and pinned locals are checked by the managed memory handlers.
    const illegalType=type=>typeof type!=='string';
    if(m.signature.callingConvention&&m.signature.callingConvention!==5||m.signature.parameters.concat(m.locals,m.signature.returnType).some(illegalType)){issue(m,null,'IL_SIGNATURE','Unsupported managed method calling convention');continue;}
    if(methodGenericParameters(inspector,m.token).length!==(m.signature.genericArity??0)){issue(m,null,'IL_GENERIC','Generic parameter metadata does not match method arity');continue;}
    const map=new Map(m.instructions.map((i,index)=>[i.offset,index]));
    verifyControlRegions(inspector,m,issue);
    for(const i of m.instructions){
      if(!isExecutableOpcode(i.name)){issue(m,i,'IL_OPCODE',`Opcode '${i.name}' is inspection-only`);continue;}
      if(i.name==='arglist'&&m.signature.callingConvention!==5)issue(m,i,'IL_VARARGS','arglist requires a vararg MethodDef');
      if(i.name==='sizeof')sizes.verify(m,i,issue);
      if(['mkrefany','refanyval','cpobj','unbox','unbox.any','box','castclass','isinst','ldobj','stobj','initobj','newarr','ldelema','ldelem','stelem'].includes(i.name)){try{if(inspector.resolveToken(i.operand).kind!=='type')throw new CilError('Instruction requires a type token');}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
      if(i.name==='ldtoken'){try{const token=inspector.resolveToken(i.operand);if(!['type','method','field'].includes(token.kind))issue(m,i,'IL_TOKEN','ldtoken requires a type, method or field');}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
      if(indexed.test(i.name)){
        const index=i.operand??Number(i.name.split('.').at(-1)),limit=i.name.includes('arg')?m.signature.parameters.length+(m.signature.isStatic?0:1):m.locals.length;
        if(!Number.isInteger(index)||index<0||index>=limit)issue(m,i,'IL_SLOT','Invalid argument/local slot');
      }
      if(i.name==='calli')verifyIndirectSignature(inspector,m,i,issue,illegalType);
      if(['jmp','call','callvirt','newobj','ldftn','ldvirtftn'].includes(i.name)){
        try{const d=resolveExecutionMethod(inspector,i.operand),target=d.resolvedToken;
          for(const method of reachableAsyncMethods(inspector,d))pending.push(method);
          if(d.signature.callingConvention===5&&target&&!validVarargsSignature(inspector.signature(target),d.signature,callSignatureKey))throw new CilError('Vararg fixed signature mismatch');
          if(i.name==='jmp'&&callSignatureKey(d.signature)!==callSignatureKey(m.signature))throw new CilError('jmp method signatures must match');
          if(d.signature.callingConvention&&d.signature.callingConvention!==5||d.signature.parameters.concat(d.signature.returnType).some(illegalType))throw new CilError('Unsupported managed call signature');
          if(['callvirt','ldvirtftn'].includes(i.name)&&d.signature.isStatic)throw new CilError(i.name+' requires an instance method');
          const instructionIndex=m.instructions.indexOf(i),prefixes=[];for(let index=instructionIndex-1;index>=0&&m.instructions[index].name.endsWith('.');index--)prefixes.push(m.instructions[index]);
          if(prefixes.some(prefix=>prefix.name==='tail.')&&callStorageType(d.signature.returnType)!==callStorageType(m.signature.returnType))throw new CilError('tail. call return type must match the containing method');
          if(prefixes.some(prefix=>prefix.name==='constrained.')&&!target)for(const candidate of inspector.methods.values())if(candidate.hasBody&&candidate.name===d.name&&callSignatureKey(inspector.signature(candidate.token))===callSignatureKey(d.signature))pending.push(candidate.token);
          if(d.signature.genericArity&&!d.genericArguments&& !['ldftn','ldvirtftn'].includes(i.name))throw new CilError('A generic method call requires MethodSpec arguments');
          if(supportedDelegateCall(inspector,d)) { /* Runtime delegate methods have no IL body. */ }
          else if(target) {
            if(['callvirt','ldvirtftn'].includes(i.name)&&(inspector.methods.get(target)?.flags&0x40)) {
              const targets=dispatch.targets(target);
              if(!targets.size)issue(m,i,'IL_DISPATCH','Virtual method has no executable implementation');
              for(const implementation of targets)pending.push(implementation);
            } else pending.push(target);
          }else if(['callvirt','ldvirtftn'].includes(i.name)&&dispatch.externalTargets(d).size){for(const implementation of dispatch.externalTargets(d))pending.push(implementation);}else if(!supportedIntrinsic(d))issue(m,i,'IL_REFERENCE',`External member '${d.owner}::${d.name}' is not implemented`);
          if(i.name==='newobj'&&(d.name!=='.ctor'||d.signature.isStatic))issue(m,i,'IL_CTOR','newobj requires an instance constructor');
        }catch(error){issue(m,i,'IL_TOKEN',error.message);}
      }
      if(['ldsfld','stsfld','ldsflda','newobj'].includes(i.name)){try{enqueueType((i.name==='newobj'?inspector.resolveToken(i.operand):resolveExecutionField(inspector,i.operand)).ownerToken);}catch{/* Reported by token validation. */}}
      if(['ldfld','stfld','ldsfld','stsfld','ldflda','ldsflda'].includes(i.name)){try{const constant=numericFieldDefinition(inspector.resolveToken(i.operand));if(constant){if(i.name!=='ldsfld')issue(m,i,'IL_FIELD','Numeric constant fields are read-only');continue;}const d=resolveExecutionField(inspector,i.operand);if(d.kind!=='field'||d.token>>>24!==4&&!d.resolvedToken)issue(m,i,'IL_FIELD','External fields are inspection-only');}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
    }
    const queue=[[0,0]],heights=new Map();for(const h of m.handlers){queue.push([map.get(h.target),h.flags===0||h.flags===1?1:0]);if(h.flags===1)queue.push([map.get(h.catchType),1]);}
    while(queue.length&&issues.length<200){
      const [index,height]=queue.pop(),i=m.instructions[index];if(!i){issue(m,null,'IL_FLOW','Control flow leaves the method');continue;}
      if(heights.has(index)){if(heights.get(index)!==height)issue(m,i,'IL_STACK','Inconsistent evaluation stack height at join');continue;}heights.set(index,height);
      if(height>m.maxStack){issue(m,i,'IL_STACK','Incoming evaluation stack exceeds maxstack');continue;}
      let pop,push;try{[pop,push]=stackEffect(inspector,m,i);}catch(error){issue(m,i,'IL_STACK',error.message);continue;}
      if(height<pop){issue(m,i,'IL_STACK','Evaluation stack underflow');continue;}const after=height-pop+push;if(after>m.maxStack)issue(m,i,'IL_STACK','Evaluation stack exceeds maxstack');
      if(i.name==='jmp'){if(height!==0)issue(m,i,'IL_STACK','jmp requires an empty stack');continue;}
      if(i.name==='ret'){if(height!==pop)issue(m,i,'IL_STACK','Invalid return stack');continue;}
      if(['throw','rethrow','endfinally','endfilter'].includes(i.name)){if(i.name==='endfilter'&&height!==1)issue(m,i,'IL_STACK','endfilter requires exactly one decision');if(i.name==='endfinally'&&height!==0)issue(m,i,'IL_STACK','endfinally requires an empty stack');continue;}
      if(i.operandKind.startsWith('br'))queue.push([map.get(i.operand),i.name.startsWith('leave')?0:after]);
      if(i.name==='switch')for(const target of i.operand)queue.push([map.get(target),after]);
      if(!/^(br|leave)(\.s)?$/.test(i.name))queue.push([index+1,after]);
    }
    verifyManagedFunctionPointers(inspector,m,issue,stackEffect);
    stackHeights[t]=Object.fromEntries(heights);
  }
  return {stackHeights,success:issues.length===0,entryPoint:entry,methods:[...visited],issues,profile:'SharpForge.ManagedIL/1'};
}
