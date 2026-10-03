import {contractForMember,frameworkType,frameworkAssignable} from '@sharpforge/framework';
import {ManagedPlatform,SUSPENDED} from './platform.js';
import {CooperativeScheduler} from './scheduler.js';
import {copyExecution} from './snapshot.js';
import { AssemblyInspector, verifyCilAssembly, supportedIntrinsic, systemType, primitiveSizes, CilError } from '@sharpforge/cil';
import { ManagedHeap, ManagedFault, isReference } from './heap.js';
const float=(value,kind='r8')=>Object.freeze({float:kind,value:kind==='r4'?Math.fround(value):Number(value)});
const number=v=>v?.float?v.value:v;
const isNumber=v=>typeof v==='number'||typeof v==='bigint'||!!v?.float;
const defaults=t=>t==='long'||t==='ulong'?0n:t==='double'?float(0):t==='float'?float(0,'r4'):['int','uint','short','ushort','byte','sbyte','char','bool','nint','nuint'].includes(t)?0:null;
const fatal=new Set(['InstructionLimitException','OutputLimitException','StackOverflowException','ExecutionLimitException']);
const localIndex=i=>i.operand??Number(i.name.split('.').at(-1));
const within=(offset,h)=>offset>=h.start&&offset<h.end;
// Snapshot state contains mutable unwind continuations and ManagedFault instances.
// Use one memo across frames/faults so pending/unwinds/caught aliases survive a rewind.
function copyFrames(frames, memo) {
  return frames.map(frame => {
    const {method, offsets, ...execution} = frame;
    return {...copyExecution(execution, memo), method, offsets};
  });
}
/** Direct, cooperative CIL interpreter for a verified managed subset, independent of #SF.
 * No eval, native imports, network, files, threads, dynamic JS plugins or CLR loading. */
