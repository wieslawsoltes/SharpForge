import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, buildControlFlowGraph, controlFlowGraphDiagnosticCatalog, CilWriter,
  decompileMethod, decompileAssembly } from '@sharpforge/cil';
import { arithmeticLibrary, managedFixture } from './managed-fixtures.js';
import { cfgCases, cfgInput, graphTuples, expectedTuples } from './fixtures/decompiler-cfg/input.mjs';

const failure = (code, offset) => error => error.code === code && (offset === undefined || error.offset === offset);
const fixture = name => cfgCases.find(value => value.name === name);

test('A13 CFGs match reviewed stable JSON for all branch, switch, termination and EH boundary families', () => {
  for (const sample of cfgCases) {
    const { code, handlers } = cfgInput(sample);
    const graph = buildControlFlowGraph(code, handlers);
    assert.equal(JSON.stringify(graphTuples(graph)), JSON.stringify(expectedTuples(sample)), sample.name);
    assert.equal(JSON.stringify(graph), JSON.stringify(buildControlFlowGraph(code, handlers)), sample.name);
    assert.equal(graph.format, 'sharpforge.control-flow-graph');
    assert.equal(graph.version, 1);
    assert.equal(graph.flow, 'normal');
    assert.equal(graph.codeSize, code.length);
    assert.equal(graph.entryBlock, graph.blocks.length ? 0 : null);
    assert.equal(graph.instructionCount, graph.instructionBlocks.length);
    const covered = new Set();
    for (const block of graph.blocks) {
      for (let index = block.firstInstruction; index < block.firstInstruction + block.instructionCount; index++) {
        assert.equal(covered.has(index), false, `${sample.name}: repeated instruction ${index}`);
        covered.add(index);
        assert.equal(graph.instructionBlocks[index], block.id);
      }
      for (const edge of block.successors) assert.equal(graph.edges[edge].source, block.id);
      for (const edge of block.predecessors) assert.equal(graph.edges[edge].target, block.id);
    }
    assert.equal(covered.size, graph.instructionCount, sample.name);
  }
});

test('A13 switch duplicate targets retain separate case edges and leave records an eventual stack-clearing target', () => {
  const switching = cfgInput(fixture('Switch'));
  const graph = buildControlFlowGraph(switching.code);
  assert.deepEqual(graph.blocks[2].predecessors, [0, 1]);
  const code = new CilWriter().op('ldc.i4.1').op('leave.s', 'done').op('nop').mark('done').op('ret').finish();
  const leaving = buildControlFlowGraph(code);
  assert.deepEqual(leaving.edges[0], { id: 0, source: 0, target: 2, kind: 'leave', caseIndex: null, clearsStack: true });
  const nested = cfgInput(fixture('NestedFinally'));
  const handlers = buildControlFlowGraph(nested.code, nested.handlers);
  assert.equal(handlers.edges.some(edge => edge.target === 1 || edge.target === 3), false,
    'normal leave edges do not invent finally-dispatch edges');
});

test('A13 CFG limits allow exact extents and reject before expanding oversized clause input', () => {
  const { code, handlers } = cfgInput(fixture('Switch'));
  const graph = buildControlFlowGraph(code, handlers);
  const exact = { maxCodeBytes: code.length, maxInstructions: graph.instructionCount, maxEdges: graph.edges.length, maxClauses: 0 };
  assert.deepEqual(buildControlFlowGraph(code, handlers, exact), graph);
  for (const key of ['maxCodeBytes', 'maxInstructions', 'maxEdges']) {
    assert.throws(() => buildControlFlowGraph(code, handlers, { ...exact, [key]: exact[key] - 1 }), failure('CILCFG0002'), key);
  }
  const nested = cfgInput(fixture('NestedFinally'));
  assert.equal(buildControlFlowGraph(nested.code, nested.handlers, { maxClauses: 2, maxRegionDepth: 2 }).exceptionBoundaries.length, 2);
  assert.throws(() => buildControlFlowGraph(nested.code, nested.handlers, { maxClauses: 1 }), failure('CILCFG0002'));
  assert.throws(() => buildControlFlowGraph(nested.code, nested.handlers, { maxRegionDepth: 1 }), failure('CILR0028'));
  const excessive = new Array(2);
  Object.defineProperty(excessive, 0, { get() { assert.fail('Oversized clause input was traversed'); } });
  assert.throws(() => buildControlFlowGraph(code, excessive, { maxClauses: 1 }), failure('CILCFG0002'));
  assert.equal(buildControlFlowGraph(new Uint8Array(), [], {
    maxCodeBytes: 0, maxInstructions: 0, maxEdges: 0, maxClauses: 0, maxRegionDepth: 0,
  }).blocks.length, 0);
});

