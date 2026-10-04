import { buildControlFlowGraph, decompileMethod, readPE } from '@sharpforge/cil';
import { arithmeticLibrary, managedFixture } from '../../managed-fixtures.js';
import { exceptionFixture } from '../../support/exception-encoding.js';
import { cfgCases, cfgInput, graphTuples, expectedTuples } from './input.mjs';

const assert = (condition, message) => { if (!condition) throw Error(message); };
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), message);
const bytes = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const hex = value => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
const kinds = { 0: 'catch', 1: 'filter', 2: 'finally', 4: 'fault' };

function rejects(action, code) {
  try { action(); }
  catch (error) {
    assert(error.code === code, `Expected ${code}; received ${error.code}: ${error.message}`);
    return;
  }
  throw Error(`Missing rejection ${code}`);
}

async function fetchJSON(path) {
  const response = await fetch(path);
  assert(response.ok, `Reference fetch ${path}`);
  return response.json();
}

/** Browser JavaScript graph/pipeline qualification. .NET observations are replayed captured reference data. */
export async function run() {
  const report = { passed: false, checks: [] };
  try {
    for (const fixture of cfgCases) {
      const input = cfgInput(fixture);
      const graph = buildControlFlowGraph(input.code, input.handlers);
      equal(graphTuples(graph), expectedTuples(fixture), fixture.name);
      equal(graph, buildControlFlowGraph(input.code, input.handlers), `${fixture.name}: stable JSON`);
      assert(graph.instructionCount === graph.instructionBlocks.length, 'Total instruction ownership');
    }
    report.checks.push('Reviewed branch/switch/leave/terminal/prefix/exception CFG tuples and stable JSON');

    const input = cfgInput(cfgCases.find(value => value.name === 'Filter'));
    const graph = buildControlFlowGraph(input.code, input.handlers);
    const original = JSON.stringify(graph);
    rejects(() => buildControlFlowGraph(input.code, input.handlers, { maxCodeBytes: input.code.length - 1 }), 'CILCFG0002');
    rejects(() => buildControlFlowGraph(input.code, input.handlers, { maxClauses: 0 }), 'CILCFG0002');
    rejects(() => buildControlFlowGraph(input.code, [], { maxEdges: null }), 'CILCFG0001');
    rejects(() => buildControlFlowGraph(input.code, [], { signal: AbortSignal.abort() }), 'CILCFG0003');
    rejects(() => buildControlFlowGraph(Uint8Array.of(0x2b, 1, 0x2a)), 'CILCFG0005');
    rejects(() => buildControlFlowGraph(Uint8Array.of(0)), 'CILCFG0006');
    input.code.fill(0xff);
    input.handlers.length = 0;
    assert(JSON.stringify(graph) === original, 'Snapshot ownership after input destruction');
    assert(Object.isFrozen(graph.blocks[0]) && Object.isFrozen(graph.blocks[0].successors), 'Frozen graph records');
    report.checks.push('Input/target diagnostics, budgets, cancellation and owned immutable snapshots');

    const arithmetic = decompileMethod(arithmeticLibrary(), 0x06000001);
    assert(arithmetic.complete && arithmetic.language === 'csharp', 'Existing arithmetic reconstruction');
    assert(arithmetic.source.includes('unchecked((stack0 + stack1))'), 'Existing arithmetic spelling');
    assert(arithmetic.controlFlowGraph.instructionCount === 4, 'Pipeline graph');
    for (const fixture of cfgCases.filter(value => value.handlers)) {
      const image = managedFixture({ methods: [{ name: fixture.name, body: fixture.body, handlers(labels, context) {
        return fixture.handlers(labels).map(handler => handler.flags === 0
          ? { ...handler, catchType: context.resolve('System.Exception') } : handler);
      } }] });
      const result = decompileMethod(image, 0x06000001);
      assert(!result.complete && result.language === 'cil', 'Conservative EH source fallback');
      assert(result.source.includes('IL_0000:'), 'Complete fallback IL instructions');
      equal(graphTuples(result.controlFlowGraph), expectedTuples(fixture), 'CFG retained on source fallback');
    }
    report.checks.push('Existing C# reconstruction and full-IL exception fallbacks with accessible CFGs');

    const reference = await fetchJSON('/tests/fixtures/decompiler-cfg/native.json');
    const image = bytes(reference.image);
    assert(hex(await crypto.subtle.digest('SHA-256', image)) === reference.imageSha256, 'Native image hash');
    assert(reference.toolchain.runtime === '10.0.5', 'Pinned CoreCLR reference');
    equal([reference.native.filterResult, reference.native.finallyResult, reference.native.finalizers], [44, 4, 1],
      'Native finally/filter observations');
    const pe = readPE(image, { inspection: true });
    for (const method of reference.native.methods) {
      const body = pe.methodBody(method.token);
      equal(Array.from(body.code), Array.from(bytes(method.code)), 'CoreCLR IL bytes');
      const cfg = buildControlFlowGraph(body.code, body.handlers);
      equal(cfg.exceptionBoundaries, method.clauses.map((clause, index) => ({ clause: index, kind: kinds[clause.flags],
        tryStart: clause.start, tryEnd: clause.end, handlerStart: clause.target, handlerEnd: clause.handlerEnd,
        filterStart: clause.filterOffset })), 'CoreCLR EH boundaries');
    }
    const exceptionReference = await fetchJSON('/tests/fixtures/eh-encoding/native.json');
    for (const name of ['FilterFat', 'FaultFat']) {
      const observation = exceptionReference.cases.find(value => value.id === name);
      const fixture = exceptionFixture(observation.options);
      assert(hex(await crypto.subtle.digest('SHA-256', fixture.assembly)) === observation.sha256, 'Existing SRM/CoreCLR image hash');
      const cfg = buildControlFlowGraph(fixture.code, fixture.handlers);
      equal(cfg.exceptionBoundaries, observation.regions.map((region, clause) => ({ clause, kind: region.kind.toLowerCase(),
        tryStart: region.tryOffset, tryEnd: region.tryOffset + region.tryLength,
        handlerStart: region.handlerOffset, handlerEnd: region.handlerOffset + region.handlerLength,
        filterStart: region.filterOffset < 0 ? null : region.filterOffset })), 'Existing SRM filter/fault boundaries');
    }
    report.reference = { toolchain: reference.toolchain, imageSha256: reference.imageSha256 };
    report.checks.push('CoreCLR IL/finally/filter observations and independent retained SRM/CoreCLR fault reference');
    report.passed = true;
  } catch (error) { report.error = { name: error.name, code: error.code, message: error.message }; }
  return report;
}
