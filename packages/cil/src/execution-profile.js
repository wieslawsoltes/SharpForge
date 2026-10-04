import {SizeOfProfile} from './sizeof-profile.js';
import {ExecutionPrefixProfile} from './execution-prefix-profile.js';
import {recordVerifiedStacks, verifiedStackEntry} from './verified-stack.js';
import {verifyExecutionToken} from './token-profile.js';
import {resolveExecutionField} from './field-profile.js';
import {supportedDelegateCall} from './delegate-profile.js';
import {resolveExecutionMethod} from './call-profile.js';
import {genericDefinitionContext, verifyGenericType, verifyGenericCall} from './generic-profile.js';
import {verifyPrimitiveStorageOperand} from './memory-type-profile.js';
import { AssemblyInspector } from './inspector.js';
import { CilError } from './binary.js';
import {CilDispatchTable} from './dispatch-profile.js';
import {isExecutableOpcode, indexedInstructions, stackEffect} from './opcode-profile.js';
export {isExecutableOpcode, stackEffect};
export {primitiveSizes} from './memory-type-profile.js';
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
/** Whole reachable-method stack-height verification plus explicit unsupported-operation diagnostics.
 * This is a constrained runtime verifier, NOT an implementation of the CLR verifier/type system. */
export function verifyCilAssembly(input,{methodToken,arguments:args=[],maxMethods=10000,...options}={}){
  const inspector=input instanceof AssemblyInspector?input:new AssemblyInspector(input,options),issues=[],visited=new Set(),pending=[],stackHeights={},entry=selectMethod(inspector,methodToken,args);
  const dispatch=new CilDispatchTable(inspector),verifiedStacks=new Map(),sizes=new SizeOfProfile(inspector),prefixes=new ExecutionPrefixProfile(inspector);
  const issue=(m,i,code,message)=>{if(issues.length<200)issues.push({methodToken:m?.token,method:m?m.owner+'::'+m.name:undefined,offset:i?.offset,code,message});};
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
    prefixes.verify(m,context,issue);
    for(const h of m.handlers)if(h.flags===1)issue(m,null,'IL_FILTER','Exception filters are inspection-only');
    for(const i of m.instructions){
      if(!isExecutableOpcode(i.name)){issue(m,i,'IL_OPCODE',`Opcode '${i.name}' is inspection-only`);continue;}
      if(i.name==='sizeof')sizes.verify(m,i,context,issue);
      if(['cpobj','unbox'].includes(i.name))verifyPrimitiveStorageOperand(inspector,m,i,issue);
      if(['newarr','ldelema','ldelem','stelem','box','unbox.any','ldobj','stobj','initobj','castclass','isinst'].includes(i.name)){try{verifyGenericType(inspector,inspector.metadata.typeName(i.operand),context);}catch(error){issue(m,i,'IL_TYPE',error.message);}}
      if(i.name==='ldtoken'){try{verifyExecutionToken(inspector,i.operand,context);}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
      if(indexedInstructions.test(i.name)){
        const index=i.operand??Number(i.name.split('.').at(-1)),limit=i.name.includes('arg')?m.signature.parameters.length+(m.signature.isStatic?0:1):m.locals.length;
        if(!Number.isInteger(index)||index<0||index>=limit)issue(m,i,'IL_SLOT','Invalid argument/local slot');
      }
      if(i.name==='ldftn'){try{const d=inspector.resolveToken(i.operand);if(d.genericArguments||d.signature.genericArity||/[!`]/.test(d.owner))throw new CilError('Generic delegate targets require closed pointer binding');const target=d.resolvedToken??(d.token>>>24===6?d.token:null);if(!target)throw new CilError('External delegate target is not supported');pending.push(target);}catch(error){issue(m,i,'IL_TOKEN',error.message);}}
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
    let peak=0;
    const queue=[[0,0]],heights=new Map();for(const h of m.handlers)if(h.flags!==1)queue.push([map.get(h.target),h.flags===0?1:0]);
    while(queue.length&&issues.length<200){
      const [index,height]=queue.pop(),i=m.instructions[index];if(!i){issue(m,null,'IL_FLOW','Control flow leaves the method');continue;}
      peak=Math.max(peak,height);
      if(height>m.maxStack){issue(m,i,'IL_STACK','Incoming evaluation stack exceeds maxstack');continue;}
      if(heights.has(index)){if(heights.get(index)!==height)issue(m,i,'IL_STACK','Inconsistent evaluation stack height at join');continue;}heights.set(index,height);
      let pop,push;try{[pop,push]=stackEffect(inspector,m,i);}catch(error){issue(m,i,'IL_STACK',error.message);continue;}
      if(height<pop){issue(m,i,'IL_STACK','Evaluation stack underflow');continue;}const after=height-pop+push;peak=Math.max(peak,after);if(after>m.maxStack)issue(m,i,'IL_STACK','Evaluation stack exceeds maxstack');
      if(i.name==='ret'){if(height!==pop)issue(m,i,'IL_STACK','Invalid return stack');continue;}
      if(['throw','rethrow','endfinally'].includes(i.name)){if(i.name==='endfinally'&&height!==0)issue(m,i,'IL_STACK','endfinally requires an empty stack');continue;}
      if(i.operandKind.startsWith('br'))queue.push([map.get(i.operand),i.name.startsWith('leave')?0:after]);
      if(i.name==='switch')for(const target of i.operand)queue.push([map.get(target),after]);
      if(!/^(br|leave)(\.s)?$/.test(i.name))queue.push([index+1,after]);
    }
    stackHeights[t]=Object.fromEntries(heights);
    verifiedStacks.set(t,verifiedStackEntry(m,peak));
  }
  return recordVerifiedStacks(inspector,{stackHeights,success:issues.length===0,entryPoint:entry,methods:[...visited],issues,profile:'SharpForge.ManagedIL/1'},verifiedStacks);
}
