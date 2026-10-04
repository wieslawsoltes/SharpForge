import {emitSourceCall} from './source-call-emission.js';
import {emitSourceMethodImpls, sourceAbstractDebug} from './source-interface-metadata.js';
import {emitSourceNullable} from './source-nullable-emission.js';
import {emitSourceVarargsInstruction} from './source-varargs-emission.js';
import {emittedMethodFlags} from './emit/method-flags.js';
import {sourceTypeBase, sourceValueType, emitSourceHelper, emitSourceValueInstruction} from './emit/source-values.js';
import {emitSourceHandlerEntry,nativeSourceHandlers} from './emit/control-regions.js';
import {emitSourceUnsafeMemory,sourceLocalSignatureType} from './source-unsafe-memory.js';
import {emitSourceMemoryInstruction} from './source-memory-emission.js';
import {resolveSourceType,memoryTypeName} from './source-memory-types.js';
import { sourceExceptionLayout } from './emit/exception-regions.js';
import {emitScalarInstruction, emitScalarConversion, scalarMetadataType} from './scalar-emission.js';
import { prepareEmission } from './emit/emission-context.js';
import { emissionTypeDescriptors } from './emit/type-descriptors.js';
import { debugPEOptions, finishEmittedPE } from './emit/pe-options.js';
import {sourceTypeMappings} from './source-type-identities.js';
import { EmitterSignatures } from './emitter-signatures.js';
import {emitBuiltin} from './builtin-emission.js';
import { emitPropertyMetadata } from './emitter-properties.js';
import {frameworkType,enumTypes} from '@sharpforge/framework';
import { EnumConvertBase, Op, BinaryName, UnaryName, Builtins, numericTypeId, numericTypeName } from '@sharpforge/bytecode';
import { Writer, CilError, align, utf8 } from './binary.js';
import { token, codedIndex, cliSystemName } from './metadata.js';
import { CilWriter } from './opcodes.js';
import { TEXT_RVA, writeMethodBody } from './pe.js';
import { analyzeMethod, constantType } from './analysis.js';
const markerName='SharpForge.<>AllocationToken';
const isValue=t=>(numericTypeId(t)!==undefined||t==='bool')||['enum','value'].includes(frameworkType(t)?.kind);
const binaryCodes={'+':'add','-':'sub','*':'mul','/':'div','%':'rem','&':'and','|':'or','^':'xor','<<':'shl','>>':'shr'};
/** Emits genuine PE/CLI metadata and CIL bodies. No JS source, host eval or embedded executable bytecode. */
export function emitAssembly(image,options={}) { return emitAssemblyDetailed(image,options).bytes; }
export function emitAssemblyDetailed(image,options={}) {
  const {name,framework,embedSources,includeDebug,peOptions,metadata,started}=prepareEmission(image,options);
  const context={image,metadata,framework,typeTokens:new Map(),methodTokens:new Map(),fieldTokens:new Map(),staticTokens:[],allocTokens:new Map(),descriptors:[],helperToken:0};
  context.resolveType=t=>resolveSourceType(context,t);
  const objectToken=context.resolveType('object');
  const typeDescriptors=emissionTypeDescriptors(image,peOptions);
  typeDescriptors.forEach((t,index)=>{t.token=token(2,index+1);if(t.original)context.typeTokens.set(t.original.name,t.token);if(t.marker)context.typeTokens.set(markerName,t.token);});
  context.signatures=new EmitterSignatures(context.typeTokens,context.resolveType,image.types);
  // Preallocate all definition tokens before signatures or bodies can reference them.
  let nextMethod=1,nextField=1;
  for(const type of typeDescriptors){type.fieldStart=nextField;type.methodStart=nextMethod;type.fields=[];type.methods=[];
    if(type.original){for(const f of type.original.fields){const field={...f,token:token(4,nextField++),isStatic:false};context.fieldTokens.set(type.name+':'+f.index,field.token);type.fields.push(field);}image.statics.forEach((f,index)=>{if(f.name.slice(0,f.name.lastIndexOf('.'))===type.name){const field={...f,name:f.name.slice(f.name.lastIndexOf('.')+1),token:token(4,nextField++),isStatic:true};context.staticTokens[index]=field.token;type.fields.push(field);}});}
    const originals=image.methods.filter(m=>type.program?m.owner===null:type.original&&m.owner===type.name);
    for(const method of originals){const d={token:token(6,nextMethod++),name:method.name==='.ctor'?'<ctor-body>':method.name,parameters:method.parameters,returnType:method.returnType,isStatic:method.isStatic,flags:emittedMethodFlags(method),original:method,type};context.methodTokens.set(method.id,d.token);type.methods.push(d);context.descriptors.push(d);}
    if(type.program){const d={token:token(6,nextMethod++),name:'<assert>',parameters:[{name:'condition',type:'bool'},{name:'message',type:'string'}],returnType:'void',isStatic:true,flags:0x93,helper:'assert',type};type.methods.push(d);context.descriptors.push(d);context.helperToken=d.token;}
    if(type.original&&!type.original.interface){const raw={token:token(6,nextMethod++),name:'.ctor',parameters:[{name:'allocation',type:markerName}],returnType:'void',isStatic:false,flags:0x1883,helper:'allocate',type};context.allocTokens.set(type.original.id,raw.token);type.methods.push(raw);context.descriptors.push(raw);
      const ctors=originals.filter(m=>m.name==='.ctor');for(const ctor of ctors.length?ctors:[null]){const d={token:token(6,nextMethod++),name:'.ctor',parameters:ctor?.parameters??[],returnType:'void',isStatic:false,flags:0x1886,helper:'constructor',ctor,type};type.methods.push(d);context.descriptors.push(d);}}
  }
  for(const t of typeDescriptors){metadata.add(2,[t.flags,metadata.string(t.name),metadata.string(t.namespace),sourceTypeBase(context,t,objectToken),t.fieldStart,t.methodStart]);for(const f of t.fields)metadata.add(4,[(f.isStatic?0x10:0)|(f.backing?1:6),metadata.string(f.name),metadata.blob(context.signatures.field(f.type))]);}
  for(const t of typeDescriptors)for(const name of t.original?.interfaces??[])metadata.add(9,[t.token&0xffffff,codedIndex('TypeDefOrRef',context.resolveType(name))]);
  let paramRow=1;for(const d of context.descriptors){d.row=metadata.add(6,[0,0,d.flags,metadata.string(d.name),metadata.blob(context.signatures.method(d.returnType,d.parameters.map(p=>p.type),d.isStatic,{callingConvention:d.original?.callingConvention??0})),paramRow]);if(d.row!==d.token)throw new CilError('Method token allocation mismatch');for(let i=0;i<d.parameters.length;i++){metadata.add(8,[0,i+1,metadata.string(d.parameters[i].name)]);paramRow++;}}
  emitSourceMethodImpls(context);
  emitPropertyMetadata(typeDescriptors, context);
  context.external=(owner,name,returnType,parameters,isStatic=true)=>metadata.member(context.resolveType(owner),name,context.signatures.method(returnType,parameters,isStatic));
  const section=new Writer().zero(72),debugMethods=[];let ilBytes=0;
  for(const d of context.descriptors){if(d.original?.isAbstract){debugMethods.push(sourceAbstractDebug(d));continue;}section.pad();const rva=TEXT_RVA+section.length;metadata.rows[6][(d.token&0xffffff)-1][0]=rva;const body=d.original?emitMethod(context,d):emitSourceHelper(context,d);d.body=body;ilBytes+=body.code.length;const sig=body.locals.length?metadata.add(17,[metadata.blob(context.signatures.locals(body.locals))]):0;section.bytes(writeMethodBody(body.code,sig,body.maxStack,body.handlers));
    if(d.original)debugMethods.push({...(d.original.asyncRole?{asyncRole:d.original.asyncRole,asyncOrigin:d.original.asyncOrigin}:{}),id:d.original.id,token:d.token,name:d.original.name,qualifiedName:d.original.qualifiedName,...(d.original.sourceRange?{sourceRange:d.original.sourceRange}:{}),...(d.original.accessor?{accessor:d.original.accessor}:{}),locals:d.original.locals.map(({type,...local})=>local),spans:body.spans});
  }
  debugMethods.sort((a,b)=>a.id-b.id);const debug={format:'SharpForge.CIL',version:1,framework,name,...debugPEOptions(peOptions),entry:image.entryPoint,...(image.outputKind==='library'?{outputKind:'library'}:{}),types:sourceTypeMappings(image,context.typeTokens),statics:context.staticTokens,methods:debugMethods,sequencePoints:image.sequencePoints.map(p=>({...p,ilOffset:debugMethods[p.methodId].spans[p.offset][0],methodToken:context.methodTokens.get(p.methodId)})),sources:image.sources.map(s=>embedSources?s:({uri:s.uri,version:s.version}))};
  const {bytes,metadataBytes}=finishEmittedPE({section,metadata,debug,includeDebug,entryToken:image.outputKind==='library'?0:context.methodTokens.get(image.entryPoint),options:peOptions});
  return {bytes,debug:includeDebug?debug:null,symbolData:{...debug,sources:image.sources},metrics:{emitIlMs:performance.now()-started,assemblyBytes:bytes.length,ilBytes,metadataBytes,methods:context.descriptors.length},framework};
}
function emitMethod(c,d) {
  const m=d.original,analysis=analyzeMethod(c.image,m),w=new CilWriter(),locals=m.locals.map(sourceLocalSignatureType),scratch=new Map(),spans=[],starts=[],patches=[],prefixes=new Map(),layout=sourceExceptionLayout(m),handlers=layout.handlers,n=m.code.length/3;
  const getScratch=(type,index=0)=>{type=type==='null'?'object':memoryTypeName(type);const key=type+':'+index;if(scratch.has(key))return scratch.get(key);const slot=locals.length;if(slot>=65535)throw new CilError('Scratch locals exceed CLI limit');locals.push(type);scratch.set(key,slot);return slot;};
  const args=m.parameters.length+(m.isStatic?0:1);for(let i=0;i<args;i++)w.local('ldarg',i).local('stloc',i);
  const needs=(from,to)=>numericTypeName(from)!==numericTypeName(to)&&((numericTypeId(to)!==undefined&&numericTypeId(from)!==undefined)||(to==='object'&&(isValue(from)||sourceValueType(c,from))));
  function convert(from,to){if(from==='null'&&/[&*]$/.test(to)){w.op('pop').integer(0).op('conv.u');return;}if(from===to||from==='null')return;if(numericTypeId(to)!==undefined&&numericTypeId(from)!==undefined)emitScalarConversion(w,c,from,to);else if(to==='object'&&(isValue(from)||sourceValueType(c,from)))w.op('box',c.resolveType(from));}
  function adapt(from,to){if(from.length!==to.length)throw new CilError('Invalid conversion stack shape');if(!from.some((t,i)=>needs(t,to[i])))return;let lowest=from.findIndex((t,i)=>needs(t,to[i]));const slots=new Map();for(let i=from.length-1;i>lowest;i--){const slot=getScratch(from[i],i);slots.set(i,slot);w.local('stloc',slot);}convert(from[lowest],to[lowest]);for(let i=lowest+1;i<from.length;i++){w.local('ldloc',slots.get(i));convert(from[i],to[i]);}}
  function relative(name,target){const at=w.length;w.op(name,0);patches.push({at:at+1,end:at+5,target});}
  const returnSlot=handlers.length&&m.returnType!=='void'?getScratch(m.returnType,999):null;
  for(let pc=0;pc<n;pc++){
    emitSourceHandlerEntry(w,c,layout,pc,prefixes);
    const begin=w.length;starts[pc]=begin;const op=m.code[pc*3],a=m.code[pc*3+1],b=m.code[pc*3+2],input=analysis.states[pc];
    const top=input.at(-1),left=input.at(-2);let terminal=false;
    if(!emitSourceNullable(w,c,{op,a,b,getScratch,input})
      &&!emitSourceVarargsInstruction(w,c,{op,a,b,input,adapt})
      &&!emitSourceCall(w,c,{op,a,b,input,adapt})
      &&!emitSourceUnsafeMemory(w,c,{op,a,b,input})
      &&!emitSourceMemoryInstruction(w,c,{op,a,b,input,method:m,pc,getScratch,adapt})
      &&!emitSourceValueInstruction(w,c,{op,a,b})&&!emitScalarInstruction(w,c,{op,a,b}))switch(op){
      case Op.ENUM:w.integer(b).op('box',c.resolveType(enumTypes[a])).op('unbox.any',c.resolveType(enumTypes[a]));break;case Op.DELEGATE:{const type=c.image.constants[b];w.op('ldftn',c.methodTokens.get(a)).op('newobj',c.external(type,'.ctor','void',['object','nint'],false));break;}case Op.SEQ:w.op('nop');break;case Op.NOP:w.op('nop').op('nop');break;case Op.ENDFINALLY:w.op('endfinally');terminal=true;break;case Op.ENDFILTER:w.op('endfilter');terminal=true;break;
      case Op.CONST:{const value=c.image.constants[a],type=constantType(value,b);if(type==='null')w.op('ldnull');else if(type==='string')w.op('ldstr',0x70000000|c.metadata.userString(value));else if(type==='double')w.op('ldc.r8',value);else {w.integer(value===true?1:value===false?0:value);if(type==='bool')w.op('conv.u1');}break;}
      case Op.LDLOC:w.local('ldloc',a);break;
      case Op.STLOC:convert(top,m.locals[a].type);w.op('dup').local('stloc',a);break;
      case Op.LDSTATIC:w.op('ldsfld',c.staticTokens[a]);break;
      case Op.STSTATIC:convert(top,c.image.statics[a].type);w.op('dup').op('stsfld',c.staticTokens[a]);break;
      case Op.LDFLD:{const field=c.fieldTokens.get(top.replace(/&$/,'')+':'+a);if(!field)throw new CilError(`Missing field ${top}:${a}`);w.op('ldfld',field);break;}
      case Op.STFLD:{const receiver=left.replace(/&$/,''),field=c.fieldTokens.get(receiver+':'+a),fieldType=c.image.types.find(t=>t.name===receiver)?.fields[a]?.type;if(!field||!fieldType)throw new CilError('Missing field metadata');convert(top,fieldType);const temp=getScratch(fieldType,998);w.local('stloc',temp).local('ldloc',temp).op('stfld',field).local('ldloc',temp);break;}
      case Op.DUP:w.op('dup');break;case Op.POP:w.op('pop');break;
      case Op.BINARY:{const operator=BinaryName[a];if(b===2){adapt([left,top],['object','object']);w.op('call',c.external('string','Concat','string',['object','object']));break;}
        if(['==','!='].includes(operator)&&(left==='string'||top==='string')&&[left,top].every(t=>t==='string'||t==='null')){w.op('call',c.external('string',operator==='=='?'op_Equality':'op_Inequality','bool',['string','string']));break;}
        if((left==='double'||top==='double')&&!['&','|','^','<<','>>'].includes(operator))adapt([left,top],['double','double']);
        if(operator in binaryCodes){w.op(binaryCodes[operator]+(b===5?'.ovf':''));w.op(b===1||b===5?'conv.i4':b===3?'conv.u1':'conv.r8');}
        else if(operator==='==')w.op('ceq');else if(operator==='!=')w.op('ceq').integer(0).op('ceq');else if(operator==='<')w.op('clt');else if(operator==='>')w.op('cgt');else if(operator==='<=')w.op(left==='double'||top==='double'?'cgt.un':'cgt').integer(0).op('ceq');else if(operator==='>=')w.op(left==='double'||top==='double'?'clt.un':'clt').integer(0).op('ceq');else throw new CilError('Unsupported operator');break;}
      case Op.CONVERT:if(a>=EnumConvertBase){const type=c.resolveType(enumTypes[a-EnumConvertBase]);w.op(b===1?'conv.ovf.i4':'conv.i4').op('box',type).op('unbox.any',type).op('nop');}else w.op(a===0?(b===1?'conv.ovf.i4':'conv.i4'):'conv.r8').op('nop');break;
      case Op.UNARY:{const operator=UnaryName[a];if(b===5&&operator==='-')w.integer(-1).op('mul.ovf').op('nop');else if(operator==='!')w.integer(0).op('ceq');else if(operator==='~')w.op('not');else{if(operator==='-')w.op('neg');w.op(b===1?'conv.i4':'conv.r8');}break;}
      case Op.JUMP:{const output=analysis.outputs[pc];adapt(output,analysis.states[a]);relative(layout.leaves(pc,a)?'leave':'br',a);terminal=true;break;}
      case Op.JFALSE:case Op.JTRUE:{// C# expression branches leave only their condition at the stack top.
        const output=analysis.outputs[pc];if(output.some((t,i)=>needs(t,analysis.states[a]?.[i])))throw new CilError('Conditional edge requires an unsupported stack conversion');
        if(layout.leaves(pc,a)){const skip=w.length;w.op(op===Op.JFALSE?'brtrue':'brfalse',5);relative('leave',a);}else relative(op===Op.JFALSE?'brfalse':'brtrue',a);break;}
      case Op.BUILTIN:{const descriptor=Builtins[a]?.contract;if(descriptor){const from=input.slice(input.length-b),to=[...(!descriptor.isStatic&&descriptor.kind!=='constructor'?[descriptor.owner]:[]),...descriptor.parameters];adapt(from,to);if(!descriptor.isStatic&&descriptor.kind!=='constructor'&&frameworkType(descriptor.owner)?.kind==='value'){const slots=[];for(let j=to.length-1;j>=0;j--){const slot=getScratch(to[j],2000+j);slots[j]=slot;w.local('stloc',slot);}w.op('ldloca',slots[0]);for(let j=1;j<slots.length;j++)w.local('ldloc',slots[j]);}const ctor=descriptor.kind==='constructor';w.op(ctor?'newobj':descriptor.isStatic||frameworkType(descriptor.owner)?.kind==='value'?'call':'callvirt',c.external(descriptor.owner,descriptor.name,ctor?'void':descriptor.result,descriptor.parameters,descriptor.isStatic));if(!ctor&&descriptor.result==='void')w.op('ldnull');}else emitBuiltin(c,w,a,input.slice(input.length-b),adapt);break;}
      case Op.RET:{if(m.returnType==='void')w.op('pop');else convert(top,m.returnType);if(layout.protected(pc)){if(m.returnType!=='void')w.local('stloc',returnSlot);relative('leave','return');}else w.op('ret');terminal=true;break;}
      case Op.NEWOBJ:w.op('ldnull').op('newobj',c.allocTokens.get(a));break;
      case Op.NEWARR:w.op('newarr',c.resolveType(c.image.constants[a]));break;
      case Op.LDELEM:w.op('ldelem',c.resolveType(left.slice(0,-2)));break;
      case Op.STELEM:{const type=input.at(-3).slice(0,-2);convert(top,type);const temp=getScratch(type,998);w.local('stloc',temp).local('ldloc',temp).op('stelem',c.resolveType(type)).local('ldloc',temp);break;}
      case Op.LENGTH:if(top==='string')w.op('callvirt',c.external('string','get_Length','int',[],false));else w.op('ldlen').op('conv.i4');break;
      case Op.THROW:w.op('throw');terminal=true;break;case Op.RETHROW:w.op('rethrow');terminal=true;break;
      default:throw new CilError('Unsupported compiler instruction');
    }
    if(!terminal&&pc+1<n&&analysis.outputs[pc].length===analysis.states[pc+1].length)adapt(analysis.outputs[pc],analysis.states[pc+1]);
    spans.push([begin,w.length-begin]);
  }
  const returnOffset=w.length;if(handlers.length){if(m.returnType!=='void')w.local('ldloc',returnSlot);w.op('ret');}
  for(const patch of patches){const target=patch.target==='return'?returnOffset:starts[patch.target];if(target===undefined)throw new CilError('Missing CIL branch target');w.patch32(patch.at,target-patch.end);}
  const nativeHandlers=nativeSourceHandlers(c,handlers,{starts,prefixes,returnOffset});
  return {code:w.finish(),locals,maxStack:analysis.maxStack+Math.max(16,args+4),handlers:nativeHandlers,spans};
}
