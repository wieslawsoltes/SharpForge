// Run after E01 assembly: node examples/runtime/portable-snapshot.mjs
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const artifact = compileToIL('int[] values=new int[2];values[0]=40;Console.WriteLine("saved");values[1]=2;Console.WriteLine(values[0]+values[1]);');
if (!artifact.success) throw new Error(JSON.stringify(artifact.diagnostics));
function create(engine) {
  return engine === 'cil' ? new CilVirtualMachine(artifact.assembly)
    : new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly));
}
for (const engine of ['source', 'reloaded-source', 'cil']) {
  const original = create(engine);
  while (original.output.join('') !== 'saved\n') {
    original.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    if (!['ready', 'running'].includes(original.state)) throw original.fault ?? new Error('Capture boundary was not reached');
  }
  const transferred = await serializeSnapshot(original, original.snapshot(), {json: true});
  original.stop();
  original.heap.collect();
  const fresh = create(engine);
  await restoreSerializedSnapshot(fresh, transferred);
  fresh.heap.collect();
  const result = fresh.run();
  if (result.state !== 'terminated' || result.output !== 'saved\n42\n') throw result.fault ?? new Error('Portable replay diverged');
  console.log(engine + ': ' + result.output.replaceAll('\n', ' ').trim());
}