export class CilVirtualMachine {
  constructor(bytes,options={}){
    const started=performance.now();this.options={maxInstructions:20_000_000,maxFrames:512,maxStackValues:65536,maxOutputCharacters:1_000_000,...options};
    this.inspector=bytes instanceof AssemblyInspector?bytes:new AssemblyInspector(bytes,options);this.report=verifyCilAssembly(this.inspector,options);
    if(!this.report.success){const error=new CilError('Managed IL verification failed: '+this.report.issues.map(i=>`${i.method??''}${i.offset===undefined?'':` IL_${i.offset.toString(16)}`}: ${i.message}`).join('; '));error.issues=this.report.issues;throw error;}
    const entry=this.inspector.getMethod(this.report.entryPoint);this.returnType=entry.signature.returnType;if(!entry.signature.isStatic)throw new CilError('Host invocation requires a static method');
    this.heap=new ManagedHeap(options);this.heap.rootProvider=()=>this.roots();this.frames=[];this.statics=new Map();this.strings=new Map();this.initialized=new Map();this.layoutCache=new Map();this.frameId=0;
    this.snapshotOwner=Object.freeze({});this.writeRevision=0;this.onWrite=null;this.state='ready';this.instructions=0;this.elapsedMs=0;this.output=[];this.outputCharacters=0;this.fault=null;this.pendingFault=null;this.onException=null;this.returnValue=null;this.exitCode=0;this.onOutput=options.onOutput??(()=>{});this.loadMs=performance.now()-started;
    for(const f of this.inspector.fields.values())if(f.isStatic)this.statics.set(f.token,defaults(this.inspector.signature(f.token).type));
    const input=options.arguments??(entry.signature.parameters.length===1&&entry.signature.parameters[0]==='string[]'?[[]]:[]);
    if(input.length!==entry.signature.parameters.length)throw new CilError('Argument count does not match selected method');
    const args=[];this.heap.withRoots(args,()=>{for(let i=0;i<input.length;i++){const value=this.marshal(input[i],entry.signature.parameters[i]);args.push(value);this.heap.pins.push(value);}});
    this.platform=new ManagedPlatform(this,options);this.scheduler=new CooperativeScheduler(this,options);this.call(entry.token,args);this.ensureInitialized(entry.ownerToken);
  }
  *roots(){yield* this.platform?.roots()??[];yield* this.scheduler?.roots()??[];
    const root=function*(v){if(v?.byref){if(v.owner)yield v.owner;}else yield v;};
    for(const v of this.statics.values())yield* root(v);yield* this.strings.values();yield this.returnValue;
    if(this.fault?.reference)yield this.fault.reference;if(this.pendingFault?.reference)yield this.pendingFault.reference;
    for(const f of this.frames){for(const v of f.stack)yield* root(v);for(const v of f.args)yield* root(v);for(const v of f.locals)yield* root(v);yield f.returnObject;if(f.exception?.reference)yield f.exception.reference;for(const c of f.caught??[])if(c.fault.reference)yield c.fault.reference;for(const u of f.unwinds)if(u.error?.reference)yield u.error.reference;}
  }
  get top(){return this.frames.at(-1);}
  marshal(value,type){
    if(type.endsWith('[]')){if(!Array.isArray(value))throw new CilError(`Expected JSON array for ${type}`);const ref=this.heap.array(type.slice(0,-2),value.length);return this.heap.withRoots([ref],()=>{const r=this.heap.get(ref);for(let i=0;i<value.length;i++)r.data[i]=this.marshal(value[i],type.slice(0,-2));return ref;});}
    if(type==='string'){if(value===null)return null;if(typeof value!=='string')throw new CilError('Expected string argument');return this.heap.string(value);}
    if(type==='bool'){if(typeof value!=='boolean')throw new CilError('Expected boolean argument');return value?1:0;}
    if(type==='long'||type==='ulong'){let n;try{if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error();n=BigInt(value);}catch{throw new CilError('Int64 arguments require an exact integer or decimal string');}if(type==='long'&&(n<-(1n<<63n)||n>=(1n<<63n))||type==='ulong'&&(n<0||n>=(1n<<64n)))throw new CilError('Int64 argument out of range');return BigInt.asIntN(64,n);}
    if(type==='double'||type==='float'){if(typeof value!=='number')throw new CilError('Expected numeric argument');return float(value,type==='float'?'r4':'r8');}
    if(['int','uint','short','ushort','byte','sbyte','char'].includes(type)){if(typeof value!=='number'||!Number.isInteger(value))throw new CilError('Expected integer argument');const ranges={int:[-2147483648,2147483647],uint:[0,4294967295],short:[-32768,32767],ushort:[0,65535],byte:[0,255],sbyte:[-128,127],char:[0,65535]};if(value<ranges[type][0]||value>ranges[type][1])throw new CilError(`${type} argument out of range`);return value|0;}
    if(type==='object'&&value===null)return null;throw new CilError(`Host argument type '${type}' is not supported`);
  }
  // CLI storage locations narrow integers and round single precision on write/load.
  storage(value,type){
    const alias={'System.SByte':'sbyte','System.Byte':'byte','System.Int16':'short','System.UInt16':'ushort','System.Char':'char','System.Boolean':'bool','System.Int32':'int','System.UInt32':'uint','System.Int64':'long','System.UInt64':'ulong','System.Single':'float','System.Double':'double'};
    type=alias[type]??type;
    const conversion={sbyte:'i1',byte:'u1',short:'i2',ushort:'u2',char:'u2',bool:'u1',int:'i4',uint:'u4',long:'i8',ulong:'u8',float:'r4',double:'r8'}[type];
    return conversion?this.convert('conv.'+conversion,value):value;
  }
  slotType(frame,arg,index){return arg?(frame.method.signature.isStatic?frame.method.signature.parameters[index]:index===0?'object':frame.method.signature.parameters[index-1]):frame.method.locals[index];}
  indirect(value,name){const suffix=name.split('.').at(-1);return ['i1','u1','i2','u2','i4','u4','i8','r4','r8','i'].includes(suffix)?this.convert('conv.'+suffix,value):value;}
  resultValue(){const value=this.value(this.returnValue);return this.returnType==='uint'?Number(value)>>>0:this.returnType==='ulong'?BigInt.asUintN(64,value??0n):this.returnType==='bool'?!!value:value;}
  resultDisplay(){return this.returnType==='string'?this.display(this.returnValue):this.format(this.returnValue,this.returnType);}
  value(v){if(v?.float)return v.value;if(isReference(v)){const r=this.heap.get(v);if(r.kind==='string')return r.data;if(r.kind==='box')return this.value(r.data[0]);}return v;}
  format(v,type){if(v===null)return '';if(isReference(v)&&this.heap.get(v).kind==='box'){const r=this.heap.get(v);return this.format(r.data[0],{'System.Boolean':'bool','System.Char':'char','System.UInt32':'uint','System.UInt64':'ulong'}[r.type]);}const n=this.value(v);if(type==='bool')return n?'True':'False';if(type==='char')return String.fromCharCode(Number(n));if(type==='uint')return String(Number(n)>>>0);if(type==='ulong')return String(BigInt.asUintN(64,n));if(isReference(n)){const r=this.heap.get(n);return r.kind==='exception'?r.type+': '+this.format(r.data[0]):r.type;}return String(n);}
  display(v){return v===null?'null':isReference(v)&&this.heap.get(v).kind==='string'?JSON.stringify(this.value(v)):this.format(v);}
  string(s){if(!this.strings.has(s))this.strings.set(s,this.heap.string(s));return this.strings.get(s);}
  push(v){if(this.top.stack.length>=this.options.maxStackValues)throw new ManagedFault('ExecutionLimitException','Evaluation stack budget exceeded');this.top.stack.push(v);}
  pop(){if(!this.top.stack.length)throw new ManagedFault('InvalidProgramException','Evaluation stack underflow');return this.top.stack.pop();}
  call(token,args,extra={}){
    if(this.frames.length>=this.options.maxFrames)throw new ManagedFault('StackOverflowException','Managed call depth exceeded');
    const m=this.inspector.getMethod(token);if(!m.signature.isStatic&&args[0]===null)throw new ManagedFault('NullReferenceException','Instance method receiver is null');
    this.frames.push({id:++this.frameId,method:m,args,locals:m.locals.map(t=>m.initLocals?defaults(t):undefined),stack:[],pc:0,lastOffset:0,offsets:new Map(m.instructions.map((i,n)=>[i.offset,n])),exception:null,pending:null,caught:[],unwinds:[],...extra});
  }
  ensureInitialized(typeToken){
    if(this.initialized.has(typeToken))return false;
    const cctor=this.inspector.types.find(t=>t.token===typeToken)?.methods.find(m=>m.name==='.cctor');this.initialized.set(typeToken,cctor?'initializing':'initialized');
    if(cctor){this.call(cctor.token,[],{initializes:typeToken});return true;}return false;
  }
  layout(typeToken,depth=0){
    if(this.layoutCache.has(typeToken))return this.layoutCache.get(typeToken);if(depth>64)throw new CilError('Inheritance depth exceeded');
    const type=this.inspector.types.find(t=>t.token===typeToken);if(!type)throw new CilError('External type allocation is not implemented');
    if(type.flags&0x20)throw new CilError('Cannot instantiate an interface');
    const base=type.baseToken>>>24===2?this.layout(type.baseToken,depth+1):{fields:[]};
    const fields=[...base.fields,...type.fields.filter(f=>!f.isStatic).map(f=>({...f,type:this.inspector.signature(f.token).type}))];
    const layout={name:type.name,token:typeToken,fields,index:new Map(fields.map((f,i)=>[f.token,i]))};this.layoutCache.set(typeToken,layout);return layout;
  }
  typeOf(ref){if(ref===null)return null;const record=this.heap.get(ref);return this.inspector.types.find(t=>t.name===record.type)?.token??null;}
  matches(ref,typeName){
    if(ref===null)return false;const r=this.heap.get(ref),target=systemType(typeName);if(target==='System.Object')return true;
    if(r.kind==='exception')return target==='System.Exception'||systemType(r.type)===target;
    if(systemType(r.type)===target)return true;let t=this.typeOf(ref),depth=0;
    while(t&&depth++<64){const type=this.inspector.types.find(x=>x.token===t);if(type?.interfaces.some(i=>this.inspector.metadata.typeName(i)===typeName))return true;t=type?.baseToken;if(!t)break;if(systemType(this.inspector.metadata.typeName(t))===target)return true;if(t>>>24!==2)break;}return false;
  }
  field(token,ref){const field=this.inspector.resolveToken(token),t=field.resolvedToken??token;if(field.kind!=='field')throw new CilError('Invalid field token');if(ref===undefined)return {field,token:t};const record=this.heap.get(ref),layout=this.layout(this.typeOf(ref)),index=layout.index.get(t);if(index===undefined)throw new ManagedFault('InvalidProgramException','Field is not part of this object');return {field,token:t,record,index};}
  notifyWrite(write){this.writeRevision++;if(write.handle!==undefined)this.heap.mutationRevision++;this.onWrite?.({...write,frameId:write.frameId??this.top?.id});}
  address(kind,index,owner){return Object.freeze({byref:true,kind,index,owner,frameId:this.top.id});}
  dereference(address,write=false,value){
    if(!address?.byref)throw new ManagedFault('InvalidProgramException','A managed address is required');
    let slots, old;
    if(['box','field','array'].includes(address.kind)){
      const r=address.kind==='array'?this.indexed(address.owner,address.index):this.heap.get(address.owner);
      if(address.kind==='box'&&r.kind!=='box')throw new ManagedFault('InvalidProgramException','A boxed value address is required');
      slots=r.data;
    } else if(address.kind==='static') {
      if(!this.statics.has(address.index))throw new ManagedFault('InvalidProgramException','Unknown static slot');
    } else {
      if(!['arg','local'].includes(address.kind))throw new ManagedFault('InvalidProgramException','Unknown managed address');
      const frame=this.frames.find(f=>f.id===address.frameId);
      if(!frame)throw new ManagedFault('InvalidProgramException','Managed address outlived its frame');
      slots=address.kind==='arg'?frame.args:frame.locals;
    }
    if(slots&&(!Number.isInteger(address.index)||address.index<0||address.index>=slots.length))throw new ManagedFault('InvalidProgramException','Invalid managed address slot');
    old=slots?slots[address.index]:this.statics.get(address.index);
    if(write){
      if(slots)slots[address.index]=value;else this.statics.set(address.index,value);
      this.writeRevision++;
      if(address.owner)this.heap.mutationRevision++;
      this.onWrite?.({kind:address.kind,index:address.index,frameId:address.frameId,
        ...(address.owner?{handle:address.owner.h,generation:address.owner.g}:{}),oldValue:old,value});
      return value;
    }
    if(old===undefined)throw new ManagedFault('InvalidProgramException','Uninitialized address');return old;
  }
  /** In-memory snapshots are scoped to this VM. No serialized host/native state is restored. */
  snapshot(){
    const memo=new Map();
    return {hostRevision:this.platform.hostOperations.snapshotVersion(),owner:this.snapshotOwner,platform:this.platform.snapshot(),scheduler:this.scheduler.snapshot(),frames:copyFrames(this.frames,memo),heap:this.heap.snapshot(),
      statics:new Map(this.statics),strings:new Map(this.strings),initialized:new Map(this.initialized),
      fault:copyExecution(this.fault,memo),pendingFault:copyExecution(this.pendingFault,memo),
      state:this.state,instructions:this.instructions,elapsedMs:this.elapsedMs,frameId:this.frameId,
      output:[...this.output],outputCharacters:this.outputCharacters,returnValue:this.returnValue,
      exitCode:this.exitCode,writeRevision:this.writeRevision,heapRevision:this.heap.mutationRevision};
  }
  restore(snapshot){
    if(snapshot?.owner!==this.snapshotOwner)throw new TypeError('Snapshot belongs to another CIL VM');
    this.platform.hostOperations.checkRestore(snapshot.hostRevision);
    const memo=new Map();this.heap.restore(snapshot.heap);this.frames=copyFrames(snapshot.frames,memo);
    this.statics=new Map(snapshot.statics);this.strings=new Map(snapshot.strings);this.initialized=new Map(snapshot.initialized);
    this.fault=copyExecution(snapshot.fault,memo);this.pendingFault=copyExecution(snapshot.pendingFault,memo);
    this.frameId=Math.max(this.frameId,snapshot.frameId);
    for(const key of ['state','instructions','elapsedMs','outputCharacters','returnValue','exitCode','writeRevision'])this[key]=snapshot[key];
    this.output=[...snapshot.output];this.scheduler.restore(snapshot.scheduler);this.platform.restore(snapshot.platform);
  }
  indexed(ref,index){const r=this.heap.get(ref),n=number(index);if(r.kind!=='array'||!Number.isInteger(n)||n<0||n>=r.data.length)throw new ManagedFault('IndexOutOfRangeException','Array index out of range');return r;}
  emitOutput(s){if(this.outputCharacters+s.length>this.options.maxOutputCharacters)throw new ManagedFault('OutputLimitException','Program output limit exceeded');this.outputCharacters+=s.length;this.output.push(s);this.onOutput(s);}
  compare(a,b,op,unsigned=false){
    if(isReference(a)||isReference(b)||a===null||b===null){const equal=a===b||isReference(a)&&isReference(b)&&a.h===b.h&&a.g===b.g;if(op==='eq')return equal;if(op==='ne')return !equal;if(unsigned&&op==='gt'&&b===null)return a!==null;throw new ManagedFault('InvalidProgramException','Invalid reference comparison');}
    if(!isNumber(a)||!isNumber(b))throw new ManagedFault('InvalidProgramException','Numeric comparison expected');
    const floating=!!(a?.float||b?.float);a=number(a);b=number(b);
    if(floating&&(Number.isNaN(a)||Number.isNaN(b)))return op==='ne'||unsigned;
    if(unsigned&&!floating){a=typeof a==='bigint'?BigInt.asUintN(64,a):a>>>0;b=typeof b==='bigint'?BigInt.asUintN(64,b):b>>>0;}
    return {eq:()=>a===b,ne:()=>a!==b,gt:()=>a>b,ge:()=>a>=b,lt:()=>a<b,le:()=>a<=b}[op]();
  }
  binary(name,a,b){
    if(!isNumber(a)||!isNumber(b))throw new ManagedFault('InvalidProgramException','Arithmetic requires numeric operands');
    const floating=!!(a?.float||b?.float),checked=name.includes('.ovf'),unsigned=name.endsWith('.un'),op=name.split('.')[0];a=number(a);b=number(b);
    if(floating){if(!['add','sub','mul','div','rem'].includes(op)||checked||unsigned)throw new ManagedFault('InvalidProgramException','Invalid floating-point operation');return float({add:()=>a+b,sub:()=>a-b,mul:()=>a*b,div:()=>a/b,rem:()=>a%b}[op]());}
    const wide=typeof a==='bigint';if(typeof b==='bigint'!==wide&&!['shl','shr'].includes(op))throw new ManagedFault('InvalidProgramException','Mismatched integer widths');
    if(wide||checked){let x=BigInt(a),y=BigInt(b),bits=wide?64:32;if(unsigned){x=BigInt.asUintN(bits,x);y=BigInt.asUintN(bits,y);}
      if(['div','rem'].includes(op)&&y===0n)throw new ManagedFault('DivideByZeroException','Integer division by zero');
      if(op==='div'&&!unsigned&&x===-(1n<<BigInt(bits-1))&&y===-1n)throw new ManagedFault('OverflowException','Integer division overflow');
      const shift=y&BigInt(bits-1),v={add:()=>x+y,sub:()=>x-y,mul:()=>x*y,div:()=>x/y,rem:()=>x%y,and:()=>x&y,or:()=>x|y,xor:()=>x^y,shl:()=>x<<shift,shr:()=>x>>shift}[op]();
      if(checked&&(v<(unsigned?0n:-(1n<<BigInt(bits-1)))||v>(unsigned?(1n<<BigInt(bits))-1n:(1n<<BigInt(bits-1))-1n)))throw new ManagedFault('OverflowException','Checked arithmetic overflow');return wide?BigInt.asIntN(64,v):Number(BigInt.asIntN(32,v));
    }
    if(unsigned){a>>>=0;b>>>=0;}if(['div','rem'].includes(op)&&b===0)throw new ManagedFault('DivideByZeroException','Integer division by zero');if(op==='div'&&!unsigned&&a===-2147483648&&b===-1)throw new ManagedFault('OverflowException','Integer division overflow');
    switch(op){case 'add':return (a+b)|0;case 'sub':return (a-b)|0;case 'mul':return Math.imul(a,b);case 'div':return (a/b)|0;case 'rem':return (a%b)|0;case 'and':return a&b;case 'or':return a|b;case 'xor':return a^b;case 'shl':return a<<(b&31);case 'shr':return unsigned?(a>>>(b&31))|0:a>>(b&31);default:throw new CilError('Unknown arithmetic opcode');}
  }
  convert(name,value){
    if(!isNumber(value))throw new ManagedFault('InvalidProgramException','Numeric conversion required');
    const checked=name.includes('.ovf.'),unsignedSource=name.endsWith('.un'),target=name.replace(/^conv\.(ovf\.)?/,'').replace(/\.un$/,''),raw=number(value);
    if(['r','r4','r8'].includes(target)){const n=unsignedSource&&!value?.float?(typeof raw==='bigint'?BigInt.asUintN(64,raw):raw>>>0):raw;return float(Number(n),target==='r4'?'r4':'r8');}
    let n;if(typeof raw==='bigint')n=unsignedSource?BigInt.asUintN(64,raw):raw;else {if(!Number.isFinite(raw)){if(checked)throw new ManagedFault('OverflowException','Non-finite integer conversion');return target==='i8'||target==='u8'?-(1n<<63n):-2147483648;}n=BigInt(Math.trunc(unsignedSource&&!value?.float?raw>>>0:raw));}
    const bits={i1:8,u1:8,i2:16,u2:16,i4:32,u4:32,i8:64,u8:64,i:32,u:32}[target],signed=target.startsWith('i');if(!bits)throw new CilError('Invalid conversion');
    if(checked&&(n<(signed?-(1n<<BigInt(bits-1)):0n)||n>(signed?(1n<<BigInt(bits-1))-1n:(1n<<BigInt(bits))-1n)))throw new ManagedFault('OverflowException','Checked conversion overflow');
    // CLI leaves out-of-range unchecked floating conversions unspecified. Match this
    // profile's compiler/IR conversion deterministically rather than wrapping a float.
    if(!checked&&value?.float&&signed&&bits===32&&(n< -2147483648n||n>2147483647n))return -2147483648;
    n=signed?BigInt.asIntN(bits,n):BigInt.asUintN(bits,n);return bits===64?BigInt.asIntN(64,n):Number(n)|0;
  }
  intrinsic(d,args){const contract=contractForMember(d);if(contract)return this.platform.invoke(contract,args);
    if(!supportedIntrinsic(d))throw new ManagedFault('MissingMethodException',`${d.owner}::${d.name}`);
    const owner=systemType(d.owner),name=d.name,sig=d.signature,self=sig.isStatic?null:args[0],p=sig.isStatic?args:args.slice(1),v=p.map(x=>this.value(x));
    if(!sig.isStatic&&self===null)throw new ManagedFault('NullReferenceException','Null instance receiver');
    if(owner==='System.Console'){this.emitOutput((p.length?this.format(p[0],sig.parameters[0]):'')+(name==='WriteLine'?'\n':''));return null;}
    if(owner==='System.Object'){if(name==='.ctor')return null;return this.heap.string(this.format(self));}
    if(owner==='System.Exception'){if(name==='.ctor'){this.heap.get(self).data[0]=p[0]??this.heap.string('Exception');return null;}return this.heap.get(self).data[0];}
    if(owner==='System.String'){
      const s=self===null?null:this.value(self);
      if(name==='Concat')return this.heap.string(p.map(x=>this.format(x)).join(''));
      if(['op_Equality','op_Inequality','Equals'].includes(name))return (v[0]===v[1])!==(name==='op_Inequality')?1:0;
      if(name==='IsNullOrEmpty')return v[0]===null||v[0]===''?1:0;
      if(typeof s!=='string')throw new ManagedFault('NullReferenceException','String receiver required');
      if(name==='get_Length')return s.length;if(name==='get_Chars'){if(!Number.isInteger(v[0])||v[0]<0||v[0]>=s.length)throw new ManagedFault('IndexOutOfRangeException','String index out of range');return s.charCodeAt(v[0]);}
      if(name==='ToString')return self;
      if(['ToUpper','ToUpperInvariant','ToLower','ToLowerInvariant','Trim'].includes(name))return this.heap.string(s[name.startsWith('ToUpper')?'toUpperCase':name.startsWith('ToLower')?'toLowerCase':'trim']());
      if(name==='Substring'){const [at,length=s.length-at]=v;if(!Number.isInteger(at)||!Number.isInteger(length)||at<0||length<0||at+length>s.length)throw new ManagedFault('ArgumentOutOfRangeException','Substring bounds');return this.heap.string(s.slice(at,at+length));}
      if(name==='Replace'){if(v[0]===null||v[0]==='')throw new ManagedFault('ArgumentException','Invalid oldValue');return this.heap.string(s.split(v[0]).join(v[1]??''));}
      if(v[0]===null)throw new ManagedFault('ArgumentNullException','Null string argument');const result=s[{Contains:'includes',StartsWith:'startsWith',EndsWith:'endsWith',IndexOf:'indexOf'}[name]](v[0]);return typeof result==='boolean'?result?1:0:result;
    }
    if(owner==='System.Math'){
      let result;if(typeof v[0]==='bigint'){if(name==='Abs'){if(v[0]===-(1n<<63n))throw new ManagedFault('OverflowException','Int64 absolute value overflow');result=v[0]<0?-v[0]:v[0];}else result=name==='Min'?v[0]<v[1]?v[0]:v[1]:v[0]>v[1]?v[0]:v[1];}
      else if(name==='Round'){const f=Math.floor(v[0]),fraction=v[0]-f;result=fraction===0.5?(f%2===0?f:f+1):Math.round(v[0]);}
      else {if(name==='Abs'&&sig.returnType==='int'&&v[0]===-2147483648)throw new ManagedFault('OverflowException','Int32 absolute value overflow');result=Math[name==='Ceiling'?'ceil':name.toLowerCase()](...v);}
      return sig.returnType==='double'||sig.returnType==='float'?float(result,sig.returnType==='float'?'r4':'r8'):result;
    }
    if(owner==='System.GC'){if(name==='Collect'){this.heap.collect();return null;}if(name==='GetTotalMemory'){if(v[0])this.heap.collect();return BigInt(this.heap.stats.liveBytes);}if(v[0]!==0)throw new ManagedFault('ArgumentOutOfRangeException','Only GC generation zero is modeled');return this.heap.stats.collections;}
    if(name==='Parse'){const s=String(v[0]??'').trim();if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s))throw new ManagedFault('FormatException','Invalid numeric text');if(owner==='System.Double')return float(Number(s));if(!/^[+-]?\d+$/.test(s))throw new ManagedFault('FormatException','Invalid integer text');return this.convert(owner==='System.Int64'?'conv.ovf.i8':'conv.ovf.i4',BigInt(s));}
    if(owner==='System.Convert'){if(name==='ToString')return this.heap.string(this.format(p[0],sig.parameters[0]));const n=Number(v[0]);if(name==='ToDouble'){if(Number.isNaN(n))throw new ManagedFault('FormatException','Invalid conversion');return float(n);}const f=Math.floor(n),r=n-f===0.5?(f%2===0?f:f+1):Math.round(n);return this.convert('conv.ovf.i4',float(r));}
    throw new ManagedFault('MissingMethodException',`${owner}::${name}`);
  }
  invoke(i){
    const caller=this.top,d=this.inspector.resolveToken(i.operand),target=d.resolvedToken??(d.token>>>24===6?d.token:null),n=d.signature.parameters.length+(i.name!=='newobj'&&!d.signature.isStatic?1:0);
    if(target&&this.ensureInitialized(d.ownerToken)){caller.pc--;return;}
    const args=caller.stack.splice(caller.stack.length-n,n);
    this.heap.withRoots(args,()=>{
      if(i.name==='newobj'&&contractForMember(d)){caller.stack.push(this.platform.invoke(contractForMember(d),args));return;}
      if(i.name==='newobj'){
        let ref;if(target){const layout=this.layout(d.ownerToken);ref=this.heap.object(layout.name,layout.fields.map(f=>defaults(f.type)));}else if(systemType(d.owner)==='System.Exception')ref=this.heap.allocate('exception','System.Exception',[args[0]??null]);else throw new ManagedFault('NotSupportedException','External object construction is unavailable');
        args.unshift(ref);this.heap.pins.push(ref);if(target)this.call(target,args,{returnObject:ref});else {this.intrinsic(d,args);caller.stack.push(ref);}return;
      }
      if(i.name==='callvirt'&&args[0]===null)throw new ManagedFault('NullReferenceException','Null virtual receiver');
      let dispatch=target;
      // MethodDef virtual dispatch within the loaded assembly; interfaces/generic dispatch are not advertised.
      if(target&&i.name==='callvirt'&&(d.flags&0x40)){let type=this.typeOf(args[0]),depth=0;while(type&&depth++<64){const td=this.inspector.types.find(t=>t.token===type),candidate=td?.methods.find(m=>m.name===d.name&&JSON.stringify(this.inspector.signature(m.token))===JSON.stringify(d.signature));if(candidate){dispatch=candidate.token;break;}type=td?.baseToken;}}
      if(dispatch){if(!this.report.methods.includes(dispatch))throw new ManagedFault('NotSupportedException','Unverified virtual override; select its method directly');this.call(dispatch,args);}
      else {const value=this.intrinsic(d,args);if(d.signature.returnType!=='void'&&value!==SUSPENDED)caller.stack.push(value);}
    });
  }
  resumeUnwind(frame){
    const p=frame.pending;if(p.handlers.length){const next=p.handlers.shift();p.active=next;frame.pc=frame.offsets.get(next.target);frame.stack=[];return;}
    frame.unwinds.pop();frame.pending=frame.unwinds.at(-1)??null;if(p.kind==='leave'){frame.pc=frame.offsets.get(p.target);return;}
    if(p.catch){frame.caught=(frame.caught??[]).filter(c=>p.catch.target>=c.start&&p.catch.target<c.end&&c.start!==p.catch.target);frame.caught.push({start:p.catch.target,end:p.catch.handlerEnd,fault:p.error});frame.exception=p.error;frame.stack=[p.error.reference];frame.pc=frame.offsets.get(p.catch.target);return;}
    if(frame.initializes)this.initialized.set(frame.initializes,'failed');this.frames.pop();this.raise(p.error);
  }
  raise(error){
    const fault=error instanceof ManagedFault?error:new ManagedFault('InvalidProgramException',error.message??String(error));this.fault=fault;
    if(fatal.has(fault.name)){this.state='faulted';return;}
    if(!fault.reference){try{const msg=this.heap.string(fault.message);fault.reference=this.heap.allocate('exception',fault.name,[msg],[msg]);}catch{this.state='faulted';return;}}
    const frame=this.top;if(!frame){this.state='faulted';return;}
    const handlers=frame.method.handlers.filter(h=>within(frame.lastOffset,h)).sort((a,b)=>(a.end-a.start)-(b.end-b.start));
    const catcher=handlers.find(h=>h.flags===0&&this.matches(fault.reference,this.inspector.metadata.typeName(h.catchType)));
    const finals=handlers.filter(h=>(h.flags===2||h.flags===4)&&(!catcher||!within(catcher.target,h)));
    frame.unwinds=frame.unwinds.filter(u=>u.active&&catcher&&catcher.target>=u.active.target&&catcher.target<u.active.handlerEnd);frame.pending={kind:'exception',error:fault,catch:catcher,handlers:finals};frame.unwinds.push(frame.pending);frame.stack=[];this.fault=null;this.resumeUnwind(frame);
  }
  step(){
    const frame=this.top,i=frame.method.instructions[frame.pc++];if(!i)throw new ManagedFault('InvalidProgramException','Instruction pointer is outside the method');frame.lastOffset=i.offset;const n=i.name,a=i.operand;
    if(n==='nop'||n==='break')return;
    if(n==='ldnull'){this.push(null);return;}if(n==='ldstr'){this.push(this.string(this.inspector.metadata.userString(a)));return;}
    if(n.startsWith('ldc.')){this.push(n==='ldc.r8'?float(a):n==='ldc.r4'?float(a,'r4'):n==='ldc.i8'?a:n==='ldc.i4.m1'?-1:n==='ldc.i4'||n==='ldc.i4.s'?a:Number(n.slice(7)));return;}
    if(/^(ldarg|ldarga|starg|ldloc|ldloca|stloc)(\.|$)/.test(n)){
      const index=localIndex(i),arg=n.includes('arg'),slots=arg?frame.args:frame.locals;
      if(n.startsWith('st'))this.dereference(this.address(arg?'arg':'local',index),true,this.storage(this.pop(),this.slotType(frame,arg,index)));else if(n.startsWith('ldarga')||n.startsWith('ldloca'))this.push(this.address(arg?'arg':'local',index));else {if(slots[index]===undefined)throw new ManagedFault('InvalidProgramException','Read of uninitialized local');this.push(this.storage(slots[index],this.slotType(frame,arg,index)));}return;
    }
    if(n==='dup'){const v=this.pop();this.push(v);this.push(v);return;}if(n==='pop'){this.pop();return;}
    if(n==='ldftn'){const d=this.inspector.resolveToken(a),token=d.resolvedToken??d.token;if(!this.report.methods.includes(token))throw new ManagedFault('InvalidProgramException','Unverified delegate method');this.push(Object.freeze({methodPointer:true,token}));return;}
    if(['call','callvirt','newobj'].includes(n)){this.invoke(i);return;}
    if(n==='ret'){const result=frame.method.signature.returnType==='void'?null:this.pop();if(frame.initializes)this.initialized.set(frame.initializes,'initialized');this.frames.pop();const value=frame.returnObject??result;if(this.top){if(frame.returnObject||frame.method.signature.returnType!=='void')this.push(value);}else{this.returnValue=value;this.exitCode=frame.method.signature.returnType==='int'?Number(value)|0:0;this.state='terminated';}return;}
    if(n==='switch'){const index=number(this.pop());if(Number.isInteger(index)&&index>=0&&index<a.length)frame.pc=frame.offsets.get(a[index]);return;}
    if(i.operandKind.startsWith('br')){
      if(n.startsWith('leave')){frame.stack=[];frame.pending={kind:'leave',target:a,handlers:frame.method.handlers.filter(h=>h.flags===2&&within(i.offset,h)&&!within(a,h)).sort((x,y)=>(x.end-x.start)-(y.end-y.start))};frame.unwinds.push(frame.pending);this.resumeUnwind(frame);return;}
      let take;if(/^br(\.s)?$/.test(n))take=true;else if(/^br(true|false)/.test(n)){const v=this.pop(),truth=v!==null&&v!==0&&v!==0n;take=n.startsWith('brtrue')?truth:!truth;}else{const b=this.pop(),l=this.pop(),op=n.slice(1).split('.')[0];take=this.compare(l,b,op,n.includes('.un'));}if(take)frame.pc=frame.offsets.get(a);return;
    }
    if(n==='endfinally'){if(!frame.pending)throw new ManagedFault('InvalidProgramException','endfinally outside an unwind');this.resumeUnwind(frame);return;}
    if(n==='throw'){const ref=this.pop();if(ref===null)throw new ManagedFault('NullReferenceException','Null exception');const r=this.heap.get(ref);if(r.kind!=='exception'&&!this.matches(ref,'System.Exception'))throw new ManagedFault('InvalidProgramException','Thrown value is not an exception');throw new ManagedFault(r.type,this.format(r.data[0]),ref);}
    if(n==='rethrow')throw [...(frame.caught??[])].reverse().find(c=>i.offset>=c.start&&i.offset<c.end)?.fault??new ManagedFault('InvalidProgramException','No active catch');
    if(n.startsWith('conv.')){this.push(this.convert(n,this.pop()));return;}
    if(n==='ceq'||/^c(gt|lt)/.test(n)){const b=this.pop(),l=this.pop();this.push(this.compare(l,b,n==='ceq'?'eq':n.slice(1,3),n.endsWith('.un'))?1:0);return;}
    if(n==='neg'||n==='not'){const v=this.pop();if(!isNumber(v))throw new ManagedFault('InvalidProgramException','Numeric operand required');const raw=number(v);this.push(v?.float?n==='neg'?float(-raw):(()=>{throw new CilError('not requires integer');})():typeof raw==='bigint'?BigInt.asIntN(64,n==='neg'?-raw:~raw):n==='neg'?(-raw)|0:~raw);return;}
    if(/^(add|sub|mul|div|rem|and|or|xor|shl|shr)(\.|$)/.test(n)){const b=this.pop(),l=this.pop();this.push(this.binary(n,l,b));return;}
    if(n==='ckfinite'){const v=this.pop();if(!v?.float||!Number.isFinite(v.value))throw new ManagedFault('ArithmeticException','Non-finite floating-point value');this.push(v);return;}
    if(['ldsfld','stsfld','ldsflda'].includes(n)){
      const f=this.field(a);if(!f.field.isStatic&&!(f.field.flags&16))throw new CilError('Expected static field');if(this.ensureInitialized(f.field.ownerToken)){frame.pc--;return;}
      if(n==='ldsfld')this.push(this.storage(this.statics.get(f.token),f.field.signature.type));else if(n==='stsfld')this.dereference(this.address('static',f.token),true,this.storage(this.pop(),f.field.signature.type));else this.push(this.address('static',f.token));return;
    }
    if(['ldfld','stfld','ldflda'].includes(n)){const value=n==='stfld'?this.pop():undefined,ref=this.pop(),f=this.field(a,ref);if(n==='stfld')this.dereference(this.address('field',f.index,ref),true,this.storage(value,f.field.signature.type));else if(n==='ldfld')this.push(this.storage(f.record.data[f.index],f.field.signature.type));else this.push(this.address('field',f.index,ref));return;}
    if(n==='newarr'){const length=number(this.pop()),type=this.inspector.metadata.typeName(a),alias={'System.Int32':'int','System.UInt32':'uint','System.Int64':'long','System.UInt64':'ulong','System.Boolean':'bool','System.Double':'double','System.Single':'float','System.String':'string','System.Object':'object','System.Char':'char','System.Byte':'byte','System.SByte':'sbyte','System.Int16':'short','System.UInt16':'ushort'}[type]??type,ref=this.heap.array(alias,length);this.heap.get(ref).data.fill(defaults(alias));this.push(ref);return;}
    if(n==='ldlen'){const r=this.heap.get(this.pop());if(r.kind!=='array')throw new CilError('ldlen requires an array');this.push(r.data.length);return;}
    if(n==='ldelem'||n.startsWith('ldelem.')||n==='ldelema'){const index=number(this.pop()),ref=this.pop(),r=this.indexed(ref,index);this.push(n==='ldelema'?this.address('array',index,ref):n==='ldelem'?this.storage(r.data[index],this.inspector.metadata.typeName(a)):this.indirect(r.data[index],n));return;}
    if(n==='stelem'||n.startsWith('stelem.')){const value=this.pop(),index=number(this.pop()),ref=this.pop(),r=this.indexed(ref,index);this.dereference(this.address('array',index,ref),true,n==='stelem'?this.storage(value,this.inspector.metadata.typeName(a)):this.indirect(value,n));return;}
    if(n==='sizeof'){this.push(primitiveSizes[this.inspector.metadata.typeName(a)]);return;}
    if(n==='cpobj'){const source=this.pop(),destination=this.pop(),type=this.inspector.metadata.typeName(a);this.dereference(destination,true,this.storage(this.dereference(source),type));return;}
    if(n==='ldobj'||n.startsWith('ldind.')){const value=this.dereference(this.pop());this.push(n==='ldobj'?this.storage(value,this.inspector.metadata.typeName(a)):this.indirect(value,n));return;}
    if(n==='stobj'||n.startsWith('stind.')){const value=this.pop();this.dereference(this.pop(),true,n==='stobj'?this.storage(value,this.inspector.metadata.typeName(a)):this.indirect(value,n));return;}
    if(n==='initobj'){const address=this.pop(),name=this.inspector.metadata.typeName(a),type={'System.Int32':'int','System.Int64':'long','System.Double':'double','System.Single':'float','System.Boolean':'bool'}[name]??name;if(a>>>24===2)throw new ManagedFault('NotSupportedException','Value-type initobj is inspection-only');this.dereference(address,true,defaults(type));return;}
    if(n==='box'){const value=this.pop(),type=this.inspector.metadata.typeName(a);if(isReference(value)&&frameworkType(type)?.kind==='value'&&this.heap.get(value).type===type){this.heap.withRoots([value],()=>{const record=this.heap.get(value),copy=this.heap.allocate(record.kind,record.type,[...record.data]);this.push(this.heap.allocate('box',type,[copy],[copy]));});return;}if(!isNumber(value))throw new ManagedFault('NotSupportedException','Only primitive and registered immutable WinUI value boxing is implemented');this.push(this.heap.allocate('box',type,[this.storage(value,type)]));return;}
    if(n==='unbox'||n==='unbox.any'){const ref=this.pop(),type=this.inspector.metadata.typeName(a),record=this.heap.get(ref);if(record.kind!=='box'||record.type!==type)throw new ManagedFault('InvalidCastException','Boxed type mismatch');this.push(n==='unbox'?this.address('box',0,ref):this.storage(record.data[0],type));return;}
    if(n==='castclass'||n==='isinst'){const ref=this.pop(),type=this.inspector.metadata.typeName(a),ok=ref===null||this.matches(ref,type);if(!ok&&n==='castclass')throw new ManagedFault('InvalidCastException','Incompatible reference type');this.push(ok?ref:null);return;}
    throw new ManagedFault('NotSupportedException',`Opcode '${n}' is not executable`);
  }
  runSlice({instructionBudget=15000,timeBudgetMs=8,onInstruction=null}={}){
    this.scheduler.beforeSlice();if(this.state==='ready')this.state='running';if(this.state!=='running')return this.state;const started=performance.now();let n=0;
    if(this.pendingFault){const pending=this.pendingFault;this.pendingFault=null;this.raise(pending);}
    while(this.state==='running'&&this.frames.length&&n<instructionBudget){if((n&255)===0&&performance.now()-started>=timeBudgetMs)break;this.scheduler.beforeInstruction();if(this.state!=='running'||!this.frames.length)break;const instruction=this.top.method.instructions[this.top.pc];if(instruction&&onInstruction?.(instruction,this.top)){this.state='paused';break;}n++;this.instructions++;
      try{if(this.instructions>this.options.maxInstructions)throw new ManagedFault('InstructionLimitException','Program exceeded its instruction budget');this.step();}catch(error){const fault=error instanceof ManagedFault?error:new ManagedFault('InvalidProgramException',error.message??String(error));fault.frames??=[...this.frames].reverse().map(f=>({method:f.method.owner+'::'+f.method.name,methodToken:f.method.token,ilOffset:f.lastOffset}));if(!fatal.has(fault.name)&&this.onException?.(fault)){this.pendingFault=fault;this.state='paused';}else this.raise(fault);}
      this.scheduler.afterInstruction();
    }
    this.elapsedMs+=performance.now()-started;return this.state;
  }
  allFrames(){return this.scheduler.allFrames();}
  run(){while(this.state==='ready'||this.state==='running')this.runSlice({instructionBudget:100000,timeBudgetMs:50});return {state:this.state,output:this.output.join(''),returnValue:this.resultValue(),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  async runAsync(options={}){await this.scheduler.runAsync(options);return {state:this.state,output:this.output.join(''),returnValue:this.resultValue(),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  stop(){this.scheduler.cancelAll();this.platform.closeAll();this.state='terminated';this.frames=[];this.pendingFault=null;}
  statistics(){return {artifactFormat:'ECMA-335',profile:this.report.profile,instructions:this.instructions,elapsedMs:this.elapsedMs,frames:this.frames.length,assembly:{bytes:this.inspector.pe.bytes.length,loadMs:this.loadMs},heap:{...this.heap.stats,maxBytes:this.heap.maxBytes,threshold:this.heap.threshold}};}
}
