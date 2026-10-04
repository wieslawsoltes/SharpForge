import {registerScalarStoreAdapters} from './execution/scalar-slot-store.js';
import {arrayVectorRecord} from './execution/arrays.js';
import {admitCilAssembly} from './execution/cil-admission.js';
import {admitCilAssemblyStacks,pushStackValue} from './execution/frame-stack.js';
import {installRootProvider,rootValues} from './execution/frame-roots.js';
import {stopExecution} from './execution/stop.js';
import {executionProfiler} from './execution/profiler.js';
import {bindNativeAbi,cilNumericContext,marshalCilValue,cilValue,cilResultValue,cilArrayIndex} from './execution/cil-values.js';
import {formatCilValue} from './value-formatting.js';
import {clearRuntimeTypes} from './execution/tokens.js';
import {createManagedAddress,dereferenceManagedAddress} from './execution/managed-address.js';
import {storageDefault,storageValue} from './execution/storage.js';
import {literalString} from './execution/strings.js';
import {ManagedPlatform} from './platform.js';
import {CooperativeScheduler} from './scheduler.js';
import {snapshotVM,restoreVM} from './snapshot.js';
import { resolveExecutionField, CilError } from '@sharpforge/cil';
import { ManagedHeap, ManagedFault, isReference } from './heap.js';
import {compare as numericCompare,binary as numericBinary,convert as numericConvert,unary as numericUnary,indirect as numericIndirect} from './execution/numeric-ops.js';
import {executeCilStep} from './execution/cil-step.js';
import {call,ensureInitialized,invoke} from './execution/calls.js';
import {registerCanonicalCilCall} from './execution/call-entry-guard.js';
import {CilTypeSystem} from './execution/type-system.js';
import {throwFault,continueUnwind,exceptionRoots} from './execution/eh.js';
import {runCilSlice} from './execution/cil-slice.js';
import {initializeCilMethodEvents,cilRuntimeEvents,restoreCilMethodEvents} from './execution/cil-method-events.js';
import {invokeIntrinsic} from './execution/intrinsics.js';
import {normalizeRuntimeLaunchOptions} from './launch-options.js';
import {cilEntryArguments} from './execution/entry-arguments.js';
import {initializeCilInstrumentation} from './execution/cil-instrumentation.js';
/** Direct, cooperative CIL interpreter for a verified managed subset, independent of #SF.
 * No eval, native imports, network, files, threads, dynamic JS plugins or CLR loading. */
