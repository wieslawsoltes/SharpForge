import {decodeVarargsInstruction} from './varargs-emission.js';
import {decodeReferenceInstruction} from './reference-emission.js';
import {loadSourceHandlers} from './source-exception-loading.js';
import {loadMemorySpan} from './memory-loading.js';
import {scalarSpan} from './scalar-loading.js';
import {numericAliases,Builtins,numericTypeName,numericTypeNames} from '@sharpforge/bytecode';
import {contractForMember,frameworkType,enumTypes} from '@sharpforge/framework';
import { Op, Binary, Unary, BuiltinMap, frameworkBuiltin, EnumConvertBase, FORMAT_VERSION, verifyImage } from '@sharpforge/bytecode';
import { CilError, text, equalBytes } from './binary.js';
import { token, decodeCoded, readSignature, cliSystemName } from './metadata.js';
import { readPE } from './pe.js';
import { decodeInstructions } from './opcodes.js';
import { emitAssembly } from './emitter.js';
import { defaultValue } from './analysis.js';
const profileOpcodes=new Set(['ldftn','unbox.any','ldloca','ldloca.s','add.ovf','sub.ovf','mul.ovf','conv.ovf.i4','nop', 'ldarg.0', 'ldarg.1', 'ldarg.2', 'ldarg.3', 'ldloc.0', 'ldloc.1', 'ldloc.2', 'ldloc.3', 'stloc.0', 'stloc.1', 'stloc.2', 'stloc.3', 'ldarg.s', 'starg.s', 'ldloc.s', 'stloc.s', 'ldnull', 'ldc.i4.m1', 'ldc.i4.0', 'ldc.i4.1', 'ldc.i4.2', 'ldc.i4.3', 'ldc.i4.4', 'ldc.i4.5', 'ldc.i4.6', 'ldc.i4.7', 'ldc.i4.8', 'ldc.i4.s', 'ldc.i4', 'ldc.r8', 'dup', 'pop', 'call', 'ret', 'br.s', 'brfalse.s', 'brtrue.s', 'br', 'brfalse', 'brtrue', 'add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'neg', 'not', 'conv.i4', 'conv.r8', 'callvirt', 'ldstr', 'newobj', 'castclass', 'throw', 'ldfld', 'stfld', 'ldsfld', 'stsfld', 'box', 'newarr', 'ldlen', 'ldelem', 'stelem', 'conv.u1', 'leave', 'leave.s', 'ceq', 'cgt', 'cgt.un', 'clt', 'clt.un', 'ldarg', 'starg', 'ldloc', 'stloc', 'rethrow', 'endfinally']);
for(const name of ['arglist','mkrefany','refanyval','refanytype','ldobj','stobj','endfilter','isinst','ldsflda','ldflda','ldelema','readonly.','ldarga','ldarga.s','ldtoken','ldc.i8','ldc.r4','add.ovf.un','sub.ovf.un','mul.ovf.un','div.un','rem.un','shr.un','conv.r.un',...['i1','u1','i2','u2','i4','u4','i8','u8','i','u','r4','r8'].flatMap(type=>['conv.'+type,'conv.ovf.'+type,'conv.ovf.'+type+'.un'])])profileOpcodes.add(name);
const shortTypes={...numericAliases,'System.Int32':'int','System.Int64':'long','System.Double':'double','System.Boolean':'bool','System.String':'string','System.Object':'object','System.Exception':'Exception','System.Array':'Array'};
const arithmetic={'add.ovf':'+','sub.ovf':'-','mul.ovf':'*',add:'+',sub:'-',mul:'*',div:'/',rem:'%',and:'&',or:'|',xor:'^',shl:'<<',shr:'>>'};
function nativeLocal(i,prefix){if(i.name===prefix)return i.operand;if(i.name===prefix+'.s')return i.operand;if(i.name.startsWith(prefix+'.'))return Number(i.name.slice(prefix.length+1));return null;}
function constant(i,metadata){if(i.name==='ldnull')return null;if(i.name==='ldstr')return metadata.userString(i.operand);if(i.name==='ldc.i4'||i.name==='ldc.i4.s'||i.name==='ldc.r8')return i.operand;if(i.name==='ldc.i4.m1')return -1;if(i.name.startsWith('ldc.i4.'))return Number(i.name.slice(7));throw new CilError('Expected a constant instruction');}
/**
 * Decode only the compiler's explicitly supported CIL profile. #SF contains debug boundaries,
 * never opcodes or executable VM instructions. All executable operations come from PE CIL bytes.
 * Canonical re-emission verifies every byte, including tokens, signatures, hidden scaffolding,
 * exception tables and assembly references, before any runtime instruction is exposed.
 */
export function loadAssembly(bytes,options={}) {
  const started=performance.now(),pe=readPE(bytes,options),metadata=pe.metadata,debugBytes=metadata.streams.get('#SF');if(!debugBytes)throw new CilError('This browser runtime requires SharpForge CIL profile/debug metadata; arbitrary .NET assembly execution is not supported');
  let debug;try{debug=JSON.parse(text(debugBytes));}catch{throw new CilError('Invalid SharpForge CIL metadata');}
  if(debug?.format!=='SharpForge.CIL'||debug.version!==1||!Array.isArray(debug.methods)||!Array.isArray(debug.types)||!Array.isArray(debug.statics)||!Array.isArray(debug.sequencePoints)||!Array.isArray(debug.sources))throw new CilError('Unsupported SharpForge CIL profile');
  if(debug.methods.length>100_000||debug.types.length>100_000||debug.sequencePoints.length>1_000_000)throw new CilError('Profile metadata limit exceeded');
  const typeOwners=new Map(),fieldOwners=new Map();const td=metadata.rows[2]??[];
  td.forEach((row,index)=>{const t=token(2,index+1);for(let f=row[4];f<(td[index+1]?.[4]??(metadata.counts[4]??0)+1);f++)fieldOwners.set(token(4,f),t);for(let m=row[5];m<(td[index+1]?.[5]??(metadata.counts[6]??0)+1);m++)typeOwners.set(token(6,m),t);});
  const typeByToken=new Map(),fieldByToken=new Map(),methodByToken=new Map();
  const types=debug.types.map((item,id)=>{if(item.id!==id||item.token>>>24!==2||typeByToken.has(item.token))throw new CilError('Invalid type mapping');const row=metadata.row(item.token),name=metadata.typeName(item.token),fields=[];for(let f=row[4];f<(td[(item.token&0xffffff)]?.[4]??(metadata.counts[4]??0)+1);f++){const ft=token(4,f),fr=metadata.row(ft);if(fr[0]&16)continue;const signature=readSignature(metadata.blob(fr[2]),metadata);if(signature.kind!=='field')throw new CilError('Invalid field signature');const field={name:metadata.string(fr[1]),type:signature.type,index:fields.length,...((fr[0]&7)===1?{backing:true}:{})};fields.push(field);fieldByToken.set(ft,{...field,owner:name});}const interfaces=(metadata.rows[9]??[]).filter(r=>r[0]===(item.token&0xffffff)).map(r=>metadata.typeName(decodeCoded('TypeDefOrRef',r[1])));const type={id,name,fields,initializer:item.initializer,...(interfaces.length?{interfaces}:{})};typeByToken.set(item.token,type);return type;});
  const staticByToken=new Map(),statics=debug.statics.map((ft,index)=>{const row=metadata.row(ft);if(ft>>>24!==4||!(row[0]&16)||staticByToken.has(ft))throw new CilError('Invalid static-field mapping');const signature=readSignature(metadata.blob(row[2]),metadata);if(signature.kind!=='field')throw new CilError('Invalid static field signature');staticByToken.set(ft,index);return {name:metadata.typeName(fieldOwners.get(ft))+'.'+metadata.string(row[1]),type:shortTypes[signature.type]??signature.type,value:defaultValue(shortTypes[signature.type]??signature.type),...((row[0]&7)===1?{backing:true}:{})};});
  const bodies=new Map(),instructions=new Map();
  const methods=debug.methods.map((info,id)=>{if(info.id!==id||info.token>>>24!==6||methodByToken.has(info.token)||!Array.isArray(info.locals)||!Array.isArray(info.spans))throw new CilError('Invalid method mapping');const row=metadata.row(info.token),sig=readSignature(metadata.blob(row[4]),metadata),body=pe.methodBody(info.token);if(sig.kind!=='method'||!!(row[2]&16)!==sig.isStatic)throw new CilError('Inconsistent method signature');const nativeLocals=body.localSignature?readSignature(metadata.blob(metadata.row(body.localSignature)[0]),metadata).types:[];if(!nativeLocals||info.locals.length>nativeLocals.length)throw new CilError('Invalid local debug mapping');const locals=info.locals.map((l,index)=>{if(l.slot!==index||typeof l.name!=='string'||l.type!==undefined)throw new CilError('Invalid local symbol');return {...l,type:shortTypes[nativeLocals[index]]??nativeLocals[index]};});
    const pr=metadata.rows[8]??[],parameters=sig.parameters.map((type,index)=>({name:metadata.string(pr[row[5]+index-1]?.[2]??0),type:shortTypes[type]??type,...(pr[row[5]+index-1]?.[0]&2?{refKind:'out'}:pr[row[5]+index-1]?.[0]&1?{refKind:'in'}:{})}));const ownerToken=typeOwners.get(info.token),owner=typeByToken.get(ownerToken)?.name??null;
    if(info.sourceRange){const r=info.sourceRange,source=debug.sources.find(s=>s.uri===r.uri);if(!source||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<r.start||typeof source.text==='string'&&r.end>source.text.length)throw new CilError('Invalid method source range');}
    const method={...(info.asyncRole?{asyncRole:info.asyncRole,asyncOrigin:info.asyncOrigin}:{}),...(info.sourceRange?{sourceRange:info.sourceRange}:{}),...(info.accessor?{accessor:info.accessor}:{}),id,name:info.name,qualifiedName:info.qualifiedName,owner,isStatic:sig.isStatic,...(sig.callingConvention?{callingConvention:sig.callingConvention}:{}),returnType:shortTypes[sig.returnType]??sig.returnType,...(typeByToken.get(ownerToken)?.interfaces?.includes('System.IDisposable')&&info.name==='Dispose'&&sig.parameters.length===0&&!sig.isStatic&&row[2]===0x1e6?{implementsDispose:true}:{}),parameters,locals,code:null,handlers:[]};methodByToken.set(info.token,method);bodies.set(id,body);const decoded=decodeInstructions(body.code);for(const i of decoded)if(!profileOpcodes.has(i.name))throw new CilError(`Unsupported CIL opcode ${i.name} in canonical profile`,i.offset);instructions.set(id,decoded);return method;});
  const propertyMaps=metadata.rows[21]??[],propertyRows=metadata.rows[23]??[],semantics=metadata.rows[24]??[];
  propertyMaps.forEach((map,index)=>{const owner=typeByToken.get(token(2,map[0]));if(!owner)return;owner.properties=[];
    const end=propertyMaps[index+1]?.[1]??propertyRows.length+1;
    for(let rowId=map[1];rowId<end;rowId++){const row=propertyRows[rowId-1];if(!row)throw new CilError('Invalid property map');const signature=readSignature(metadata.blob(row[2]),metadata);if(signature.kind!=='property'||signature.parameters.length)throw new CilError('Unsupported property signature');
      const pt=token(23,rowId),name=metadata.string(row[1]),accessors=semantics.filter(s=>decodeCoded('HasSemantics',s[2])===pt),property={name,type:signature.returnType,isStatic:signature.isStatic,access:'private',get:null,set:null,backing:null};
      for(const a of accessors){const method=methodByToken.get(token(6,a[1])),kind=a[0]===2?'get':a[0]===1?'set':null;if(!method||!kind||method.owner!==owner.name)throw new CilError('Invalid property accessor');const flags=metadata.row(token(6,a[1]))[2],access=({1:'private',3:'internal',4:'protected',6:'public'})[flags&7];if(!access||!(flags&0x800))throw new CilError('Invalid accessor flags');method.accessor={property:name,kind,access};property[kind]=method.id;if(property.access==='private'||access==='public')property.access=access;}
      const backingName=`<${name}>k__BackingField`;if(owner.fields.some(f=>f.name===backingName&&f.backing)||statics.some(f=>f.name===owner.name+'.'+backingName&&f.backing))property.backing=backingName;owner.properties.push(property);
    }
  });
  const library=debug.outputKind==='library',entry=methodByToken.get(pe.entryPoint);if(library?pe.entryPoint!==0||debug.entry!==null:!entry||entry.id!==debug.entry)throw new CilError('Entry point does not match profile');
  const image={formatVersion:FORMAT_VERSION,name:debug.name,...(library?{outputKind:'library'}:{}),entryPoint:library?null:entry.id,constants:[],sequencePoints:debug.sequencePoints,sources:debug.sources,types,statics,methods};const constants=new Map(),intern=value=>{const key=JSON.stringify([typeof value,value]);if(constants.has(key))return constants.get(key);const id=image.constants.length;constants.set(key,id);image.constants.push(value);return id;};
  let totalInstructions=0;
  const resolveCall=t=>{if(t>>>24===43){const row=metadata.row(t),definition=resolveCall(decodeCoded('MethodDefOrRef',row[0])),spec=readSignature(metadata.blob(row[1]),metadata);if(spec.kind!=='methodSpec'||spec.arguments.length!==(definition.sig.genericArity??0))throw new CilError('Invalid generic method instantiation');const substitute=type=>type.replace(/!!(\d+)/g,(_,index)=>spec.arguments[Number(index)]??'error');return {...definition,token:t,methodArguments:spec.arguments,sig:{...definition.sig,parameters:definition.sig.parameters.map(substitute),returnType:substitute(definition.sig.returnType)}};}if(t>>>24===6){const row=metadata.row(t);return {token:t,owner:metadata.typeName(typeOwners.get(t)),name:metadata.string(row[3]),sig:readSignature(metadata.blob(row[4]),metadata)};}if(t>>>24!==10)throw new CilError('Unsupported method token');const row=metadata.row(t),parent=decodeCoded('MemberRefParent',row[0]);return {token:t,...(parent>>>24===6?{resolvedToken:parent}:{}),owner:metadata.typeName(parent>>>24===6?typeOwners.get(parent):parent),name:metadata.string(row[1]),sig:readSignature(metadata.blob(row[2]),metadata)};};
  for(const method of methods){const info=debug.methods[method.id],body=bodies.get(method.id),all=instructions.get(method.id),byOffset=new Map(all.map(i=>[i.offset,i])),startToPc=new Map();let previousEnd=0;
    for(let pc=0;pc<info.spans.length;pc++){const span=info.spans[pc];if(!Array.isArray(span)||span.length!==2||!span.every(Number.isInteger)||span[0]<previousEnd||span[1]<=0||span[0]+span[1]>body.code.length||!byOffset.has(span[0])||span[0]+span[1]!==body.code.length&&!byOffset.has(span[0]+span[1]))throw new CilError('Invalid instruction-boundary map');previousEnd=span[0]+span[1];startToPc.set(span[0],pc);}totalInstructions+=info.spans.length;if(totalInstructions>1_000_000)throw new CilError('Instruction limit exceeded');
    const sequenceByPc=new Map();for(const p of image.sequencePoints.filter(p=>p.methodId===method.id)){if(p.id<0||p.id>=image.sequencePoints.length||image.sequencePoints[p.id]!==p||info.spans[p.offset]?.[0]!==p.ilOffset||p.methodToken!==info.token)throw new CilError('Invalid sequence point');sequenceByPc.set(p.offset,p.id);}
    const code=new Int32Array(info.spans.length*3);
    for(let pc=0;pc<info.spans.length;pc++){const [offset,size]=info.spans[pc],span=[];for(let at=offset;at<offset+size;){const i=byOffset.get(at);if(!i)throw new CilError('Missing CIL instruction');span.push(i);at+=i.size;}const decoded=decodeSpan(span,{metadata,method,methodByToken,typeByToken,typeOwners,fieldByToken,staticByToken,startToPc,resolveCall,intern,sequence:sequenceByPc.get(pc)});code.set(decoded,pc*3);}
    method.code=code;
    method.handlers=loadSourceHandlers({metadata,method,body,spans:info.spans,byOffset,startToPc});
  }
  const errors=verifyImage(image);if(errors.length)throw new CilError('Decoded CIL verification failed: '+errors.join('; '));
  const decodedAt=performance.now();const canonical=emitAssembly(image,{name:debug.name,framework:debug.framework,embedSources:debug.sources.every(s=>typeof s.text==='string')});if(!canonicalWithSymbols(canonical,pe))throw new CilError('Assembly is not canonical for the supported CIL profile; modified scaffolding, signatures, references or instructions are rejected');
  image.il={format:'ECMA-335',profile:'SharpForge.CIL/1',assemblyBytes:pe.bytes.length,decodeMs:decodedAt-started,verificationMs:performance.now()-decodedAt,loadMs:performance.now()-started,methodTokens:debug.methods.map(m=>m.token),offsets:debug.methods.map(m=>m.spans.map(s=>s[0]))};
  return image;
}
function decodeSpan(span,c) {
  const memory=loadMemorySpan(span,c);if(memory)return memory;
  if(span.at(-2)?.name==='ldstr'&&span.at(-1)?.name==='pop'){
    const marker=c.metadata.userString(span.at(-2).operand);
    if(marker==='SharpForge.Formatting.Format4'){
      const builtin=Builtins.find(b=>b.contract?.owner==='System.String'&&b.contract.name==='Format'&&b.contract.parameters.length===5);
      return [Op.BUILTIN,builtin.id,builtin.min];
    }
    if(marker==='SharpForge.Formatting.BoxValue'||marker==='SharpForge.Formatting.FormatValue'){
      const builtin=Builtins.find(b=>b.contract?.owner==='SharpForge.Runtime.Formatting'&&b.contract.name===marker.slice('SharpForge.Formatting.'.length));
      return [Op.BUILTIN,builtin.id,builtin.min];
    }
  }
  const scalar=scalarSpan(span,c);if(scalar)return [scalar.op,scalar.a,scalar.b];
  const emit=(op,a=0,b=0)=>[op,a,b],names=span.map(i=>i.name),call=span.filter(i=>['call','callvirt','newobj'].includes(i.name)).at(-1);
  const variable=decodeVarargsInstruction(span,{...c,shortType:type=>shortTypes[type]??type});if(variable)return variable;
  const reference=decodeReferenceInstruction(span,{...c,shortType:type=>shortTypes[type]??type},emit);if(reference)return reference;
  if(names.includes('ldftn')){const functionToken=span.find(i=>i.name==='ldftn').operand,method=c.methodByToken.get(functionToken),constructor=c.resolveCall(call.operand);if(!method||frameworkType(constructor.owner)?.kind!=='delegate')throw new CilError('Invalid delegate construction');return emit(Op.DELEGATE,method.id,c.intern(constructor.owner));}
  const afterCall=call?span.slice(span.indexOf(call)+1):[];
  const storedConversion=afterCall.some(i=>['ret','stfld','stsfld','stelem'].includes(i.name)||i.operandKind.startsWith('br')||nativeLocal(i,'stloc')!==null&&nativeLocal(i,'stloc')<c.method.locals.length);
  if(call&&!storedConversion){const target=c.resolveCall(call.operand),owner=shortTypes[target.owner]??target.owner,sig=target.sig,count=sig.parameters.length+(sig.isStatic?0:1);
    const normalized=type=>type.endsWith('&')?normalized(type.slice(0,-1))+'&':shortTypes[type]??numericTypeName(type);
    const profile=Builtins.find(builtin=>{const descriptor=builtin.numeric??builtin.synchronization??builtin.arrayRuntime??builtin.varargsRuntime??builtin.exceptionRuntime;if(descriptor?.formatType!==undefined&&descriptor.formatType!==(span.some(i=>i.name==='box')?normalized(c.metadata.typeName(span.find(i=>i.name==='box').operand)):null))return false;if(['System.Console','System.Convert'].includes(descriptor?.owner)&&descriptor.formatType===undefined&&span.some(i=>i.name==='box'&&['nint','nuint'].includes(normalized(c.metadata.typeName(i.operand)))))return false;if(!descriptor||descriptor.owner!==target.owner||descriptor.name!==target.name||descriptor.isStatic!==sig.isStatic||(descriptor.genericArity??0)!==(sig.genericArity??0))return false;const substitute=type=>type.replace(/!!(\d+)/g,(_,index)=>target.methodArguments?.[Number(index)]??'!!'+index);return normalized(substitute(descriptor.returnType))===normalized(sig.returnType)&&descriptor.parameters.length===sig.parameters.length&&descriptor.parameters.every((type,index)=>normalized(substitute(type))===normalized(sig.parameters[index]));});
    if(profile)return emit(Op.BUILTIN,profile.id,profile.min);
    const contract=contractForMember({owner:target.owner,name:target.name,signature:sig});if(contract){const builtin=frameworkBuiltin(contract);return emit(Op.BUILTIN,builtin.id,builtin.min);}
    if(call.name==='newobj'&&sig.parameters[0]==='SharpForge.<>AllocationToken'){const type=c.typeByToken.get(c.typeOwners.get(call.operand));if(!type)throw new CilError('Unknown allocation constructor');return emit(Op.NEWOBJ,type.id);}
    if(c.methodByToken.has(target.resolvedToken??call.operand)){const method=c.methodByToken.get(target.resolvedToken??call.operand);return emit(Op.CALL,method.id,count);}
    if(target.name==='<assert>'&&target.owner==='SharpForge.<>Program')return emit(Op.BUILTIN,BuiltinMap.get('Debug.Assert').id,names.includes('ldstr')?1:2);
    if(owner==='string'&&target.name==='Concat'&&sig.parameters[0]==='object')return emit(Op.BINARY,Binary['+'],2);
    if(owner==='string'&&target.name.startsWith('op_')){if(!['op_Equality','op_Inequality'].includes(target.name))throw new CilError('Unsupported string operator');return emit(Op.BINARY,Binary[target.name==='op_Equality'?'==':'!=']);}
    if(owner==='string'&&target.name==='get_Length')return emit(Op.LENGTH);
    let name,argc=count;
    if(owner==='Exception'&&target.name==='.ctor'&&call.name==='newobj'){name='Exception.new';argc=sig.parameters.length;}
    else if(owner==='Exception'&&target.name==='get_Message')name='Exception.Message';
    else if(target.owner==='System.Math'){name='Math.'+target.name;if(target.name==='Abs'&&sig.parameters[0]==='int')name='$Math.Abs.Int32';}
    else if(target.owner==='System.Console')name='Console.'+target.name;
    else if(target.owner==='System.GC'){name='GC.'+target.name;if(target.name==='GetTotalMemory'&&span.some(i=>i.name.startsWith('ldc.i4')))argc=0;}
    else if(target.owner==='System.Convert'){name='Convert.'+target.name;if(target.name==='ToString'&&sig.parameters[0]==='object')name='object.ToString';}
    else if(target.owner==='System.Object'&&target.name==='GetType'){const box=span.find(i=>i.name==='box'),type=box?shortTypes[c.metadata.typeName(box.operand)]??c.metadata.typeName(box.operand):null;name=[...numericTypeNames,'bool'].includes(type)?'$type.'+type+'.GetType':'object.GetType';}
    else if(['System.Type','System.Reflection.MemberInfo'].includes(target.owner)&&['get_Name','get_FullName'].includes(target.name))name='Type.'+target.name.slice(4);
    else if(target.owner==='System.Object'&&target.name==='ReferenceEquals')name='object.ReferenceEquals';
    else if(target.owner==='System.Enum'&&target.name==='HasFlag')name='Enum.HasFlag';
    else if(target.owner==='System.Environment'&&target.name==='get_TickCount')name='Environment.TickCount';
    else if(owner==='int'||owner==='double'||owner==='string'||owner==='Array')name=owner+'.'+target.name;
    const builtin=BuiltinMap.get(name);if(!builtin)throw new CilError(`External method is not in the browser runtime profile: ${target.owner}.${target.name}`);return emit(Op.BUILTIN,builtin.id,argc);
  }
  if(names.includes('box')&&names.includes('unbox.any')){const t=c.metadata.typeName(span.find(i=>i.name==='box').operand),id=enumTypes.indexOf(t);if(id>=0){if(['conv.i4','conv.ovf.i4'].includes(span[0].name))return emit(Op.CONVERT,EnumConvertBase+id,span[0].name==='conv.ovf.i4'?1:0);return emit(Op.ENUM,id,constant(span[0],c.metadata));}}
  const address=span.find(i=>['ldloca','ldloca.s','ldsflda','ldflda','ldelema'].includes(i.name));
  if(address){const readonly=span.some(i=>i.name==='readonly.')||span.at(-1)?.name==='pop'&&span.at(-2)?.name==='ldc.i4.4';if(address.name.startsWith('ldloca'))return emit(Op.ADDRESS,readonly?4:0,address.operand);if(address.name==='ldsflda'){const slot=c.staticByToken.get(address.operand);if(slot===undefined)throw new CilError('Unknown addressed static field');return emit(Op.ADDRESS,1|(readonly?4:0),slot);}if(address.name==='ldflda'){const field=c.fieldByToken.get(address.operand);if(!field)throw new CilError('Unknown addressed instance field');return emit(Op.ADDRESS,2|(readonly?4:0),field.index);}return emit(Op.ADDRESS,3|(readonly?4:0));}
  const field=span.find(i=>['ldfld','stfld','ldsfld','stsfld'].includes(i.name));if(field){if(field.name.endsWith('sfld')){const index=c.staticByToken.get(field.operand);if(index===undefined)throw new CilError('Unknown static field token');return emit(field.name==='ldsfld'?Op.LDSTATIC:Op.STSTATIC,index);}const f=c.fieldByToken.get(field.operand);if(!f)throw new CilError('Unknown field token');return emit(field.name==='ldfld'?Op.LDFLD:Op.STFLD,f.index);}
  const array=span.find(i=>['newarr','ldelem','stelem','ldlen'].includes(i.name));if(array){if(array.name==='newarr')return emit(Op.NEWARR,c.intern(shortTypes[c.metadata.typeName(array.operand)]??c.metadata.typeName(array.operand)));return emit({ldelem:Op.LDELEM,stelem:Op.STELEM,ldlen:Op.LENGTH}[array.name]);}
  if(names.includes('ret'))return emit(Op.RET);if(names.includes('endfinally'))return emit(Op.ENDFINALLY);if(names.includes('endfilter'))return emit(Op.ENDFILTER);
  if(names.includes('throw'))return emit(Op.THROW);if(names.includes('rethrow'))return emit(Op.RETHROW);
  const branches=span.filter(i=>i.operandKind.startsWith('br'));if(branches.length){const branch=branches.at(-1),target=c.startToPc.get(branch.operand);if(target===undefined&&branch.name.startsWith('leave'))return emit(Op.RET);if(target===undefined)throw new CilError('Branch enters a superinstruction');if(branches.length===2){const first=branches[0];return emit(first.name.startsWith('brtrue')?Op.JFALSE:Op.JTRUE,target);}return emit(branch.name.startsWith('brfalse')?Op.JFALSE:branch.name.startsWith('brtrue')?Op.JTRUE:Op.JUMP,target);}
  if(span.length===3&&names[0].startsWith('ldc.i4')&&constant(span[0],c.metadata)===-1&&names[1]==='mul.ovf'&&names[2]==='nop')return emit(Op.UNARY,Unary['-'],5);
  const binary=span.findIndex(i=>i.name in arithmetic);if(binary>=0){const next=span[binary+1]?.name;return emit(Op.BINARY,Binary[arithmetic[span[binary].name]],span[binary].name.endsWith('.ovf')?5:next==='conv.i4'?1:next==='conv.u1'?3:0);}
  const comparisons=span.filter(i=>['ceq','clt','cgt','clt.un','cgt.un'].includes(i.name));if(comparisons.length){const first=comparisons[0];if(first.name==='cgt.un')return emit(Op.BINARY,Binary['<=']);if(first.name==='clt.un')return emit(Op.BINARY,Binary['>=']);if(first.name==='clt')return emit(Op.BINARY,Binary[comparisons.length===2?'>=':'<']);if(first.name==='cgt')return emit(Op.BINARY,Binary[comparisons.length===2?'<=':'>']);if(comparisons.length===2)return emit(Op.BINARY,Binary['!=']);if(span[0].name.startsWith('ldc.i4')&&constant(span[0],c.metadata)===0)return emit(Op.UNARY,Unary['!']);return emit(Op.BINARY,Binary['==']);}
  if(names.includes('neg'))return emit(Op.UNARY,Unary['-'],span[names.indexOf('neg')+1]?.name==='conv.i4'?1:0);if(names.includes('not'))return emit(Op.UNARY,Unary['~'],1);
  const store=span.find(i=>{const n=nativeLocal(i,'stloc');return n!==null&&n<c.method.locals.length;});if(store)return emit(Op.STLOC,nativeLocal(store,'stloc'));
  const load=span.find(i=>{const n=nativeLocal(i,'ldloc');return n!==null&&n<c.method.locals.length;});if(load)return emit(Op.LDLOC,nativeLocal(load,'ldloc'));
  if(span.length===2&&names.every(n=>n==='nop'))return emit(Op.NOP);
  if(span[0].name==='nop'){if(c.sequence===undefined)throw new CilError('Missing source sequence point');return emit(Op.SEQ,c.sequence);}
  if(span[0].name==='ldnull'||span[0].name==='ldstr'||span[0].name.startsWith('ldc.')){let value=constant(span[0],c.metadata);if(span[1]?.name==='conv.u1')value=!!value;return emit(Op.CONST,c.intern(value),span[0].name==='ldc.r8'?1:0);}
  if(span.length===2&&span[1].name==='nop'&&['conv.i4','conv.r8','conv.ovf.i4'].includes(span[0].name))return emit(Op.CONVERT,span[0].name==='conv.r8'?1:0,span[0].name==='conv.ovf.i4'?1:0);
  if(span[0].name==='dup')return emit(Op.DUP);if(span[0].name==='pop')return emit(Op.POP);if(span[0].name==='conv.i4'||span[0].name==='conv.r8')return emit(Op.UNARY,Unary['+'],span[0].name==='conv.i4'?1:0);
  throw new CilError('CIL sequence is not a supported superinstruction',span[0]?.offset);
}

/** Debug payloads are non-executable. Permit only a well-formed append-only debug
 * directory while preserving byte-for-byte verification of all executable data. */
function canonicalWithSymbols(canonical,pe){
  if(equalBytes(canonical,pe.bytes))return true;
  if(pe.sections.length!==1||pe.bytes.length<=canonical.length)return false;
  const original=readPE(canonical),section=pe.sections[0],cs=original.sections[0],v=new DataView(pe.bytes.buffer,pe.bytes.byteOffset,pe.bytes.byteLength);
  const dir=pe.optionalStart+(pe.magic===0x10b?96:112)+6*8,rva=v.getUint32(dir,true),length=v.getUint32(dir+4,true);
  if(!length||length%28||length>28*1024||rva!==section.rva+canonical.length-section.offset)return false;
  const offset=pe.offsetOf(rva,length);if(offset!==canonical.length)return false;
  const ranges=[];for(let at=offset;at<offset+length;at+=28){const kind=v.getUint32(at+12,true),size=v.getUint32(at+16,true),dataRva=v.getUint32(at+20,true),start=v.getUint32(at+24,true);if(![2,16,17,19].includes(kind))return false;if(!size){if(kind!==16)return false;continue;}if(start<offset+length||start+size>pe.bytes.length||dataRva!==section.rva+start-section.offset)return false;if(ranges.some(([a,b])=>a<start+size&&start<b))return false;ranges.push([start,start+size]);}
  const clone=pe.bytes.slice(0,canonical.length);for(const [at,size]of [[pe.optionalStart+4,4],[pe.optionalStart+56,4],[dir,8],[section.headerOffset+8,4],[section.headerOffset+16,4]])clone.set(canonical.subarray(at,at+size),at);
  return equalBytes(clone,canonical);
}
