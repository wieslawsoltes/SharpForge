import {ManagedFault} from './heap.js';
/** Host promises never enter managed data. Their presence creates a reverse-debugging barrier. */
export class HostOperations{
  constructor(platform){this.p=platform;this.active=new Map();this.nextId=1;this.revision=0;this.closed=false;}
  *roots(){for(const op of this.active.values()){yield op.task.ref;yield*op.roots;}}
  start(resultType,begin,convert,roots=[],tag=null){
    const {vm}=this.p;if(this.closed)throw new ManagedFault('ObjectDisposedException','Host operations are closed');if(vm.scheduler.suppressed)throw new ManagedFault('InvalidOperationException','External operations are not permitted during synchronous function evaluation');
    const task=vm.scheduler.createTask(resultType,{external:true}),id=this.nextId++,controller=new AbortController(),operation={id,task,controller,roots:[...roots],tag};this.active.set(id,operation);this.revision++;
    const complete=(value,error)=>{if(this.active.get(id)!==operation)return;this.active.delete(id);this.revision++;task.external=false;
      try{this.p.heap.withRoots([task.ref,...roots],()=>{if(error){const canceled=controller.signal.aborted||error.name==='AbortError';const fault=error instanceof ManagedFault?error:new ManagedFault(canceled?'TaskCanceledException':tag==='compute'?'InvalidOperationException':'HttpRequestException',error.message??String(error));vm.scheduler.complete(task,null,fault,canceled);}else vm.scheduler.complete(task,convert(value));});}
      catch(e){vm.scheduler.complete(task,null,e instanceof ManagedFault?e:new ManagedFault('RuntimeException',e.message));}try{this.p.options.onExternalComplete?.();}catch(callbackError){this.p.lastExternalObserverError=String(callbackError.message??callbackError);}};
    Promise.resolve().then(()=>{if(controller.signal.aborted)throw controller.signal.reason;return begin(controller.signal);}).then(v=>complete(v),e=>complete(null,e));return task.ref;
  }
  cancel(tag){for(const op of this.active.values())if(tag===null||op.tag===tag||typeof tag==='function'&&tag(op))op.controller.abort(new DOMException('Canceled by managed code','AbortError'));}
  snapshotVersion(){if(this.active.size)throw new ManagedFault('InvalidOperationException','Cannot snapshot across a pending external operation');return this.revision;}
  checkRestore(version){if(this.active.size||(version??0)!==this.revision)throw new ManagedFault('InvalidOperationException','Cannot reverse across external I/O or worker computation; start a new history segment');}
  dispose(){if(this.closed)return;this.closed=true;for(const op of this.active.values()){op.controller.abort(new DOMException('Runtime stopped','AbortError'));this.p.vm.scheduler.complete(op.task,null,null,true);}if(this.active.size)this.revision++;this.active.clear();}
}
