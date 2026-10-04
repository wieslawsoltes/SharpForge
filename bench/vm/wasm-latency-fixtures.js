import {qualificationAssembly} from './qualification-assembly.js';

/** Fixed native-arithmetic and managed-helper workloads; smaller loops are only for harness regression tests. */
export function wasmLatencyFixtures(iterations = 1024) {
  if (!Number.isInteger(iterations) || iterations < 32 || iterations > 1000000) {
    throw new RangeError('Wasm latency iterations must be 32–1000000');
  }
  return [false, true].map(boxing => ({
    id: boxing ? 'wasm-call-boxing' : 'wasm-call-arithmetic',
    iterations,
    expectedReturn: iterations,
    expectedOutput: '',
    expectedInstructions: (boxing ? 13 : 7) * iterations + 4,
    expectedManagedAllocations: boxing ? iterations : 0,
    assembly: qualificationAssembly({name: boxing ? 'WasmLatencyBoxing' : 'WasmLatencyArithmetic',
      locals: boxing ? ['int', 'object'] : ['int'], body(writer, context) {
        writer.op('ldc.i4.0').op('stloc.0').mark('loop');
        writer.op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0');
        if (boxing) {
          const integer = context.resolve('System.Int32');
          writer.op('ldloc.0').op('box', integer).op('stloc.1');
          writer.op('ldloc.1').op('unbox.any', integer).op('stloc.0');
        }
        writer.op('ldloc.0').integer(iterations).op('blt', 'loop');
        writer.op('ldloc.0').op('ret');
      }})
  }));
}