test('A13 invalid CFG options, encoded instructions, prefix targets and terminal fallthrough have stable diagnostics', () => {
  const valid = Uint8Array.of(0x2a);
  for (const options of [null, [], { maxEdges: -1 }, { maxEdges: null }, { maxInstructions: Infinity },
    { maxCodeBytes: 16_777_217 }, { signal: true }]) {
    assert.throws(() => buildControlFlowGraph(valid, [], options), failure('CILCFG0001'));
  }
  for (const code of [[], null, new DataView(new ArrayBuffer(1))]) {
    assert.throws(() => buildControlFlowGraph(code), failure('CILCFG0001'));
  }
  assert.throws(() => buildControlFlowGraph(Uint8Array.of(0xff)), failure('CILCFG0004', 0));
  assert.throws(() => buildControlFlowGraph(Uint8Array.of(0xfe)), failure('CILCFG0004', 1));
  assert.throws(() => buildControlFlowGraph(Uint8Array.of(0x2b, 1, 0x2a)), failure('CILCFG0005', 0));
  const operandTarget = new CilWriter().op('ldc.i4', 1).op('br.s', -6).op('ret').finish();
  assert.throws(() => buildControlFlowGraph(operandTarget), failure('CILCFG0005', 5));
  const prefixTarget = new CilWriter().op('br.s', 'target').op('volatile.').mark('target').op('ldind.i4').op('ret').finish();
  assert.throws(() => buildControlFlowGraph(prefixTarget), failure('CILCFG0005', 0));
  assert.throws(() => buildControlFlowGraph(new CilWriter().op('volatile.').finish()), failure('CILR0030'));
  assert.throws(() => buildControlFlowGraph(Uint8Array.of(0)), failure('CILCFG0006', 0));
  assert.equal(Object.keys(controlFlowGraphDiagnosticCatalog).length, 6);
});

test('A13 malformed EH geometry and prefix-splitting boundaries reuse existing region diagnostics', () => {
  const code = new CilWriter().op('ldc.i4', 7).op('pop').op('ret').finish();
  const clause = { start: 1, end: 5, target: 5, handlerEnd: 6, catchType: 0x01000001 };
  assert.throws(() => buildControlFlowGraph(code, [clause]), failure('CILR0016'));
  const input = cfgInput(fixture('Filter'));
  assert.throws(() => buildControlFlowGraph(input.code, [{ ...input.handlers[0], catchType: 6 }]), failure('CILR0012'));
  assert.throws(() => buildControlFlowGraph(input.code, [{ ...input.handlers[0], filterOffset: 3 }]), failure('CILR0013'));
  const owned = buildControlFlowGraph(input.code, input.handlers.map(({ catchType, ...handler }) => ({ ...handler, filterOffset: catchType })));
  assert.equal(owned.exceptionBoundaries[0].filterStart, 2);
});

test('A13 graph ownership survives input destruction and cancellation is checked before and during graph work', () => {
  const { code, handlers } = cfgInput(fixture('Filter'));
  const graph = buildControlFlowGraph(code, handlers);
  const json = JSON.stringify(graph);
  code.fill(0xff);
  handlers[0].target = 0;
  handlers.length = 0;
  assert.equal(JSON.stringify(graph), json);
  assert.ok(Object.isFrozen(graph) && Object.isFrozen(graph.blocks) && Object.isFrozen(graph.edges[0]));
  assert.ok(Object.isFrozen(graph.blocks[0].successors) && Object.isFrozen(graph.exceptionBoundaries[0]));
  assert.throws(() => { graph.blocks[0].startOffset = 10; }, TypeError);
  assert.throws(() => buildControlFlowGraph(code, [], { signal: AbortSignal.abort() }), failure('CILCFG0003'));
  let checks = 0;
  assert.throws(() => buildControlFlowGraph(new Uint8Array(256).fill(0x2a), [], {
    signal: { get aborted() { return ++checks > 30; } },
  }), failure('CILCFG0003'));
});

test('A13 the pipeline preserves the existing arithmetic source and adds an owned CFG without rereading a cached method', () => {
  const inspector = new AssemblyInspector(arithmeticLibrary());
  inspector.getMethod(0x06000001);
  inspector.pe.methodBody = () => assert.fail('Cached decompilation reread the body');
  const result = decompileMethod(inspector, 0x06000001);
  assert.equal(result.language, 'csharp');
  assert.equal(result.complete, true);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.source, [
    '// Reconstructed from 0x06000001 IL; original names/source formatting are not recovered.',
    'public static int Add(int arg0, int arg1)', '{', '    int stack0 = arg0;', '    int stack1 = arg1;',
    '    int stack2 = unchecked((stack0 + stack1));', '    return stack2;', '}', '',
  ].join('\n'));
  assert.equal(result.controlFlowGraph.blocks.length, 1);
  assert.equal(result.controlFlowGraph.instructionCount, 4);
  inspector.pe.bytes.fill(0);
  inspector.cache.clear();
  assert.equal(result.controlFlowGraph.blocks[0].endOffset, 4);
});