export class CilVirtualMachine {
  constructor(bytes,options={}){
    registerCanonicalCilCall(this,canonicalCilCall);
    registerScalarStoreAdapters(this,canonicalScalarStoreAdapters);
    options=normalizeRuntimeLaunchOptions(options);
    const started=performance.now();this.options={maxInstructions:20_000_000,maxFrames:512,maxStackValues:65536,maxOutputCharacters:1_000_000,...options};
    bindNativeAbi(this.options);
    initializeCilMethodEvents(this, options.runtimeEvents);
    admitCilAssembly(this,bytes,options);
    admitCilAssemblyStacks(this);
    const entry=this.inspector.getMethod(this.report.entryPoint);this.returnType=entry.signature.returnType;if(!entry.signature.isStatic)throw new CilError('Host invocation requires a static method');
    this.heap=new ManagedHeap(options);installRootProvider(this);this.frames=[];this.statics=new Map();this.strings=new Map();this.initialized=new Map();this._typeSystem=null;this.layoutCache=this.typeSystem.layouts;this.frameId=0;
    this.snapshotOwner=Object.freeze({});this.writeRevision=0;this.onWrite=null;this.state='ready';this.instructions=0;this.elapsedMs=0;this.output=[];this.outputCharacters=0;this.fault=null;this.pendingFault=null;this.onException=null;this.returnValue=null;this.exitCode=0;this.onOutput=options.onOutput??(()=>{});this.loadMs=performance.now()-started;
    initializeCilInstrumentation(this,options);
    for(const f of this.inspector.fields.values())if(f.isStatic)this.statics.set(f.token,storageDefault(this,resolveExecutionField(this.inspector,f.token).signature.type));
    const args=cilEntryArguments(this,entry,options);
    this.platform=new ManagedPlatform(this,options);this.scheduler=new CooperativeScheduler(this,options);this.call(entry.token,args);this.ensureInitialized(entry.ownerToken,'static-method');
  }
  *roots(){yield* rootValues(this);}
  get top(){return this.frames.at(-1);}
  get runtimeEvents(){return cilRuntimeEvents(this);}
  get profiler(){return executionProfiler(this);}
  get typeSystem(){
    if(this._typeSystem?.inspector!==this.inspector){clearRuntimeTypes(this);this._typeSystem=new CilTypeSystem(this);this.layoutCache=this._typeSystem.layouts;}
    return this._typeSystem;
  }
  marshal(value,type){return marshalCilValue(this,value,type);}
  // CLI storage locations narrow integers and round single precision on write/load.
  storage(value,type){return storageValue(this,value,type,cilNumericContext(this));}
  slotType(frame,arg,index){const optional=arg&&frame.varargs?.find(item=>item.index===index);if(optional)return optional.type.name;return arg?(frame.method.signature.isStatic?frame.method.signature.parameters[index]:index===0?'object':frame.method.signature.parameters[index-1]):frame.method.locals[index];}
  indirect(value,name){return numericIndirect(value,name,cilNumericContext(this));}
  resultValue(){return cilResultValue(this);}
  resultDisplay(){return this.returnType==='string'?this.display(this.returnValue):this.format(this.returnValue,this.returnType);}
  value(v){return cilValue(this,v);}
  format(v,type){return formatCilValue(this,v,type);}
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
  address(kind,index,owner,options){return createManagedAddress(this,kind,index,owner,options);}
  dereference(address,write=false,value){return dereferenceManagedAddress(this,address,write,value);}
  snapshot(){return snapshotVM(this,'cil');}
  restore(snapshot){const result=restoreVM(this,snapshot,'cil');restoreCilMethodEvents(this);return result;}
  indexed(ref,index){return arrayVectorRecord(this,ref,index);}
  emitOutput(s){if(this.outputCharacters+s.length>this.options.maxOutputCharacters)throw new ManagedFault('OutputLimitException','Program output limit exceeded');this.outputCharacters+=s.length;this.output.push(s);this.onOutput(s);}
  compare(a,b,op,unsigned=false,branch=false){return numericCompare(a,b,op,unsigned,cilNumericContext(this),branch);}
  binary(name,a,b){return numericBinary(name,a,b,cilNumericContext(this));}
  convert(name,value){return numericConvert(name,value,cilNumericContext(this));}
  unary(name,value){return numericUnary(name,value,cilNumericContext(this));}
  intrinsic(descriptor,args){return invokeIntrinsic(this,descriptor,args);}
  invoke(instruction){return invoke(this,instruction);}
  resumeUnwind(frame){return continueUnwind(this,frame);}
  raise(error){return throwFault(this,error);}
  *exceptionRoots(frame){yield* exceptionRoots(frame);}
  step(){return executeCilStep(this);}
  runSlice(options){return runCilSlice(this,options);}
  allFrames(){return this.scheduler.allFrames();}
  run(){while(this.state==='ready'||this.state==='running')this.runSlice({instructionBudget:100000,timeBudgetMs:50});return {state:this.state,output:this.output.join(''),returnValue:this.resultValue(),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  async runAsync(options={}){await this.scheduler.runAsync(options);return {state:this.state,output:this.output.join(''),returnValue:this.resultValue(),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  stop(){stopExecution(this);}
  statistics(){return {artifactFormat:'ECMA-335',profile:this.report.profile,instructions:this.instructions,elapsedMs:this.elapsedMs,frames:this.frames.length,assembly:{bytes:this.inspector.pe.bytes.length,loadMs:this.loadMs},heap:{...this.heap.stats,maxBytes:this.heap.maxBytes,threshold:this.heap.threshold}};}
}
const canonicalCilCall = CilVirtualMachine.prototype.call;

const canonicalScalarStoreAdapters = Object.freeze({address: CilVirtualMachine.prototype.address,
  dereference: CilVirtualMachine.prototype.dereference, storage: CilVirtualMachine.prototype.storage, pop: CilVirtualMachine.prototype.pop});
