import {HttpTransport,NetworkPolicy} from '@sharpforge/network';
import {frameworkType,taskResult} from '@sharpforge/framework';
import {ManagedFault,isReference} from './heap.js';
const H='System.Net.Http.',CT='System.Threading.CancellationToken',CTS=CT+'Source';
const ok=value=>({handled:true,value});
const bad=(type,message)=>{throw new ManagedFault(type,message);};
const id=r=>r?`${r.h}:${r.g}`:'';
const equal=(a,b)=>isReference(a)&&isReference(b)&&id(a)===id(b);
function live(p,ref){if(!ref)bad('NullReferenceException','A managed HTTP object is required');if(p.get(ref,'$disposed',false))bad('ObjectDisposedException',p.record(ref).type);}
function headerObject(p,owner,key='Headers',type=H+'Headers.HttpRequestHeaders'){
 let ref=p.get(owner,key);if(!ref){ref=p.make(type);p.heap.withRoots([ref],()=>p.set(owner,key,ref));}return ref;
}
function headerEntries(p,ref){return ref?Object.fromEntries(p.propertyEntries(ref).filter(([k,v])=>k.startsWith('$h:')&&v!==null).map(([k,v])=>[k.slice(3),p.native(v)])):{};}
function setHeader(p,ref,name,value){const h=new Headers();try{h.set(name,value);}catch(e){bad('ArgumentException',e.message);}for(const[k,v]of h)p.set(ref,'$h:'+k,p.managed(v,'string'));}
function newUri(p,text,base){try{const url=new URL(text,base);return p.make('System.Uri',{'$original':p.managed(text,'string'),'$absolute':p.managed(url.href,'string')});}catch{bad('UriFormatException','Invalid absolute URI');}}
function done(p,type,value,canceled=false){const task=p.vm.scheduler.createTask(type);p.vm.scheduler.complete(task,value,null,canceled);return task.ref;}
function response(p,r){
 const content=p.make(H+'HttpContent',{'$text':p.managed(r.text,'string')} );p.heap.pins.push(content);
 const headers=p.make(H+'Headers.HttpResponseHeaders');p.heap.pins.push(headers);
 const contentHeaders=headerObject(p,content,'Headers',H+'Headers.HttpContentHeaders');
 for(const[k,v]of Object.entries(r.headers)){setHeader(p,k.toLowerCase().startsWith('content-')?contentHeaders:headers,k,v);}
 return p.make(H+'HttpResponseMessage',{StatusCode:r.status,ReasonPhrase:p.managed(r.statusText,'string'),IsSuccessStatusCode:p.managed(r.status>=200&&r.status<300,'bool'),Content:content,Headers:headers});
}
/** .NET-shaped buffered HTTP API. No host cookies, credentials, ambient filesystem or automatic redirects. */
export function invokeNetwork(p,d,args){
 const type=frameworkType(d.owner);if(type?.kind!=='network')return {handled:false};
 let ref=d.isStatic||d.kind==='constructor'?null:args[0],values=ref?args.slice(1):args;
 const n=values.map(v=>p.native(v));
 if(type.family==='uri'){
  if(d.kind==='constructor')return ok(values.length===1?newUri(p,n[0]):newUri(p,n[1],p.native(p.get(values[0],'$absolute'))));
  if(d.isStatic){try{return ok(p.managed(d.name==='EscapeDataString'?encodeURIComponent(n[0]).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()):decodeURIComponent(n[0]),'string'));}catch(e){bad('UriFormatException',e.message);}}
  const original=p.get(ref,'$original'),absolute=p.get(ref,'$absolute');if(d.name==='ToString'||d.property==='OriginalString')return ok(d.name==='ToString'?(absolute??original):original);if(d.property==='IsAbsoluteUri')return ok(p.managed(absolute!==null,'bool'));if(!absolute)bad('InvalidOperationException','This operation requires an absolute URI');const url=new URL(p.native(absolute));
  const result={OriginalString:original,AbsoluteUri:absolute,AbsolutePath:p.managed(url.pathname,'string'),Host:p.managed(url.hostname,'string'),Scheme:p.managed(url.protocol.slice(0,-1),'string'),Port:url.port?Number(url.port):url.protocol==='https:'?443:url.protocol==='http:'?80:-1,IsAbsoluteUri:p.managed(true,'bool')};return ok(d.name==='ToString'?absolute:result[d.property]);
 }
 if(type.family==='cancellation'){
  if(d.kind==='constructor')return ok(p.make(CTS,{'$canceled':false}));
  if(d.isStatic)return ok(p.singleton('CancellationToken.None',()=>p.make(CT)));
  const source=d.owner===CTS?ref:p.get(ref,'$source'),canceled=source?!!p.get(source,'$canceled',false):false;
  if(d.property==='Token'){live(p,ref);let token=p.get(ref,'$token');if(!token){token=p.make(CT,{'$source':ref});p.heap.withRoots([token],()=>p.set(ref,'$token',token));}return ok(token);}
  if(d.property==='IsCancellationRequested')return ok(p.managed(canceled,'bool'));
  if(d.property==='CanBeCanceled')return ok(p.managed(!!source,'bool'));
  if(d.name==='ThrowIfCancellationRequested'){if(canceled)bad('TaskCanceledException','Operation canceled');return ok(null);}
  if(d.name==='Cancel'){live(p,ref);p.set(ref,'$canceled',true);p.hostOperations.cancel(op=>op.roots.some(v=>equal(v,ref)));return ok(null);}
  if(d.name==='Dispose'){p.set(ref,'$disposed',true);return ok(null);}
 }
 if(d.name==='Dispose'){p.set(ref,'$disposed',true);if(type.family==='httpClient')p.hostOperations.cancel('http:'+id(ref));return ok(null);}
 if(type.family==='httpMethod'){
  if(d.kind==='constructor'){if(typeof n[0]!=='string'||!/^[-!#$%&'*+.^_`|~0-9A-Za-z]+$/.test(n[0]))bad('ArgumentException','Invalid HTTP method');return ok(p.make(d.owner,{Method:values[0]}));}
  if(d.isStatic)return ok(p.singleton('HttpMethod.'+d.property,()=>p.make(d.owner,{Method:p.managed(d.property.toUpperCase(),'string')})));
  return ok(p.get(ref,'Method'));
 }
 if(type.family==='httpHeaders'){
  const key=typeof n[0]==='string'?n[0].toLowerCase():'';
  if(d.name==='Add'||d.name==='TryAddWithoutValidation'){try{const prev=p.native(p.get(ref,'$h:'+key));setHeader(p,ref,n[0],prev?prev+', '+n[1]:n[1]);return ok(d.result==='bool'?p.managed(true,'bool'):null);}catch(e){if(d.result==='bool')return ok(p.managed(false,'bool'));throw e;}}
  if(d.name==='Contains')return ok(p.managed(p.get(ref,'$h:'+key)!==null,'bool'));
  if(d.name==='Remove'){const existed=p.get(ref,'$h:'+key)!==null;p.set(ref,'$h:'+key,null);return ok(p.managed(existed,'bool'));}
  if(d.name==='Clear'){for(const[k]of p.propertyEntries(ref))if(k.startsWith('$h:'))p.set(ref,k,null);return ok(null);}
  if(d.name==='ToString')return ok(p.managed(Object.entries(headerEntries(p,ref)).filter(([,v])=>v!==null).map(([k,v])=>`${k}: ${v}\r\n`).join(''),'string'));
 }
 if(d.kind==='constructor'){
  if(type.family==='httpContent')return ok(p.make(d.owner,{'$text':values[0]}));
  if(type.family==='httpClient'){const timeout=p.make('System.TimeSpan',{TotalMilliseconds:p.managed(100000,'double')});return ok(p.heap.withRoots([timeout],()=>p.make(d.owner,{Timeout:timeout})));}
  if(type.family==='httpRequest'){const method=values[0]??p.singleton('HttpMethod.Get',()=>p.make(H+'HttpMethod',{Method:p.managed('GET','string')}));p.heap.pins.push(method);const uri=values.length>1?p.make('System.Uri',{'$original':values[1]}):null;return ok(p.heap.withRoots([uri],()=>p.make(d.owner,{Method:method,RequestUri:uri})));}
 }
 live(p,ref);
 if(d.name==='EnsureSuccessStatusCode'){const status=p.get(ref,'StatusCode');if(status<200||status>=300)bad('HttpRequestException',`HTTP response status ${status}`);return ok(ref);}
 if(d.name==='ReadAsStringAsync')return ok(done(p,'string',p.get(ref,'$text')));
 if(d.kind==='get'){
  if(d.property==='Headers'||d.property==='DefaultRequestHeaders')return ok(headerObject(p,ref,d.property,d.result));
  return ok(p.get(ref,d.property));
 }
 if(d.kind==='set'){
  if(d.property==='Timeout'){const ms=p.native(p.get(values[0],'TotalMilliseconds'));if(!Number.isFinite(ms)||ms<=0||ms>2147483647)bad('ArgumentOutOfRangeException','Positive finite HTTP timeout required');}
  p.set(ref,d.property,values[0]);return ok(null);
 }
 if(type.family==='httpClient'){
  if(d.name==='CancelPendingRequests'){p.hostOperations.cancel('http:'+id(ref));return ok(null);}
  const token=d.parameters.at(-1)===CT?values.at(-1):null,source=token?p.get(token,'$source'):null,resultType=taskResult(d.result);
  if(source&&p.get(source,'$canceled',false))return ok(done(p,resultType,null,true));
  let request=d.name==='SendAsync'?values[0]:null,url,method,content,headers=headerEntries(p,p.get(ref,'DefaultRequestHeaders'));
  if(request){live(p,request);const uri=p.get(request,'RequestUri');url=uri?p.native(p.get(uri,'$absolute')??p.get(uri,'$original')):null;method=p.native(p.get(p.get(request,'Method'),'Method'));content=p.get(request,'Content');headers={...headers,...headerEntries(p,p.get(request,'Headers'))};}
  else{url=n[0];method=d.name==='GetStringAsync'||d.name==='GetAsync'?'GET':d.name.slice(0,-5).toUpperCase();content=['POST','PUT','PATCH'].includes(method)?values[1]:null;}
  const base=p.get(ref,'BaseAddress');try{url=new URL(url,base?p.native(p.get(base,'$absolute')):undefined).href;}catch{bad('InvalidOperationException','Use an absolute request URI or set HttpClient.BaseAddress');}
  let body=null;if(content){live(p,content);body=p.native(p.get(content,'$text'))??'';headers={...headers,'content-type':'text/plain; charset=utf-8',...headerEntries(p,p.get(content,'Headers'))};}
  headers=Object.fromEntries(Object.entries(headers).filter(([,v])=>v!==null));
  p.httpTransport??=new HttpTransport(new NetworkPolicy(p.options.network??{}));const timeout=Math.min(p.native(p.get(p.get(ref,'Timeout'),'TotalMilliseconds')),p.httpTransport.policy.timeoutMs);
  return ok(p.hostOperations.start(resultType,signal=>p.httpTransport.request(url,{method,headers,body,signal,timeoutMs:timeout}),r=>{if(d.name==='GetStringAsync'){if(r.status<200||r.status>=300)bad('HttpRequestException',`HTTP response status ${r.status}`);return p.managed(r.text,'string');}return response(p,r);},[ref,request,content,token,source].filter(Boolean),'http:'+id(ref)));
 }
 bad('MissingMethodException',d.owner+'.'+d.name);
}
