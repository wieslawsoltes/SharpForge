import {callSourceFrame} from './execution/call-frames.js';
import {rootValues} from './execution/frame-roots.js';
import {executionProfiler} from './execution/profiler.js';
import {flushFramePool} from './execution/frame-pool.js';
import {stopExecution} from './execution/stop.js';
import {sourceConstant} from './execution/source-numbers.js';
import {formatSourceValue} from './value-formatting.js';
import {snapshotVM,restoreVM} from './snapshot.js';
import {Op} from '@sharpforge/bytecode';
import {dispatchSourceOpcode} from './execution/source-ops/index.js';
import { ManagedFault, isReference } from './heap.js';
import {builtin} from './execution/source-builtins.js';
import {sourceValue} from './execution/source-values.js';
import {initializeSourceVM} from './execution/initialize-source.js';
import {binary} from './execution/source-ops.js';
import {makeFault,enterCatch,finalizers,finishReturn,transfer,resumeUnwind,handleFault} from './execution/source-eh.js';
export class VirtualMachine {
  constructor(image,options={}){
    initializeSourceVM(this,image,options);
  }
  *roots(){yield* rootValues(this);}
  call(methodId,args){return callSourceFrame(this,methodId,args);}
  notifyWrite(write){this.writeRevision++;if(['field','array'].includes(write.kind))this.heap.mutationRevision++;this.onWrite?.(write);}
  get top(){return this.frames.at(-1);}
  get profiler(){return executionProfiler(this);}
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
  runSlice({instructionBudget=15000,timeBudgetMs=8,onSequence=null}={}){
    const profiler=this.profiler;
    try {
    this.scheduler.beforeSlice();if(this.state==='ready')this.state='running';if(this.state!=='running')return this.state;
    const started=performance.now();let count=0;
    if(this.pendingFault){const pending=this.pendingFault;this.pendingFault=null;this.handleFault(pending);}
    while(this.state==='running'&&this.frames.length&&count<instructionBudget){
      if((count&255)===0&&performance.now()-started>=timeBudgetMs)break;
      this.scheduler.beforeInstruction();if(this.state!=='running'||!this.frames.length)break;const frame=this.top,method=this.image.methods[frame.methodId],code=method.code,base=frame.pc*3,op=code[base],a=code[base+1],b=code[base+2];
      if(op===Op.SEQ){frame.point=this.image.sequencePoints[a];this.currentPoint=frame.point;if(onSequence?.(frame.point,frame)){this.sourcePause=true;this.state='paused';break;}}
      this.sourcePause=false;frame.pc++;count++;this.instructions++;
      try{
        if(this.instructions>this.options.maxInstructions)throw new ManagedFault('InstructionLimitException','Program exceeded its instruction budget');
        profiler?.instruction(frame);
        if(!dispatchSourceOpcode(this,frame,op,a,b))throw new ManagedFault('InvalidProgramException','Unknown instruction');
      }catch(error){const fault=this.makeFault(error);if(fault.name==='InstructionLimitException'){this.fault=fault;this.state='faulted';break;}if(this.onException?.(fault)){this.pendingFault=fault;this.state='paused';}else this.handleFault(fault);}finally{flushFramePool(this);}
      this.scheduler.afterInstruction();
    }
    this.currentPoint=this.top?.point??null;this.elapsedMs+=performance.now()-started;return this.state;
    } finally {flushFramePool(this);profiler?.boundary();}
  }
  allFrames(){return this.scheduler.allFrames();}
  run(){if(this.state==='paused')this.state='running';while(this.state==='ready'||this.state==='running')this.runSlice({instructionBudget:100000,timeBudgetMs:100});return {state:this.state,output:this.output.join(''),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  async runAsync(options={}){await this.scheduler.runAsync(options);return {state:this.state,output:this.output.join(''),returnValue:this.value(this.returnValue),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  stop(){stopExecution(this);}
  statistics(){return {artifactFormat:this.image.il?'ECMA-335':'SharpForge IR',assembly:this.image.il?{bytes:this.image.il.assemblyBytes,loadMs:this.image.il.loadMs,decodeMs:this.image.il.decodeMs,verificationMs:this.image.il.verificationMs}:null,instructions:this.instructions,elapsedMs:this.elapsedMs,frames:this.frames.length,heap:{...this.heap.stats,maxBytes:this.heap.maxBytes,threshold:this.heap.threshold}};}
  snapshot(){return snapshotVM(this,'source');}
  restore(snapshot){return restoreVM(this,snapshot,'source');}
}