test('A13 legacy lowering keeps mutable-load captures, numeric literal spelling and member call/field handlers', () => {
  const mutable = managedFixture({ methods: [{ name: 'Main', result: 'int', locals: ['int'], body(writer) {
    writer.op('ldc.i4.1').op('stloc.0').op('ldloc.0').op('ldc.i4.2').op('stloc.0').op('ret');
  } }] });
  assert.match(decompileMethod(mutable, 0x06000001).source, /int stack0 = v0;\n    v0 = 2;\n    return stack0;/);
  for (const [opcode, operand, result, text] of [['ldc.i8', 9223372036854775807n, 'long', '9223372036854775807L'],
    ['ldc.r4', -0, 'float', '-0f'], ['ldc.r8', Infinity, 'double', 'double.PositiveInfinity']]) {
    const bytes = managedFixture({ methods: [{ name: 'Main', result, body: writer => writer.op(opcode, operand).op('ret') }] });
    const source = decompileMethod(bytes, 0x06000001);
    assert.equal(source.complete, true);
    assert.ok(source.source.includes(`return ${text};`));
  }
  const members = managedFixture({ fields: [{ name: 'Value', type: 'int' }], methods: [
    { name: 'ValueMethod', result: 'int', body: writer => writer.op('ldc.i4.1').op('ret') },
    { name: 'Main', result: 'int', body(writer, context) {
      writer.op('call', context.methods.ValueMethod).op('stsfld', context.fields.Value).op('ldsfld', context.fields.Value).op('ret');
    } },
  ] });
  const call = decompileMethod(members, 0x06000002);
  assert.equal(call.complete, true);
  assert.match(call.source, /int stack0 = Fixture.Program.ValueMethod\(\);/);
  assert.match(call.source, /Fixture.Program.Value = stack0;/);
  assert.match(call.source, /int stack1 = Fixture.Program.Value;/);
});

test('A13 exception and SSA source fallbacks retain complete IL plus the independently usable normal CFG', () => {
  for (const sample of cfgCases.filter(value => value.handlers)) {
    const bytes = managedFixture({ methods: [{ name: sample.name, body: sample.body, handlers(labels, context) {
      return sample.handlers(labels).map(handler => handler.flags === 0
        ? { ...handler, catchType: context.resolve('System.Exception') } : handler);
    } }] });
    const result = decompileMethod(bytes, 0x06000001);
    assert.equal(result.language, 'cil', sample.name);
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[0].code, 'DECOMPILER_FALLBACK');
    assert.match(result.source, /IL_0000:/);
    assert.deepEqual(graphTuples(result.controlFlowGraph), expectedTuples(sample));
  }
  const sample = fixture('Diamond');
  const bytes = managedFixture({ methods: [{ name: sample.name, body: sample.body }] });
  const result = decompileMethod(bytes, 0x06000001);
  assert.equal(result.complete, false);
  assert.match(result.diagnostics[0].message, /SSA/);
  assert.deepEqual(graphTuples(result.controlFlowGraph), expectedTuples(sample));
});

test('A13 bodyless methods, graph failures and pipeline interruption remain explicit', () => {
  const bodyless = managedFixture({ methods: [{ name: 'Abstract', noBody: true, flags: 0x5c6, static: false }] });
  const result = decompileMethod(bodyless, 0x06000001);
  assert.equal(result.diagnostics[0].code, 'NO_IL_BODY');
  assert.equal(result.controlFlowGraph, null);
  const invalid = managedFixture({ methods: [{ name: 'Fallthrough', body: writer => writer.op('nop') }] });
  const diagnostic = decompileMethod(invalid, 0x06000001).diagnostics[0];
  assert.equal(diagnostic.code, 'CILCFG0006');
  assert.equal(diagnostic.offset, 0);
  assert.equal(diagnostic.severity, 'error');
  const bytes = arithmeticLibrary();
  assert.throws(() => decompileMethod(bytes, 0x06000001, { maxInstructions: 3 }), failure('CILCFG0002'));
  assert.throws(() => decompileAssembly(bytes, { signal: AbortSignal.abort() }), failure('CILCFG0003'));
  const all = decompileAssembly(bytes);
  assert.equal(all.total, 3);
  assert.equal(all.reconstructed, 3);
  assert.ok(all.methods.every(method => method.controlFlowGraph));
});
