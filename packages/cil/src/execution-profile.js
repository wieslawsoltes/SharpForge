import {selectMethod} from './entry-selection.js';
export {selectMethod} from './entry-selection.js';
import {FunctionPointerProfile,indirectCallStackEffect} from './function-pointer-profile.js';
import {SizeOfProfile} from './sizeof-profile.js';
import {ExecutionPrefixProfile} from './execution-prefix-profile.js';
import {recordVerifiedStacks, verifiedStackEntry} from './verified-stack.js';
import {resolveExecutionField} from './field-profile.js';
import {supportedDelegateCall} from './delegate-profile.js';
import {resolveExecutionMethod} from './call-profile.js';
import {genericDefinitionContext, verifyGenericType, verifyGenericCall} from './generic-profile.js';
import {verifyPrimitiveStorageOperand} from './memory-type-profile.js';
import { AssemblyInspector } from './inspector.js';
import { CilError } from './binary.js';
import {CilDispatchTable} from './dispatch-profile.js';
import {executionStackHeights} from './verify/stack-heights.js';
// Broad decoding is deliberately separate from this managed execution allowlist.
const simple = new Set(('calli constrained. volatile. ldtoken ldftn nop break ldnull dup pop ret switch ldstr newobj call callvirt throw rethrow endfinally ldlen newarr ldfld stfld ldsfld stsfld ldflda ldsflda ldobj stobj initobj ldelema ldelem stelem box unbox unbox.any cpobj sizeof castclass isinst ckfinite').split(' '));
const arithmetic = /^(add|sub|mul)(\.ovf(\.un)?)?$|^(div|rem|shr)(\.un)?$|^(and|or|xor|shl|neg|not|ceq|cgt|clt)(\.un)?$/;
const indexed = /^(ldarg|ldarga|starg|ldloc|ldloca|stloc)(\.[0-3s])?$/;
const numeric = /^ldc\.(i4(\.(m1|[0-8]|s))?|i8|r4|r8)$/;
const branches = /^(br|brtrue|brfalse|leave)(\.s)?$|^(beq|bge|bgt|ble|blt|bne)(\.un)?(\.s)?$/;
const conversions = /^conv\.(ovf\.)?(i1|u1|i2|u2|i4|u4|i8|u8|i|u|r4|r8|r)(\.un)?$/;
export function isExecutableOpcode(name){return simple.has(name)||arithmetic.test(name)||indexed.test(name)||numeric.test(name)||branches.test(name)||conversions.test(name)||/^(ldelem|stelem|ldind|stind)\.(i1|u1|i2|u2|i4|u4|i8|i|r4|r8|ref)$/.test(name);}
export {primitiveSizes} from './memory-type-profile.js';
export {systemType} from './intrinsic-profile.js';
import {intrinsicDefinition} from './intrinsic-profile.js';
export function supportedIntrinsic(descriptor){return intrinsicDefinition(descriptor)!==null;}
export function stackEffect(inspector,m,i){
  const n=i.name;
  if(n==='constrained.'||n==='volatile.'||n==='nop'||n==='break'||n==='endfinally'||n==='rethrow'||/^br(\.s)?$/.test(n)||/^leave/.test(n))return [0,0];
  if(n==='ldtoken'||n==='ldftn'||n==='sizeof'||n==='ldnull'||n==='ldstr'||numeric.test(n)||/^ld(arg|loc)/.test(n)||n==='ldsfld'||n==='ldsflda')return [0,1];
  if(/^st(arg|loc)/.test(n)||n==='pop'||n==='stsfld'||n==='throw'||n==='switch'||/^br(true|false)/.test(n)||n==='initobj')return [1,0];
  if(n==='dup')return [1,2];
  if(n==='ret')return [m.signature.returnType==='void'?0:1,0];
  if(n==='calli')return indirectCallStackEffect(inspector,i);
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
  const dispatch=new CilDispatchTable(inspector),verifiedStacks=new Map(),sizes=new SizeOfProfile(inspector),prefixes=new ExecutionPrefixProfile(inspector,dispatch),pointers=new FunctionPointerProfile(inspector);
  const issue=(m,i,code,message,details={})=>{if(issues.length<200)issues.push({methodToken:m?.token,method:m?m.owner+'::'+m.name:undefined,offset:i?.offset,code,message,...details});};
  const stackContext={issue,issues,stackEffect};
  if(!(inspector.pe.flags&1)||inspector.pe.flags&0x10)issue(null,null,'IL_IMAGE','Only IL-only managed images are executable');pending.push(entry);
  // Static initializers can be reached by allocation, field access or method invocation.
  const enqueueType=t=>{const type=inspector.types.find(x=>x.token===t);for(const m of type?.methods??[])if(m.name==='.cctor')pending.push(m.token);};
  while(pending.length){
    const t=pending.pop();if(visited.has(t))continue;visited.add(t);if(visited.size>maxMethods){issue(null,null,'IL_LIMIT','Reachable method limit exceeded');break;}
    let m;try{m=inspector.getMethod(t);}catch(error){issue({token:t},null,'IL_METADATA',error.message);continue;}
    if(!Number.isInteger(m.maxStack)||m.maxStack<0||m.maxStack>65535){issue(m,null,'IL_STACK','Invalid maxstack header');continue;}
    enqueueType(m.ownerToken);
    if(!m.hasBody||m.implFlags&3||m.flags&0x2000){issue(m,null,'IL_NATIVE','Native, runtime and abstract methods are not executable');continue;}
    let context;
    try {
      context=genericDefinitionContext(inspector,m);
      if(t===entry&&(context.typeArguments.length||context.methodArguments.length))throw new CilError('Entry point must be closed');
      if(m.signature.callingConvention)throw new CilError('Non-default calling conventions are inspection-only');
      for(const type of m.signature.parameters.concat(m.locals,m.signature.returnType))verifyGenericType(inspector,type,context);
    } catch(error) {issue(m,null,'IL_SIGNATURE',error.message);continue;}
    const map=new Map(m.instructions.map((i,index)=>[i.offset,index]));
    prefixes.verify(m,context,issue,pending);
    for(const h of m.handlers)if(h.flags===1)issue(m,null,'IL_FILTER','Exception filters are inspection-only');
    for(const i of m.instructions){
      if(!isExecutableOpcode(i.name)){issue(m,i,'IL_OPCODE',`Opcode '${i.name}' is inspection-only`);continue;}
      const pointerTarget=pointers.verifyOperand(m,i,context,issue,verifyGenericType);if(pointerTarget)pending.push(pointerTarget);
      if(i.name==='sizeof')sizes.verify(m,i,context,issue);
      if(['cpobj','unbox'].includes(i.name))verifyPrimitiveStorageOperand(inspector,m,i,issue);
      if(['newarr','ldelema','ldelem','stelem','box','unbox.any','ldobj','stobj','initobj','castclass','isinst'].includes(i.name)){try{verifyGenericType(inspector,inspector.metadata.typeName(i.operand),context);}catch(error){issue(m,i,'IL_TYPE',error.message);}}
      if(i.name==='ldtoken'){try{const token=inspector.resolveToken(i.operand);if(token.kind==='type')verifyGenericType(inspector,token.name,context);if(!['type','method','field'].includes(token.kind))issue(m,i,'IL_TOKEN','ldtoken requires a type, method or field');}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
      if(indexed.test(i.name)){
        const index=i.operand??Number(i.name.split('.').at(-1)),limit=i.name.includes('arg')?m.signature.parameters.length+(m.signature.isStatic?0:1):m.locals.length;
        if(!Number.isInteger(index)||index<0||index>=limit)issue(m,i,'IL_SLOT','Invalid argument/local slot');
      }
      if(['call','callvirt','newobj'].includes(i.name)){
        try{const d=resolveExecutionMethod(inspector,i.operand,context);verifyGenericCall(inspector,d,context);if(d.kind!=='method')throw new CilError('Call operand is not a method');const target=d.resolvedToken??(d.token>>>24===6?d.token:null);
          if(supportedDelegateCall(inspector,d)) { /* Delegate runtime methods have no IL body. */ }
          else if(target) {
            if(i.name==='callvirt'&&(inspector.methods.get(target)?.flags&0x40)) {
              const targets=dispatch.targets(target);
              if(!targets.size)issue(m,i,'IL_DISPATCH','Virtual method has no executable implementation');
              for(const implementation of targets)pending.push(implementation);
            } else pending.push(target);
          }else if(!supportedIntrinsic(d))issue(m,i,'IL_REFERENCE',`External member '${d.owner}::${d.name}' is not implemented`);
          if(i.name==='newobj'&&(d.name!=='.ctor'||d.signature.isStatic))issue(m,i,'IL_CTOR','newobj requires an instance constructor');
        }catch(error){issue(m,i,'IL_TOKEN',error.message);}
      }
      if(['ldsfld','stsfld','ldsflda','newobj'].includes(i.name)){try{enqueueType((i.name==='newobj'?resolveExecutionMethod(inspector,i.operand,context):resolveExecutionField(inspector,i.operand,context.typeArguments,context.methodArguments)).ownerToken);}catch{/* Reported by token validation. */}}
      if(['ldfld','stfld','ldsfld','stsfld','ldflda','ldsflda'].includes(i.name)){try{const d=resolveExecutionField(inspector,i.operand,context.typeArguments,context.methodArguments);if(d.decimalConstant&&i.name==='stsfld')issue(m,i,'IL_FIELD','Decimal constants are readonly');if(d.kind!=='field'||d.token>>>24!==4&&!d.resolvedToken&&!d.decimalConstant)issue(m,i,'IL_FIELD','External fields are inspection-only');}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
    }
    const {peak,heights}=executionStackHeights(inspector,m,map,stackContext);
    pointers.verify(m,issue,stackEffect,peak);
    stackHeights[t]=Object.fromEntries(heights);
    verifiedStacks.set(t,verifiedStackEntry(m,peak));
  }
  return recordVerifiedStacks(inspector,{stackHeights,success:issues.length===0,entryPoint:entry,methods:[...visited],issues,profile:'SharpForge.ManagedIL/1'},verifiedStacks);
}
