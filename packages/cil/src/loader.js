import {loadedImageMethod} from './load/image-method.js';
import {decodeScalarSpan,profileOpcodes} from './scalar-loading.js';
import { canonicalEmissionOptions } from './pe/canonical-options.js';
import {decodeCallSpan, profileShortTypes as shortTypes} from './load/call-span.js';
import {decodeFieldSpan} from './load/field-span.js';
import { canonicalWithSymbols } from './pe/canonical-symbols.js';
import {frameworkType,enumTypes} from '@sharpforge/framework';
import { Op, Binary, Unary, EnumConvertBase, FORMAT_VERSION, verifyImage } from '@sharpforge/bytecode';
import { CilError, text } from './binary.js';
import { token, decodeCoded, readSignature, cliSystemName } from './metadata.js';
import { readPE } from './pe.js';
import { decodeInstructions } from './opcodes.js';
import { emitAssembly } from './emitter.js';
import { defaultValue } from './analysis.js';
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
  const staticByToken=new Map(),statics=debug.statics.map((ft,index)=>{const row=metadata.row(ft);if(ft>>>24!==4||!(row[0]&16)||staticByToken.has(ft))throw new CilError('Invalid static-field mapping');const signature=readSignature(metadata.blob(row[2]),metadata);if(signature.kind!=='field')throw new CilError('Invalid static field signature');staticByToken.set(ft,index);return {name:metadata.typeName(fieldOwners.get(ft))+'.'+metadata.string(row[1]),type:signature.type,value:defaultValue(signature.type),...((row[0]&7)===1?{backing:true}:{})};});
  const bodies=new Map(),instructions=new Map();
  const methods=debug.methods.map((info,id)=>{if(info.id!==id||info.token>>>24!==6||methodByToken.has(info.token)||!Array.isArray(info.locals)||!Array.isArray(info.spans))throw new CilError('Invalid method mapping');const row=metadata.row(info.token),sig=readSignature(metadata.blob(row[4]),metadata),body=pe.methodBody(info.token);if(sig.kind!=='method'||!!(row[2]&16)!==sig.isStatic)throw new CilError('Inconsistent method signature');const nativeLocals=body.localSignature?readSignature(metadata.blob(metadata.row(body.localSignature)[0]),metadata).types:[];if(!nativeLocals||info.locals.length>nativeLocals.length)throw new CilError('Invalid local debug mapping');const locals=info.locals.map((l,index)=>{if(l.slot!==index||typeof l.name!=='string'||l.type!==undefined)throw new CilError('Invalid local symbol');return {...l,type:nativeLocals[index]};});
    const pr=metadata.rows[8]??[],parameters=sig.parameters.map((type,index)=>({name:metadata.string(pr[row[5]+index-1]?.[2]??0),type}));const ownerToken=typeOwners.get(info.token),owner=typeByToken.get(ownerToken)?.name??null;
    if(info.sourceRange){const r=info.sourceRange,source=debug.sources.find(s=>s.uri===r.uri);if(!source||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<r.start||typeof source.text==='string'&&r.end>source.text.length)throw new CilError('Invalid method source range');}
    const method=loadedImageMethod(info,{id,owner,signature:sig,flags:row[2],parameters,locals,disposable:typeByToken.get(ownerToken)?.interfaces?.includes('System.IDisposable')});methodByToken.set(info.token,method);bodies.set(id,body);const decoded=decodeInstructions(body.code);for(const i of decoded)if(!profileOpcodes.has(i.name))throw new CilError(`Unsupported CIL opcode ${i.name} in canonical profile`,i.offset);instructions.set(id,decoded);return method;});
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
  const resolveCall=t=>{if(t>>>24===6){const row=metadata.row(t);return {token:t,owner:metadata.typeName(typeOwners.get(t)),name:metadata.string(row[3]),sig:readSignature(metadata.blob(row[4]),metadata)};}if(t>>>24!==10)throw new CilError('Unsupported method token');const row=metadata.row(t);return {token:t,owner:metadata.typeName(decodeCoded('MemberRefParent',row[0])),name:metadata.string(row[1]),sig:readSignature(metadata.blob(row[2]),metadata)};};
  for(const method of methods){const info=debug.methods[method.id],body=bodies.get(method.id),all=instructions.get(method.id),byOffset=new Map(all.map(i=>[i.offset,i])),startToPc=new Map();let previousEnd=0;
    for(let pc=0;pc<info.spans.length;pc++){const span=info.spans[pc];if(!Array.isArray(span)||span.length!==2||!span.every(Number.isInteger)||span[0]<previousEnd||span[1]<=0||span[0]+span[1]>body.code.length||!byOffset.has(span[0])||span[0]+span[1]!==body.code.length&&!byOffset.has(span[0]+span[1]))throw new CilError('Invalid instruction-boundary map');previousEnd=span[0]+span[1];startToPc.set(span[0],pc);}totalInstructions+=info.spans.length;if(totalInstructions>1_000_000)throw new CilError('Instruction limit exceeded');
    const sequenceByPc=new Map();for(const p of image.sequencePoints.filter(p=>p.methodId===method.id)){if(p.id<0||p.id>=image.sequencePoints.length||image.sequencePoints[p.id]!==p||info.spans[p.offset]?.[0]!==p.ilOffset||p.methodToken!==info.token)throw new CilError('Invalid sequence point');sequenceByPc.set(p.offset,p.id);}
    const code=new Int32Array(info.spans.length*3);
    for(let pc=0;pc<info.spans.length;pc++){const [offset,size]=info.spans[pc],span=[];for(let at=offset;at<offset+size;){const i=byOffset.get(at);if(!i)throw new CilError('Missing CIL instruction');span.push(i);at+=i.size;}const decoded=decodeSpan(span,{metadata,method,methodByToken,typeByToken,typeOwners,fieldByToken,staticByToken,startToPc,resolveCall,intern,sequence:sequenceByPc.get(pc)});code.set(decoded,pc*3);}
    method.code=code;
    for(const h of body.handlers){if(h.flags===2){const start=startToPc.get(h.start),end=info.spans.findIndex(s=>s[0]+s[1]===h.end),target=startToPc.get(h.target),handlerEnd=startToPc.get(h.handlerEnd)??info.spans.findIndex(s=>s[0]+s[1]===h.handlerEnd)+1;if(start===undefined||end<0||target===undefined||handlerEnd<=target)throw new CilError('Unsupported finally-region encoding');method.handlers.push({kind:'finally',start,end,target,handlerEnd});continue;}const prefix=byOffset.get(h.target),slot=prefix?nativeLocal(prefix,'stloc'):null,target=prefix?startToPc.get(h.target+prefix.size):undefined,start=startToPc.get(h.start),end=info.spans.findIndex(s=>s[0]+s[1]===h.end);if(slot===null||slot<0||slot>=method.locals.length||target===undefined||start===undefined||end<0||metadata.typeName(h.catchType)!=='System.Exception')throw new CilError('Unsupported catch-region encoding');method.handlers.push({start,end,target,slot,type:'Exception'});}
  }
  const errors=verifyImage(image);if(errors.length)throw new CilError('Decoded CIL verification failed: '+errors.join('; '));
  const decodedAt=performance.now();const canonical=emitAssembly(image,canonicalEmissionOptions(pe,debug));if(!canonicalWithSymbols(canonical,pe))throw new CilError('Assembly is not canonical for the supported CIL profile; modified scaffolding, signatures, references or instructions are rejected');
  image.il={format:'ECMA-335',profile:'SharpForge.CIL/1',assemblyBytes:pe.bytes.length,decodeMs:decodedAt-started,verificationMs:performance.now()-decodedAt,loadMs:performance.now()-started,methodTokens:debug.methods.map(m=>m.token),offsets:debug.methods.map(m=>m.spans.map(s=>s[0]))};
  return image;
}
function decodeSpan(span,c) {
  const scalar=decodeScalarSpan(span,c);if(scalar)return scalar;
  const emit=(op,a=0,b=0)=>[op,a,b],names=span.map(i=>i.name),call=span.find(i=>['call','callvirt','newobj'].includes(i.name));
  if(names.includes('ldftn')){const functionToken=span.find(i=>i.name==='ldftn').operand,method=c.methodByToken.get(functionToken),constructor=c.resolveCall(call.operand);if(!method||frameworkType(constructor.owner)?.kind!=='delegate')throw new CilError('Invalid delegate construction');return emit(Op.DELEGATE,method.id,c.intern(constructor.owner));}
  if(call)return decodeCallSpan(span,call,c);
  if(names.includes('box')&&names.includes('unbox.any')){const t=c.metadata.typeName(span.find(i=>i.name==='box').operand),id=enumTypes.indexOf(t);if(id>=0){if(['conv.i4','conv.ovf.i4'].includes(span[0].name))return emit(Op.CONVERT,EnumConvertBase+id,span[0].name==='conv.ovf.i4'?1:0);return emit(Op.ENUM,id,constant(span[0],c.metadata));}}
  const field=decodeFieldSpan(span,c);if(field)return field;
  const array=span.find(i=>['newarr','ldelem','stelem','ldlen'].includes(i.name));if(array){if(array.name==='newarr')return emit(Op.NEWARR,c.intern(shortTypes[c.metadata.typeName(array.operand)]??c.metadata.typeName(array.operand)));return emit({ldelem:Op.LDELEM,stelem:Op.STELEM,ldlen:Op.LENGTH}[array.name]);}
  if(names.includes('ret'))return emit(Op.RET);if(names.includes('endfinally'))return emit(Op.ENDFINALLY);
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
