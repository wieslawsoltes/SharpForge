import {formatCilValue} from './value-formatting.js';
import {runtimeTypeRoots,clearRuntimeTypes} from './execution/tokens.js';
import {checkArrayStore} from './execution/casting.js';
import {storageDefault,storageValue} from './execution/storage.js';
import {literalString,stringRoots,clearStrings} from './execution/strings.js';
import {ManagedPlatform} from './platform.js';
import {CooperativeScheduler} from './scheduler.js';
import {snapshotVM,restoreVM} from './snapshot.js';
import { AssemblyInspector, verifyCilAssembly, resolveExecutionField, CilError } from '@sharpforge/cil';
import { ManagedHeap, ManagedFault, isReference } from './heap.js';
import {float,number,compare as numericCompare,binary as numericBinary,convert as numericConvert,unary as numericUnary,indirect as numericIndirect} from './execution/numeric-ops.js';
import {cilHandlers} from './execution/handlers/index.js';
import {call,ensureInitialized,invoke,prepareCall} from './execution/calls.js';
import {CilTypeSystem} from './execution/type-system.js';
import {throwFault,continueUnwind,exceptionRoots,fatalFaults} from './execution/eh.js';
import {invokeIntrinsic} from './execution/intrinsics.js';
import {initializationRoots} from './execution/static-init.js';
import {normalizeRuntimeLaunchOptions} from './launch-options.js';
import {cilEntryArguments} from './execution/entry-arguments.js';
const numericContext=Object.freeze({fault:(name,message)=>new ManagedFault(name,message),error:message=>new CilError(message),isReference});
/** Direct, cooperative CIL interpreter for a verified managed subset, independent of #SF.
 * No eval, native imports, network, files, threads, dynamic JS plugins or CLR loading. */
