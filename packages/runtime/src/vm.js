import {createExecutionProfiler} from './execution/profiler.js';
import {executeSourceVarargs} from './execution/source-varargs.js';
import {executeSourceReference, sourceReturnReference} from './execution/source-references.js';
import {isFatalFault,markUnhandled} from './execution/unhandled.js';
import {stopVM} from './execution/vm-lifecycle.js';
import {selectSourceFusion} from './execution/source-fusion.js';
import {executeSourceMemory} from './execution/source-memory.js';
import {collectAtInstruction} from './execution/gc-stress.js';
import {faultFromException} from './execution/exception-object.js';
import {callSource,callSourceFromStack} from './execution/source-calls.js';
import {beginFrameInstruction,flushFramePool} from './execution/frame-pool.js';
import {installRootProvider} from './execution/frame-roots.js';
import {createArray,arrayAddress,arrayGet} from './execution/arrays.js';
import {SyncPrimitives} from './execution/sync-primitives.js';
import {resumeArrayOperation,arrayContinuationRoots} from './execution/array-ops.js';
import {validateSliceBudget} from './execution/slice-budget.js';
import {sourceInputTypes,sourceStore,sourceCopy,sourceNewObject} from './execution/source-storage.js';
import {address,dereference,sourceFieldValue,sourceFieldStore,sourceFieldType} from './execution/managed-pointers.js';
import {decodeScalar,scalarFormat,numericTypeName,numericTypeNames,number,isDecimal,isNativeInteger} from '@sharpforge/bytecode';
import {createSourceMethodTables} from './execution/method-table.js';
import {ManagedPlatform,SUSPENDED} from './platform.js';
import {CooperativeScheduler} from './scheduler.js';
import {snapshotVM,restoreVM} from './snapshot.js';
import { loadAssembly } from '@sharpforge/cil';
import { Op, BinaryName, UnaryName, verifyImage } from '@sharpforge/bytecode';
import { ManagedHeap, ManagedFault, isReference } from './heap.js';
import {builtin} from './execution/source-builtins.js';
import {sourceValue} from './execution/source-values.js';
import {literalString,stringRoots} from './execution/strings.js';
import {binary,convert,unary,defaultValue,sourceEnum,enumToString,checkSourceArrayStore,runtimeTypeRoots,runtimeTypeText} from './execution/source-ops.js';
import {roots as exceptionRoots,makeFault,enterCatch,finalizers,finishReturn,transfer,resumeUnwind,handleFault,rethrow,endSourceFilter} from './execution/source-eh.js';
export class VirtualMachine {
  constructor(image,options={}){
    if(image instanceof Uint8Array||image instanceof ArrayBuffer)image=loadAssembly(image,options.assemblyLimits);
    if(image?.outputKind==='library')throw new Error('Library has no entry point. Invoke a static method with CilVirtualMachine instead.');
    const errors=verifyImage(image);if(errors.length)throw new Error('Bytecode verification failed: '+errors.join('; '));
    this.image=image;this.options={maxInstructions:20_000_000,maxOutputCharacters:1_000_000,...options};
    this.heap=new ManagedHeap({...options,methodTables:createSourceMethodTables(image,options)});installRootProvider(this);this.stack=[];this.frames=[];this.statics=image.statics.map(s=>s.value===null?defaultValue(s.type,this):s.value?.scalar?decodeScalar(s.value,this.options):s.value);this.constantValues=new Map();this.strings=new Map();this.output=[];this.outputCharacters=0;
    this.snapshotOwner=Object.freeze({});this.state='ready';this.instructions=0;this.writeRevision=0;this.sourcePause=false;this.elapsedMs=0;this.frameId=0;this.currentPoint=null;this.fault=null;this.pendingFault=null;this.exitCode=0;this.returnValue=null;this.onOutput=options.onOutput??(()=>{});this.onException=null;this.onWrite=null;
    this.platform=new ManagedPlatform(this,options);this.scheduler=new CooperativeScheduler(this,options);this.sync=new SyncPrimitives(this);this.profiler=createExecutionProfiler(this,options.profile);this.heap.observer=this.profiler;this.call(image.entryPoint,[]);
  }
  *roots(){yield* this.platform?.roots()??[];yield* this.scheduler?.roots()??[];yield* this.sync?.roots()??[];yield this.returnValue;yield* this.stack;yield* this.statics;yield* this.constantValues.values();yield* stringRoots(this);yield* runtimeTypeRoots(this);for(const f of this.frames){yield* f.locals;yield* arrayContinuationRoots(f);}yield* exceptionRoots(this);}
  call(methodId,args,types=[]){return callSource(this,methodId,args,types);}
  notifyWrite(write){this.writeRevision++;if(['field','array','box'].includes(write.kind))this.heap.mutationRevision++;this.onWrite?.(write);}
  get top(){return this.frames.at(-1);}
  value(ref){return sourceValue(this.heap,ref);}
  format(value,type=null){const name=runtimeTypeText(this,value)??enumToString(this,value);if(name!==null)return name;if(value===null)return '';if(value===undefined)return '<unassigned>';if(type==='bool'||type==='System.Boolean')return number(value)?'True':'False';if(value===true)return 'True';if(value===false)return 'False';if(isReference(value)){const r=this.heap.get(value);if(r.kind==='string')return r.data;if(r.kind==='box')return this.format(r.data[0],numericTypeName(r.methodTable.name));if(r.kind==='exception')return r.type+': '+this.format(r.data[0]);return r.type;}if(type&&numericTypeNames.includes(numericTypeName(type))||value?.float||isNativeInteger(value)||isDecimal(value)||typeof value==='bigint')return scalarFormat(value,type??undefined,this.options);return String(value);}
  display(value){if(value===null)return 'null';if(isReference(value)){const r=this.heap.get(value);if(r.kind==='string')return JSON.stringify(r.data);if(r.kind==='array')return `${r.type} [${r.data.length}]`;return `${r.type} {#${value.h}}`;}return this.format(value);}
  constant(index){const raw=this.image.constants[index];return typeof raw==='string'?literalString(this,raw):raw?.scalar?decodeScalar(raw,this.options):raw;}
  binary(operator,a,b,mode=0){return binary(this,operator,a,b,mode);}
  emitOutput(text){text=String(text);if(this.outputCharacters+text.length>this.options.maxOutputCharacters)throw new ManagedFault('OutputLimitException','Program output limit exceeded');this.outputCharacters+=text.length;this.output.push(text);this.onOutput(text);}
  builtin(id,args,types=[]){return builtin(this,id,args,types);}
  address(kind,index,owner,options){return address(this,kind,index,owner,options);}
  dereference(pointer,write=false,value){return dereference(this,pointer,write,value);}
  indexed(ref,index){index=Number(number(index));const r=this.heap.get(ref);if(r.kind!=='array')throw new ManagedFault('InvalidOperationException','Expected a managed array');if(!Number.isInteger(index)||index<0||index>=r.data.length)throw new ManagedFault('IndexOutOfRangeException','Index was outside the bounds of the array');return r;}
  makeFault(error){return makeFault(error);}
  enterCatch(frame,handler,fault){return enterCatch(this,frame,handler,fault);}
  finalizers(frame,source,target=Infinity){return finalizers(this,frame,source,target);}
  finishReturn(frame,value){return finishReturn(this,frame,value);}
  transfer(frame,kind,target,value){return transfer(this,frame,kind,target,value);}
  resumeUnwind(frame){return resumeUnwind(this,frame);}
  handleFault(error){return handleFault(this,error);}
  runSlice({instructionBudget=15000,timeBudgetMs=8,onSequence=null}={}){
    validateSliceBudget(instructionBudget,timeBudgetMs);
    this.scheduler.beforeSlice();if(this.state==='ready')this.state='running';if(this.state!=='running')return this.state;
    const started=performance.now();let count=0;
    if(this.pendingFault){const pending=this.pendingFault;this.pendingFault=null;pending.exceptionDebuggerResume=true;this.handleFault(pending);}
    while(this.state==='running'&&this.frames.length&&count<instructionBudget){
      if((count&255)===0&&performance.now()-started>=timeBudgetMs)break;
      if(this.scheduler.enabled)this.scheduler.beforeInstruction();if(this.state!=='running'||!this.frames.length)break;const frame=this.top,continuing=!!frame.intrinsicContinuation,method=this.image.methods[frame.methodId],code=method.code,base=frame.pc*3,op=code[base],a=code[base+1],b=code[base+2];
      if(!continuing&&op===Op.SEQ){frame.point=this.image.sequencePoints[a];this.currentPoint=frame.point;if(onSequence?.(frame.point,frame)){this.sourcePause=true;this.state='paused';break;}}
      const fusion=selectSourceFusion(this,frame,method,Math.min(instructionBudget-count,256-(count&255)),onSequence),before=this.instructions;
      this.sourcePause=false;if(!continuing){frame.pc++;count++;this.instructions++;if(this.profiler)this.profiler.instruction(frame);}
      beginFrameInstruction(this,frame);
      try{
        if(this.instructions>this.options.maxInstructions||continuing&&this.instructions>=this.options.maxInstructions)throw new ManagedFault('InstructionLimitException','Program exceeded its instruction budget');
        if(fusion)fusion.execute(this,frame);else if(continuing){const result=resumeArrayOperation(this,frame,{deadline:started+timeBudgetMs,workBudget:1});count+=result.work;this.instructions+=result.work;if(this.profiler)this.profiler.instruction(frame,result.work);if(result.done&&result.returns)this.stack.push(result.value);if(!result.work)break;}else if(!executeSourceVarargs(this,frame,op,a)&&!executeSourceReference(this,frame,op,a,b))switch(op){
          case Op.ENUM:this.stack.push(sourceEnum(this,a,b));break;case Op.DELEGATE:{const receiver=this.stack.pop();this.stack.push(this.heap.withRoots([receiver],()=>this.platform.delegate(this.image.constants[b],a,receiver)));break;}case Op.SEQ:case Op.NOP:break;case Op.ENDFINALLY:this.resumeUnwind(frame);break;case Op.ENDFILTER:endSourceFilter(this,this.stack.pop());break;
          case Op.CONST:this.stack.push(this.constant(a));break;
          case Op.LDLOC:if(frame.locals[a]===undefined)throw new ManagedFault('InvalidProgramException','Read of uninitialized local');this.stack.push(sourceCopy(this,frame.locals[a]));break;
          case Op.STLOC:{const oldValue=frame.locals[a];frame.locals[a]=sourceStore(this,this.stack.at(-1),method.locals[a].type,sourceInputTypes(this,frame).at(-1));this.stack[this.stack.length-1]=sourceCopy(this,frame.locals[a]);this.notifyWrite({kind:'local',frameId:frame.id,index:a,value:frame.locals[a],oldValue});break;}
          case Op.LDSTATIC:this.stack.push(sourceCopy(this,this.statics[a]));break;
          case Op.STSTATIC:{const oldValue=this.statics[a];this.statics[a]=sourceStore(this,this.stack.at(-1),this.image.statics[a].type,sourceInputTypes(this,frame).at(-1));this.stack[this.stack.length-1]=sourceCopy(this,this.statics[a]);this.notifyWrite({kind:'static',index:a,value:this.statics[a],oldValue});break;}
          case Op.LDFLD:this.stack.push(sourceFieldValue(this,this.stack.pop(),a));break;
          case Op.STFLD:{const value=this.stack.pop(),ref=this.stack.pop();this.heap.withRoots([ref,value],()=>{const stored=sourceFieldStore(this,ref,a,sourceStore(this,value,sourceFieldType(this,ref,a),sourceInputTypes(this,frame).at(-1)));this.stack.push(sourceCopy(this,stored));});break;}
          case Op.DUP:this.stack.push(this.stack.at(-1));break;case Op.POP:this.stack.pop();break;
          case Op.BINARY:{const right=this.stack.pop(),left=this.stack.pop();this.stack.push(this.binary(BinaryName[a],left,right,b));break;}
          case Op.CONVERT:this.stack.push(convert(this.stack.pop(),a,b,this));break;
          case Op.UNARY:this.stack.push(unary(UnaryName[a],this.stack.pop(),b,this));break;
          case Op.JUMP:this.transfer(frame,'jump',a);break;case Op.JFALSE:if(!this.stack.pop())this.transfer(frame,'jump',a);break;case Op.JTRUE:if(this.stack.pop())this.transfer(frame,'jump',a);break;
          case Op.CALL:callSourceFromStack(this,a,b);break;
          case Op.BUILTIN:{const args=this.stack.splice(this.stack.length-b,b),value=this.builtin(a,args,sourceInputTypes(this,frame).slice(-b));if(value!==SUSPENDED)this.stack.push(value);break;}
          case Op.RET:{const result=sourceStore(this,this.stack.pop(),method.returnType,sourceInputTypes(this,frame).at(-1));this.transfer(frame,'return',Infinity,sourceReturnReference(this,frame,result));break;}
          case Op.NEWOBJ:this.stack.push(sourceNewObject(this,this.image.types[a].name));break;
          case Op.NEWARR:{const length=this.stack.pop(),type=this.image.constants[a];this.stack.push(createArray(this,type,[length]));break;}
          case Op.LDELEM:{const index=Number(number(this.stack.pop())),ref=this.stack.pop();this.stack.push(sourceCopy(this,arrayGet(this,ref,[index])));break;}
          case Op.STELEM:{const value=this.stack.pop(),index=Number(number(this.stack.pop())),ref=this.stack.pop();this.heap.withRoots([ref,value],()=>{const r=this.indexed(ref,index),oldValue=r.data[index],stored=sourceStore(this,value,r.methodTable.elementType.name,sourceInputTypes(this,frame).at(-1));checkSourceArrayStore(this,r,stored);this.heap.writeData(r,index,stored);this.stack.push(sourceCopy(this,stored));this.notifyWrite({kind:'array',handle:ref.h,generation:ref.g,index,value:stored,oldValue});});break;}
          case Op.LENGTH:{const r=this.heap.get(this.stack.pop());if(r.kind!=='array'&&r.kind!=='string')throw new ManagedFault('InvalidProgramException','Length requires an array or string');this.stack.push(r.data.length);break;}
          case Op.THROW:throw faultFromException(this,this.stack.pop());
          case Op.RETHROW:rethrow(frame);break;
          default:if(!executeSourceMemory(this,op,a,b))throw new ManagedFault('InvalidProgramException','Unknown instruction');
        }
      }catch(error){const fault=this.makeFault(error);if(isFatalFault(fault)){markUnhandled(this,fault);this.scheduler.cancelAll({preserveCurrent:true});break;}this.handleFault(fault);}finally{if(fusion)count+=this.instructions-before-1;flushFramePool(this);}
      collectAtInstruction(this);
      if(this.scheduler.enabled)this.scheduler.afterInstruction();
    }
    this.currentPoint=this.top?.point??null;this.elapsedMs+=performance.now()-started;if(this.profiler)this.profiler.boundary();return this.state;
  }
  allFrames(){return this.scheduler.allFrames();}
  run(){if(this.state==='paused')this.state='running';while(this.state==='ready'||this.state==='running')this.runSlice({instructionBudget:100000,timeBudgetMs:100});return {state:this.state,output:this.output.join(''),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  async runAsync(options={}){await this.scheduler.runAsync(options);return {state:this.state,output:this.output.join(''),returnValue:this.value(this.returnValue),exitCode:this.exitCode,fault:this.fault,stats:this.statistics()};}
  stop(){stopVM(this);}
  statistics(){return {artifactFormat:this.image.il?'ECMA-335':'SharpForge IR',assembly:this.image.il?{bytes:this.image.il.assemblyBytes,loadMs:this.image.il.loadMs,decodeMs:this.image.il.decodeMs,verificationMs:this.image.il.verificationMs}:null,instructions:this.instructions,elapsedMs:this.elapsedMs,frames:this.frames.length,heap:{...this.heap.stats,maxBytes:this.heap.maxBytes,threshold:this.heap.threshold}};}
  snapshot(){return snapshotVM(this,'source');}
  restore(snapshot){return restoreVM(this,snapshot,'source');}
}
