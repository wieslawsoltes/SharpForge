import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compileToIL } from '../../../packages/compiler/src/index.js';
import {
  VirtualMachine,
  CilVirtualMachine,
  ManagedHeap,
  ManagedFault,
} from '../../../packages/runtime/src/index.js';
import { SourceText } from '../../../packages/text/src/index.js';
import { parse, nestingBudget } from '../../../packages/syntax/src/index.js';
import { Workspace } from '../../../packages/workspace/src/index.js';
import { DebugSession } from '../../../packages/debugger/src/index.js';
import { run } from '../../../scripts/conformance/repro/common.js';

const defaults = {
  heap: 32 * 1024 * 1024,
  array: 1_000_000,
  frames: 512,
  instructions: 20_000_000,
  output: 1_000_000,
};
function compiled(source) {
  const result = compileToIL(source);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}
function execute(source, engine, options = {}) {
  const artifact = compiled(source);
  const vm =
    engine === 'source'
      ? new VirtualMachine(artifact.image, options)
      : new CilVirtualMachine(artifact.assembly, options);
  let peakRss = process.memoryUsage().rss;
  let peakFrames = vm.frames.length;
  try {
    assert.equal(vm.heap.maxBytes, options.maxBytes ?? defaults.heap);
    assert.equal(vm.options.maxFrames, options.maxFrames ?? defaults.frames);
    assert.equal(
      vm.options.maxInstructions,
      options.maxInstructions ?? defaults.instructions,
    );
    assert.equal(
      vm.options.maxOutputCharacters,
      options.maxOutputCharacters ?? defaults.output,
    );
    while (['ready', 'running'].includes(vm.state)) {
      vm.runSlice({ instructionBudget: options.observeFrames ? 1 : 100000, timeBudgetMs: 100 });
      peakFrames = Math.max(peakFrames, vm.frames.length);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    assert(
      peakRss <= 512 * 1024 * 1024,
      `Observed host RSS exceeded 512 MiB: ${peakRss}`,
    );
    const result = {
      state: vm.state,
      fault: vm.fault,
      output: vm.output.join(''),
      instructions: vm.instructions,
      outputCharacters: vm.outputCharacters,
      heapPeak: vm.heap.stats.peakBytes,
      peakRss,
      peakFrames,
    };
    assert(result.heapPeak <= vm.heap.maxBytes);
    return result;
  } finally {
    vm.stop();
  }
}
function fault(result, name) {
  assert.equal(result.state, 'faulted');
  assert(
    result.fault instanceof ManagedFault,
    'Expected an actual managed fault',
  );
  assert.equal(result.fault.name, name);
}
const cases = {
  heap(engine) {
    const source =
      'int[] a=new int[1000000];int[] b=new int[1000000];int[] c=new int[1000000];int[] d=new int[1000000];int[] e=new int[1000000];Console.WriteLine(a[0]+b[0]+c[0]+d[0]+e[0]);';
    const result = execute(source, engine);
    fault(result, 'OutOfMemoryException');
    assert.equal(result.output, '');
    return result;
  },
  array(engine) {
    const positive = execute(
      'int[] value=new int[1000000];Console.WriteLine(value.Length);',
      engine,
    );
    assert.equal(positive.state, 'terminated');
    assert.equal(positive.output, '1000000\n');
    const negative = execute(
      'int[] value=new int[1000001];Console.WriteLine(value.Length);',
      engine,
    );
    fault(negative, 'OutOfMemoryException');
    return negative;
  },
  frames(engine) {
    const source = (depth) =>
      `class P { static int F(int n){if(n==0)return 0;return F(n-1)+1;} static void Main(){Console.WriteLine(F(${depth}));} }`;
    // The emitted entry wrapper and Main add two frames before F(509)..F(0).
    const positive = execute(source(509), engine, { observeFrames: true });
    assert.equal(positive.state, 'terminated');
    assert.equal(positive.output, '509\n');
    assert.equal(positive.peakFrames, defaults.frames);
    const negative = execute(source(510), engine, { observeFrames: true });
    fault(negative, 'StackOverflowException');
    assert.equal(negative.peakFrames, defaults.frames);
    return negative;
  },
  instructions(engine) {
    const result = execute(
      'while(true){try{while(true){}}catch(Exception){Console.Write("caught");}}',
      engine,
    );
    fault(result, 'InstructionLimitException');
    assert.equal(result.instructions, defaults.instructions + 1);
    assert.equal(
      result.output,
      '',
      'Managed catch must not swallow the global instruction budget',
    );
    return result;
  },
  output(engine) {
    const chunk = 'x'.repeat(1000),
      source = (count) =>
        `string chunk="${chunk}";for(int i=0;i<${count};i++)Console.Write(chunk);`;
    const positive = execute(source(1000), engine);
    assert.equal(positive.state, 'terminated');
    assert.equal(positive.outputCharacters, defaults.output);
    const negative = execute(source(1001), engine);
    fault(negative, 'OutputLimitException');
    assert.equal(negative.outputCharacters, defaults.output);
    return { ...negative, output: '<one million verified characters>' };
  },
};

if (process.argv[2] === '--limit-case') {
  const name = process.argv[3],
    engine = process.argv[4];
  assert(Object.hasOwn(cases, name) && ['source', 'cil'].includes(engine));
  const result = cases[name](engine);
  console.log(
    JSON.stringify({
      case: name,
      engine,
      state: result.state,
      fault: result.fault.name,
      instructions: result.instructions,
      heapPeak: result.heapPeak,
      peakRss: result.peakRss,
    }),
  );
} else {
  // Each expensive default-boundary case has its own V8 memory ceiling and owned
  // process-tree watchdog. These do not claim an OS-wide memory sandbox.
  for (const engine of ['source', 'cil'])
    for (const name of Object.keys(cases)) {
      test(
        `limits ${engine}: documented ${name} default and fault`,
        { timeout: 100000 },
        async (t) => {
          const result = await run(
            process.execPath,
            [
              '--max-old-space-size=192',
              fileURLToPath(import.meta.url),
              '--limit-case',
              name,
              engine,
            ],
            { timeout: 90000 },
          );
          const report = JSON.parse(result.stdout);
          assert.equal(report.engine, engine);
          assert.equal(report.case, name);
          t.diagnostic(JSON.stringify(report));
        },
      );
    }
  test('limits heap: exact allocation boundary, one over, invalid length and rooted survival', () => {
    const heap = new ManagedHeap({ maxBytes: 256, initialThreshold: 256 });
    const value = heap.array('int', 28),
      handle = heap.createHandle(value);
    try {
      assert.equal(heap.stats.liveBytes, 256);
      assert.throws(
        () => heap.array('int', 29),
        (error) =>
          error instanceof ManagedFault &&
          error.name === 'OutOfMemoryException',
      );
      assert.throws(
        () => heap.string('x'),
        (error) =>
          error instanceof ManagedFault &&
          error.name === 'OutOfMemoryException',
      );
      assert.throws(
        () => heap.array('int', -1),
        (error) => error.name === 'OverflowException',
      );
      assert.throws(
        () => heap.array('int', 1.5),
        (error) => error.name === 'OverflowException',
      );
      assert.equal(heap.getHandle(handle), value);
    } finally {
      heap.releaseHandle(handle);
      heap.collect();
    }
    assert.equal(heap.stats.liveBytes, 0);
  });
  test('limits parser: nesting and diagnostics remain bounded', () => {
    assert.equal(nestingBudget, 200);
    const nested = (depth) =>
      'Console.WriteLine(' + '('.repeat(depth) + '1' + ')'.repeat(depth) + ');';
    const positive = parse(new SourceText(nested(16), 'positive.cs'));
    assert(!positive.diagnostics.some((row) => row.code === 'SF1099'));
    const source = nested(nestingBudget + 1),
      negative = parse(new SourceText(source, 'negative.cs'));
    assert(negative.diagnostics.some((row) => row.code === 'SF1099'));
    assert(negative.diagnostics.length <= 200);
    const malformed = parse(
      new SourceText('int ; '.repeat(1000), 'diagnostics.cs'),
    );
    assert(
      malformed.diagnostics.length > 0 && malformed.diagnostics.length <= 200,
    );
  });
  test('limits workspace: document count, snapshot length and token-cache defaults', () => {
    const workspace = new Workspace();
    assert.equal(workspace.maxDocuments, 100);
    assert.equal(workspace.maxDocumentLength, 2_000_000);
    assert.equal(workspace.tokenCache.limit, 32768);
    for (let index = 0; index < 100; index++)
      workspace.update(index + '.cs', '', 1);
    assert.throws(() => workspace.update('extra.cs', '', 1), /document limit/);
    workspace.update('0.cs', ' '.repeat(2_000_000), 2);
    assert.throws(
      () => workspace.update('0.cs', ' '.repeat(2_000_001), 3),
      /source size limit/,
    );
    for (let index = 0; index < 32769; index++)
      workspace.tokenCache.getOrAdd(String(index), () => index);
    assert.equal(workspace.tokenCache.map.size, 32768);
  });
  test('limits debugger: history count/bytes and watch node budget are bounded', () => {
    const session = new DebugSession(
      compiled('int answer=42;Console.WriteLine(answer);').image,
      { recordHistory: true },
    );
    try {
      assert.equal(session.maxHistory, 64);
      assert.equal(session.maxHistoryBytes, 8 * 1024 * 1024);
      for (let index = 0; index < 70; index++) session.remember(true);
      assert.equal(session.history.length, 64);
      assert(session.historyBytes <= session.maxHistoryBytes);
      const retained = session.vm.heap.createHandle(
        session.vm.heap.array('int', 400000),
      );
      try {
        const dropped = session.historyDropped;
        session.remember(true);
        assert.equal(
          session.historyDropped,
          dropped + 1,
          'Oversized snapshot must be omitted',
        );
        assert(session.historyBytes <= session.maxHistoryBytes);
      } finally {
        session.vm.heap.releaseHandle(retained);
      }

      // A balanced expression exceeds the watch visitor budget without first
      // exhausting parser depth; leaves are real parsed managed integer literals.
      let expression = '1';
      for (let depth = 0; depth < 10; depth++)
        expression = '(' + expression + '+' + expression + ')';
      assert.throws(
        () => session.evaluate(expression),
        /evaluation budget exceeded/,
      );
      assert.equal(session.evaluate('1+2').result, '3');
    } finally {
      session.vm.stop();
    }
  });
}
