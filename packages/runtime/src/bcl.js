import {frameworkType} from '@sharpforge/framework';
import {isReference} from './heap.js';
import {MAX,fail,integer,bclScalar,array,makeArray,equal} from '@sharpforge/bcl-core';
export {bclScalar,formatBclValue,compositeFormat} from '@sharpforge/bcl-core';
function count(p,ref){return p.get(ref,'$count',0);}
function data(p,ref){const r=p.get(ref,'$data');return r?p.heap.get(r).data:[];}
function version(p,ref){return p.get(ref,'$version',0);}
function change(p,ref){p.set(ref,'$version',version(p,ref)+1);}
function reserve(p,ref,needed,slots=1){integer(p,needed);const old=data(p,ref),capacity=old.length/slots;if(needed<=capacity)return;const n=Math.min(MAX,Math.max(needed,capacity?capacity*2:4)),items=old.concat(Array(n*slots-old.length).fill(null));const r=makeArray(p,'object',items);p.heap.withRoots([r],()=>p.set(ref,'$data',r));}
function commitItems(p,ref,items,slots=1){const n=items.length/slots;integer(p,n);reserve(p,ref,n,slots);const old=data(p,ref),next=Array(old.length).fill(null);items.forEach((v,i)=>next[i]=v);p.heap.replaceData(p.get(ref,'$data'),next);p.set(ref,'$count',n);change(p,ref);}
function write(p,ref,index,value){const r=p.get(ref,'$data'),record=p.heap.get(r),oldValue=record.data[index];record.data[index]=value;p.vm.notifyWrite?.({kind:'array',handle:r.h,generation:r.g,index,oldValue,value});}
function queueItems(p,ref){const a=data(p,ref),head=p.get(ref,'$head',0),size=count(p,ref);return Array.from({length:size},(_,i)=>a[(head+i)%a.length]);}
function queueEnqueue(p,ref,value){const size=count(p,ref),a=data(p,ref);integer(p,size+1);if(size===a.length){const items=queueItems(p,ref);reserve(p,ref,size+1);const next=Array(data(p,ref).length).fill(null);items.forEach((v,i)=>next[i]=v);p.heap.replaceData(p.get(ref,'$data'),next);p.set(ref,'$head',0);}write(p,ref,(p.get(ref,'$head',0)+size)%data(p,ref).length,value);p.set(ref,'$count',size+1);change(p,ref);}
function append(p,ref,value){const n=count(p,ref);reserve(p,ref,n+1);write(p,ref,n,value);p.set(ref,'$count',n+1);change(p,ref);}
function keyOf(p,value){const v=bclScalar(p,value);if(v===null)return 'null';if(isReference(v))return 'r:'+v.h+':'+v.g;return typeof v+':'+String(v);}
function indexMap(p,ref,slots=1){const record=p.record(ref),v=version(p,ref);p.bclIndexes??=new WeakMap();let cache=p.bclIndexes.get(record);if(cache?.version!==v){const index=new Map(),items=data(p,ref);for(let i=0;i<count(p,ref);i++)index.set(keyOf(p,items[i*slots]),i);cache={version:v,index};p.bclIndexes.set(record,cache);}return cache.index;}
/** All state is heap-owned and therefore GC-visible and included in debugger snapshots. */
export function invokeBcl(p,d,args){
  const t=frameworkType(d.owner),family=t?.family;if(t?.kind!=='bcl')return {handled:false};
  const result=value=>({handled:true,value}),ref=d.isStatic||d.kind==='constructor'?null:args[0],values=ref===null?args:args.slice(1),n=values.map(v=>bclScalar(p,v)),m=d.name;
  if(family==='math'){
    if(d.kind==='get')return result(p.managed(t.properties[d.property].value,'double'));
    let v;if(m==='Clamp'){if(n[1]>n[2])fail(p,'ArgumentException','Minimum exceeds maximum');v=Math.min(n[2],Math.max(n[1],n[0]));}else v=Math[m==='Truncate'?'trunc':m.toLowerCase()](...n);return result(p.managed(v,d.result));
  }
  if(d.kind==='constructor'){
    if(n.length===1&&typeof n[0]==='number')integer(p,n[0]);
    const r=p.make(d.owner,{'$count':0,'$version':0});p.heap.pins.push(r);
    if(d.parameters[0]?.endsWith('[]')){const a=array(p,values[0]);commitItems(p,r,family==='HashSet'?a.filter((x,i)=>a.findIndex(y=>equal(p,x,y))===i):a);}
    else if(n[0])reserve(p,r,n[0],family==='Dictionary'?2:1);
    return result(r);
  }
  p.record(ref);
  if(family==='enumerator'){
    if(m==='Dispose'){p.set(ref,'$owner',null);return result(null);}
    const owner=p.get(ref,'$owner');if(!owner)fail(p,'ObjectDisposedException','Enumerator is disposed');if(version(p,owner)!==p.get(ref,'$version'))fail(p,'InvalidOperationException','Collection was modified during enumeration');
    if(m==='MoveNext'){const i=p.get(ref,'$index',-1)+1;p.set(ref,'$index',i);return result(p.managed(i<count(p,owner),'bool'));}
    if(m==='get_Current'){const i=p.get(ref,'$index',-1);if(i<0||i>=count(p,owner))fail(p,'InvalidOperationException','Enumerator is not positioned on an item');const type=frameworkType(p.record(owner).type),index=type.family==='Stack'?count(p,owner)-1-i:type.family==='Queue'?(p.get(owner,'$head',0)+i)%data(p,owner).length:i;return result(data(p,owner)[index]);}
  }
  const size=count(p,ref),slots=family==='Dictionary'?2:1;
  if(m==='get_Count')return result(size);
  if(m==='get_Capacity')return result(data(p,ref).length);
  if(m==='set_Capacity'){integer(p,n[0],size);const next=data(p,ref).slice(0,n[0]);while(next.length<n[0])next.push(null);const r=makeArray(p,'object',next);p.heap.withRoots([r],()=>p.set(ref,'$data',r));return result(null);}
  if(m==='Clear'){if(size)commitItems(p,ref,[],slots);if(family==='Queue')p.set(ref,'$head',0);return result(null);}
  if(m==='GetEnumerator')return result(p.make(d.result,{'$owner':ref,'$index':-1,'$version':version(p,ref)}));
  if(m==='ToArray')return result(makeArray(p,t.element,family==='Queue'?queueItems(p,ref):family==='Stack'?data(p,ref).slice(0,size).reverse():data(p,ref).slice(0,size)));
  if(family==='Dictionary'){
    if(m==='get_Keys'||m==='get_Values')return result(makeArray(p,m==='get_Keys'?t.key:t.element,Array.from({length:size},(_,i)=>data(p,ref)[i*2+(m==='get_Keys'?0:1)])));
    if(m==='ContainsValue')return result(p.managed(Array.from({length:size},(_,i)=>data(p,ref)[i*2+1]).some(v=>equal(p,v,values[0])),'bool'));
    if(values[0]===null)fail(p,'ArgumentNullException','Dictionary key cannot be null');const map=indexMap(p,ref,2),key=keyOf(p,values[0]),index=map.get(key);
    if(m==='ContainsKey')return result(p.managed(index!==undefined,'bool'));
    if(m==='get_Item'){if(index===undefined)fail(p,'KeyNotFoundException','The given key was not present');return result(data(p,ref)[index*2+1]);}
    if(m==='Remove'){if(index===undefined)return result(p.managed(false,'bool'));const a=data(p,ref).slice(0,size*2);a.splice(index*2,2);commitItems(p,ref,a,2);return result(p.managed(true,'bool'));}
    if(m==='Add'||m==='TryAdd'||m==='set_Item'){if(index!==undefined){if(m==='Add')fail(p,'ArgumentException','An item with the same key already exists');if(m==='TryAdd')return result(p.managed(false,'bool'));write(p,ref,index*2+1,values[1]);change(p,ref);}else{reserve(p,ref,size+1,2);write(p,ref,size*2,values[0]);write(p,ref,size*2+1,values[1]);p.set(ref,'$count',size+1);change(p,ref);map.set(key,size);}p.bclIndexes.set(p.record(ref),{version:version(p,ref),index:map});return result(m==='TryAdd'?p.managed(true,'bool'):null);}
  }
  if(m==='Contains'||m==='IndexOf'){const at=family==='HashSet'?indexMap(p,ref).get(keyOf(p,values[0]))??-1:(family==='Queue'?queueItems(p,ref):data(p,ref).slice(0,size)).findIndex(v=>equal(p,v,values[0]));return result(m==='Contains'?p.managed(at>=0,'bool'):at);}
  if(m==='get_Item'){return result(data(p,ref)[integer(p,n[0],0,size-1)]);}
  if(m==='set_Item'){const i=integer(p,n[0],0,size-1);write(p,ref,i,values[1]);change(p,ref);return result(null);}
  if(m==='Add'||m==='Enqueue'||m==='Push'){if(family==='Queue'){queueEnqueue(p,ref,values[0]);return result(null);}const map=family==='HashSet'?indexMap(p,ref):null,key=map?keyOf(p,values[0]):null;if(map?.has(key))return result(p.managed(false,'bool'));append(p,ref,values[0]);if(map){map.set(key,size);p.bclIndexes.set(p.record(ref),{version:version(p,ref),index:map});}return result(family==='HashSet'?p.managed(true,'bool'):null);}
  if(m==='Peek'||m==='Dequeue'||m==='Pop'){if(!size)fail(p,'InvalidOperationException','Collection is empty');const i=family==='Stack'?size-1:p.get(ref,'$head',0),value=data(p,ref)[i];if(m!=='Peek'){p.heap.withRoots([value],()=>{write(p,ref,i,null);p.set(ref,'$count',size-1);if(family==='Queue')p.set(ref,'$head',size===1?0:(i+1)%data(p,ref).length);change(p,ref);});}return result(value);}
  const a=data(p,ref).slice(0,size);
  switch(m){
    case 'AddRange':{const extra=array(p,values[0]);integer(p,a.length+extra.length);for(const v of extra)a.push(v);break;}
    case 'Insert':a.splice(integer(p,n[0],0,size),0,values[1]);break;
    case 'RemoveAt':a.splice(integer(p,n[0],0,size-1),1);break;
    case 'RemoveRange':a.splice(integer(p,n[0],0,size),integer(p,n[1],0,size-n[0]));break;
    case 'Remove':{const i=a.findIndex(v=>equal(p,v,values[0]));if(i<0)return result(p.managed(false,'bool'));a.splice(i,1);commitItems(p,ref,a);return result(p.managed(true,'bool'));}
    case 'Reverse':a.reverse();break;
    case 'Sort':a.sort((x,y)=>{const u=bclScalar(p,x),v=bclScalar(p,y);if(u===v)return 0;if(u===null)return -1;if(v===null)return 1;if(typeof u==='number'&&typeof v==='number')return Number.isNaN(u)?-1:Number.isNaN(v)?1:u-v;if(typeof u==='string'&&typeof v==='string'||typeof u==='boolean'&&typeof v==='boolean')return u<v?-1:1;fail(p,'InvalidOperationException','Default comparer is unavailable for this object type');});break;
    case 'UnionWith':case 'IntersectWith':case 'ExceptWith':{const other=new Set(array(p,values[0]).map(v=>keyOf(p,v))),seen=new Set(a.map(v=>keyOf(p,v)));if(m==='UnionWith'){for(const v of array(p,values[0]))if(!seen.has(keyOf(p,v))){seen.add(keyOf(p,v));a.push(v);}}else for(let i=a.length-1;i>=0;i--)if(other.has(keyOf(p,a[i]))===(m==='ExceptWith'))a.splice(i,1);break;}
    default:fail(p,'MissingMethodException',`${d.owner}.${m}`);
  }
  commitItems(p,ref,a);return result(null);
}
