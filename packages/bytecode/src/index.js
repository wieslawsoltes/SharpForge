import {verifyNumericInstruction,verifyScalarConstant} from './numeric/source-profile.js';
import {enumTypes,frameworkType} from '@sharpforge/framework';
export {smallInteger, smallIntegerIndirect} from './numeric/small-int.js';
export {managedExceptionTypes, exceptionTypeName, exceptionBaseType, exceptionHResult, exceptionMatches} from './exception-types.js';
import {FORMAT_VERSION,Op,BinaryName,UnaryName} from './opcodes.js';
import {verifyProjectReferences} from './project-references.js';
import {projectInstructionEffect} from './project-reference-instructions.js';
export {PROJECT_REFERENCE_FORMAT,projectReferenceLimits,projectAssemblyKey,verifyProjectReferences} from './project-references.js';
export {FORMAT_VERSION,EnumConvertBase,Op,OpName,Binary,BinaryName,Unary,UnaryName} from './opcodes.js';
import {recordSourceStacks,discardSourceStacks} from './source-stack-proof.js';
export {verifiedSourceStackBound} from './source-stack-proof.js';
import {Builtins} from './builtins.js';
export {Builtins,BuiltinMap,frameworkBuiltin,CONTRACT_BUILTIN_OFFSET,createBuiltinRegistry} from './builtins.js';
export {builtinOwners,builtinMemberShape,builtinParameterType} from './builtin-metadata.js';
export {disassemble} from './disassembly.js';
export {serializeImage,deserializeImage} from './serialization.js';
/** Structural and stack-height verification for compiler output and externally loaded images. */
export function verifyImage(image,{stackBounds=false}={}){
  const errors=[],bounds=stackBounds?[]:null;
  if(image?.formatVersion!==FORMAT_VERSION||!Array.isArray(image?.methods)||!Array.isArray(image?.constants)||!Array.isArray(image?.types)||!Array.isArray(image?.sequencePoints)||!Array.isArray(image?.statics)){discardSourceStacks(image);return ['Malformed or incompatible bytecode image'];}
  const invalid = image.externalReferences === undefined ? null : verifyProjectReferences(image.externalReferences);
  if (invalid?.length) {
    discardSourceStacks(image);
    return invalid;
  }
  const fail=(m,pc,msg)=>{if(errors.length<100)errors.push(`${m?.qualifiedName??'<image>'}:${pc}: ${msg}`);};
  if(!image.constants.every(verifyScalarConstant)||!image.statics.every(s=>verifyScalarConstant(s.value)))fail(null,0,'Invalid scalar constant');
  if(image.outputKind==='library'?image.entryPoint!==null:!Number.isInteger(image.entryPoint)||!image.methods[image.entryPoint])fail(null,0,'Invalid entry point');
  for(const m of image.methods){
    if(!(m.code instanceof Int32Array)||m.code.length%3||m.code.length>3_000_000||!Array.isArray(m.locals)||!Array.isArray(m.handlers)){fail(m,0,'Invalid code or metadata');continue;}
    const n=m.code.length/3,heights=new Map(),queue=[[0,0]];let peak=0;
    for(const h of m.handlers){if(h.start<0||h.end>n||h.start>=h.end||h.target<0||h.target>=n||(h.kind==='finally'?(!Number.isInteger(h.handlerEnd)||h.handlerEnd<=h.target||h.handlerEnd>n):(h.slot<0||h.slot>=m.locals.length)))fail(m,0,'Invalid exception handler');else queue.push([h.target,0]);}
    while(queue.length){const [pc,height]=queue.pop();if(pc<0||pc>=n){fail(m,pc,'Control flow leaves the method');continue;}if(heights.has(pc)){if(heights.get(pc)!==height)fail(m,pc,'Inconsistent stack height at join');continue;}heights.set(pc,height);
      const op=m.code[pc*3],a=m.code[pc*3+1],b=m.code[pc*3+2];let need=0,delta=0;
      switch(op){
        case Op.ENUM:if(!enumTypes[a])fail(m,pc,'Invalid enum type');delta=1;break;case Op.DELEGATE:need=1;if(!image.methods[a]||frameworkType(image.constants[b])?.kind!=='delegate')fail(m,pc,'Invalid delegate');break;case Op.NOP:break;case Op.ENDFINALLY:if(height!==0)fail(m,pc,'Finally must have an empty stack');break;
        case Op.SEQ:if(!image.sequencePoints[a])fail(m,pc,'Invalid sequence point');break;
        case Op.CONST:if(a<0||a>=image.constants.length)fail(m,pc,'Invalid constant');delta=1;break;
        case Op.LDLOC:case Op.STLOC:if(a<0||a>=m.locals.length)fail(m,pc,'Invalid local');if(op===Op.LDLOC)delta=1;else need=1;break;
        case Op.LDSTATIC:case Op.STSTATIC:if(a<0||a>=image.statics.length)fail(m,pc,'Invalid static');if(op===Op.LDSTATIC)delta=1;else need=1;break;
        case Op.LDFLD:need=1;break;case Op.STFLD:need=2;delta=-1;break;
        case Op.DUP:need=1;delta=1;break;case Op.POP:need=1;delta=-1;break;
        case Op.BINARY:need=2;delta=-1;if(!BinaryName[a])fail(m,pc,'Invalid binary operator');if(!verifyNumericInstruction('binary',BinaryName[a],b))fail(m,pc,'Invalid binary mode');break;
        case Op.CONVERT:need=1;if(!verifyNumericInstruction('convert',a,b))fail(m,pc,'Invalid numeric conversion');break;
        case Op.UNARY:need=1;if(!verifyNumericInstruction('unary',UnaryName[a],b))fail(m,pc,'Invalid unary operator');break;
        case Op.JUMP:break;case Op.JFALSE:case Op.JTRUE:need=1;delta=-1;break;
        case Op.CALL:if(!image.methods[a])fail(m,pc,'Invalid method');else if(b!==image.methods[a].parameters.length+(image.methods[a].isStatic?0:1))fail(m,pc,'Invalid argument count');need=b;delta=1-b;break;
        case Op.BUILTIN:if(!Builtins[a]||b<Builtins[a].min||b>Builtins[a].max)fail(m,pc,'Invalid intrinsic');need=b;delta=1-b;break;
        case Op.RET:need=1;delta=-1;if(height!==1)fail(m,pc,'Return stack must contain exactly one value');break;
        case Op.NEWOBJ:if(!image.types[a])fail(m,pc,'Invalid managed type');delta=1;break;
        case Op.NEWARR:if(typeof image.constants[a]!=='string')fail(m,pc,'Invalid array element type');need=1;break;
        case Op.LDELEM:need=2;delta=-1;break;case Op.STELEM:need=3;delta=-2;break;
        case Op.LENGTH:need=1;break;case Op.THROW:need=1;delta=-1;break;case Op.RETHROW:break;
        default: {
          const effect = projectInstructionEffect(image, op, a, b);
          if (!effect) { fail(m, pc, 'Unknown opcode'); continue; }
          if (effect.error) fail(m, pc, effect.error);
          need = effect.need;
          delta = effect.delta;
        }
      }
      if(height<need){fail(m,pc,'Stack underflow');continue;}
      peak=Math.max(peak,height,height+delta);
      if(op===Op.RET||op===Op.THROW||op===Op.RETHROW||op===Op.ENDFINALLY)continue;
      if(op===Op.JUMP||op===Op.JFALSE||op===Op.JTRUE)queue.push([a,height+delta]);
      if(op!==Op.JUMP)queue.push([pc+1,height+delta]);
    }
    bounds?.push([m,peak]);
  }
  if(errors.length)discardSourceStacks(image);else if(bounds)recordSourceStacks(image,bounds);
  return errors;
}

export * from './numeric-exports.js';
