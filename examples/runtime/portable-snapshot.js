import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const artifact = compileToIL('int total=0;for(int n=1;n<=10;n++){total=total+n;}Console.WriteLine(total);');
if (!artifact.success) throw new Error(JSON.stringify(artifact.diagnostics));
for (const engine of ['source', 'cil']) {
  const create = () => engine === 'source' ? new VirtualMachine(artifact.image) : new CilVirtualMachine(artifact.assembly);
  const original = create();
  original.runSlice({instructionBudget: 15, timeBudgetMs: 1000});
  const json = await serializeSnapshot(original, original.snapshot(), {json: true});
  const resumed = create();
  await restoreSerializedSnapshot(resumed, json);
  const expected = original.run(), actual = resumed.run();
  if (actual.output !== expected.output || actual.state !== expected.state) throw new Error(engine + ' replay diverged');
  console.log(JSON.stringify({engine, output: actual.output, bytes: new TextEncoder().encode(json).length,
    ownerRebound: resumed.snapshotOwner !== original.snapshotOwner}));
}
