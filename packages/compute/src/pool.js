import {createKernel} from './kernel.js';
import {SIMD_BASE64} from './wasm.js';
async function workerMain(base64,options){
  const node=typeof process==='object'&&process.versions?.node;
  let send,listen,identity=null;if(node){const m=await import('node:worker_threads');send=(v,t)=>m.parentPort.postMessage(v,t);listen=f=>m.parentPort.on('message',f);identity=m.threadId;}else{send=(v,t)=>self.postMessage(v,t);listen=f=>self.onmessage=e=>f(e.data);}
  const kernel=createKernel(base64,options);send({ready:true,info:{...kernel.metrics,threadId:identity}});
  listen(job=>{try{const C=job.type==='f64'?Float64Array:Int32Array,a=new C(job.a),b=job.b?new C(job.b):null,value=kernel.execute(job.operation,a,b);send({id:job.id,value,metrics:{...kernel.metrics,threadId:identity}},ArrayBuffer.isView(value)?[value.buffer]:[]);}catch(e){send({id:job.id,error:{name:e.name,message:e.message}});}});
}
/** Isolated workers with bounded queue, owned transfer buffers and cancellation by termination. */
export class ComputePool{
  constructor({workers=2,maxQueue=32,maxElements=1_000_000,backend='auto',timeoutMs=30000,maxQueuedBytes=64*1024*1024}={}){
    if(!Number.isInteger(workers)||workers<1||workers>8||!Number.isInteger(maxQueue)||maxQueue<1||maxQueue>1024||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>600000||!Number.isSafeInteger(maxQueuedBytes)||maxQueuedBytes<1||maxQueuedBytes>512*1024*1024)throw new RangeError('Invalid worker-pool limits');
    this.options={maxElements,backend};createKernel(SIMD_BASE64,this.options);
    this.pendingBytes=0;this.maxQueuedBytes=maxQueuedBytes;this.size=workers;this.maxQueue=maxQueue;this.timeoutMs=timeoutMs;this.queue=[];this.slots=[];this.closed=false;this.nextId=1;this.stats={submitted:0,completed:0,canceled:0,failed:0,spawned:0,maxActive:0};this.initializing=null;
  }
  async spawn(index){
    const source='const createKernel='+createKernel.toString()+';('+workerMain.toString()+')('+JSON.stringify(SIMD_BASE64)+','+JSON.stringify(this.options)+');';
    let worker,url=null;if(typeof process==='object'&&process.versions?.node){const {Worker}=await import('node:worker_threads');worker=new Worker(source,{eval:true});}else{url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));worker=new Worker(url);}
    if(this.closed){worker.terminate();if(url)URL.revokeObjectURL(url);return;}
    const slot={index,worker,url,job:null,info:null,ready:false};this.slots[index]=slot;this.stats.spawned++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>failure(new Error('Numerical worker startup deadline exceeded')),this.timeoutMs);
      const failure=e=>{if(this.slots[index]!==slot)return;const error=e instanceof Error?e:new Error(e.message??'Numerical worker failed');clearTimeout(timer);const j=slot.job;slot.job=null;if(j){this.stats.failed++;j.finish(error);}if(!slot.ready){reject(error);this.dispose(error);}else this.replace(slot);};
      const message=data=>{
        if(this.slots[index]!==slot)return;
        if(data.ready){clearTimeout(timer);slot.ready=true;slot.info=data.info;worker.unref?.();resolve();this.drain();return;}
        const j=slot.job;if(!j||j.id!==data.id)return;slot.job=null;worker.unref?.();
        if(data.error){const e=new Error(data.error.message);e.name=data.error.name;this.stats.failed++;j.finish(e);}else{slot.info=data.metrics;if(performance.now()>j.deadline){this.stats.failed++;j.finish(new Error('Numerical worker deadline exceeded'));}else{this.stats.completed++;j.finish(null,data.value);}}this.drain();
      };
      slot.cancelStartup=()=>{clearTimeout(timer);if(!slot.ready)reject(new Error('Compute pool disposed during startup'));};
      if(worker.on){worker.on('message',message);worker.on('error',failure);worker.on('exit',code=>{if(code!==0)failure(new Error('Numerical worker exited: '+code));});}else{worker.onmessage=e=>message(e.data);worker.onerror=failure;}
    });
  }
  async init(){if(this.closed)throw new Error('Compute pool is disposed');if(!this.initializing)this.initializing=Promise.all(Array.from({length:this.size},(_,i)=>this.spawn(i)));await this.initializing;}
  async replace(slot){if(this.slots[slot.index]!==slot)return;this.slots[slot.index]=null;slot.cancelStartup?.();slot.worker.terminate();if(slot.url)URL.revokeObjectURL(slot.url);if(!this.closed)try{await this.spawn(slot.index);}catch(e){this.dispose(e);}}
  execute(operation,a,b=null,{signal=null,timeoutMs=this.timeoutMs}={}){
    if(this.closed)return Promise.reject(new Error('Compute pool is disposed'));if(signal?.aborted)return Promise.reject(signal.reason??new DOMException('Aborted','AbortError'));
    const C=a instanceof Float64Array?Float64Array:a instanceof Int32Array?Int32Array:null;
    if(!C||a.length>this.options.maxElements||b!==null&&(!(b instanceof C)||a.length!==b.length)||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>600000)return Promise.reject(new RangeError('Invalid numerical job'));
    if(this.queue.length>=this.maxQueue)return Promise.reject(new Error('Numerical worker queue limit exceeded'));const jobBytes=a.byteLength+(b?.byteLength??0);if(this.pendingBytes+jobBytes>this.maxQueuedBytes)return Promise.reject(new Error('Numerical worker byte budget exceeded'));
    const ownedA=new C(a),ownedB=b===null?null:new C(b);return this.submit({operation,type:C===Float64Array?'f64':'i32',a:ownedA.buffer,b:ownedB?.buffer},{signal,timeoutMs});
  }
  submit(payload,{signal=null,timeoutMs=this.timeoutMs}={}){return new Promise((resolve,reject)=>{
    const bytes=payload.a.byteLength+(payload.b?.byteLength??0);this.pendingBytes+=bytes;const job={id:this.nextId++,payload,deadline:performance.now()+timeoutMs,finish:null};let finished=false;
    const stop=error=>{if(finished)return;const i=this.queue.indexOf(job);if(i>=0)this.queue.splice(i,1);const slot=this.slots.find(s=>s?.job===job);if(slot){slot.job=null;this.replace(slot);}job.finish(error);};
    const cancel=()=>{this.stats.canceled++;stop(signal?.reason??new DOMException('Aborted','AbortError'));};
    const timer=setTimeout(()=>{this.stats.failed++;stop(new Error('Numerical worker deadline exceeded'));},timeoutMs);
    job.finish=(error,result)=>{if(finished)return;finished=true;this.pendingBytes-=bytes;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};signal?.addEventListener('abort',cancel,{once:true});this.queue.push(job);this.stats.submitted++;this.init().then(()=>this.drain(),e=>stop(e));
  });}
  drain(){if(this.closed)return;for(const slot of this.slots)if(slot?.ready&&!slot.job&&this.queue.length){const job=this.queue.shift();slot.job=job;const transfers=[job.payload.a,...(job.payload.b?[job.payload.b]:[])];try{slot.worker.ref?.();slot.worker.postMessage({...job.payload,id:job.id},transfers);}catch(e){slot.job=null;slot.worker.unref?.();job.finish(e);}}this.stats.maxActive=Math.max(this.stats.maxActive,this.slots.filter(s=>s?.job).length);}
  async capabilities(){await this.init();return {kind:'isolated-workers',workers:this.size,pendingBytes:this.pendingBytes,maxQueuedBytes:this.maxQueuedBytes,slots:this.slots.map(s=>s?.info),...this.stats};}
  dispose(reason=new Error('Compute pool is disposed')){if(this.closed)return;this.closed=true;for(const j of this.queue.splice(0))j.finish(reason);const slots=this.slots;this.slots=[];for(const slot of slots)if(slot){slot.cancelStartup?.();slot.job?.finish(reason);slot.job=null;slot.worker.terminate();if(slot.url)URL.revokeObjectURL(slot.url);}}
}
