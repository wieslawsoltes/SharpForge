import {collectHeap} from './execution/heap-collection.js';
import {MethodTableRegistry} from './execution/method-table.js';
import {replaceHeapData} from './execution/heap-allocation.js';
import {allocateHeapArray,allocateHeapRecord} from './execution/heap-storage.js';
import {ManagedFault,isReference} from './execution/managed-fault.js';
import {snapshotHeap,restoreHeap,heapSnapshotStatistics} from './execution/snapshot-cow.js';
export {ManagedFault,isReference};
/** A precise, non-moving tracing heap. Managed references are generation-checked handles, never raw JS object references. */
export class ManagedHeap {
  constructor({maxBytes=32*1024*1024,initialThreshold=64*1024,maxArrayLength=0xffffffff,methodTables=new MethodTableRegistry()}={}){
    this.methodTables=methodTables;
    if(!Number.isSafeInteger(maxArrayLength)||maxArrayLength<0)throw new RangeError('Invalid maxArrayLength');this.maxArrayLength=maxArrayLength;
    this.maxBytes=maxBytes;this.threshold=Math.min(initialThreshold,maxBytes);if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(initialThreshold)||initialThreshold<1)throw new RangeError('Heap sizes must be positive safe integers');this.mutationRevision=0;this.generationCounter=0;this.records=[];this.generations=[];this.free=[];this.rootProvider=()=>[];this.pins=[];this.handles=new Map();this.handleOwner=Object.freeze({});this.nextHandleId=1;this.marks=new Uint32Array(0);this.markEpoch=0;this.markWork=[];
    this.stats={allocatedBytes:0,hostStrongHandles:0,hostWeakHandles:0,rootsScanned:0,edgesScanned:0,markedObjects:0,maxPauseMs:0,markMs:0,sweepMs:0,liveBytes:0,liveObjects:0,allocations:0,collections:0,freedObjects:0,freedBytes:0,lastPauseMs:0,totalPauseMs:0,peakBytes:0};
  }
  withRoots(values,action){const start=this.pins.length;for(const value of values)this.pins.push(value);try{return action();}finally{this.pins.length=start;}}
  /** Explicit host roots. Weak handles never retain their target across collection. */
  createHandle(value,{weak=false}={}){if(isReference(value))this.get(value);else if(weak)throw new TypeError('Weak handles require a managed reference');const id=this.nextHandleId++;if(!Number.isSafeInteger(id))throw new RangeError('Handle identity exhausted');const handle=Object.freeze({id,owner:this.handleOwner});this.handles.set(id,{value,weak});this.stats[weak?'hostWeakHandles':'hostStrongHandles']++;return handle;}
  getHandle(handle){if(handle?.owner!==this.handleOwner)return null;const item=this.handles.get(handle?.id);if(!item)return null;const v=item.value;if(item.weak&&isReference(v)&&(this.generations[v.h]!==v.g||!this.records[v.h]))return null;return v;}
  releaseHandle(handle){if(handle?.owner!==this.handleOwner||!this.handles.has(handle.id))return false;const item=this.handles.get(handle.id);this.handles.delete(handle.id);this.stats[item.weak?'hostWeakHandles':'hostStrongHandles']--;return true;}
  reserve(bytes,roots=[]){
    if(bytes>this.maxBytes||bytes<0||!Number.isSafeInteger(bytes))throw new ManagedFault('OutOfMemoryException','The managed allocation exceeds the heap budget');
    if(this.stats.liveBytes+bytes>this.threshold)this.collect(roots);
    if(this.stats.liveBytes+bytes>this.maxBytes)throw new ManagedFault('OutOfMemoryException','Managed heap budget exhausted');
  }
  allocate(kind,type,data,roots=[]){return allocateHeapRecord(this,{kind,type,data,roots},ManagedFault);}
  ensureWritable(reference){return this.get(reference);}
  replaceData(reference,data){return replaceHeapData(this,reference,data);}
  string(value,roots=[]){return this.allocate('string','string',String(value),roots);}
  object(type,fields){return this.allocate('object',type,fields);}
  array(type,length){return allocateHeapArray(this,type,length,ManagedFault);}
  get(ref){
    if(ref===null||ref===undefined)throw new ManagedFault('NullReferenceException','Object reference not set to an instance of an object');
    if(!isReference(ref)||this.generations[ref.h]!==ref.g||!this.records[ref.h])throw new ManagedFault('InvalidReferenceException','Stale or invalid managed reference');
    return this.records[ref.h];
  }
  collect(extraRoots=[]){return collectHeap(this,extraRoots,isReference);}
  snapshot(options={}){return snapshotHeap(this,options);}
  restore(snapshot,options={}){return restoreHeap(this,snapshot,options);}
  get lastSnapshot(){return heapSnapshotStatistics(this);}
  census(){const counts=new Map();for(const record of this.records)if(record){const key=record.kind+':'+record.type;let item=counts.get(key);if(!item)counts.set(key,item={kind:record.kind,type:record.type,objects:0,bytes:0});item.objects++;item.bytes+=record.size;}return {stamp:this.stamp(),objects:this.stats.liveObjects,bytes:this.stats.liveBytes,types:[...counts.values()].sort((a,b)=>b.bytes-a.bytes||a.type.localeCompare(b.type))};}
  stamp(){return `${this.mutationRevision}:${this.generationCounter}:${this.stats.collections}:${this.stats.liveObjects}`;}
  inspectPage({afterHandle=-1,limit=200,kind=null,type=null,stamp=null}={}){if(!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(afterHandle)||afterHandle< -1)throw new RangeError('Invalid heap page request');if(stamp!==null&&stamp!==this.stamp())throw new Error('Heap changed; restart inspection from the first page');const items=[];let more=false;for(let h=afterHandle+1;h<this.records.length;h++){const r=this.records[h];if(!r||kind&&r.kind!==kind||type&&r.type!==type)continue;if(items.length===limit){more=true;break;}items.push(this.inspectRecord(h,r));}return {items,stamp:this.stamp(),next:more?items.at(-1).handle:null,totalLiveObjects:this.stats.liveObjects};}
  inspectRecord(h,r){return {handle:h,generation:this.generations[h],type:r.type,kind:r.kind,size:r.size,length:r.data.length,preview:r.kind==='string'?r.data.slice(0,120):`${r.data.length} ${r.kind==='array'?'elements':'fields'}`};}
  /** Breadth-first root path. Bounded diagnostic operation, never part of a collection. */
  retentionPath(reference,{maxObjects=20000,maxEdges=200000}={}){
    this.get(reference);if(!Number.isInteger(maxObjects)||maxObjects<1||maxObjects>1000000||!Number.isInteger(maxEdges)||maxEdges<1||maxEdges>10000000)throw new RangeError('Invalid retention-path budget');
    const queue=[],parents=new Map();let edges=0,truncated=false;
    const add=(value,parent,label)=>{if(!isReference(value)||this.generations[value.h]!==value.g||!this.records[value.h]||parents.has(value.h))return;if(parents.size>=maxObjects){truncated=true;return;}parents.set(value.h,{parent,label,reference:value});queue.push(value.h);};
    let root=0;for(const value of this.rootProvider()){add(value,null,`VM root ${root++}`);if(++edges>=maxEdges){truncated=true;break;}}for(let i=0;i<this.pins.length&&edges<maxEdges;i++,edges++)add(this.pins[i],null,`Temporary root ${i}`);for(const [id,handle]of this.handles){if(edges++>=maxEdges){truncated=true;break;}if(!handle.weak)add(handle.value,null,`Strong host handle ${id}`);}
    for(let i=0;i<queue.length&&!parents.has(reference.h);i++){const h=queue[i],record=this.records[h];if(record.kind==='string')continue;for(let j=0;j<record.data.length;j++){if(edges++>=maxEdges){truncated=true;break;}add(record.data[j],h,`${record.kind==='array'?'Element':'Field'} ${j}`);}if(edges>=maxEdges)break;}
    const path=[];if(parents.has(reference.h)){let h=reference.h;while(h!==null){const step=parents.get(h),record=this.records[h];path.push({reference:step.reference,label:step.label,type:record.type});h=step.parent;}path.reverse();}
    return {reachable:path.length>0,path,truncated,visited:parents.size,edgesScanned:edges,stamp:this.stamp()};
  }
  inspect(limit=200){if(!Number.isInteger(limit)||limit<0||limit>10000)throw new RangeError('Invalid heap inspection limit');const items=[];for(let h=0;h<this.records.length&&items.length<limit;h++){const r=this.records[h];if(r)items.push({handle:h,generation:this.generations[h],type:r.type,kind:r.kind,size:r.size,length:r.data.length,preview:r.kind==='string'?r.data.slice(0,120):`${r.data.length} ${r.kind==='array'?'elements':'fields'}`});}return items;}
}
