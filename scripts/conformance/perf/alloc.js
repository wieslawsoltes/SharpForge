/** Managed counters belong to SharpForge's managed heap. Node deltas are retained heap, never total/native allocations. */
export function beginAllocation(vm){return {heapUsed:process.memoryUsage().heapUsed,stats:vm?{...vm.heap.stats}:null};}
export function finishAllocation(before,vm,operations=1){
 if(!Number.isSafeInteger(operations)||operations<1)throw new Error('Positive operation count required');
 const nodeHeapDeltaBytes=process.memoryUsage().heapUsed-before.heapUsed;
 if(!vm)return {nodeHeapDeltaBytes,managed:null,nativeAllocations:{status:'unsupported',reason:'No native allocator instrumentation'}};
 const stats=vm.heap.stats,delta=key=>stats[key]-before.stats[key];
 return {nodeHeapDeltaBytes,managed:{operations,allocations:delta('allocations'),allocatedBytes:delta('allocatedBytes'),allocationsPerOperation:delta('allocations')/operations,bytesPerOperation:delta('allocatedBytes')/operations,collections:delta('collections'),totalPauseMs:delta('totalPauseMs'),maxPauseMs:stats.maxPauseMs},nativeAllocations:{status:'unsupported',reason:'Managed heap accounting is not native allocator instrumentation'}};
}

export function allocationSummary(records,tolerance=.05){
 if(!Array.isArray(records)||!records.length||!Number.isFinite(tolerance)||tolerance<0)throw new Error('Invalid allocation stability inputs');
 const rows=records.map(x=>x?.managed);if(rows.some(x=>!x))return {status:'unsupported',reason:'No managed VM counters for this adapter'};
 const range=key=>{const values=rows.map(x=>x[key]);if(values.some(x=>!Number.isFinite(x)||x<0))throw new Error('Invalid managed counter');const min=Math.min(...values),max=Math.max(...values);return {min,max,relativeSpread:min===0?(max===0?0:null):(max-min)/min};};
 const allocations=range('allocationsPerOperation'),bytes=range('bytesPerOperation'),pauses=range('maxPauseMs');
 const collectionCounts=rows.map(x=>x.collections);
 if(collectionCounts.some(x=>!Number.isSafeInteger(x)||x<0))throw new Error('Invalid managed collection count');
 return {status:'measured',stable:[allocations,bytes,pauses].every(x=>x.relativeSpread!==null&&x.relativeSpread<=tolerance),tolerance,allocationsPerOperation:allocations,bytesPerOperation:bytes,maxPauseMs:pauses.max,maxPauseMsRange:pauses,collectionCounts};
}
