import {createExecutionProfiler} from './execution/profiler.js';
import {installRootProvider} from './execution/frame-roots.js';
import {pushStackValue} from './execution/frame-stack.js';
import {verificationFault} from './execution/verification-fault.js';
import {asyncRoots} from './execution/async-runtime.js';
import {nativeInteger,decimalParse,decimalFromBits,decodeScalar} from '@sharpforge/bytecode';
import {invokeDelegate} from './execution/delegate-calls.js';
import {callRoots} from './execution/generic-calls.js';
import {createArray} from './execution/arrays.js';
import {SyncPrimitives} from './execution/sync-primitives.js';
import {arrayContinuationRoots} from './execution/array-ops.js';
import {scalarFormat,isDecimal,isNativeInteger,numericTypeName,numericTypeNames,nativeIntegerBits} from '@sharpforge/bytecode';
import {runtimeTypeRoots,clearRuntimeTypes,runtimeTypeText} from './execution/tokens.js';
import {address,dereference} from './execution/managed-pointers.js';
import {storageDefault,storageValue} from './execution/storage.js';
import {enumToString} from './execution/enums.js';
import {literalString,stringRoots} from './execution/strings.js';
import {ManagedPlatform} from './platform.js';
import {CooperativeScheduler} from './scheduler.js';
import {snapshotVM,restoreVM} from './snapshot.js';
import { AssemblyInspector, verifyCilAssembly, resolveExecutionField, callStorageType, CilError } from '@sharpforge/cil';
import { ManagedHeap, ManagedFault, isReference } from './heap.js';
import {float,number,compare as numericCompare,binary as numericBinary,convert as numericConvert,unary as numericUnary,indirect as numericIndirect} from './execution/numeric-ops.js';
import {executeCilStep,runCilSlice,cilExecutionState,setCilExecutionState} from './execution/cil-step.js';
import {stopVM} from './execution/vm-lifecycle.js';
import {call,ensureInitialized,invoke,invokeFunctionPointer} from './execution/calls.js';
import {CilTypeSystem} from './execution/type-system.js';
import {throwFault,continueUnwind,exceptionRoots} from './execution/eh.js';
import {invokeIntrinsic} from './execution/intrinsics.js';
import {initializationRoots} from './execution/static-init.js';
const numericContexts=new WeakMap();
const numericContext=vm=>{let c=numericContexts.get(vm);if(!c){c=Object.freeze({fault:(name,message)=>new ManagedFault(name,message),error:message=>new CilError(message),isReference,nativeIntBits:nativeIntegerBits(vm.options)});numericContexts.set(vm,c);}return c;};
/** Direct, cooperative CIL interpreter for a verified managed subset, independent of #SF.
 * No eval, native imports, network, files, threads, dynamic JS plugins or CLR loading. */
