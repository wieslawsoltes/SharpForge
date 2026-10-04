import {enumTypes} from '@sharpforge/framework';
import { EnumConvertBase, Op, Builtins, verifyImage, numericTypeName } from '@sharpforge/bytecode';
import { CilError } from './binary.js';
import {constantType,merge,binaryType,unaryType} from './analysis-types.js';
export {constantType,defaultValue} from './analysis-types.js';
export function analyzeMethod(image,method) {
  const count=method.code.length/3,states=Array(count),outputs=Array(count),queue=[[0,[]]],typeMap=new Map(image.types.map(t=>[t.name,t]));let maxStack=0;
  for(const h of method.handlers)queue.push([h.target,[]]);let work=0;
  function transfer(pc,input) {const stack=[...input],op=method.code[pc*3],a=method.code[pc*3+1],b=method.code[pc*3+2],pop=()=>{if(!stack.length)throw new CilError(`Stack underflow in ${method.qualifiedName}:${pc}`);return stack.pop();};
    switch(op){
      case Op.ENUM:stack.push(enumTypes[a]);break;case Op.DELEGATE:pop();stack.push(image.constants[b]);break;case Op.CONST:stack.push(constantType(image.constants[a],b));break;
      case Op.LDLOC:stack.push(method.locals[a].type);break;case Op.LDSTATIC:stack.push(image.statics[a].type);break;
      case Op.STLOC:pop();stack.push(method.locals[a].type);break;case Op.STSTATIC:pop();stack.push(image.statics[a].type);break;
      case Op.LDFLD:{const receiver=pop(),field=typeMap.get(receiver)?.fields[a];if(!field)throw new CilError(`Cannot resolve field ${receiver}:${a}`);stack.push(field.type);break;}
      case Op.STFLD:{pop();const receiver=pop(),field=typeMap.get(receiver)?.fields[a];if(!field)throw new CilError('Unknown store field');stack.push(field.type);break;}
      case Op.DUP:stack.push(stack.at(-1));break;case Op.POP:pop();break;
      case Op.BINARY:pop();pop();stack.push(binaryType(a,b));break;
      case Op.CONVERT:pop();stack.push(a>=EnumConvertBase?enumTypes[a-EnumConvertBase]:numericTypeName(a));break;
      case Op.UNARY:stack.push(unaryType(a,b,pop()));break;
      case Op.JFALSE:case Op.JTRUE:pop();break;
      case Op.CALL:for(let i=0;i<b;i++)pop();stack.push(image.methods[a].returnType==='void'?'null':image.methods[a].returnType);break;
      case Op.BUILTIN:{const args=stack.splice(stack.length-b,b),result=Builtins[a].result;stack.push(result==='void'?'null':result==='numeric'?(args.includes('double')?'double':'int'):result);break;}
      case Op.RET:case Op.THROW:pop();break;
      case Op.NEWOBJ:stack.push(image.types[a].name);break;
      case Op.NEWARR:pop();stack.push(image.constants[a]+'[]');break;
      case Op.LDELEM:{pop();const array=pop();if(!array.endsWith('[]'))throw new CilError('Cannot resolve array element type');stack.push(array.slice(0,-2));break;}
      case Op.STELEM:{pop();pop();const array=pop();stack.push(array.slice(0,-2));break;}
      case Op.LENGTH:pop();stack.push('int');break;
    }
    return stack;
  }
  while(queue.length){if(++work>count*32+1024)throw new CilError('Type analysis convergence limit exceeded');const [pc,input]=queue.pop();if(pc<0||pc>=count)throw new CilError('Control flow leaves method');let state=input;if(states[pc]){if(states[pc].length!==input.length)throw new CilError('Stack-height mismatch');state=input.map((t,i)=>merge(t,states[pc][i]));if(state.every((t,i)=>t===states[pc][i]))continue;}states[pc]=state;maxStack=Math.max(maxStack,state.length);const output=transfer(pc,state);outputs[pc]=output;maxStack=Math.max(maxStack,output.length);const op=method.code[pc*3],target=method.code[pc*3+1];if([Op.RET,Op.THROW,Op.RETHROW,Op.ENDFINALLY].includes(op))continue;if([Op.JUMP,Op.JFALSE,Op.JTRUE].includes(op))queue.push([target,output]);if(op!==Op.JUMP)queue.push([pc+1,output]);}
  // Unreachable cleanup and terminal defaults are emitted too. They do not contribute CFG edges.
  let fallback=[];for(let pc=0;pc<count;pc++){if(states[pc]){fallback=outputs[pc];continue;}states[pc]=fallback;try{outputs[pc]=transfer(pc,fallback);}catch{states[pc]=[];outputs[pc]=[];}fallback=[Op.RET,Op.THROW,Op.RETHROW,Op.JUMP,Op.ENDFINALLY].includes(method.code[pc*3])?[]:outputs[pc];}
  return {states,outputs,maxStack};
}
export function validateInput(image) { const errors=verifyImage(image);if(errors.length)throw new CilError('Invalid compiler image: '+errors.join('; '));for(const method of image.methods){if(method.locals.length>65000)throw new CilError('Too many locals for CIL emission');} }
