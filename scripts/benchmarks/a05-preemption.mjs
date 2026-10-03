// Execute after E01 assembly. Records actual latency; never substitutes estimates.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {sortingVM,loopVM} from '../../tests/a05-31-fixtures.js';

const budget=8,length=1_000_000,results=[];
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)];
for(const engine of ['source','cil'])for(const operation of ['Sort','Reverse'])for(const phase of ['cold','warm']) {
  const {vm,data}=sortingVM(engine,length,{operation}),durations=[];
  const heapBefore=process.memoryUsage().heapUsed,allocations=vm.heap.stats.allocations,instructions=vm.instructions,start=performance.now();
  while(['ready','running'].includes(vm.state)) {
    const sliceStart=performance.now();vm.runSlice({instructionBudget:15000,timeBudgetMs:budget});durations.push(performance.now()-sliceStart);
  }
  assert.equal(vm.state,'terminated',vm.fault?.stack);assert.ok(data.every((value,index)=>value===index+1));
  results.push({engine,operation,phase,length,timeBudgetMs:budget,instructionBudget:15000,slices:durations.length,
    firstSliceMs:durations[0],medianMs:percentile(durations,.5),p95Ms:percentile(durations,.95),p99Ms:percentile(durations,.99),maxMs:Math.max(...durations),
    totalMs:performance.now()-start,workInstructions:vm.instructions-instructions,managedAllocations:vm.heap.stats.allocations-allocations,
    observedHostHeapDeltaBytes:process.memoryUsage().heapUsed-heapBefore,withinTwoTimesBudget:durations.every(ms=>ms<=budget*2),durationsMs:durations});
}
for(const engine of ['source','cil']) {
  const vm=loopVM(engine,{maxInstructions:100_000_000}),durations=[];
  for(let i=0;i<100;i++){const start=performance.now();vm.runSlice({instructionBudget:1_000_000,timeBudgetMs:budget});durations.push(performance.now()-start);}
  vm.stop();results.push({engine,operation:'instruction-loop',phase:'warm',timeBudgetMs:budget,slices:durations.length,
    medianMs:percentile(durations,.5),p95Ms:percentile(durations,.95),p99Ms:percentile(durations,.99),maxMs:Math.max(...durations),withinTwoTimesBudget:durations.every(ms=>ms<=budget*2),durationsMs:durations});
}
const evidence={date:new Date().toISOString(),node:process.version,platform:process.platform,architecture:process.arch,command:process.argv,results,
  unsupported:['Tiered execution: E02 T11 is not implemented','Native/browser qualification requires its own platform run'],
  notes:['Input allocation and population precede timed slices','Observed host heap delta is not an exact JavaScript allocation count','Any measured slice exceeding 2x the requested budget fails this gate']};
const text=JSON.stringify(evidence,null,2)+'\n',at=process.argv.indexOf('--output');
if(at>=0){if(!process.argv[at+1])throw new Error('--output needs a filename');const path=resolve(process.argv[at+1]);await mkdir(dirname(path),{recursive:true});await writeFile(path,text);}
process.stdout.write(text);
if(results.some(result=>!result.withinTwoTimesBudget))process.exitCode=1;