export class CilVirtualMachine {
  constructor(bytes,options={}){
    const started=performance.now();this.options={maxInstructions:20_000_000,maxStackValues:65536,maxOutputCharacters:1_000_000,...options};
    this.inspector=bytes instanceof AssemblyInspector?bytes:new AssemblyInspector(bytes,options);this.report=verifyCilAssembly(this.inspector,options);
    if(!this.report.success)throw verificationFault(this.report);
    const entry=this.inspector.getMethod(this.report.entryPoint);this.returnType=entry.signature.returnType;if(!entry.signature.isStatic)throw new CilError('Host invocation requires a static method');
    this.heap=new ManagedHeap(options);installRootProvider(this);this.frames=[];this.statics=new Map();this.strings=new Map();this.initialized=new Map();this._typeSystem=null;this.layoutCache=this.typeSystem.layouts;this.frameId=0;
    this.snapshotOwner=Object.freeze({});this.writeRevision=0;this.onWrite=null;this.state='ready';this.instructions=0;this.elapsedMs=0;this.output=[];this.outputCharacters=0;this.fault=null;this.pendingFault=null;this.onException=null;this.returnValue=null;this.exitCode=0;this.onOutput=options.onOutput??(()=>{});this.loadMs=performance.now()-started;
    for(const f of this.inspector.fields.values())if(f.isStatic)this.statics.set(f.token,storageDefault(this,resolveExecutionField(this.inspector,f.token).signature.type));
    const input=options.arguments??(entry.signature.parameters.length===1&&entry.signature.parameters[0]==='string[]'?[[]]:[]);
    if(input.length!==entry.signature.parameters.length)throw new CilError('Argument count does not match selected method');
    const args=[];this.heap.withRoots(args,()=>{for(let i=0;i<input.length;i++){const value=this.marshal(input[i],entry.signature.parameters[i]);args.push(value);this.heap.pins.push(value);}});
    this.platform=new ManagedPlatform(this,options);this.scheduler=new CooperativeScheduler(this,options);this.sync=new SyncPrimitives(this);this.profiler=createExecutionProfiler(this,options.profile);this.heap.observer=this.profiler;this.call(entry.token,args);this.ensureInitialized(entry.ownerToken,'static-method');
  }
  *roots(){yield* this.platform?.roots()??[];yield* this.scheduler?.roots()??[];yield* this.sync?.roots()??[];yield* asyncRoots(this);
    const root=function*(v){if(v?.byref){if(v.owner)yield v.owner;}else yield v;};
    yield* initializationRoots(this);yield* runtimeTypeRoots(this);
    for(const v of this.statics.values())yield* root(v);yield* stringRoots(this);yield this.returnValue;
    if(this.fault?.reference)yield this.fault.reference;if(this.pendingFault?.reference)yield this.pendingFault.reference;
    for(const f of this.frames){for(const v of f.stack)yield* root(v);for(const v of f.args)yield* root(v);for(const v of f.locals)yield* root(v);yield f.returnObject;yield f.asyncBuilderTask;yield* exceptionRoots(f);yield* callRoots(f);yield* arrayContinuationRoots(f);}
  }
  get top(){return this.frames.at(-1);}
  get state(){return cilExecutionState(this);}
  set state(value){setCilExecutionState(this,value);}
  get typeSystem(){
    if(this._typeSystem?.inspector!==this.inspector){clearRuntimeTypes(this);this._typeSystem=new CilTypeSystem(this);this.layoutCache=this._typeSystem.layouts;}
    return this._typeSystem;
  }
  marshal(value,type){
    type=numericTypeName(type);
    if(value?.scalar){if(numericTypeName(value.scalar)!==type)throw new CilError('Scalar argument type mismatch');return decodeScalar(value,numericContext(this));}
    if(type==='decimal'){if(Array.isArray(value))return decimalFromBits(value,numericContext(this));if(typeof value!=='string')throw new CilError('Decimal arguments require exact text or four Int32 bits');return decimalParse(value,numericContext(this));}
    if(type==='nint'||type==='nuint'){const bits=nativeIntegerBits(this.options);let n;try{if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error();n=BigInt(value);}catch{throw new CilError('Native integer arguments require an exact integer or decimal string');}const unsigned=type==='nuint',min=unsigned?0n:-(1n<<BigInt(bits-1)),max=unsigned?(1n<<BigInt(bits))-1n:(1n<<BigInt(bits-1))-1n;if(n<min||n>max)throw new CilError('Native integer argument out of range');return nativeInteger(n,bits);}
    if(type.endsWith('[]')){if(!Array.isArray(value))throw new CilError(`Expected JSON array for ${type}`);const ref=createArray(this,type.slice(0,-2),[value.length]);return this.heap.withRoots([ref],()=>{const r=this.heap.get(ref);for(let i=0;i<value.length;i++)this.heap.writeData(r,i,this.marshal(value[i],type.slice(0,-2)));return ref;});}
    if(type==='string'){if(value===null)return null;if(typeof value!=='string')throw new CilError('Expected string argument');return this.heap.string(value);}
    if(type==='bool'){if(typeof value!=='boolean')throw new CilError('Expected boolean argument');return value?1:0;}
    if(type==='long'||type==='ulong'){let n;try{if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error();n=BigInt(value);}catch{throw new CilError('Int64 arguments require an exact integer or decimal string');}if(type==='long'&&(n<-(1n<<63n)||n>=(1n<<63n))||type==='ulong'&&(n<0||n>=(1n<<64n)))throw new CilError('Int64 argument out of range');return BigInt.asIntN(64,n);}
    if(type==='double'||type==='float'){if(typeof value!=='number')throw new CilError('Expected numeric argument');return float(value,type==='float'?'r4':'r8');}
    if(['int','uint','short','ushort','byte','sbyte','char'].includes(type)){if(typeof value!=='number'||!Number.isInteger(value))throw new CilError('Expected integer argument');const ranges={int:[-2147483648,2147483647],uint:[0,4294967295],short:[-32768,32767],ushort:[0,65535],byte:[0,255],sbyte:[-128,127],char:[0,65535]};if(value<ranges[type][0]||value>ranges[type][1])throw new CilError(`${type} argument out of range`);return value|0;}
    if(type==='object'&&value===null)return null;throw new CilError(`Host argument type '${type}' is not supported`);
  }
  // CLI storage locations narrow integers and round single precision on write/load.
  storage(value,type){return storageValue(this,value,type,numericContext(this));}
  slotType(frame, arg, index) {
    if (arg && !frame.method.signature.isStatic && index === 0) {
      const owner = frame.genericIdentity ?? frame.method.owner;
      return this.typeSystem.table(owner).flags.valueType ? owner + '&' : 'object';
    }
    const type = arg ? frame.method.signature.parameters[index - (frame.method.signature.isStatic ? 0 : 1)]
      : frame.method.locals[index];
    return type === undefined ? undefined : callStorageType(type);
  }
  indirect(value,name){return numericIndirect(value,name,numericContext(this));}
  resultValue(){const value=this.value(this.returnValue);if(this.returnType==='nuint'){const bits=nativeIntegerBits(this.options),n=BigInt.asUintN(bits,BigInt(value??0));return bits===32?Number(n):n;}return this.returnType==='uint'?Number(value)>>>0:this.returnType==='ulong'?BigInt.asUintN(64,value??0n):this.returnType==='bool'?!!value:value;}
  resultDisplay(){return this.returnType==='string'?this.display(this.returnValue):this.format(this.returnValue,this.returnType);}
  value(v){if(v?.float||isNativeInteger(v))return v.value;if(isReference(v)){const r=this.heap.get(v);if(r.kind==='string')return r.data;if(r.kind==='box')return this.value(r.data[0]);}return v;}
  format(v,type){const name=runtimeTypeText(this,v)??enumToString(this,v,type);if(name!==null)return name;if(v===null)return '';if(isReference(v)&&this.heap.get(v).kind==='box'){const r=this.heap.get(v);return this.format(r.data[0],numericTypeName(r.methodTable.name));}const n=this.value(v);if(type==='System.Boolean')type='bool';if(type==='bool')return n?'True':'False';if(isDecimal(v)||v?.float||isNativeInteger(v)||numericTypeNames.includes(numericTypeName(type)))return scalarFormat(v,type,this.options);if(type==='char')return String.fromCharCode(Number(n));if(type==='uint')return String(Number(n)>>>0);if(type==='ulong')return String(BigInt.asUintN(64,n));if(isReference(n)){const r=this.heap.get(n);return r.kind==='exception'?r.type+': '+this.format(r.data[0]):r.type;}return String(n);}
  display(v){return v===null?'null':isReference(v)&&this.heap.get(v).kind==='string'?JSON.stringify(this.value(v)):this.format(v);}
  string(s){return literalString(this,s);}
  push(v){pushStackValue(this,v);}
  pop(){if(!this.top.stack.length)throw new ManagedFault('InvalidProgramException','Evaluation stack underflow');return this.top.stack.pop();}
  call(token,args,extra={}){return call(this,token,args,extra);}
  ensureInitialized(typeToken,trigger='field',genericIdentity=null){return ensureInitialized(this,typeToken,trigger,genericIdentity);}
  layout(typeToken,depth=0){return this.typeSystem.layout(typeToken,depth);}
  typeOf(ref){return this.typeSystem.typeOf(ref);}
  matches(ref,typeName){return this.typeSystem.matches(ref,typeName);}
  field(token,ref){return this.typeSystem.field(token,ref);}
  notifyWrite(write){this.writeRevision++;if(write.handle!==undefined)this.heap.mutationRevision++;this.onWrite?.({...write,frameId:write.frameId??this.top?.id});}
  address(kind,index,owner,options){return address(this,kind,index,owner,options);}
  dereference(pointer,write=false,value){return dereference(this,pointer,write,value);}
  snapshot(){return snapshotVM(this,'cil');}
  restore(snapshot){return restoreVM(this,snapshot,'cil');}
  indexed(ref,index){const r=this.heap.get(ref),n=number(index);if(r.kind!=='array'||!Number.isInteger(n)||n<0||n>=r.data.length)throw new ManagedFault('IndexOutOfRangeException','Array index out of range');return r;}
  emitOutput(s){if(this.outputCharacters+s.length>this.options.maxOutputCharacters)throw new ManagedFault('OutputLimitException','Program output limit exceeded');this.outputCharacters+=s.length;this.output.push(s);this.onOutput(s);}
  compare(a,b,op,unsigned=false){return numericCompare(a,b,op,unsigned,numericContext(this));}
  binary(name,a,b){return numericBinary(name,a,b,numericContext(this));}
  convert(name,value){return numericConvert(name,value,numericContext(this));}
  unary(name,value){return numericUnary(name,value,numericContext(this));}
  intrinsic(descriptor,args){return invokeIntrinsic(this,descriptor,args);}
  invokeFunctionPointer(pointer,args,extra){return invokeFunctionPointer(this,pointer,args,extra);}
  invokeDelegate(reference,args){return invokeDelegate(this,reference,args);}
  invoke(instruction){return invoke(this,instruction);}
  resumeUnwind(frame){return continueUnwind(this,frame);}
  raise(error){return throwFault(this,error);}
  *exceptionRoots(frame){yield* exceptionRoots(frame);}
  step(){return executeCilStep(this);}
  runSlice(options){return runCilSlice(this,options);}
  allFrames(){return this.scheduler.allFrames();}
  run(){while(this.state==='ready'||this.state==='running')this.runSlice({instructionBudget:100000,timeBudgetMs:50});return {state:this.state,output:this.output.join(''),returnValue:this.resultValue(),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  async runAsync(options={}){await this.scheduler.runAsync(options);return {state:this.state,output:this.output.join(''),returnValue:this.resultValue(),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  stop(){stopVM(this);}
  statistics(){return {artifactFormat:'ECMA-335',profile:this.report.profile,instructions:this.instructions,elapsedMs:this.elapsedMs,frames:this.frames.length,assembly:{bytes:this.inspector.pe.bytes.length,loadMs:this.loadMs},heap:{...this.heap.stats,maxBytes:this.heap.maxBytes,threshold:this.heap.threshold}};}
}
