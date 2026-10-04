import {verifyControlInstructions} from './control-execution-profile.js';
import {verifyExecutionCall} from './verify/execution-calls.js';
import {verificationInput} from './verify/verification-input.js';
export {selectMethod} from './entry-selection.js';
import {FunctionPointerProfile} from './function-pointer-profile.js';
import {isExecutableOpcode, isIndexedOpcode, stackEffect} from './execution-opcodes.js';
import {verifyExecutionLocalType} from './execution-memory-profile.js';
export {isExecutableOpcode, stackEffect} from './execution-opcodes.js';
import {SizeOfProfile} from './sizeof-profile.js';
import {ExecutionPrefixProfile} from './execution-prefix-profile.js';
import {recordVerifiedStacks, verifiedStackEntry} from './verified-stack.js';
import {verifyExecutionToken} from './token-profile.js';
import {resolveExecutionField} from './field-profile.js';
import {resolveExecutionMethod} from './call-profile.js';
import {genericDefinitionContext, verifyGenericType} from './generic-profile.js';
import {verifyPrimitiveStorageOperand} from './memory-type-profile.js';
import { CilError } from './binary.js';
import {CilDispatchTable} from './dispatch-profile.js';
import {executionStackHeights} from './verify/stack-heights.js';
import {executionHandlerOffsets} from './verify/execution-handlers.js';
import {verifyExecutionField} from './verify/execution-fields.js';
export {primitiveSizes} from './memory-type-profile.js';
export {systemType} from './intrinsic-profile.js';
import {intrinsicDefinition} from './intrinsic-profile.js';
export function supportedIntrinsic(descriptor){return intrinsicDefinition(descriptor)!==null;}
/** Bounded reachable stack heights and lexical EH admission; this runtime profile is not the CLR type verifier. */
export function verifyCilAssembly(input,configuration={}){
  const {inspector,pending,entry,maxMethods,options}=verificationInput(input,configuration),issues=[],visited=new Set(),stackHeights={};
  const dispatch=new CilDispatchTable(inspector),verifiedStacks=new Map(),sizes=new SizeOfProfile(inspector),prefixes=new ExecutionPrefixProfile(inspector,dispatch),pointers=new FunctionPointerProfile(inspector,dispatch);
  const issue=(m,i,code,message,details={})=>{if(issues.length<200)issues.push({methodToken:m?.token,method:m?m.owner+'::'+m.name:undefined,offset:i?.offset,code,message,...details});};
  const stackContext={issue,issues,stackEffect,options};
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
      if(m.signature.callingConvention&&m.signature.callingConvention!==5)throw new CilError('Only default and managed vararg calling conventions are executable');
      for(const type of m.signature.parameters.concat(m.signature.returnType))verifyGenericType(inspector,type,context);
      for(const type of m.locals)verifyExecutionLocalType(inspector,type,context);
    } catch(error) {issue(m,null,'IL_SIGNATURE',error.message);continue;}
    const map = executionHandlerOffsets(m, options, issue);
    if (!map) continue;
    prefixes.verify(m,context,issue,pending);
    verifyControlInstructions(inspector,m,context,issue,pending,verifyGenericType);
    for(const i of m.instructions){
      if(!isExecutableOpcode(i.name)){issue(m,i,'IL_OPCODE',`Opcode '${i.name}' is inspection-only`);continue;}
      for(const target of pointers.verifyOperand(m,i,context,issue,verifyGenericType)??[])pending.push(target);
      if(i.name==='sizeof')sizes.verify(m,i,context,issue);
      if(['cpobj','unbox'].includes(i.name))verifyPrimitiveStorageOperand(inspector,m,i,issue,context);
      if(['newarr','ldelema','ldelem','stelem','box','unbox.any','ldobj','stobj','initobj','castclass','isinst'].includes(i.name)){try{verifyGenericType(inspector,inspector.metadata.typeName(i.operand),context);}catch(error){issue(m,i,'IL_TYPE',error.message);}}
      if(i.name==='ldtoken'){try{verifyExecutionToken(inspector,i.operand,context);}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
      if(isIndexedOpcode(i.name)){
        const index=i.operand??Number(i.name.split('.').at(-1)),limit=i.name.includes('arg')?m.signature.parameters.length+(m.signature.isStatic?0:1):m.locals.length;
        if(!Number.isInteger(index)||index<0||index>=limit)issue(m,i,'IL_SLOT','Invalid argument/local slot');
      }
      if(['call','callvirt','newobj'].includes(i.name))verifyExecutionCall(inspector,m,i,context,{pending,dispatch,issue});
      if(['ldsfld','stsfld','ldsflda','newobj'].includes(i.name)){try{enqueueType((i.name==='newobj'?resolveExecutionMethod(inspector,i.operand,context):resolveExecutionField(inspector,i.operand,context.typeArguments,context.methodArguments)).ownerToken);}catch{/* Reported by token validation. */}}
      if(['ldfld','stfld','ldsfld','stsfld','ldflda','ldsflda'].includes(i.name))verifyExecutionField(inspector,m,i,context,issue);
    }
    const {peak,heights}=executionStackHeights(inspector,m,map,stackContext);
    pointers.verify(m,issue,stackEffect,peak);
    stackHeights[t]=Object.fromEntries(heights);
    verifiedStacks.set(t,verifiedStackEntry(m,peak));
  }
  return recordVerifiedStacks(inspector,{stackHeights,success:issues.length===0,entryPoint:entry,methods:[...visited],issues,profile:'SharpForge.ManagedIL/1'},verifiedStacks);
}
