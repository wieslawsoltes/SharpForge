export class NetworkError extends Error{constructor(message,code='NETWORK'){super(message);this.name='NetworkError';this.code=code;}}
const deniedHeaders=/^(?:host|cookie2?|set-cookie|origin|referer|connection|content-length|transfer-encoding|proxy-.+|sec-.+)$/i;
const abortError=()=>new DOMException('The operation was canceled','AbortError');
const positive=(value,name,max)=>{if(!Number.isSafeInteger(value)||value<1||value>max)throw new RangeError(name+' is outside its allowed range');return value;};
/** No wildcard grants. Origins, not strings/prefixes, define the network capability. */
export class NetworkPolicy{
  constructor({allowedOrigins=[],maxRequestBytes=1_048_576,maxResponseBytes=1_048_576,timeoutMs=10000,maxConcurrent=4,maxQueue=32}={}){
    if(!Array.isArray(allowedOrigins)||allowedOrigins.length>100)throw new TypeError('An explicit origin list is required');
    this.origins=new Set(allowedOrigins.map(origin=>{const u=new URL(origin);if(!['http:','https:','ws:','wss:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new TypeError('Grants must be exact HTTP(S)/WS(S) origins');return u.origin;}));
    this.maxRequestBytes=positive(maxRequestBytes,'maxRequestBytes',64*1024*1024);this.maxResponseBytes=positive(maxResponseBytes,'maxResponseBytes',64*1024*1024);this.timeoutMs=positive(timeoutMs,'timeoutMs',600000);this.maxConcurrent=positive(maxConcurrent,'maxConcurrent',32);this.maxQueue=positive(maxQueue,'maxQueue',1024);
  }
  check(input,base=null,protocols=['http:','https:']){let url;try{url=new URL(input,base??undefined);}catch{throw new NetworkError('An absolute URL or configured base address is required','URL');}if(!protocols.includes(url.protocol)||url.username||url.password||!this.origins.has(url.origin))throw new NetworkError('Network origin is not permitted: '+url.origin,'DENIED');url.hash='';return url;}
  headers(input={}){const headers=new Headers(input);for(const [name,value]of headers){if(deniedHeaders.test(name)||value.length>16384)throw new NetworkError('Disallowed request header: '+name,'HEADER');}if([...headers].length>100)throw new NetworkError('Request header count exceeded','HEADER');return headers;}
  describe(){return {allowedOrigins:[...this.origins],maxRequestBytes:this.maxRequestBytes,maxResponseBytes:this.maxResponseBytes,timeoutMs:this.timeoutMs,maxConcurrent:this.maxConcurrent,maxQueue:this.maxQueue,credentials:'omit',redirect:'error'};}
}
export class HttpTransport{
  constructor(options={}){this.policy=options instanceof NetworkPolicy?options:new NetworkPolicy(options);this.queue=[];this.active=new Set();this.closed=false;this.stats={requests:0,completed:0,failed:0,canceled:0,receivedBytes:0,maxActive:0};}
  request(input,{baseAddress=null,method='GET',headers={},body=null,signal=null,timeoutMs=null}={}){
    try{
      if(this.closed)throw new NetworkError('HTTP transport is disposed','DISPOSED');if(signal?.aborted)throw signal.reason??abortError();if(this.queue.length>=this.policy.maxQueue)throw new NetworkError('HTTP request queue limit exceeded','QUEUE');
      const url=this.policy.check(input,baseAddress),h=this.policy.headers(headers);method=String(method).toUpperCase();if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method))throw new NetworkError('Unsupported HTTP method','METHOD');
      if(body!==null&&typeof body!=='string'&&!(body instanceof Uint8Array))throw new TypeError('HTTP body must be text or bytes');if(body!==null&&['GET','HEAD'].includes(method))throw new NetworkError('GET and HEAD requests cannot have bodies','BODY');
      const bytes=body===null?null:typeof body==='string'?new TextEncoder().encode(body):new Uint8Array(body);if((bytes?.length??0)>this.policy.maxRequestBytes)throw new NetworkError('Request body exceeds the configured byte limit','LIMIT');
      const deadline=Math.min(timeoutMs===null?this.policy.timeoutMs:positive(Math.ceil(timeoutMs),'timeoutMs',600000),this.policy.timeoutMs);
      return new Promise((resolve,reject)=>{
        const controller=new AbortController(),job={url:url.href,method,headers:h,body:bytes,controller,finish:null};let done=false;
        const cancel=()=>{controller.abort(signal?.reason??abortError());if(!this.active.has(job)){const i=this.queue.indexOf(job);if(i>=0)this.queue.splice(i,1);job.finish(signal?.reason??abortError());}};
        const timer=setTimeout(()=>{const e=new NetworkError('HTTP request deadline exceeded','TIMEOUT');controller.abort(e);if(!this.active.has(job)){const i=this.queue.indexOf(job);if(i>=0)this.queue.splice(i,1);job.finish(e);}},deadline);
        job.finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);this.active.delete(job);if(error){if(error.name==='AbortError')this.stats.canceled++;else this.stats.failed++;reject(error);}else{this.stats.completed++;resolve(value);}this.drain();};
        signal?.addEventListener('abort',cancel,{once:true});this.queue.push(job);this.stats.requests++;this.drain();
      });
    }catch(error){return Promise.reject(error);}
  }
  drain(){while(!this.closed&&this.active.size<this.policy.maxConcurrent&&this.queue.length){const j=this.queue.shift();this.active.add(j);this.stats.maxActive=Math.max(this.stats.maxActive,this.active.size);this.perform(j).then(v=>j.finish(null,v),e=>j.finish(j.controller.signal.aborted?j.controller.signal.reason??abortError():e));}}
  async perform(job){
    const response=await fetch(job.url,{method:job.method,headers:job.headers,body:job.body,signal:job.controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
    const announced=Number(response.headers.get('content-length'));if(Number.isFinite(announced)&&announced>this.policy.maxResponseBytes){await response.body?.cancel();throw new NetworkError('Response exceeds the configured byte limit','LIMIT');}
    const chunks=[];let size=0;const reader=response.body?.getReader();
    if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>this.policy.maxResponseBytes){await reader.cancel();throw new NetworkError('Response exceeds the configured byte limit','LIMIT');}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}this.stats.receivedBytes+=size;
    return {url:response.url,status:response.status,statusText:response.statusText,ok:response.ok,headers:Object.fromEntries([...response.headers].filter(([k])=>k!=='set-cookie')),bytes,text:new TextDecoder().decode(bytes)};
  }
  dispose(){if(this.closed)return;this.closed=true;for(const j of this.queue.splice(0))j.finish(new NetworkError('HTTP transport disposed','DISPOSED'));for(const j of this.active)j.controller.abort(new NetworkError('HTTP transport disposed','DISPOSED'));}
}
/** Text/binary WebSocket frames with bounded send buffering and receive queues. */
export class WebSocketClient{
  constructor(policy={}, {maxMessageBytes=1_048_576,maxQueuedMessages=64}={}){this.policy=policy instanceof NetworkPolicy?policy:new NetworkPolicy(policy);this.maxMessageBytes=positive(maxMessageBytes,'maxMessageBytes',64*1024*1024);this.maxQueuedMessages=positive(maxQueuedMessages,'maxQueuedMessages',1024);this.socket=null;this.messages=[];this.waiters=[];this.error=null;this.closed=false;}
  connect(input,{protocols=[],signal=null}={}){if(this.socket||this.closed)return Promise.reject(new NetworkError('WebSocket already used','STATE'));let u;try{u=this.policy.check(input,null,['ws:','wss:']);}catch(e){return Promise.reject(e);}if(signal?.aborted)return Promise.reject(signal.reason??abortError());return new Promise((resolve,reject)=>{
    const socket=this.socket=new WebSocket(u,protocols);socket.binaryType='arraybuffer';let opened=false;
    const abort=()=>{const e=signal?.reason??abortError();this.fail(e);reject(e);};const timer=setTimeout(()=>{const e=new NetworkError('WebSocket connect deadline exceeded','TIMEOUT');this.fail(e);reject(e);},this.policy.timeoutMs);
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};signal?.addEventListener('abort',abort,{once:true});
    socket.onopen=()=>{opened=true;cleanup();resolve(this);};socket.onerror=()=>{const e=new NetworkError('WebSocket transport error');cleanup();this.fail(e);if(!opened)reject(e);};
    socket.onclose=()=>{cleanup();this.closed=true;if(!opened)reject(this.error??new NetworkError('WebSocket closed before connection','CLOSED'));for(const w of this.waiters.splice(0))w.finish(this.error,null);};
    socket.onmessage=e=>{const data=typeof e.data==='string'?e.data:new Uint8Array(e.data),length=typeof data==='string'?new TextEncoder().encode(data).length:data.byteLength;if(length>this.maxMessageBytes||this.messages.length>=this.maxQueuedMessages){this.fail(new NetworkError('WebSocket receive limit exceeded','LIMIT'));return;}const waiter=this.waiters.shift();if(waiter)waiter.finish(null,data);else this.messages.push(data);};
  });}
  send(data){if(this.socket?.readyState!==1)throw new NetworkError('WebSocket is not open','STATE');if(typeof data!=='string'&&!(data instanceof Uint8Array))throw new TypeError('WebSocket payload must be text or bytes');const size=typeof data==='string'?new TextEncoder().encode(data).length:data.byteLength;if(size>this.maxMessageBytes||this.socket.bufferedAmount+size>this.policy.maxRequestBytes)throw new NetworkError('WebSocket send limit exceeded','LIMIT');this.socket.send(data);}
  receive({signal=null,timeoutMs=this.policy.timeoutMs}={}){if(signal?.aborted)return Promise.reject(signal.reason??abortError());if(this.messages.length)return Promise.resolve(this.messages.shift());if(this.error)return Promise.reject(this.error);if(this.closed)return Promise.resolve(null);if(this.waiters.length>=this.maxQueuedMessages)return Promise.reject(new NetworkError('WebSocket receive waiter limit exceeded','LIMIT'));return new Promise((resolve,reject)=>{const waiter={finish:null};let finished=false;const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);const i=this.waiters.indexOf(waiter);if(i>=0)this.waiters.splice(i,1);};waiter.finish=(e,v)=>{if(finished)return;finished=true;cleanup();e?reject(e):resolve(v);};const abort=()=>waiter.finish(signal.reason??abortError()),timer=setTimeout(()=>waiter.finish(new NetworkError('WebSocket receive deadline exceeded','TIMEOUT')),positive(timeoutMs,'timeoutMs',600000));signal?.addEventListener('abort',abort,{once:true});this.waiters.push(waiter);});}
  fail(error){if(this.error)return;this.error=error;this.closed=true;for(const w of this.waiters.splice(0))w.finish(error);try{this.socket?.close(1008,'Client policy or transport error');}catch{}}
  close(code=1000,reason=''){this.socket?.close(code,reason);this.closed=true;for(const w of this.waiters.splice(0))w.finish(null,null);}
}

/** Static/native hosts opt in independently from managed-session networking grants. */
export function createBrowserCsp(allowedOrigins=[]){const policy=new NetworkPolicy({allowedOrigins}),extra=[...policy.origins].sort().map(x=>' '+x).join('');return "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'"+extra+"; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";}
