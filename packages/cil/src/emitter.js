import {variableCallToken, emitVarargsInstruction} from './varargs-emission.js';
import {emitReferenceInstruction} from './reference-emission.js';
import {sourceHandlerLayout,emitSourceHandlerEntry,sourceHandlerZones,nativeSourceHandlers} from './source-exception-regions.js';
import {emitMemoryInstruction} from './memory-emission.js';
import {emitScalarConstant,emitScalarConversion,emitScalarBinary,emitScalarUnary,scalarMarker} from './scalar-emission.js';
import {frameworkType,enumTypes} from '@sharpforge/framework';
import { numericTypeNames,numericTypeName,decodeNumericMode, EnumConvertBase, Op, BinaryName, UnaryName, Builtins } from '@sharpforge/bytecode';
import { Writer, CilError, align, utf8 } from './binary.js';
import { MetadataBuilder, token, codedIndex, cliSystemName, methodSignature, localSignature, fieldSignature } from './metadata.js';
import { CilWriter } from './opcodes.js';
import { TEXT_RVA, writeMethodBody, writePE } from './pe.js';
import { analyzeMethod, constantType, validateInput } from './analysis.js';
const markerName='SharpForge.<>AllocationToken';
const isValue=t=>numericTypeNames.includes(numericTypeName(t))||t==='bool'||['enum','value'].includes(frameworkType(t)?.kind);
const binaryCodes={'+':'add','-':'sub','*':'mul','/':'div','%':'rem','&':'and','|':'or','^':'xor','<<':'shl','>>':'shr'};
function safeName(name) { if(typeof name!=='string'||!name||name.length>512||/[\0/\\]/.test(name))throw new CilError('Invalid assembly name');return name.replace(/\.dll$/i,''); }
/** Emits genuine PE/CLI metadata and CIL bodies. No JS source, host eval or embedded executable bytecode. */
export function emitAssembly(image,options={}) { return emitAssemblyDetailed(image,options).bytes; }
export function emitAssemblyDetailed(image,{name=image.name??'Application',framework='net8',embedSources=true,includeDebug=true}={}) {
  validateInput(image);if(!['net8','mscorlib4'].includes(framework))throw new CilError('Supported reference profiles: net8, mscorlib4');name=safeName(name);const started=performance.now(),metadata=new MetadataBuilder(name,{framework});
  const context={image,metadata,framework,typeTokens:new Map(),methodTokens:new Map(),fieldTokens:new Map(),staticTokens:[],allocTokens:new Map(),descriptors:[],helperToken:0};
  context.resolveType=t=>context.typeTokens.get(t)??metadata.typeRef(cliSystemName(t));
  const objectToken=context.resolveType('object');
  const typeDescriptors=[{name:'<Module>',namespace:'',flags:0,original:null},{name:'<>Program',namespace:'SharpForge',flags:0x100181,original:null,program:true},{name:'<>AllocationToken',namespace:'SharpForge',flags:0x100101,original:null,marker:true},...image.types.map(t=>({name:t.name,namespace:'',flags:image.outputKind==='library'?0x000001:0x100001,original:t}))];
  typeDescriptors.forEach((t,index)=>{t.token=token(2,index+1);if(t.original)context.typeTokens.set(t.original.name,t.token);if(t.marker)context.typeTokens.set(markerName,t.token);});
  // Preallocate all definition tokens before signatures or bodies can reference them.
  let nextMethod=1,nextField=1;
  for(const type of typeDescriptors){type.fieldStart=nextField;type.methodStart=nextMethod;type.fields=[];type.methods=[];
    if(type.original){for(const f of type.original.fields){const field={...f,token:token(4,nextField++),isStatic:false};context.fieldTokens.set(type.name+':'+f.index,field.token);type.fields.push(field);}image.statics.forEach((f,index)=>{if(f.name.slice(0,f.name.lastIndexOf('.'))===type.name){const field={...f,name:f.name.slice(f.name.lastIndexOf('.')+1),token:token(4,nextField++),isStatic:true};context.staticTokens[index]=field.token;type.fields.push(field);}});}
    const originals=image.methods.filter(m=>type.program?m.owner===null:type.original&&m.owner===type.name);
    for(const method of originals){const d={token:token(6,nextMethod++),name:method.name==='.ctor'?'<ctor-body>':method.name,parameters:method.parameters,returnType:method.returnType,isStatic:method.isStatic,flags:method.implementsDispose?0x1e6:method.accessor?(0x880|(method.isStatic?0x10:0)|({public:6,private:1,protected:4,internal:3}[method.accessor.access]??1)):method.name==='.cctor'?0x1891:method.name==='.ctor'?0x83:(method.isStatic?0x96:0x86),original:method,type};context.methodTokens.set(method.id,d.token);type.methods.push(d);context.descriptors.push(d);}
    if(type.program){const d={token:token(6,nextMethod++),name:'<assert>',parameters:[{name:'condition',type:'bool'},{name:'message',type:'string'}],returnType:'void',isStatic:true,flags:0x93,helper:'assert',type};type.methods.push(d);context.descriptors.push(d);context.helperToken=d.token;}
    if(type.original){const raw={token:token(6,nextMethod++),name:'.ctor',parameters:[{name:'allocation',type:markerName}],returnType:'void',isStatic:false,flags:0x1883,helper:'allocate',type};context.allocTokens.set(type.original.id,raw.token);type.methods.push(raw);context.descriptors.push(raw);
      const ctors=originals.filter(m=>m.name==='.ctor');for(const ctor of ctors.length?ctors:[null]){const d={token:token(6,nextMethod++),name:'.ctor',parameters:ctor?.parameters??[],returnType:'void',isStatic:false,flags:0x1886,helper:'constructor',ctor,type};type.methods.push(d);context.descriptors.push(d);}}
  }
  for(const t of typeDescriptors){metadata.add(2,[t.flags,metadata.string(t.name),metadata.string(t.namespace),t.name==='<Module>'?0:codedIndex('TypeDefOrRef',objectToken),t.fieldStart,t.methodStart]);for(const f of t.fields)metadata.add(4,[(f.isStatic?0x10:0)|(f.backing?1:6),metadata.string(f.name),metadata.blob(fieldSignature(f.type,context.resolveType))]);}
  for(const t of typeDescriptors)for(const name of t.original?.interfaces??[])metadata.add(9,[t.token&0xffffff,codedIndex('TypeDefOrRef',context.resolveType(name))]);
  let paramRow=1;for(const d of context.descriptors){d.row=metadata.add(6,[0,0,d.flags,metadata.string(d.name),metadata.blob(methodSignature(d.returnType,d.parameters.map(p=>p.type),d.isStatic,context.resolveType,0,d.original?.callingConvention??0)),paramRow]);if(d.row!==d.token)throw new CilError('Method token allocation mismatch');for(let i=0;i<d.parameters.length;i++){metadata.add(8,[d.parameters[i].refKind==='out'?2:d.parameters[i].refKind==='in'?1:0,i+1,metadata.string(d.parameters[i].name)]);paramRow++;}}
  for(const descriptor of typeDescriptors){const properties=descriptor.original?.properties??[];if(!properties.length)continue;
    metadata.add(21,[descriptor.token&0xffffff,(metadata.rows[23]?.length??0)+1]);
    for(const property of properties){const signature=methodSignature(property.type,[],property.isStatic,context.resolveType);signature[0]|=8;
      const pt=metadata.add(23,[0,metadata.string(property.name),metadata.blob(signature)]);
      if(property.get!==null)metadata.add(24,[2,context.methodTokens.get(property.get)&0xffffff,codedIndex('HasSemantics',pt)]);
      if(property.set!==null)metadata.add(24,[1,context.methodTokens.get(property.set)&0xffffff,codedIndex('HasSemantics',pt)]);
    }
  }
  context.external=(owner,name,returnType,parameters,isStatic=true,genericArity=0)=>metadata.member(context.resolveType(owner),name,methodSignature(returnType,parameters,isStatic,context.resolveType,genericArity));
  const section=new Writer().zero(72),debugMethods=[];let ilBytes=0;
  for(const d of context.descriptors){section.pad();const rva=TEXT_RVA+section.length;metadata.rows[6][(d.token&0xffffff)-1][0]=rva;const body=d.original?emitMethod(context,d):emitHelper(context,d);d.body=body;ilBytes+=body.code.length;const sig=body.locals.length?metadata.add(17,[metadata.blob(localSignature(body.locals,context.resolveType))]):0;section.bytes(writeMethodBody(body.code,sig,body.maxStack,body.handlers));
    if(d.original)debugMethods.push({...(d.original.asyncRole?{asyncRole:d.original.asyncRole,asyncOrigin:d.original.asyncOrigin}:{}),id:d.original.id,token:d.token,name:d.original.name,qualifiedName:d.original.qualifiedName,...(d.original.sourceRange?{sourceRange:d.original.sourceRange}:{}),...(d.original.accessor?{accessor:d.original.accessor}:{}),locals:d.original.locals.map(({type,...local})=>local),spans:body.spans});
  }
  debugMethods.sort((a,b)=>a.id-b.id);const debug={format:'SharpForge.CIL',version:1,framework,name,entry:image.entryPoint,...(image.outputKind==='library'?{outputKind:'library'}:{}),types:image.types.map(t=>({id:t.id,token:context.typeTokens.get(t.name),initializer:t.initializer})),statics:context.staticTokens,methods:debugMethods,sequencePoints:image.sequencePoints.map(p=>({...p,ilOffset:debugMethods[p.methodId].spans[p.offset][0],methodToken:context.methodTokens.get(p.methodId)})),sources:image.sources.map(s=>embedSources?s:({uri:s.uri,version:s.version}))};
  section.pad();const metadataOffset=section.length,md=metadata.finish(includeDebug?debug:null,section.finish());section.bytes(md);const bytes=writePE(section.finish(),metadataOffset,md.length,image.outputKind==='library'?0:context.methodTokens.get(image.entryPoint));
  return {bytes,debug:includeDebug?debug:null,symbolData:{...debug,sources:image.sources},metrics:{emitIlMs:performance.now()-started,assemblyBytes:bytes.length,ilBytes,metadataBytes:md.length,methods:context.descriptors.length},framework};
}
function emitHelper(c,d) {
  const w=new CilWriter(),objectCtor=c.external('object','.ctor','void',[],false);let maxStack=2;
  if(d.helper==='allocate')w.local('ldarg',0).op('call',objectCtor).op('ret');
  else if(d.helper==='constructor'){w.local('ldarg',0).op('call',objectCtor);const init=d.type.original.initializer;if(init!==undefined)w.local('ldarg',0).op('call',c.methodTokens.get(init));if(d.ctor){w.local('ldarg',0);d.parameters.forEach((p,i)=>w.local('ldarg',i+1));w.op('call',c.methodTokens.get(d.ctor.id));maxStack=d.parameters.length+1;}w.op('ret');}
  else if(d.helper==='assert'){w.local('ldarg',0);const at=w.length;w.op('brtrue',0).local('ldarg',1).op('newobj',c.external('Exception','.ctor','void',['string'],false)).op('throw');const done=w.length;w.op('ret');w.patch32(at+1,done-(at+5));}
  return {code:w.finish(),locals:[],maxStack,handlers:[]};
}
function emitMethod(c,d) {
  const m=d.original,analysis=analyzeMethod(c.image,m),w=new CilWriter(),locals=m.locals.map(l=>l.type),scratch=new Map(),spans=[],starts=[],patches=[],prefixes=new Map(),handlers=sourceHandlerLayout(m),n=m.code.length/3;
  const getScratch=(type,index=0)=>{type=type==='null'?'object':type;const key=type+':'+index;if(scratch.has(key))return scratch.get(key);const slot=locals.length;if(slot>=65535)throw new CilError('Scratch locals exceed CLI limit');locals.push(type);scratch.set(key,slot);return slot;};
  const args=m.parameters.length+(m.isStatic?0:1);for(let i=0;i<args;i++)w.local('ldarg',i).local('stloc',i);
  const needs=(from,to)=>from!==to&&((numericTypeNames.includes(numericTypeName(to))&&numericTypeNames.includes(numericTypeName(from)))||(to==='object'&&isValue(from)));
  function convert(from,to){if(from===to||from==='null')return;if(numericTypeNames.includes(numericTypeName(to))&&numericTypeNames.includes(numericTypeName(from)))emitScalarConversion(w,c,from,to);else if(to==='object'&&isValue(from))w.op('box',c.resolveType(from));}
  function adapt(from,to){if(from.length!==to.length)throw new CilError('Invalid conversion stack shape');if(!from.some((t,i)=>needs(t,to[i])))return;let lowest=from.findIndex((t,i)=>needs(t,to[i]));const slots=new Map();for(let i=from.length-1;i>lowest;i--){const slot=getScratch(from[i],i);slots.set(i,slot);w.local('stloc',slot);}convert(from[lowest],to[lowest]);for(let i=lowest+1;i<from.length;i++){w.local('ldloc',slots.get(i));convert(from[i],to[i]);}}
  function relative(name,target){const at=w.length;w.op(name,0);patches.push({at:at+1,end:at+5,target});}
  function leaves(pc,target){const targetZones=sourceHandlerZones(handlers,target);return sourceHandlerZones(handlers,pc).some(z=>!targetZones.includes(z));}
  const returnSlot=handlers.length&&m.returnType!=='void'?getScratch(m.returnType,999):null;
  for(let pc=0;pc<n;pc++){
    emitSourceHandlerEntry(w,c,handlers,pc,prefixes);
    const begin=w.length;starts[pc]=begin;const op=m.code[pc*3],a=m.code[pc*3+1],b=m.code[pc*3+2],input=analysis.states[pc];
    const top=input.at(-1),left=input.at(-2);let terminal=false;
    if(!emitVarargsInstruction(w,c,{op,a,b})&&!emitReferenceInstruction(w,c,{op,a,b,input,scratch:getScratch})&&!emitMemoryInstruction(w,c,{op,a,b,input,scratch:getScratch}))switch(op){
      case Op.ENUM:w.integer(b).op('box',c.resolveType(enumTypes[a])).op('unbox.any',c.resolveType(enumTypes[a]));break;case Op.DELEGATE:{const type=c.image.constants[b];w.op('ldftn',c.methodTokens.get(a)).op('newobj',c.external(type,'.ctor','void',['object','nint'],false));break;}case Op.SEQ:w.op('nop');break;case Op.NOP:w.op('nop').op('nop');break;case Op.ENDFINALLY:w.op('endfinally');terminal=true;break;case Op.ENDFILTER:w.op('endfilter');terminal=true;break;
      case Op.CONST:{const value=c.image.constants[a],type=constantType(value,b);if(value?.scalar)emitScalarConstant(w,c,value);else if(type==='null')w.op('ldnull');else if(type==='string')w.op('ldstr',0x70000000|c.metadata.userString(value));else if(type==='double')w.op('ldc.r8',value);else {w.integer(value===true?1:value===false?0:value);if(type==='bool')w.op('conv.u1');}break;}
      case Op.LDLOC:w.local('ldloc',a);break;
      case Op.STLOC:convert(top,m.locals[a].type);w.op('dup').local('stloc',a);break;
      case Op.LDSTATIC:w.op('ldsfld',c.staticTokens[a]);break;
      case Op.STSTATIC:convert(top,c.image.statics[a].type);w.op('dup').op('stsfld',c.staticTokens[a]);break;
      case Op.LDFLD:{const field=c.fieldTokens.get(top+':'+a);if(!field)throw new CilError(`Missing field ${top}:${a}`);w.op('ldfld',field);break;}
      case Op.STFLD:{const receiver=left,field=c.fieldTokens.get(receiver+':'+a),fieldType=c.image.types.find(t=>t.name===receiver)?.fields[a]?.type;if(!field||!fieldType)throw new CilError('Missing field metadata');convert(top,fieldType);const temp=getScratch(fieldType,998);w.local('stloc',temp).local('ldloc',temp).op('stfld',field).local('ldloc',temp);break;}
      case Op.DUP:w.op('dup');break;case Op.POP:w.op('pop');break;
      case Op.BINARY:{const operator=BinaryName[a];if(b>=16){const {type}=decodeNumericMode(b);adapt([left,top],[type,['<<','>>','>>>'].includes(operator)?'int':type]);emitScalarBinary(w,c,operator,b);break;}if(b===2){adapt([left,top],['object','object']);w.op('call',c.external('string','Concat','string',['object','object']));break;}
        if(['==','!='].includes(operator)&&(left==='string'||top==='string')&&[left,top].every(t=>t==='string'||t==='null')){w.op('call',c.external('string',operator==='=='?'op_Equality':'op_Inequality','bool',['string','string']));break;}
        if((left==='double'||top==='double')&&!['&','|','^','<<','>>','>>>'].includes(operator))adapt([left,top],['double','double']);
        if(operator in binaryCodes){w.op(binaryCodes[operator]+(b===5?'.ovf':''));w.op(b===1||b===5?'conv.i4':b===3?'conv.u1':'conv.r8');}
        else if(operator==='==')w.op('ceq');else if(operator==='!=')w.op('ceq').integer(0).op('ceq');else if(operator==='<')w.op('clt');else if(operator==='>')w.op('cgt');else if(operator==='<=')w.op(left==='double'||top==='double'?'cgt.un':'cgt').integer(0).op('ceq');else if(operator==='>=')w.op(left==='double'||top==='double'?'clt.un':'clt').integer(0).op('ceq');else throw new CilError('Unsupported operator');break;}
      case Op.CONVERT:if(b>=16){const {type:from,checked}=decodeNumericMode(b),to=a>=EnumConvertBase?'int':numericTypeNames[a];emitScalarConversion(w,c,from,to,checked);if(a>=EnumConvertBase){const token=c.resolveType(enumTypes[a-EnumConvertBase]);w.op('box',token).op('unbox.any',token);scalarMarker(w,c,enumTypes[a-EnumConvertBase],checked,from);}else scalarMarker(w,c,to,checked,from);break;}if(a>=EnumConvertBase){const type=c.resolveType(enumTypes[a-EnumConvertBase]);w.op(b===1?'conv.ovf.i4':'conv.i4').op('box',type).op('unbox.any',type).op('nop');}else w.op(a===0?(b===1?'conv.ovf.i4':'conv.i4'):'conv.r8').op('nop');break;
      case Op.UNARY:{const operator=UnaryName[a];if(b>=16){const {type}=decodeNumericMode(b);convert(top,type);emitScalarUnary(w,c,operator,b);break;}if(b===5&&operator==='-')w.integer(-1).op('mul.ovf').op('nop');else if(operator==='!')w.integer(0).op('ceq');else if(operator==='~')w.op('not');else{if(operator==='-')w.op('neg');w.op(b===1?'conv.i4':'conv.r8');}break;}
      case Op.JUMP:{const output=analysis.outputs[pc];adapt(output,analysis.states[a]);relative(leaves(pc,a)?'leave':'br',a);terminal=true;break;}
      case Op.JFALSE:case Op.JTRUE:{// C# expression branches leave only their condition at the stack top.
        const output=analysis.outputs[pc];if(output.some((t,i)=>needs(t,analysis.states[a]?.[i])))throw new CilError('Conditional edge requires an unsupported stack conversion');
        if(leaves(pc,a)){const skip=w.length;w.op(op===Op.JFALSE?'brtrue':'brfalse',5);relative('leave',a);}else relative(op===Op.JFALSE?'brfalse':'brtrue',a);break;}
      case Op.CALL:{const target=c.image.methods[a],from=input.slice(input.length-b),to=[...(target.isStatic?[]:[target.owner]),...target.parameters.map(p=>p.type)];if(target.callingConvention===5)to.push(...from.slice(to.length));adapt(from,to);w.op('call',target.callingConvention===5?variableCallToken(c,target,from):c.methodTokens.get(a));if(target.returnType==='void')w.op('ldnull');break;}
      case Op.BUILTIN:{const builtin=Builtins[a],profile=builtin.numeric??builtin.synchronization??builtin.arrayRuntime??builtin.varargsRuntime??builtin.exceptionRuntime;if(profile){const ctor=profile.name==='.ctor',from=input.slice(input.length-b),generic=profile.genericArity??0,type=generic?from[0]?.replace(builtin.arrayRuntime?/\[\]&$/:/&$/,''):null;if(generic&&!from[0]?.endsWith('&'))throw new CilError('Generic synchronization requires an address');const replace=t=>generic?t.replaceAll('!!0',type):t,parameters=profile.parameters.map(replace),to=[...(!profile.isStatic&&!ctor?[profile.owner]:[]),...parameters];adapt(from,to);if(!profile.isStatic&&!ctor&&numericTypeName(profile.owner)==='decimal'){const slots=[];for(let j=to.length-1;j>=0;j--){slots[j]=getScratch(to[j],2500+j);w.local('stloc',slots[j]);}w.op('ldloca',slots[0]);for(let j=1;j<slots.length;j++)w.local('ldloc',slots[j]);}let target=c.external(profile.owner,profile.name,profile.returnType,profile.parameters,profile.isStatic,generic);if(generic)target=c.metadata.methodSpec(target,[type],c.resolveType);w.op(ctor?'newobj':profile.isStatic||numericTypeName(profile.owner)==='decimal'||builtin.varargsRuntime?'call':'callvirt',target);if(!ctor&&profile.returnType==='void')w.op('ldnull');break;}const descriptor=builtin?.contract;if(descriptor){const from=input.slice(input.length-b),to=[...(!descriptor.isStatic&&descriptor.kind!=='constructor'?[descriptor.owner]:[]),...descriptor.parameters];adapt(from,to);if(descriptor.owner==='System.String'&&descriptor.name==='Format'&&descriptor.parameters.length===5){
          // The source profile's fourth object argument is a params-array call in CoreLib.
          const slots=Array.from({length:4},(_,j)=>getScratch('object',2700+j));
          for(let j=3;j>=0;j--)w.local('stloc',slots[j]);
          w.integer(4).op('newarr',c.resolveType('object'));
          for(let j=0;j<4;j++)w.op('dup').integer(j).local('ldloc',slots[j]).op('stelem.ref');
          w.op('call',c.external('string','Format','string',['string','object[]']));
          w.op('ldstr',0x70000000|c.metadata.userString('SharpForge.Formatting.Format4')).op('pop');break;
        }if(descriptor.owner==='SharpForge.Runtime.Formatting'){
          // The profile's source helper ABI lowers to actual CoreLib operations.
          // Its no-op marker lets the loader reconstruct the original source call.
          if(descriptor.name==='BoxValue')w.op('pop');
          else if(descriptor.name==='FormatValue'){
            const value=getScratch('object',2600),format=getScratch('string',2601),alignment=getScratch('int',2602);
            w.op('pop').local('stloc',alignment).local('stloc',format).local('stloc',value);
            w.op('ldstr',0x70000000|c.metadata.userString('{0,')).local('ldloc',alignment).op('box',c.resolveType('int')).op('call',c.external('string','Concat','string',['object','object']));
            w.op('ldstr',0x70000000|c.metadata.userString(':')).op('call',c.external('string','Concat','string',['string','string']));
            w.local('ldloc',format).op('call',c.external('string','Concat','string',['string','string']));
            w.op('ldstr',0x70000000|c.metadata.userString('}')).op('call',c.external('string','Concat','string',['string','string']));
            w.local('ldloc',value).op('call',c.external('string','Format','string',['string','object']));
          }else throw new CilError('Unsupported formatting helper');
          w.op('ldstr',0x70000000|c.metadata.userString('SharpForge.Formatting.'+descriptor.name)).op('pop');break;
        }if(!descriptor.isStatic&&descriptor.kind!=='constructor'&&frameworkType(descriptor.owner)?.kind==='value'){const slots=[];for(let j=to.length-1;j>=0;j--){const slot=getScratch(to[j],2000+j);slots[j]=slot;w.local('stloc',slot);}w.op('ldloca',slots[0]);for(let j=1;j<slots.length;j++)w.local('ldloc',slots[j]);}const ctor=descriptor.kind==='constructor';w.op(ctor?'newobj':descriptor.isStatic||frameworkType(descriptor.owner)?.kind==='value'?'call':'callvirt',c.external(descriptor.owner,descriptor.name,ctor?'void':descriptor.result,descriptor.parameters,descriptor.isStatic));if(!ctor&&descriptor.result==='void')w.op('ldnull');}else emitBuiltin(c,w,a,b,input.slice(input.length-b),adapt);break;}
      case Op.RET:{if(m.returnType==='void')w.op('pop');else convert(top,m.returnType);if(sourceHandlerZones(handlers,pc).length){if(m.returnType!=='void')w.local('stloc',returnSlot);relative('leave','return');}else w.op('ret');terminal=true;break;}
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
  const nativeHandlers=nativeSourceHandlers(c,handlers,{starts,spans,prefixes,returnOffset});
  return {code:w.finish(),locals,maxStack:analysis.maxStack+Math.max(16,args+4),handlers:nativeHandlers,spans};
}
function emitBuiltin(c,w,id,count,types,adapt) {
  const name=Builtins[id].name;let owner,member,result,params,instance=false,newObject=false,extra=false;
  if(name.startsWith('Console.')){owner='System.Console';member=name.slice(8);result='void';params=count?[types[0]==='null'?'string':frameworkType(types[0])?.kind==='enum'?'object':['sbyte','byte','short','ushort'].includes(types[0])?'int':['nint','nuint'].includes(types[0])?'object':isValue(types[0])||types[0]==='string'?types[0]:'object']:[];}
  else if(name.startsWith('Math.')||name==='$Math.Abs.Int32'){owner='System.Math';member=name==='$Math.Abs.Int32'?'Abs':name.slice(5);const intResult=['Abs','Min','Max'].includes(member)&&types.every(t=>t==='int');result=intResult?'int':'double';params=types.map(()=>result);}
  else if(name.startsWith('GC.')){owner='System.GC';member=name.slice(3);result=member==='Collect'?'void':member==='GetTotalMemory'?'long':'int';params=member==='Collect'?[]:member==='GetTotalMemory'?['bool']:['int'];if(member==='GetTotalMemory'&&!count){w.integer(0);extra=true;}}
  else if(name==='int.Parse'||name==='double.Parse'){owner=name.startsWith('int')?'int':'double';member='Parse';result=owner;params=['string'];}
  else if(name.startsWith('Convert.')){owner='System.Convert';member=name.slice(8);result={ToInt32:'int',ToDouble:'double',ToString:'string'}[member];params=[types[0]==='null'?'object':isValue(types[0])||types[0]==='string'?types[0]:'object'];}
  else if(name.startsWith('Array.')){owner='Array';member=name.slice(6);result='void';params=['Array'];}
  else if(name==='object.GetType'||name.startsWith('$type.')){owner='object';member='GetType';result='System.Type';params=[];instance=true;}
  else if(name==='Type.Name'||name==='Type.FullName'){owner=name==='Type.Name'?'System.Reflection.MemberInfo':'System.Type';member='get_'+name.slice(5);result='string';params=[];instance=true;}
  else if(name==='object.ReferenceEquals'){owner='System.Object';member='ReferenceEquals';result='bool';params=['object','object'];}
  else if(name==='Enum.HasFlag'){adapt(types,['object','object']);w.op('callvirt',c.external('System.Enum','HasFlag','bool',['System.Enum'],false));return;}
  else if(name==='string.get_Chars'){adapt(types,['string','int']);w.op('callvirt',c.external('string','get_Chars','char',['int'],false)).op('conv.i4');return;}
  else if(name==='object.ToString'){owner='System.Convert';member='ToString';result='string';params=['object'];}
  else if(name==='Exception.new'){owner='Exception';member='.ctor';result='void';params=['string'];instance=true;newObject=true;}
  else if(name==='Exception.Message'){owner='Exception';member='get_Message';result='string';params=[];instance=true;}
  else if(name==='Debug.Assert'){if(count===1)w.op('ldstr',0x70000000|c.metadata.userString('Assertion failed'));w.op('call',c.helperToken).op('ldnull');return;}
  else if(name==='Environment.TickCount'){owner='System.Environment';member='get_TickCount';result='int';params=[];}
  else if(name.startsWith('string.')){owner='string';member=name.slice(7);result=['Contains','StartsWith','EndsWith','IsNullOrEmpty'].includes(member)?'bool':member==='IndexOf'?'int':'string';instance=!['Concat','IsNullOrEmpty','Intern','IsInterned'].includes(member);params=member==='Concat'?['string','string']:['IsNullOrEmpty','Intern','IsInterned'].includes(member)?['string']:member==='Substring'?Array(count-1).fill('int'):['Contains','IndexOf','StartsWith','EndsWith'].includes(member)?['string']:member==='Replace'?['string','string']:[];}
  else throw new CilError(`No CIL intrinsic mapping for ${name}`);
  if(!extra)adapt(types,[...(instance&&!newObject?[owner]:[]),...params]);
  w.op(newObject?'newobj':instance?'callvirt':'call',c.external(owner,member,result,params,!instance));if(result==='void'&&!newObject)w.op('ldnull');
}
