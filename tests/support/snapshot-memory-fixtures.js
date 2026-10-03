import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly} from '@sharpforge/cil';
import {controlFixture} from './control-fixture.js';

export const spanProgram = `
Span<int> values = stackalloc int[4] {10,20,30,40};
Span<int> tail = values.Slice(1,2);
ReadOnlySpan<int> view = values;
Span<int> empty = default(Span<int>);
Console.WriteLine("capture");
tail[1] = 77;
Console.WriteLine(view[2]);
Console.WriteLine(values[1]);
Console.WriteLine(empty.Length);
`;

export function compiledMemory(source = spanProgram) {
  const result = compileToIL(source);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}

export function memoryMachine(engine, artifact, options = {}) {
  if (engine === 'cil') return new CilVirtualMachine(artifact.assembly, options);
  return new VirtualMachine(engine === 'reload' ? loadAssembly(artifact.assembly) : artifact.image, options);
}

export function captureBoundary(vm) {
  for (let step = 0; step < 2000; step++) {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    if (vm.output.join('') === 'capture\n') return vm.snapshot();
    assert(['ready', 'running'].includes(vm.state), vm.fault?.stack ?? 'Program ended before capture');
  }
  assert.fail('Program did not reach its capture marker');
}

export function memoryValues(vm, predicate) {
  return vm.frames.flatMap(frame => [...frame.locals, ...(frame.args ?? []), ...(frame.stack ?? [])])
    .concat(vm.stack ?? []).filter(predicate);
}

/** Independent IL keeps a lexical array pin and native pointer live at capture. */
export function pinnedMemoryAssembly() {
  return controlFixture([{name: 'Program', methods: [{
    name: 'Main',
    localBytes: Uint8Array.from([7, 2, 0x45, 0x1d, 8, 0x0f, 8]),
    body(writer, context) {
      const integer = context.resolve('System.Int32');
      const text = context.member('System.Console', 'WriteLine', 'void', ['string']);
      const number = context.member('System.Console', 'WriteLine', 'void', ['int']);
      writer.op('ldc.i4.2').op('newarr', integer).op('stloc.0');
      writer.op('ldloc.0').op('ldc.i4.0').op('ldelema', integer).op('conv.u').op('stloc.1');
      writer.op('ldstr', 0x70000000 + context.md.userString('capture')).op('call', text);
      writer.op('ldloc.1').op('ldc.i4.4').op('add').op('ldc.i4.7').op('stind.i4');
      writer.op('ldloc.0').op('ldc.i4.1').op('ldelem.i4').op('call', number);
      writer.op('ldnull').op('stloc.0').op('ret');
    }
  }]}]);
}
