import { AssemblyInspector, AssemblyUsageAnalysis, CilError } from '@sharpforge/cil';
import { usageFixture } from './input.mjs';
const assert = (value, message) => { if (!value) throw Error(message); };
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
function rejects(action, pattern) {
  try { action(); } catch (error) {
    assert(error instanceof CilError && pattern.test(error.message), 'Unexpected error: ' + error.message);
    return;
  }
  throw Error('Missing rejection: ' + pattern);
}
export async function run() {
  const report = { passed: false, checks: [] };
  try {
    const input = usageFixture(), inspector = new AssemblyInspector(input.bytes);
    const graph = new AssemblyUsageAnalysis(inspector), t = input.tokens;
    const original = graph.query('uses', t.run);
    assert(original.total === 9, 'Use count');
    assert(graph.query('used-by', t.read).total === 2 && graph.query('used-by', t.readRef).total === 1, 'Canonical/raw aliases');
    assert(graph.query('assigned-by', t.value).entries[0].opcode === 'stfld', 'Instance field assignment');
    assert(graph.query('assigned-by', t.shared).entries[0].opcode === 'stsfld', 'Static field assignment');
    assert(graph.query('instantiated-by', t.type).total === 1, 'Constructor vs array element');
    const unknown = graph.query('uses', t.external).entries[0];
    assert(unknown.status === 'unknown' && unknown.targetToken === t.externalRef, 'External identity retained');
    assert(inspector.cache.size === 0, 'No decorated body cache');
    report.checks.push('Four expected relation sets, canonical/raw aliases and explicit external binding');
    rejects(() => new AssemblyUsageAnalysis(inspector, { maxCodeBytes: 0 }), /code bytes/);
    rejects(() => new AssemblyUsageAnalysis(inspector, { maxUsages: graph.storage.usages - 1 }), /occurrences/);
    rejects(() => graph.query('uses', t.run, { limit: 1001 }), /page/);
    rejects(() => graph.query('uses', t.run, { signal: AbortSignal.abort() }), /cancelled/);
    rejects(() => graph.query('uses', 0x106000003), /metadata token/);
    rejects(() => graph.query('overridden-by', t.read), /unsupported relation/);
    assert(graph.query('uses', t.run, { limit: 0 }).nextOffset === null, 'Zero page');
    const page = graph.query('uses', t.run, { offset: 1, limit: 2 });
    assert(page.entries.length === 2 && page.total === 9 && page.nextOffset === 3, 'Page');
    page.entries[0].targetToken = 0;
    inspector.pe.bytes.fill(0); inspector.metadata.rows.length = 0;
    assert(JSON.stringify(graph.query('uses', t.run)) === JSON.stringify(original), 'Owned records');
    report.checks.push('Budgets, paging, cancellation, malformed token and owned input/output state');
    const reference = await (await fetch('/tests/fixtures/usage-relations/native.json')).json();
    const bytes = Uint8Array.from(atob(reference.image), character => character.charCodeAt(0));
    assert(hex(await crypto.subtle.digest('SHA-256', bytes)) === reference.imageSha256, 'Native image hash');
    const native = new AssemblyUsageAnalysis(new AssemblyInspector(bytes));
    for (const method of reference.native.methods) {
      const actual = native.query('uses', method.token).entries.map(edge => [edge.offset, edge.opcode, edge.operandToken]);
      const expected = method.uses.map(edge => [edge.offset, edge.opcode, edge.operand]);
      assert(JSON.stringify(actual) === JSON.stringify(expected), 'Native operand sites');
      for (const edge of method.uses) {
        const target = edge.local ? edge.definition : edge.operand;
        const contains = relation => native.query(relation, target).entries.some(item => item.sourceToken === method.token && item.offset === edge.offset);
        assert(contains('used-by'), 'Native reverse use');
        if (edge.assigned) assert(contains('assigned-by'), 'Native direct assignment');
        if (edge.instantiatedType && edge.local) assert(native.query('instantiated-by', edge.instantiatedType).entries
          .some(item => item.sourceToken === method.token && item.offset === edge.offset), 'Native constructor');
      }
    }
    report.reference = { toolchain: reference.toolchain, imageSha256: reference.imageSha256 };
    report.checks.push('Independent native reflection operand/canonical-target parity for all four relations');
    report.passed = true;
  } catch (error) { report.error = { name: error.name, message: error.message }; }
  return report;
}
