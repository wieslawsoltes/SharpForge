import {memberAccessFlags} from './metadata/member-definitions.js';
import {emissionMethodDebugInfo} from './emit/method-debug-info.js';
import {emitHelper, projectTypeInitializer} from './emit/helpers.js';
import {createInstructionProfile, handlerLayout, isValue, prepareProjectReferenceMembers,
  prepareProjectReferenceTypes, scalarMetadataType} from './emit/instruction-profile.js';
import {emissionDebugProfile} from './emit/debug-profile.js';
import { prepareEmission } from './emit/emission-context.js';
import {applyMemberDefinitions} from './emit/member-definitions.js';
import { finishEmittedPE } from './emit/pe-options.js';
import { EmitterSignatures } from './emitter-signatures.js';
import { emitObjectBuiltin } from './object-builtin-mapping.js';
import { emitPropertyMetadata } from './emitter-properties.js';
import {frameworkType,enumTypes} from '@sharpforge/framework';
import { EnumConvertBase, Op, BinaryName, UnaryName, Builtins, numericTypeId } from '@sharpforge/bytecode';
import { Writer, CilError, align, utf8 } from './binary.js';
import { token, codedIndex, cliSystemName } from './metadata.js';
import { CilWriter } from './opcodes.js';
import { TEXT_RVA, writeMethodBody } from './pe.js';
import { analyzeMethod, constantType } from './analysis.js';
const markerName='SharpForge.<>AllocationToken';
const binaryCodes={'+':'add','-':'sub','*':'mul','/':'div','%':'rem','&':'and','|':'or','^':'xor','<<':'shl','>>':'shr'};
/** Emits genuine PE/CLI metadata and CIL bodies. No JS source, host eval or embedded executable bytecode. */
export function emitAssembly(image,options={}) { return emitAssemblyDetailed(image,options).bytes; }
export function emitAssemblyDetailed(image,options={}) {
  const {name,framework,embedSources,includeDebug,peOptions,metadata,typeDescriptors,memberDefinitions,started}=prepareEmission(image,options);
  const context={image,metadata,framework,typeTokens:new Map(),methodTokens:new Map(),fieldTokens:new Map(),staticTokens:[],allocTokens:new Map(),descriptors:[],helperToken:0};
  context.resolveType=t=>context.typeTokens.get(t)??metadata.typeRef(cliSystemName(scalarMetadataType(t)));
  const objectToken=context.resolveType('object');
  typeDescriptors.forEach((t,index)=>{t.token=token(2,index+1);if(t.original)context.typeTokens.set(t.original.name,t.token);if(t.marker)context.typeTokens.set(markerName,t.token);});
  prepareProjectReferenceTypes(context);
  context.signatures=new EmitterSignatures(context.typeTokens,context.resolveType);
  prepareProjectReferenceMembers(context);
  // Preallocate all definition tokens before signatures or bodies can reference them.
  let nextMethod=1,nextField=1;
  for(const type of typeDescriptors){type.fieldStart=nextField;type.methodStart=nextMethod;type.fields=[];type.methods=[];
    if(type.original){for(const f of type.original.fields){const field={...f,token:token(4,nextField++),isStatic:false};context.fieldTokens.set(type.name+':'+f.index,field.token);type.fields.push(field);}image.statics.forEach((f,index)=>{if(f.name.slice(0,f.name.lastIndexOf('.'))===type.name){const field={...f,name:f.name.slice(f.name.lastIndexOf('.')+1),token:token(4,nextField++),isStatic:true};context.staticTokens[index]=field.token;type.fields.push(field);}});}
    const originals=image.methods.filter(m=>type.program?m.owner===null:type.original&&m.owner===type.name);
    for(const method of originals){const d={token:token(6,nextMethod++),name:method.name==='.ctor'?'<ctor-body>':method.name,parameters:method.parameters,returnType:method.returnType,isStatic:method.isStatic,flags:method.implementsDispose?0x1e6:method.accessor?(0x880|(method.isStatic?0x10:0)|(memberAccessFlags.get(method.accessor.access)??1)):method.name==='.cctor'?0x1891:method.name==='.ctor'?0x83:(method.isStatic?0x96:0x86),original:method,type};context.methodTokens.set(method.id,d.token);type.methods.push(d);context.descriptors.push(d);}
    if(type.program){const d={token:token(6,nextMethod++),name:'<assert>',parameters:[{name:'condition',type:'bool'},{name:'message',type:'string'}],returnType:'void',isStatic:true,flags:0x93,helper:'assert',type};type.methods.push(d);context.descriptors.push(d);context.helperToken=d.token;}
    if(type.original){const raw={token:token(6,nextMethod++),name:'.ctor',parameters:[{name:'allocation',type:markerName}],returnType:'void',isStatic:false,flags:0x1883,helper:'allocate',type};context.allocTokens.set(type.original.id,raw.token);type.methods.push(raw);context.descriptors.push(raw);
      const ctors=originals.filter(m=>m.name==='.ctor');for(const ctor of ctors.length?ctors:[null]){const d={token:token(6,nextMethod++),name:'.ctor',parameters:ctor?.parameters??[],returnType:'void',isStatic:false,flags:0x1886,helper:'constructor',ctor,type};type.methods.push(d);context.descriptors.push(d);}}
    const initializer = projectTypeInitializer(context, type, originals, token(6, nextMethod), options);
    if (initializer) { nextMethod++; type.methods.push(initializer); context.descriptors.push(initializer); }
  }
  applyMemberDefinitions(context,typeDescriptors,memberDefinitions);
  for(const t of typeDescriptors){metadata.add(2,[t.flags,metadata.string(t.metadataName??t.name),metadata.string(t.namespace),t.name==='<Module>'?0:codedIndex('TypeDefOrRef',objectToken),t.fieldStart,t.methodStart]);for(const f of t.fields)metadata.add(4,[f.flags??((f.isStatic?0x10:0)|(f.backing?1:6)),metadata.string(f.name),metadata.blob(context.signatures.field(f.type))]);}
  for(const t of typeDescriptors)for(const name of t.original?.interfaces??[])metadata.add(9,[t.token&0xffffff,codedIndex('TypeDefOrRef',context.resolveType(name))]);
  let paramRow=1;for(const d of context.descriptors){d.row=metadata.add(6,[0,0,d.flags,metadata.string(d.name),metadata.blob(context.signatures.method(d.returnType,d.parameters.map(p=>p.type),d.isStatic)),paramRow]);if(d.row!==d.token)throw new CilError('Method token allocation mismatch');for(let i=0;i<d.parameters.length;i++){metadata.add(8,[0,i+1,metadata.string(d.parameters[i].name)]);paramRow++;}}
  emitPropertyMetadata(typeDescriptors, context);
  context.external=(owner,name,returnType,parameters,isStatic=true)=>metadata.member(context.resolveType(owner),name,context.signatures.method(returnType,parameters,isStatic));
  const section=new Writer().zero(72),debugMethods=[];let ilBytes=0;
  for(const d of context.descriptors){section.pad();const rva=TEXT_RVA+section.length;metadata.rows[6][(d.token&0xffffff)-1][0]=rva;const body=d.original?emitMethod(context,d):emitHelper(context,d);d.body=body;ilBytes+=body.code.length;const sig=body.locals.length?metadata.add(17,[metadata.blob(context.signatures.locals(body.locals))]):0;section.bytes(writeMethodBody(body.code,sig,body.maxStack,body.handlers));
    if(d.original)debugMethods.push(emissionMethodDebugInfo(d,body));
  }
  const debug = emissionDebugProfile({image, framework, name, peOptions, context, debugMethods, embedSources,
    projectOptions: {...options, memberDefinitions}, typeDescriptors});
  const {bytes,metadataBytes}=finishEmittedPE({section,metadata,debug,includeDebug,entryToken:image.outputKind==='library'?0:context.methodTokens.get(image.entryPoint),options:peOptions});
  return {bytes,debug:includeDebug?debug:null,symbolData:{...debug,sources:image.sources},metrics:{emitIlMs:performance.now()-started,assemblyBytes:bytes.length,ilBytes,metadataBytes,methods:context.descriptors.length},framework};
}
function emitMethod(c,d) {
  const m=d.original,analysis=analyzeMethod(c.image,m),w=new CilWriter(),locals=m.locals.map(l=>l.type),scratch=new Map(),spans=[],starts=[],patches=[],prefixes=new Map(),handlers=handlerLayout(m),n=m.code.length/3;
  const getScratch=(type,index=0)=>{type=type==='null'?'object':type;const key=type+':'+index;if(scratch.has(key))return scratch.get(key);const slot=locals.length;if(slot>=65535)throw new CilError('Scratch locals exceed CLI limit');locals.push(type);scratch.set(key,slot);return slot;};
  const args=m.parameters.length+(m.isStatic?0:1);for(let i=0;i<args;i++)w.local('ldarg',i).local('stloc',i);
  const {needs,convert,adapt,relative,zones,leaves,emit}=createInstructionProfile(c,w,{getScratch,handlers,patches});
  const returnSlot=handlers.length&&m.returnType!=='void'?getScratch(m.returnType,999):null;
  for(let pc=0;pc<n;pc++){
    const handler=handlers.find(h=>h.target===pc);if(handler){prefixes.set(pc,w.length);if(handler.kind!=='finally')w.local('stloc',handler.slot);}
    const begin=w.length;starts[pc]=begin;const op=m.code[pc*3],a=m.code[pc*3+1],b=m.code[pc*3+2],input=analysis.states[pc];
    const top=input.at(-1),left=input.at(-2);let terminal=false;
    if (!emit(op,a,b,input)) switch(op){
      case Op.ENUM:w.integer(b).op('box',c.resolveType(enumTypes[a])).op('unbox.any',c.resolveType(enumTypes[a]));break;case Op.DELEGATE:{const type=c.image.constants[b];w.op('ldftn',c.methodTokens.get(a)).op('newobj',c.external(type,'.ctor','void',['object','nint'],false));break;}case Op.SEQ:w.op('nop');break;case Op.NOP:w.op('nop').op('nop');break;case Op.ENDFINALLY:w.op('endfinally');terminal=true;break;
      case Op.CONST:{const value=c.image.constants[a],type=constantType(value,b);if(type==='null')w.op('ldnull');else if(type==='string')w.op('ldstr',0x70000000|c.metadata.userString(value));else if(type==='double')w.op('ldc.r8',value);else {w.integer(value===true?1:value===false?0:value);if(type==='bool')w.op('conv.u1');}break;}
      case Op.LDLOC:w.local('ldloc',a);break;
      case Op.STLOC:convert(top,m.locals[a].type);w.op('dup').local('stloc',a);break;
      case Op.LDSTATIC:w.op('ldsfld',c.staticTokens[a]);break;
      case Op.STSTATIC:convert(top,c.image.statics[a].type);w.op('dup').op('stsfld',c.staticTokens[a]);break;
      case Op.LDFLD:{const field=c.fieldTokens.get(top+':'+a);if(!field)throw new CilError(`Missing field ${top}:${a}`);w.op('ldfld',field);break;}
      case Op.STFLD:{const receiver=left,field=c.fieldTokens.get(receiver+':'+a),fieldType=c.image.types.find(t=>t.name===receiver)?.fields[a]?.type;if(!field||!fieldType)throw new CilError('Missing field metadata');convert(top,fieldType);const temp=getScratch(fieldType,998);w.local('stloc',temp).local('ldloc',temp).op('stfld',field).local('ldloc',temp);break;}
      case Op.DUP:w.op('dup');break;case Op.POP:w.op('pop');break;
      case Op.BINARY:{const operator=BinaryName[a];if(b===2){adapt([left,top],['object','object']);w.op('call',c.external('string','Concat','string',['object','object']));break;}
        if(['==','!='].includes(operator)&&(left==='string'||top==='string')&&[left,top].every(t=>t==='string'||t==='null')){w.op('call',c.external('string',operator==='=='?'op_Equality':'op_Inequality','bool',['string','string']));break;}
        if((left==='double'||top==='double')&&!['&','|','^','<<','>>'].includes(operator))adapt([left,top],['double','double']);
        if(operator in binaryCodes){w.op(binaryCodes[operator]+(b===5?'.ovf':''));w.op(b===1||b===5?'conv.i4':b===3?'conv.u1':'conv.r8');}
        else if(operator==='==')w.op('ceq');else if(operator==='!=')w.op('ceq').integer(0).op('ceq');else if(operator==='<')w.op('clt');else if(operator==='>')w.op('cgt');else if(operator==='<=')w.op(left==='double'||top==='double'?'cgt.un':'cgt').integer(0).op('ceq');else if(operator==='>=')w.op(left==='double'||top==='double'?'clt.un':'clt').integer(0).op('ceq');else throw new CilError('Unsupported operator');break;}
      case Op.CONVERT:if(a>=EnumConvertBase){const type=c.resolveType(enumTypes[a-EnumConvertBase]);w.op(b===1?'conv.ovf.i4':'conv.i4').op('box',type).op('unbox.any',type).op('nop');}else w.op(a===0?(b===1?'conv.ovf.i4':'conv.i4'):'conv.r8').op('nop');break;
      case Op.UNARY:{const operator=UnaryName[a];if(b===5&&operator==='-')w.integer(-1).op('mul.ovf').op('nop');else if(operator==='!')w.integer(0).op('ceq');else if(operator==='~')w.op('not');else{if(operator==='-')w.op('neg');w.op(b===1?'conv.i4':'conv.r8');}break;}
      case Op.JUMP:{const output=analysis.outputs[pc];adapt(output,analysis.states[a]);relative(leaves(pc,a)?'leave':'br',a);terminal=true;break;}
      case Op.JFALSE:case Op.JTRUE:{// C# expression branches leave only their condition at the stack top.
        const output=analysis.outputs[pc];if(output.some((t,i)=>needs(t,analysis.states[a]?.[i])))throw new CilError('Conditional edge requires an unsupported stack conversion');
        if(leaves(pc,a)){const skip=w.length;w.op(op===Op.JFALSE?'brtrue':'brfalse',5);relative('leave',a);}else relative(op===Op.JFALSE?'brfalse':'brtrue',a);break;}
      case Op.CALL:{const target=c.image.methods[a],from=input.slice(input.length-b),to=[...(target.isStatic?[]:[target.owner]),...target.parameters.map(p=>p.type)];adapt(from,to);w.op('call',c.methodTokens.get(a));if(target.returnType==='void')w.op('ldnull');break;}
      case Op.BUILTIN:{const descriptor=Builtins[a]?.contract;if(descriptor){const from=input.slice(input.length-b),to=[...(!descriptor.isStatic&&descriptor.kind!=='constructor'?[descriptor.owner]:[]),...descriptor.parameters];adapt(from,to);if(!descriptor.isStatic&&descriptor.kind!=='constructor'&&frameworkType(descriptor.owner)?.kind==='value'){const slots=[];for(let j=to.length-1;j>=0;j--){const slot=getScratch(to[j],2000+j);slots[j]=slot;w.local('stloc',slot);}w.op('ldloca',slots[0]);for(let j=1;j<slots.length;j++)w.local('ldloc',slots[j]);}const ctor=descriptor.kind==='constructor';w.op(ctor?'newobj':descriptor.isStatic||frameworkType(descriptor.owner)?.kind==='value'?'call':'callvirt',c.external(descriptor.owner,descriptor.name,ctor?'void':descriptor.result,descriptor.parameters,descriptor.isStatic));if(!ctor&&descriptor.result==='void')w.op('ldnull');}else emitBuiltin(c,w,a,b,input.slice(input.length-b),adapt);break;}
      case Op.RET:{if(m.returnType==='void')w.op('pop');else convert(top,m.returnType);if(zones(pc).length){if(m.returnType!=='void')w.local('stloc',returnSlot);relative('leave','return');}else w.op('ret');terminal=true;break;}
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
  const nativeHandlers=handlers.map(h=>({start:starts[h.start],end:spans[h.end][0]+spans[h.end][1],target:prefixes.get(h.target),handlerEnd:prefixes.get(h.handlerEndPc)??starts[h.handlerEndPc]??returnOffset,catchType:h.kind==='finally'?0:c.resolveType('Exception'),...(h.kind==='finally'?{flags:2}:{})}));
  return {code:w.finish(),locals,maxStack:analysis.maxStack+Math.max(16,args+4),handlers:nativeHandlers,spans};
}
function emitBuiltin(c,w,id,count,types,adapt) {
  const name=Builtins[id].name;let owner,member,result,params,instance=false,newObject=false,extra=false;
  if(emitObjectBuiltin(c,w,name,types,adapt))return;
  if(name.startsWith('Console.')){owner='System.Console';member=name.slice(8);result='void';params=count?[types[0]==='null'?'string':frameworkType(types[0])?.kind==='enum'?'object':isValue(types[0])||types[0]==='string'?types[0]:'object']:[];}
  else if(name.startsWith('Math.')||name==='$Math.Abs.Int32'){owner='System.Math';member=name==='$Math.Abs.Int32'?'Abs':name.slice(5);const intResult=['Abs','Min','Max'].includes(member)&&types.every(t=>t==='int');result=intResult?'int':'double';params=types.map(()=>result);}
  else if(name.startsWith('GC.')){owner='System.GC';member=name.slice(3);result=member==='Collect'?'void':member==='GetTotalMemory'?'long':'int';params=member==='Collect'?[]:member==='GetTotalMemory'?['bool']:['int'];if(member==='GetTotalMemory'&&!count){w.integer(0);extra=true;}}
  else if(name==='int.Parse'||name==='double.Parse'){owner=name.startsWith('int')?'int':'double';member='Parse';result=owner;params=['string'];}
  else if(name.startsWith('Convert.')){owner='System.Convert';member=name.slice(8);result={ToInt32:'int',ToDouble:'double',ToString:'string'}[member];params=[types[0]==='null'?'object':isValue(types[0])||types[0]==='string'?types[0]:'object'];}
  else if(name.startsWith('Array.')){owner='Array';member=name.slice(6);result='void';params=['Array'];}
  else if(name==='Type.Name'||name==='Type.FullName'){owner=name==='Type.Name'?'System.Reflection.MemberInfo':'System.Type';member='get_'+name.slice(5);result='string';params=[];instance=true;}
  else if(name==='Enum.HasFlag'){adapt(types,['object','object']);w.op('callvirt',c.external('System.Enum','HasFlag','bool',['System.Enum'],false));return;}
  else if(name==='string.get_Chars'){adapt(types,['string','int']);w.op('callvirt',c.external('string','get_Chars','char',['int'],false)).op('conv.i4');return;}
  else if(name==='Exception.new'){owner='Exception';member='.ctor';result='void';params=['string'];instance=true;newObject=true;}
  else if(name==='Exception.Message'){owner='Exception';member='get_Message';result='string';params=[];instance=true;}
  else if(name==='Debug.Assert'){if(count===1)w.op('ldstr',0x70000000|c.metadata.userString('Assertion failed'));w.op('call',c.helperToken).op('ldnull');return;}
  else if(name==='Environment.TickCount'){owner='System.Environment';member='get_TickCount';result='int';params=[];}
  else if(name.startsWith('string.')){owner='string';member=name.slice(7);result=['Contains','StartsWith','EndsWith','IsNullOrEmpty'].includes(member)?'bool':member==='IndexOf'?'int':'string';instance=!['Concat','IsNullOrEmpty','Intern','IsInterned'].includes(member);params=member==='Concat'?['string','string']:['IsNullOrEmpty','Intern','IsInterned'].includes(member)?['string']:member==='Substring'?Array(count-1).fill('int'):['Contains','IndexOf','StartsWith','EndsWith'].includes(member)?['string']:member==='Replace'?['string','string']:[];}
  else throw new CilError(`No CIL intrinsic mapping for ${name}`);
  if(!extra)adapt(types,[...(instance&&!newObject?[owner]:[]),...params]);
  w.op(newObject?'newobj':instance?'callvirt':'call',c.external(owner,member,result,params,!instance));if(result==='void'&&!newObject)w.op('ldnull');
}
