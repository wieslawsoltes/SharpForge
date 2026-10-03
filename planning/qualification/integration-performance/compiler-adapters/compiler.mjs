import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

function generated(files, statements) {
  const units = Array.from({length: files}, (_, index) => ({
    uri: `Generated${index}.cs`,
    text: `class Generated${index}\n{\n public static int Calculate(int input)\n {\n  int value=input;\n`
      + Array.from({length: statements}, (_, statement) => `  value += ${statement % 97};`).join('\n')
      + '\n  return value;\n }\n}\n',
  }));
  units.push({uri: 'Program.cs', text: 'Console.WriteLine(Generated0.Calculate(1));\n'});
  return units;
}

/** Existing benchmark.js generated workloads; VM assertion is outside timed compilation. */
export async function create({root, adapter}) {
  const load = name => import(pathToFileURL(join(root, 'packages', name, 'src/index.js')));
  const [{compile}, {Workspace}, {VirtualMachine}] = await Promise.all([
    load('compiler'), load('workspace'), load('runtime'),
  ]);
  const statements = adapter.id.includes('1k') ? 90 : 390;
  const files = generated(statements === 90 ? 10 : 25, statements);
  const expectedSum = Array.from({length: statements}, (_, index) => index % 97).reduce((sum, item) => sum + item, 0);
  const editing = adapter.id.includes('edit');
  const workspace = editing ? new Workspace() : null;
  if (workspace) {
    for (const file of files) workspace.update(file.uri, file.text, 1);
    assert.equal(workspace.compile().success, true);
  }
  let version = 1;
  return async () => {
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    let input = 1;
    if (workspace) {
      input = ++version;
      workspace.update('Program.cs', `Console.WriteLine(Generated0.Calculate(${input}));\n`, version);
    }
    const result = workspace ? workspace.compile() : compile(files);
    const elapsed = performance.now() - start;
    const heapDelta = process.memoryUsage().heapUsed - before;
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    if (workspace) assert.equal(result.metrics.parsedThisCompilation, 1);
    const machine = new VirtualMachine(result.image, {maxInstructions: 500000});
    try {
      const executed = machine.run();
      assert.equal(executed.state, 'terminated');
      assert.equal(executed.output, String(expectedSum + input) + '\n');
    } finally {
      machine.stop();
    }
    return {
      ms: elapsed,
      checksum: 'verified-generated-sum:' + expectedSum,
      metrics: {
        nodeHeapDeltaBytes: heapDelta,
        memoryScope: 'Retained JS heap delta around compilation; not native or total allocations',
        timingScope: editing ? 'One-file update plus parse/bind/emit; VM assertion excluded' : 'Full parse/bind/emit; VM assertion excluded',
        fileCount: files.length,
        sourceLines: files.reduce((total, file) => total + file.text.split('\n').length - 1, 0),
      },
    };
  };
}
