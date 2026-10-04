import {registerSourceAdapters} from './execution/source-adapter-guard.js';
import {sourceAddress, sourceDereference, sourceStorage} from './execution/source-addresses.js';
import {callSourceFrame} from './execution/call-frames.js';
import {rootValues} from './execution/frame-roots.js';
import {sourceRuntimeEvents, restoreSourceMethodEvents} from './execution/source-runtime-events.js';
import {runSourceSlice} from './execution/source-slice.js';
import {stopExecution} from './execution/stop.js';
import {sourceConstant} from './execution/source-numbers.js';
import {formatSourceValue} from './value-formatting.js';
import {snapshotVM,restoreVM} from './snapshot.js';
import { ManagedFault, isReference } from './heap.js';
import {builtin} from './execution/source-builtins.js';
import {sourceValue} from './execution/source-values.js';
import {initializeSourceVM} from './execution/initialize-source.js';
import {binary} from './execution/source-ops.js';
import {makeFault,enterCatch,finalizers,finishReturn,transfer,resumeUnwind,handleFault} from './execution/source-eh.js';
export class VirtualMachine {
  #profiler = null;
  constructor(image,options={}){
    registerSourceAdapters(this, canonicalSourceAdapters);
    initializeSourceVM(this,image,options, profiler => { this.#profiler = profiler; });
  }
  *roots(){yield* rootValues(this);}
  call(methodId,args,extra){return callSourceFrame(this,methodId,args,extra);}
  address(kind,index,owner,options){return sourceAddress(this,kind,index,owner,options);}
  dereference(pointer,write=false,value){return sourceDereference(this,pointer,write,value);}
  storage(value,type){return sourceStorage(this,value,type);}
  notifyWrite(write){this.writeRevision++;if(['field','array'].includes(write.kind))this.heap.mutationRevision++;this.onWrite?.(write);}
  get top(){return this.frames.at(-1);}
  get profiler(){return this.#profiler;}
  get runtimeEvents() { return sourceRuntimeEvents(this); }
  value(ref){return sourceValue(this.heap,ref);}
  format(value,type){return formatSourceValue(this,value,type);}
  display(value){if(value===null)return 'null';if(isReference(value)){const r=this.heap.get(value);if(r.kind==='string')return JSON.stringify(r.data);if(r.kind==='array')return `${r.type} [${r.data.length}]`;return `${r.type} {#${value.h}}`;}return this.format(value);}
  constant(index){return sourceConstant(this,index);}
  binary(operator,a,b,mode=0){return binary(this,operator,a,b,mode);}
  emitOutput(text){text=String(text);if(this.outputCharacters+text.length>this.options.maxOutputCharacters)throw new ManagedFault('OutputLimitException','Program output limit exceeded');this.outputCharacters+=text.length;this.output.push(text);this.onOutput(text);}
  builtin(id,args){return builtin(this,id,args);}
  indexed(ref,index){const r=this.heap.get(ref);if(r.kind!=='array')throw new ManagedFault('InvalidOperationException','Expected a managed array');if(!Number.isInteger(index)||index<0||index>=r.data.length)throw new ManagedFault('IndexOutOfRangeException','Index was outside the bounds of the array');return r;}
  makeFault(error){return makeFault(error);}
  enterCatch(frame,handler,fault){return enterCatch(this,frame,handler,fault);}
  finalizers(frame,source,target=Infinity){return finalizers(this,frame,source,target);}
  finishReturn(frame,value){return finishReturn(this,frame,value);}
  transfer(frame,kind,target,value){return transfer(this,frame,kind,target,value);}
  resumeUnwind(frame){return resumeUnwind(this,frame);}
  handleFault(error){return handleFault(this,error);}
  runSlice(options){return runSourceSlice(this,options);}
  allFrames(){return this.scheduler.allFrames();}
  run(){if(this.state==='paused')this.state='running';while(this.state==='ready'||this.state==='running')this.runSlice({instructionBudget:100000,timeBudgetMs:100});return {state:this.state,output:this.output.join(''),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  async runAsync(options={}){await this.scheduler.runAsync(options);return {state:this.state,output:this.output.join(''),returnValue:this.value(this.returnValue),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  stop(){stopExecution(this);}
  statistics(){return {artifactFormat:this.image.il?'ECMA-335':'SharpForge IR',assembly:this.image.il?{bytes:this.image.il.assemblyBytes,loadMs:this.image.il.loadMs,decodeMs:this.image.il.decodeMs,verificationMs:this.image.il.verificationMs}:null,instructions:this.instructions,elapsedMs:this.elapsedMs,frames:this.frames.length,heap:{...this.heap.stats,maxBytes:this.heap.maxBytes,threshold:this.heap.threshold}};}
  snapshot(){return snapshotVM(this,'source');}
  restore(snapshot) {
    const result = restoreVM(this, snapshot, 'source');
    restoreSourceMethodEvents(this);
    return result;
  }
}

const canonicalSourceAdapters = Object.freeze({
  call: VirtualMachine.prototype.call,
  binary: VirtualMachine.prototype.binary,
  transfer: VirtualMachine.prototype.transfer,
  constant: VirtualMachine.prototype.constant,
  notifyWrite: VirtualMachine.prototype.notifyWrite
});
