// Correctness precedes measurement. Run only after the complete E01 gate is open.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {CilVirtualMachine} from '../packages/runtime/src/cil-vm.js';
import {controlFixture} from '../tests/support/control-fixture.js';
const iterations=Number(process.env.A05_BENCH_ITERATIONS??100);
assert(Number.isInteger(iterations)&&iterations>=10&&iterations<=10000);
const fixtures={
  call:controlFixture([{name:'Program',methods:[{name:'Main',result:'int',body:(w,c)=>w.op('ldc.i4',41).op('call',c.methods.get('Program.Inc')).op('ret')},{name:'Inc',parameters:['int'],result:'int',body:w=>w.op('ldarg.0').op('ldc.i4.1').op('add').op('ret')}]}]),
  tail:controlFixture([{name:'Program',methods:[{name:'Main',result:'int',body:(w,c)=>w.op('ldc.i4',42).op('ldc.i4.0').op('call',c.methods.get('Program.Count')).op('ret')},{name:'Count',parameters:['int','int'],result:'int',body:(w,c)=>w.op('ldarg.0').op('brfalse','end').op('ldarg.0').op('ldc.i4.1').op('sub').op('ldarg.1').op('ldc.i4.1').op('add').op('tail.').op('call',c.methods.get('Program.Count')).op('ret').label('end').op('ldarg.1').op('ret')}]}]),
  exception:controlFixture([{name:'Program',methods:[{name:'Main',result:'int',body:w=>w.label('try').op('ldc.i4.1').op('ldc.i4.0').op('div').op('pop').op('leave','end').label('tryEnd').label('catch').op('pop').op('leave','end').label('catchEnd').label('end').op('ldc.i4',42).op('ret'),handlers:(labels,c)=>[{flags:0,start:labels.get('try'),end:labels.get('tryEnd'),target:labels.get('catch'),handlerEnd:labels.get('catchEnd'),catchType:c.resolve('System.Exception')}]}]})
};
const summarize=samples=>{const values=samples.toSorted((a,b)=>a-b),at=p=>values[Math.min(values.length-1,Math.ceil(values.length*p)-1)];return {mean:values.reduce((a,b)=>a+b,0)/values.length,p50:at(.5),p95:at(.95),p99:at(.99)};};
const cases=[];
for(const [name,bytes] of Object.entries(fixtures))for(const mode of ['cold','warm']) {
  const shared=mode==='warm'?new CilVirtualMachine(bytes):null,snapshot=shared?.snapshot(),latencies=[],allocations=[],allocatedBytes=[];
  for(let iteration=0;iteration<iterations;iteration++) {
    const started=performance.now(),vm=shared??new CilVirtualMachine(bytes);if(shared)vm.restore(snapshot);
    const before={...vm.heap.stats},result=vm.run();const elapsed=performance.now()-started;
    assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,42);
    latencies.push(elapsed);allocations.push(vm.heap.stats.allocations-before.allocations);allocatedBytes.push(vm.heap.stats.allocatedBytes-before.allocatedBytes);
  }
  cases.push({name,mode,milliseconds:summarize(latencies),allocations:summarize(allocations),allocatedBytes:summarize(allocatedBytes)});
}
const report={task:'SF-A05-E01-T02-T04',revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,platform:process.platform,architecture:process.arch,iterations,cases};
const output=JSON.stringify(report,null,2)+'\n';if(process.argv[2])writeFileSync(process.argv[2],output);else process.stdout.write(output);
