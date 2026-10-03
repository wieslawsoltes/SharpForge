import {ManagedPlatform,SUSPENDED} from './platform.js';
import {CooperativeScheduler} from './scheduler.js';
import {snapshotVM,restoreVM} from './snapshot.js';
import { loadAssembly } from '@sharpforge/cil';
import { Op, BinaryName, UnaryName, verifyImage } from '@sharpforge/bytecode';
import { ManagedHeap, ManagedFault, isReference } from './heap.js';
import {builtin} from './execution/source-builtins.js';
import * as sourceOps from './execution/source-ops.js';
import * as sourceEH from './execution/source-eh.js';
export class VirtualMachine {
  constructor(image,options={}){
    if(image instanceof Uint8Array||image instanceof ArrayBuffer)image=loadAssembly(image,options.assemblyLimits);
    if(image?.outputKind==='library')throw new Error('Library has no entry point. Invoke a static method with CilVirtualMachine instead.');
    const errors=verifyImage(image);if(errors.length)throw new Error('Bytecode verification failed: '+errors.join('; '));
    this.image=image;this.options={maxInstructions:20_000_000,maxFrames:512,maxOutputCharacters:1_000_000,...options};
    this.heap=new ManagedHeap(options);this.heap.rootProvider=()=>this.roots();this.stack=[];this.frames=[];this.statics=image.statics.map(s=>s.value);this.constantValues=new Map();this.output=[];this.outputCharacters=0;
    this.snapshotOwner=Object.freeze({});this.state='ready';this.instructions=0;this.writeRevision=0;this.sourcePause=false;this.elapsedMs=0;this.frameId=0;this.currentPoint=null;this.fault=null;this.pendingFault=null;this.exitCode=0;this.returnValue=null;this.onOutput=options.onOutput??(()=>{});this.onException=null;this.onWrite=null;
    this.platform=new ManagedPlatform(this,options);this.scheduler=new CooperativeScheduler(this,options);this.call(image.entryPoint,[]);
  }
  *roots(){yield* this.platform?.roots()??[];yield* this.scheduler?.roots()??[];yield this.returnValue;yield* this.stack;yield* this.statics;yield* this.constantValues.values();for(const f of this.frames)yield* f.locals;yield* sourceEH.roots(this);}
  call(methodId,args){if(this.frames.length>=this.options.maxFrames)throw new ManagedFault('StackOverflowException','Maximum managed call depth exceeded');const method=this.image.methods[methodId],locals=Array(method.locals.length).fill(undefined);args.forEach((v,i)=>locals[i]=v);if(!method.isStatic&&args[0]===null)throw new ManagedFault('NullReferenceException','Cannot call an instance method on null');this.frames.push({id:++this.frameId,methodId,pc:0,base:this.stack.length,locals,point:null,...sourceEH.frameState()});}
  notifyWrite(write){this.writeRevision++;if(['field','array'].includes(write.kind))this.heap.mutationRevision++;this.onWrite?.(write);}
  get top(){return this.frames.at(-1);}
  value(ref){return isReference(ref)&&this.heap.get(ref).kind==='string'?this.heap.get(ref).data:ref;}
  format(value){if(value===null)return '';if(value===undefined)return '<unassigned>';if(value===true)return 'True';if(value===false)return 'False';if(isReference(value)){const r=this.heap.get(value);if(r.kind==='string')return r.data;if(r.kind==='exception')return r.type+': '+this.format(r.data[0]);return r.type;}return String(value);}
  display(value){if(value===null)return 'null';if(isReference(value)){const r=this.heap.get(value);if(r.kind==='string')return JSON.stringify(r.data);if(r.kind==='array')return `${r.type} [${r.data.length}]`;return `${r.type} {#${value.h}}`;}return this.format(value);}
  constant(index){const raw=this.image.constants[index];if(typeof raw!=='string')return raw;if(!this.constantValues.has(index))this.constantValues.set(index,this.heap.string(raw));return this.constantValues.get(index);}
  binary(operator,a,b,mode=0){return sourceOps.binary(this,operator,a,b,mode);}
  emitOutput(text){text=String(text);if(this.outputCharacters+text.length>this.options.maxOutputCharacters)throw new ManagedFault('OutputLimitException','Program output limit exceeded');this.outputCharacters+=text.length;this.output.push(text);this.onOutput(text);}
  builtin(id,args){return builtin(this,id,args);}
  indexed(ref,index){const r=this.heap.get(ref);if(r.kind!=='array')throw new ManagedFault('InvalidOperationException','Expected a managed array');if(!Number.isInteger(index)||index<0||index>=r.data.length)throw new ManagedFault('IndexOutOfRangeException','Index was outside the bounds of the array');return r;}
  makeFault(error){return sourceEH.makeFault(error);}
  enterCatch(frame,handler,fault){return sourceEH.enterCatch(this,frame,handler,fault);}
  finalizers(frame,source,target=Infinity){return sourceEH.finalizers(this,frame,source,target);}
  finishReturn(frame,value){return sourceEH.finishReturn(this,frame,value);}
  transfer(frame,kind,target,value){return sourceEH.transfer(this,frame,kind,target,value);}
  resumeUnwind(frame){return sourceEH.resumeUnwind(this,frame);}
  handleFault(error){return sourceEH.handleFault(this,error);}
  runSlice({instructionBudget=15000,timeBudgetMs=8,onSequence=null}={}){
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
        switch(op){
          case Op.ENUM:this.stack.push(b);break;case Op.DELEGATE:{const receiver=this.stack.pop();this.stack.push(this.heap.withRoots([receiver],()=>this.platform.delegate(this.image.constants[b],a,receiver)));break;}case Op.SEQ:case Op.NOP:break;case Op.ENDFINALLY:this.resumeUnwind(frame);break;
          case Op.CONST:this.stack.push(this.constant(a));break;
          case Op.LDLOC:if(frame.locals[a]===undefined)throw new ManagedFault('InvalidProgramException','Read of uninitialized local');this.stack.push(frame.locals[a]);break;
          case Op.STLOC:{const oldValue=frame.locals[a];frame.locals[a]=this.stack.at(-1);this.notifyWrite({kind:'local',frameId:frame.id,index:a,value:frame.locals[a],oldValue});break;}
          case Op.LDSTATIC:this.stack.push(this.statics[a]);break;
          case Op.STSTATIC:{const oldValue=this.statics[a];this.statics[a]=this.stack.at(-1);this.notifyWrite({kind:'static',index:a,value:this.statics[a],oldValue});break;}
          case Op.LDFLD:{const ref=this.stack.pop(),r=this.heap.get(ref);if(a>=r.data.length||r.kind!=='object')throw new ManagedFault('InvalidProgramException','Invalid field index');this.stack.push(r.data[a]);break;}
          case Op.STFLD:{const value=this.stack.pop(),ref=this.stack.pop(),r=this.heap.get(ref);if(a>=r.data.length||r.kind!=='object')throw new ManagedFault('InvalidProgramException','Invalid field index');const oldValue=r.data[a];r.data[a]=value;this.stack.push(value);this.notifyWrite({kind:'field',handle:ref.h,generation:ref.g,index:a,value,oldValue});break;}
          case Op.DUP:this.stack.push(this.stack.at(-1));break;case Op.POP:this.stack.pop();break;
          case Op.BINARY:{const right=this.stack.pop(),left=this.stack.pop();this.stack.push(this.binary(BinaryName[a],left,right,b));break;}
          case Op.CONVERT:this.stack.push(sourceOps.convert(this.stack.pop(),a,b));break;
          case Op.UNARY:this.stack.push(sourceOps.unary(UnaryName[a],this.stack.pop(),b));break;
          case Op.JUMP:this.transfer(frame,'jump',a);break;case Op.JFALSE:if(!this.stack.pop())this.transfer(frame,'jump',a);break;case Op.JTRUE:if(this.stack.pop())this.transfer(frame,'jump',a);break;
          case Op.CALL:{const args=this.stack.splice(this.stack.length-b,b);this.call(a,args);break;}
          case Op.BUILTIN:{const args=this.stack.splice(this.stack.length-b,b),value=this.builtin(a,args);if(value!==SUSPENDED)this.stack.push(value);break;}
          case Op.RET:{const result=this.stack.pop();this.transfer(frame,'return',Infinity,result);break;}
          case Op.NEWOBJ:{const type=this.image.types[a];this.stack.push(this.heap.object(type.name,type.fields.map(f=>sourceOps.defaultValue(f.type))));break;}
          case Op.NEWARR:{const length=this.stack.pop();this.stack.push(this.heap.array(this.image.constants[a],length));break;}
          case Op.LDELEM:{const index=this.stack.pop(),ref=this.stack.pop();this.stack.push(this.indexed(ref,index).data[index]);break;}
          case Op.STELEM:{const value=this.stack.pop(),index=this.stack.pop(),ref=this.stack.pop();const r=this.indexed(ref,index),oldValue=r.data[index];r.data[index]=value;this.stack.push(value);this.notifyWrite({kind:'array',handle:ref.h,generation:ref.g,index,value,oldValue});break;}
          case Op.LENGTH:{const r=this.heap.get(this.stack.pop());if(r.kind!=='array'&&r.kind!=='string')throw new ManagedFault('InvalidProgramException','Length requires an array or string');this.stack.push(r.data.length);break;}
          case Op.THROW:{const ref=this.stack.pop();if(ref===null)throw new ManagedFault('NullReferenceException','A null exception was thrown');const r=this.heap.get(ref);throw new ManagedFault(r.type,this.format(r.data[0]),ref);}
          case Op.RETHROW:sourceEH.rethrow(frame);break;
          default:throw new ManagedFault('InvalidProgramException','Unknown instruction');
        }
      }catch(error){const fault=this.makeFault(error);if(fault.name==='InstructionLimitException'){this.fault=fault;this.state='faulted';break;}if(this.onException?.(fault)){this.pendingFault=fault;this.state='paused';}else this.handleFault(fault);}
      this.scheduler.afterInstruction();
    }
    this.currentPoint=this.top?.point??null;this.elapsedMs+=performance.now()-started;return this.state;
  }
  allFrames(){return this.scheduler.allFrames();}
  run(){if(this.state==='paused')this.state='running';while(this.state==='ready'||this.state==='running')this.runSlice({instructionBudget:100000,timeBudgetMs:100});return {state:this.state,output:this.output.join(''),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  async runAsync(options={}){await this.scheduler.runAsync(options);return {state:this.state,output:this.output.join(''),returnValue:this.value(this.returnValue),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  stop(){this.scheduler.cancelAll();this.platform.closeAll();this.state='terminated';this.pendingFault=null;this.frames=[];this.stack=[];this.currentPoint=null;}
  statistics(){return {artifactFormat:this.image.il?'ECMA-335':'SharpForge IR',assembly:this.image.il?{bytes:this.image.il.assemblyBytes,loadMs:this.image.il.loadMs,decodeMs:this.image.il.decodeMs,verificationMs:this.image.il.verificationMs}:null,instructions:this.instructions,elapsedMs:this.elapsedMs,frames:this.frames.length,heap:{...this.heap.stats,maxBytes:this.heap.maxBytes,threshold:this.heap.threshold}};}
  snapshot(){return snapshotVM(this,'source');}
  restore(snapshot){return restoreVM(this,snapshot,'source');}
}
