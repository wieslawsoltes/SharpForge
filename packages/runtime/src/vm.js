import {visitVMRoots,rootValues} from './gc/roots.js';
import {RuntimeGC} from './gc/runtime-integration.js';
import {runSourceSlice} from './execution/source-dispatch.js';
import {formatSourceValue} from './value-formatting.js';
import {createSourceMethodTables} from './execution/method-table.js';
import {ManagedPlatform} from './platform.js';
import {CooperativeScheduler} from './scheduler.js';
import {snapshotVM,restoreVM} from './snapshot.js';
import { loadAssembly } from '@sharpforge/cil';
import { verifyImage } from '@sharpforge/bytecode';
import { ManagedHeap, ManagedFault, isReference } from './heap.js';
import {builtin} from './execution/source-builtins.js';
import {sourceValue} from './execution/source-values.js';
import {literalString} from './execution/strings.js';
import {binary,defaultValue} from './execution/source-ops.js';
import {frameState,makeFault,enterCatch,finalizers,finishReturn,transfer,resumeUnwind,handleFault} from './execution/source-eh.js';
export class VirtualMachine {
  constructor(image,options={}){
    if(image instanceof Uint8Array||image instanceof ArrayBuffer)image=loadAssembly(image,options.assemblyLimits);
    if(image?.outputKind==='library')throw new Error('Library has no entry point. Invoke a static method with CilVirtualMachine instead.');
    const errors=verifyImage(image);if(errors.length)throw new Error('Bytecode verification failed: '+errors.join('; '));
    this.image=image;this.options={maxInstructions:20_000_000,maxFrames:512,maxOutputCharacters:1_000_000,...options};
    this.heap=new ManagedHeap({...options,methodTables:createSourceMethodTables(image)});this.heap.rootVisitor=visitor=>this.visitRoots(visitor);this.stack=[];this.frames=[];this.statics=image.statics.map(s=>s.value===null?defaultValue(s.type,this):s.value);this.constantValues=new Map();this.strings=new Map();this.output=[];this.outputCharacters=0;
    this.snapshotOwner=Object.freeze({});this.state='ready';this.instructions=0;this.writeRevision=0;this.sourcePause=false;this.elapsedMs=0;this.frameId=0;this.currentPoint=null;this.fault=null;this.pendingFault=null;this.exitCode=0;this.returnValue=null;this.onOutput=options.onOutput??(()=>{});this.onException=null;this.onWrite=null;
    this.gcRuntime=new RuntimeGC(this);this.platform=new ManagedPlatform(this,options);this.scheduler=new CooperativeScheduler(this,options);this.gcRuntime.attachPlatform(this.platform);this.call(image.entryPoint,[]);
  }
  visitRoots(visitor){visitVMRoots(this,visitor);}
  *roots(){yield* rootValues(this);}
  call(methodId, args) {
    if (this.frames.length >= this.options.maxFrames) {
      throw new ManagedFault('StackOverflowException', 'Maximum managed call depth exceeded');
    }
    const method = this.image.methods[methodId];
    const locals = Array(method.locals.length).fill(undefined);
    args.forEach((value, index) => this.heap.writeRoot(locals, index, value));
    if (!method.isStatic && args[0] === null) {
      throw new ManagedFault('NullReferenceException', 'Cannot call an instance method on null');
    }
    this.frames.push({id: ++this.frameId, methodId, pc: 0, base: this.stack.length, locals, point: null, ...frameState()});
  }
  notifyWrite(write){this.writeRevision++;this.onWrite?.(write);}
  get top(){return this.frames.at(-1);}
  value(ref){return sourceValue(this.heap,ref);}
  format(value){return formatSourceValue(this,value);}
  display(value){if(value===null)return 'null';if(isReference(value)){const r=this.heap.get(value);if(r.kind==='string')return JSON.stringify(r.data);if(r.kind==='array')return `${r.type} [${r.data.length}]`;return `${r.type} {#${value.h}}`;}return this.format(value);}
  constant(index){const raw=this.image.constants[index];return typeof raw==='string'?literalString(this,raw):raw;}
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
  runSlice(options={}){return runSourceSlice(this,options);}
  allFrames(){return this.scheduler.allFrames();}
  run(){if(this.state==='paused')this.state='running';while(this.state==='ready'||this.state==='running'||this.state==='waiting'&&this.gcRuntime.hasPendingWork())this.runSlice({instructionBudget:100000,timeBudgetMs:100});return {state:this.state,output:this.output.join(''),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  async runAsync(options={}){await this.scheduler.runAsync(options);return {state:this.state,output:this.output.join(''),returnValue:this.value(this.returnValue),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  stop(){this.gcRuntime.dispose();}
  statistics(){return {artifactFormat:this.image.il?'ECMA-335':'SharpForge IR',assembly:this.image.il?{bytes:this.image.il.assemblyBytes,loadMs:this.image.il.loadMs,decodeMs:this.image.il.decodeMs,verificationMs:this.image.il.verificationMs}:null,instructions:this.instructions,elapsedMs:this.elapsedMs,frames:this.frames.length,heap:{...this.heap.stats,maxBytes:this.heap.maxBytes,threshold:this.heap.threshold}};}
  snapshot(){return snapshotVM(this,'source');}
  restore(snapshot){return restoreVM(this,snapshot,'source');}
}
