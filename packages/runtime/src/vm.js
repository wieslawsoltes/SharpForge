import {enumTypes} from '@sharpforge/framework';
import {ManagedPlatform,SUSPENDED} from './platform.js';
import {CooperativeScheduler} from './scheduler.js';
import {copyExecution} from './snapshot.js';
import { loadAssembly } from '@sharpforge/cil';
import { Op, BinaryName, UnaryName, Builtins, verifyImage } from '@sharpforge/bytecode';
import { ManagedHeap, ManagedFault, isReference } from './heap.js';
const defaultValue=type=>type==='int'||type==='double'?0:type==='bool'?false:null;
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
  *roots(){yield* this.platform?.roots()??[];yield* this.scheduler?.roots()??[];yield this.returnValue;yield* this.stack;yield* this.statics;yield* this.constantValues.values();for(const f of this.frames){yield* f.locals;for(const u of f.unwinds??[]){yield u.value;if(u.error?.reference)yield u.error.reference;}if(f.exception?.reference)yield f.exception.reference;for(const c of f.caught??[])if(c.fault.reference)yield c.fault.reference;}if(this.fault?.reference)yield this.fault.reference;if(this.pendingFault?.reference)yield this.pendingFault.reference;}
  call(methodId,args){if(this.frames.length>=this.options.maxFrames)throw new ManagedFault('StackOverflowException','Maximum managed call depth exceeded');const method=this.image.methods[methodId],locals=Array(method.locals.length).fill(undefined);args.forEach((v,i)=>locals[i]=v);if(!method.isStatic&&args[0]===null)throw new ManagedFault('NullReferenceException','Cannot call an instance method on null');this.frames.push({id:++this.frameId,methodId,pc:0,base:this.stack.length,locals,point:null,exception:null,caught:[],unwinds:[]});}
  notifyWrite(write){this.writeRevision++;if(['field','array'].includes(write.kind))this.heap.mutationRevision++;this.onWrite?.(write);}
  get top(){return this.frames.at(-1);}
  value(ref){return isReference(ref)&&this.heap.get(ref).kind==='string'?this.heap.get(ref).data:ref;}
  format(value){if(value===null)return '';if(value===undefined)return '<unassigned>';if(value===true)return 'True';if(value===false)return 'False';if(isReference(value)){const r=this.heap.get(value);if(r.kind==='string')return r.data;if(r.kind==='exception')return r.type+': '+this.format(r.data[0]);return r.type;}return String(value);}
  display(value){if(value===null)return 'null';if(isReference(value)){const r=this.heap.get(value);if(r.kind==='string')return JSON.stringify(r.data);if(r.kind==='array')return `${r.type} [${r.data.length}]`;return `${r.type} {#${value.h}}`;}return this.format(value);}
  constant(index){const raw=this.image.constants[index];if(typeof raw!=='string')return raw;if(!this.constantValues.has(index))this.constantValues.set(index,this.heap.string(raw));return this.constantValues.get(index);}
  binary(operator,a,b,mode=0){
    if(mode===2&&operator==='+')return this.heap.string(this.format(a)+this.format(b),[a,b]);
    const l=this.value(a),r=this.value(b);
    if(mode===5){const value=operator==='+'?BigInt(l)+BigInt(r):operator==='-'?BigInt(l)-BigInt(r):BigInt(l)*BigInt(r);if(value< -2147483648n||value>2147483647n)throw new ManagedFault('OverflowException','Checked Int32 arithmetic overflow');return Number(value);}
    const same=()=>isReference(l)&&isReference(r)?l.h===r.h&&l.g===r.g:l===r;
    switch(operator){
      case '+':return mode===1?(l+r)|0:l+r;case '-':return mode===1?(l-r)|0:l-r;case '*':return mode===1?Math.imul(l,r):l*r;
      case '/':if(mode===1){if(r===0)throw new ManagedFault('DivideByZeroException','Attempted to divide by zero');if(l===-2147483648&&r===-1)throw new ManagedFault('OverflowException','Integer division overflow');return (l/r)|0;}return l/r;
      case '%':if(mode===1&&r===0)throw new ManagedFault('DivideByZeroException','Attempted to divide by zero');return mode===1?(l%r)|0:l%r;
      case '==':return same();case '!=':return !same();case '<':return l<r;case '<=':return l<=r;case '>':return l>r;case '>=':return l>=r;
      case '&':return mode===3?Boolean(l&r):l&r;case '|':return mode===3?Boolean(l|r):l|r;case '^':return mode===3?Boolean(l^r):l^r;case '<<':return l<<(r&31);case '>>':return l>>(r&31);
      default:throw new ManagedFault('InvalidProgramException','Unknown binary operation');
    }
  }
  emitOutput(text){text=String(text);if(this.outputCharacters+text.length>this.options.maxOutputCharacters)throw new ManagedFault('OutputLimitException','Program output limit exceeded');this.outputCharacters+=text.length;this.output.push(text);this.onOutput(text);}
  builtin(id,args){if(Builtins[id].contract)return this.platform.invoke(Builtins[id].contract,args);const name=Builtins[id].name;
    return this.heap.withRoots(args,()=>{
      const a=this.value(args[0]),b=this.value(args[1]),c=this.value(args[2]);
      if(name.startsWith('Math.')){const fn={Abs:'abs',Min:'min',Max:'max',Pow:'pow',Sqrt:'sqrt',Floor:'floor',Ceiling:'ceil',Round:'round'}[name.slice(5)];if(fn==='round'){const f=Math.floor(a),fraction=a-f;return fraction===0.5?(f%2===0?f:f+1):Math.round(a);}return Math[fn](...args);}
      switch(name){
        case '$Math.Abs.Int32':if(a===-2147483648)throw new ManagedFault('OverflowException','Absolute value of Int32.MinValue is not representable');return Math.abs(a);
        case 'Console.WriteLine':this.emitOutput((args.length?this.format(args[0]):'')+'\n');return null;
        case 'Console.Write':this.emitOutput(this.format(args[0]));return null;
        case 'GC.Collect':this.heap.collect();return null;
        case 'GC.GetTotalMemory':if(a===true)this.heap.collect();return this.heap.stats.liveBytes|0;
        case 'GC.CollectionCount':if(a!==0)throw new ManagedFault('ArgumentOutOfRangeException','This non-generational collector exposes generation 0 only');return this.heap.stats.collections;
        case 'int.Parse':{const s=String(a??'').trim();if(!/^[+-]?\d+$/.test(s))throw new ManagedFault('FormatException','Input string was not in a correct format');const value=Number(s);if(value<-2147483648||value>2147483647)throw new ManagedFault('OverflowException','Value is outside the Int32 range');return value|0;}
        case 'double.Parse':{const s=String(a??'').trim();if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s))throw new ManagedFault('FormatException','Invalid floating-point input');return Number(s);}
        case 'Convert.ToInt32':{const v=Number(a),f=Math.floor(v),fraction=v-f,n=fraction===0.5?(f%2===0?f:f+1):Math.round(v);if(!Number.isFinite(n)||n<-2147483648||n>2147483647)throw new ManagedFault('OverflowException','Value is outside the Int32 range');return n|0;}
        case 'Convert.ToDouble':{const v=Number(a);if(Number.isNaN(v))throw new ManagedFault('FormatException','Cannot convert value to double');return v;}
        case 'Convert.ToString':case 'object.ToString':return this.heap.string(this.format(args[0]));
        case 'string.Concat':return this.heap.string(this.format(args[0])+this.format(args[1]));
        case 'string.IsNullOrEmpty':return a===null||a==='';
        case 'Array.Reverse':case 'Array.Sort':{const record=this.heap.get(args[0]);if(record.kind!=='array')throw new ManagedFault('ArgumentException','Array required');if(name==='Array.Reverse')record.data.reverse();else record.data.sort((a,b)=>{a=this.value(a);b=this.value(b);return typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b),'en');});return null;}
        case 'string.Substring':if(typeof a!=='string')throw new ManagedFault('NullReferenceException','String is null');if(!Number.isInteger(b)||b<0||b>a.length||args.length===3&&(!Number.isInteger(c)||c<0||b+c>a.length))throw new ManagedFault('ArgumentOutOfRangeException','Substring range is outside the string');return this.heap.string(args.length===3?a.slice(b,b+c):a.slice(b));
        case 'string.Contains':case 'string.IndexOf':case 'string.StartsWith':case 'string.EndsWith':{if(typeof a!=='string')throw new ManagedFault('NullReferenceException','String is null');if(b===null)throw new ManagedFault('ArgumentNullException','Value is null');const method={Contains:'includes',IndexOf:'indexOf',StartsWith:'startsWith',EndsWith:'endsWith'}[name.slice(7)];return a[method](b);}
        case 'string.ToUpper':case 'string.ToLower':case 'string.Trim':if(typeof a!=='string')throw new ManagedFault('NullReferenceException','String is null');return this.heap.string(a[{ToUpper:'toUpperCase',ToLower:'toLowerCase',Trim:'trim'}[name.slice(7)]]());
        case 'string.Replace':if(typeof a!=='string')throw new ManagedFault('NullReferenceException','String is null');if(b===null||b==='')throw new ManagedFault('ArgumentException','Old value cannot be null or empty');return this.heap.string(a.split(b).join(c??''));
        case 'Exception.new':return this.heap.allocate('exception','Exception',[args[0]]);
        case 'Exception.Message':return this.heap.get(args[0]).data[0];
        case 'Debug.Assert':if(a!==true)throw new ManagedFault('AssertionException',args.length>1?this.format(args[1]):'Assertion failed');return null;
        case 'Environment.TickCount':return Math.trunc(performance.now())|0;
        default:throw new ManagedFault('MissingMethodException',`Intrinsic '${name}' is not implemented`);
      }
    });
  }
  indexed(ref,index){const r=this.heap.get(ref);if(r.kind!=='array')throw new ManagedFault('InvalidOperationException','Expected a managed array');if(!Number.isInteger(index)||index<0||index>=r.data.length)throw new ManagedFault('IndexOutOfRangeException','Index was outside the bounds of the array');return r;}
  makeFault(error){if(error instanceof ManagedFault)return error;return new ManagedFault('RuntimeException',error?.message??String(error));}
  enterCatch(frame,handler,fault){const method=this.image.methods[frame.methodId],after=method.code[handler.end*3+1],siblings=method.handlers.filter(h=>h.start===handler.start&&h.end===handler.end&&h.target>handler.target).sort((a,b)=>a.target-b.target),end=siblings[0]?.target??after;frame.caught=(frame.caught??[]).filter(c=>handler.target>=c.start&&handler.target<c.end&&c.start!==handler.target);frame.caught.push({start:handler.target,end,fault});frame.exception=fault;}
  finalizers(frame,source,target=Infinity){return this.image.methods[frame.methodId].handlers.filter(h=>h.kind==='finally'&&source>=h.start&&source<=h.end&&!(target>=h.start&&target<=h.end)).sort((a,b)=>(a.end-a.start)-(b.end-b.start));}
  finishReturn(frame,value){this.stack.length=frame.base;this.frames.pop();if(this.frames.length)this.stack.push(value);else{this.returnValue=value;this.state='terminated';this.exitCode=typeof value==='number'?value|0:0;}}
  transfer(frame,kind,target,value){const handlers=this.finalizers(frame,frame.pc-1,target);if(!handlers.length){if(kind==='return')this.finishReturn(frame,value);else frame.pc=target;return;}frame.unwinds.push({kind,target,value,handlers,active:null});this.stack.length=frame.base;this.resumeUnwind(frame);}
  resumeUnwind(frame){const u=frame.unwinds.at(-1);if(!u)throw new ManagedFault('InvalidProgramException','No active finally continuation');if(u.handlers.length){u.active=u.handlers.shift();frame.pc=u.active.target;this.stack.length=frame.base;return;}frame.unwinds.pop();if(u.kind==='return'){this.finishReturn(frame,u.value);return;}if(u.kind==='jump'){frame.pc=u.target;return;}if(u.catch){frame.locals[u.catch.slot]=u.error.reference;this.enterCatch(frame,u.catch,u.error);frame.pc=u.catch.target;this.fault=null;return;}this.frames.pop();this.stack.length=frame.base;this.handleFault(u.error);}
  handleFault(error){
    const fault=this.makeFault(error);this.fault=fault;
    if(!fault.reference){try{const message=this.heap.string(fault.message);fault.reference=this.heap.allocate('exception',fault.name,[message],[message]);}catch{/* Preserve the original failure if its managed representation cannot be allocated. */}}
    fault.frames??=this.frames.slice().reverse().map(f=>({method:this.image.methods[f.methodId].qualifiedName,point:f.point}));
    while(this.frames.length){const frame=this.top,method=this.image.methods[frame.methodId],pc=frame.pc-1;
      const handler=method.handlers.filter(h=>h.kind!=='finally'&&pc>=h.start&&pc<h.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0],target=handler?.target??Infinity,finals=this.finalizers(frame,pc,target);
      // Exceptions caught inside the active finally preserve its original continuation.
      frame.unwinds=frame.unwinds.filter(u=>u.active&&target>=u.active.target&&target<u.active.handlerEnd);
      this.stack.length=frame.base;
      if(finals.length){frame.unwinds.push({kind:'exception',error:fault,catch:handler,handlers:finals,active:null});this.fault=null;this.resumeUnwind(frame);return;}
      if(handler){frame.locals[handler.slot]=fault.reference;this.enterCatch(frame,handler,fault);frame.pc=handler.target;this.fault=null;return;}
      this.frames.pop();
    }
    this.state='faulted';
  }
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
          case Op.CONVERT:{const value=this.stack.pop();if(a===0&&b===1&&(!Number.isFinite(value)||Math.trunc(value)<-2147483648||Math.trunc(value)>2147483647))throw new ManagedFault('OverflowException','Checked Int32 conversion overflow');this.stack.push(a===0?(Number.isFinite(value)&&value>=-2147483648&&value<2147483648?Math.trunc(value)|0:-2147483648):Number(value));break;}
          case Op.UNARY:{const value=this.stack.pop(),operator=UnaryName[a];if(b===5&&value===-2147483648)throw new ManagedFault('OverflowException','Checked Int32 negation overflow');this.stack.push(operator==='!'?!value:operator==='~'?~value:operator==='-'?(b===1||b===5?(-value)|0:-value):+value);break;}
          case Op.JUMP:this.transfer(frame,'jump',a);break;case Op.JFALSE:if(!this.stack.pop())this.transfer(frame,'jump',a);break;case Op.JTRUE:if(this.stack.pop())this.transfer(frame,'jump',a);break;
          case Op.CALL:{const args=this.stack.splice(this.stack.length-b,b);this.call(a,args);break;}
          case Op.BUILTIN:{const args=this.stack.splice(this.stack.length-b,b),value=this.builtin(a,args);if(value!==SUSPENDED)this.stack.push(value);break;}
          case Op.RET:{const result=this.stack.pop();this.transfer(frame,'return',Infinity,result);break;}
          case Op.NEWOBJ:{const type=this.image.types[a];this.stack.push(this.heap.object(type.name,type.fields.map(f=>defaultValue(f.type))));break;}
          case Op.NEWARR:{const length=this.stack.pop();this.stack.push(this.heap.array(this.image.constants[a],length));break;}
          case Op.LDELEM:{const index=this.stack.pop(),ref=this.stack.pop();this.stack.push(this.indexed(ref,index).data[index]);break;}
          case Op.STELEM:{const value=this.stack.pop(),index=this.stack.pop(),ref=this.stack.pop();const r=this.indexed(ref,index),oldValue=r.data[index];r.data[index]=value;this.stack.push(value);this.notifyWrite({kind:'array',handle:ref.h,generation:ref.g,index,value,oldValue});break;}
          case Op.LENGTH:{const r=this.heap.get(this.stack.pop());if(r.kind!=='array'&&r.kind!=='string')throw new ManagedFault('InvalidProgramException','Length requires an array or string');this.stack.push(r.data.length);break;}
          case Op.THROW:{const ref=this.stack.pop();if(ref===null)throw new ManagedFault('NullReferenceException','A null exception was thrown');const r=this.heap.get(ref);throw new ManagedFault(r.type,this.format(r.data[0]),ref);}
          case Op.RETHROW:throw [...(frame.caught??[])].reverse().find(c=>frame.pc-1>=c.start&&frame.pc-1<c.end)?.fault??new ManagedFault('InvalidOperationException','No active exception to rethrow');
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
  snapshot(){const hostRevision=this.platform.hostOperations.snapshotVersion(),memo=new Map();return {hostRevision,owner:this.snapshotOwner,platform:this.platform.snapshot(),scheduler:this.scheduler.snapshot(),sourcePause:this.sourcePause,writeRevision:this.writeRevision,stack:[...this.stack],frames:copyExecution(this.frames,memo),statics:[...this.statics],constantValues:[...this.constantValues],heap:this.heap.snapshot(),state:this.state,instructions:this.instructions,elapsedMs:this.elapsedMs,frameId:this.frameId,currentPoint:this.currentPoint,output:[...this.output],outputCharacters:this.outputCharacters,exitCode:this.exitCode,returnValue:this.returnValue,pendingFault:copyExecution(this.pendingFault,memo),fault:copyExecution(this.fault,memo)};}
  restore(s){if(s?.owner!==this.snapshotOwner)throw new TypeError('Snapshot belongs to another source VM');this.platform.hostOperations.checkRestore(s.hostRevision);const memo=new Map();this.stack=[...s.stack];this.frames=copyExecution(s.frames,memo);this.statics=[...s.statics];this.constantValues=new Map(s.constantValues);this.heap.restore(s.heap);this.state='paused';this.instructions=s.instructions;this.elapsedMs=s.elapsedMs;this.frameId=Math.max(this.frameId,s.frameId);this.writeRevision=s.writeRevision??0;this.sourcePause=s.sourcePause??false;this.currentPoint=this.top?.point??null;this.output=[...s.output];this.outputCharacters=s.outputCharacters;this.exitCode=s.exitCode;this.returnValue=s.returnValue;this.pendingFault=copyExecution(s.pendingFault,memo);this.fault=copyExecution(s.fault,memo);this.scheduler.restore(s.scheduler);this.platform.restore(s.platform);}

}