export class CilVirtualMachine {
  constructor(bytes,options={}){
    options=normalizeRuntimeLaunchOptions(options);
    const started=performance.now();this.options={maxInstructions:20_000_000,maxFrames:512,maxStackValues:65536,maxOutputCharacters:1_000_000,...options};
    this.inspector=bytes instanceof AssemblyInspector?bytes:new AssemblyInspector(bytes,options);this.report=verifyCilAssembly(this.inspector,options);
    if(!this.report.success){const error=new CilError('Managed IL verification failed: '+this.report.issues.map(i=>`${i.method??''}${i.offset===undefined?'':` IL_${i.offset.toString(16)}`}: ${i.message}`).join('; '));error.issues=this.report.issues;throw error;}
    const entry=this.inspector.getMethod(this.report.entryPoint);this.returnType=entry.signature.returnType;if(!entry.signature.isStatic)throw new CilError('Host invocation requires a static method');
    this.heap=new ManagedHeap(options);this.heap.rootProvider=()=>this.roots();this.frames=[];this.statics=new Map();this.strings=new Map();this.initialized=new Map();this._typeSystem=null;this.layoutCache=this.typeSystem.layouts;this.frameId=0;
    this.snapshotOwner=Object.freeze({});this.writeRevision=0;this.onWrite=null;this.state='ready';this.instructions=0;this.elapsedMs=0;this.output=[];this.outputCharacters=0;this.fault=null;this.pendingFault=null;this.onException=null;this.returnValue=null;this.exitCode=0;this.onOutput=options.onOutput??(()=>{});this.loadMs=performance.now()-started;
    for(const f of this.inspector.fields.values())if(f.isStatic)this.statics.set(f.token,storageDefault(this,resolveExecutionField(this.inspector,f.token).signature.type));
    const args=cilEntryArguments(this,entry,options);
    this.platform=new ManagedPlatform(this,options);this.scheduler=new CooperativeScheduler(this,options);this.call(entry.token,args);this.ensureInitialized(entry.ownerToken,'static-method');
  }
  *roots(){yield* this.platform?.roots()??[];yield* this.scheduler?.roots()??[];
    const root=function*(v){if(v?.byref){if(v.owner)yield v.owner;}else yield v;};
    yield* initializationRoots(this);yield* runtimeTypeRoots(this);
    for(const v of this.statics.values())yield* root(v);yield* stringRoots(this);yield this.returnValue;
    if(this.fault?.reference)yield this.fault.reference;if(this.pendingFault?.reference)yield this.pendingFault.reference;
    for(const f of this.frames){for(const v of f.stack)yield* root(v);for(const v of f.args)yield* root(v);for(const v of f.locals)yield* root(v);yield f.returnObject;yield* exceptionRoots(f);}
  }
  get top(){return this.frames.at(-1);}
  get typeSystem(){
    if(this._typeSystem?.inspector!==this.inspector){clearRuntimeTypes(this);this._typeSystem=new CilTypeSystem(this);this.layoutCache=this._typeSystem.layouts;}
    return this._typeSystem;
  }
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
  storage(value,type){return storageValue(this,value,type,numericContext);}
  slotType(frame,arg,index){return arg?(frame.method.signature.isStatic?frame.method.signature.parameters[index]:index===0?'object':frame.method.signature.parameters[index-1]):frame.method.locals[index];}
  indirect(value,name){return numericIndirect(value,name,numericContext);}
  resultValue(){const value=this.value(this.returnValue);return this.returnType==='uint'?Number(value)>>>0:this.returnType==='ulong'?BigInt.asUintN(64,value??0n):this.returnType==='bool'?!!value:value;}
  resultDisplay(){return this.returnType==='string'?this.display(this.returnValue):this.format(this.returnValue,this.returnType);}
  value(v){if(v?.float)return v.value;if(isReference(v)){const r=this.heap.get(v);if(r.kind==='string')return r.data;if(r.kind==='box')return this.value(r.data[0]);}return v;}
  format(v,type){return formatCilValue(this,v,type);}
  display(v){return v===null?'null':isReference(v)&&this.heap.get(v).kind==='string'?JSON.stringify(this.value(v)):this.format(v);}
  string(s){return literalString(this,s);}
  push(v){if(this.top.stack.length>=this.options.maxStackValues)throw new ManagedFault('ExecutionLimitException','Evaluation stack budget exceeded');this.top.stack.push(v);}
  pop(){if(!this.top.stack.length)throw new ManagedFault('InvalidProgramException','Evaluation stack underflow');return this.top.stack.pop();}
  call(token,args,extra={}){return call(this,token,args,extra);}
  ensureInitialized(typeToken,trigger='field',genericIdentity=null){return ensureInitialized(this,typeToken,trigger,genericIdentity);}
  layout(typeToken,depth=0){return this.typeSystem.layout(typeToken,depth);}
  typeOf(ref){return this.typeSystem.typeOf(ref);}
  matches(ref,typeName){return this.typeSystem.matches(ref,typeName);}
  field(token,ref){return this.typeSystem.field(token,ref);}
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
      if(address.kind==='array')checkArrayStore(this.heap,this.heap.get(address.owner),value);
      if(slots)slots[address.index]=value;else this.statics.set(address.index,value);
      this.writeRevision++;
      if(address.owner)this.heap.mutationRevision++;
      this.onWrite?.({kind:address.kind,index:address.index,frameId:address.frameId,
        ...(address.owner?{handle:address.owner.h,generation:address.owner.g}:{}),oldValue:old,value});
      return value;
    }
    if(old===undefined)throw new ManagedFault('InvalidProgramException','Uninitialized address');return old;
  }
  snapshot(){return snapshotVM(this,'cil');}
  restore(snapshot){return restoreVM(this,snapshot,'cil');}
  indexed(ref,index){const r=this.heap.get(ref),n=number(index);if(r.kind!=='array'||!Number.isInteger(n)||n<0||n>=r.data.length)throw new ManagedFault('IndexOutOfRangeException','Array index out of range');return r;}
  emitOutput(s){if(this.outputCharacters+s.length>this.options.maxOutputCharacters)throw new ManagedFault('OutputLimitException','Program output limit exceeded');this.outputCharacters+=s.length;this.output.push(s);this.onOutput(s);}
  compare(a,b,op,unsigned=false){return numericCompare(a,b,op,unsigned,numericContext);}
  binary(name,a,b){return numericBinary(name,a,b,numericContext);}
  convert(name,value){return numericConvert(name,value,numericContext);}
  unary(name,value){return numericUnary(name,value,numericContext);}
  intrinsic(descriptor,args){return invokeIntrinsic(this,descriptor,args);}
  invoke(instruction){return invoke(this,instruction);}
  resumeUnwind(frame){return continueUnwind(this,frame);}
  raise(error){return throwFault(this,error);}
  *exceptionRoots(frame){yield* exceptionRoots(frame);}
  step(){
    const frame=this.top;
    if(frame.needsInitialization&&!prepareCall(this,frame))return;
    const instruction=frame.method.instructions[frame.pc++];
    if(!instruction)throw new ManagedFault('InvalidProgramException','Instruction pointer is outside the method');
    frame.lastOffset=instruction.offset;
    const handler=cilHandlers.get(instruction.name);
    if(!handler)throw new ManagedFault('NotSupportedException',`Opcode '${instruction.name}' is not executable`);
    handler(this,frame,instruction);
  }
  runSlice({instructionBudget=15000,timeBudgetMs=8,onInstruction=null}={}){
    this.scheduler.beforeSlice();if(this.state==='ready')this.state='running';if(this.state!=='running')return this.state;const started=performance.now();let n=0;
    if(this.pendingFault){const pending=this.pendingFault;this.pendingFault=null;this.raise(pending);}
    while(this.state==='running'&&this.frames.length&&n<instructionBudget){if((n&255)===0&&performance.now()-started>=timeBudgetMs)break;this.scheduler.beforeInstruction();if(this.state!=='running'||!this.frames.length)break;const instruction=this.top.method.instructions[this.top.pc];if(instruction&&onInstruction?.(instruction,this.top)){this.state='paused';break;}n++;this.instructions++;
      try{if(this.instructions>this.options.maxInstructions)throw new ManagedFault('InstructionLimitException','Program exceeded its instruction budget');this.step();}catch(error){const fault=error instanceof ManagedFault?error:new ManagedFault('InvalidProgramException',error.message??String(error));fault.frames??=[...this.frames].reverse().map(f=>({method:f.method.owner+'::'+f.method.name,methodToken:f.method.token,ilOffset:f.lastOffset}));if(!fatalFaults.has(fault.name)&&this.onException?.(fault)){this.pendingFault=fault;this.state='paused';}else this.raise(fault);}
      this.scheduler.afterInstruction();
    }
    this.elapsedMs+=performance.now()-started;return this.state;
  }
  allFrames(){return this.scheduler.allFrames();}
  run(){while(this.state==='ready'||this.state==='running')this.runSlice({instructionBudget:100000,timeBudgetMs:50});return {state:this.state,output:this.output.join(''),returnValue:this.resultValue(),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  async runAsync(options={}){await this.scheduler.runAsync(options);return {state:this.state,output:this.output.join(''),returnValue:this.resultValue(),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  stop(){clearStrings(this);clearRuntimeTypes(this);this.scheduler.cancelAll();this.platform.closeAll();this.state='terminated';this.frames=[];this.pendingFault=null;}
  statistics(){return {artifactFormat:'ECMA-335',profile:this.report.profile,instructions:this.instructions,elapsedMs:this.elapsedMs,frames:this.frames.length,assembly:{bytes:this.inspector.pe.bytes.length,loadMs:this.loadMs},heap:{...this.heap.stats,maxBytes:this.heap.maxBytes,threshold:this.heap.threshold}};}
}
