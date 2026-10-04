import { AssemblyInspector, decompileAssembly } from '@sharpforge/cil';
import { arithmeticLibrary } from '../../managed-fixtures.js';
import { tablesFixture } from '../metadata-table-views/fixture.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const hex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

function checkCounts(inventory, counts) {
  const seen = new Set();
  for (const table of inventory.tables) {
    assert(table.rowCount === (counts[table.table] ?? 0), 'Physical count: ' + table.name);
    assert(table.rows.length === table.rowCount, 'Row count: ' + table.name);
    assert(table.rendered + table.summarized + table.unsupported === table.rowCount, 'Status count');
    for (const row of table.rows) {
      assert(row.token === table.table * 0x1000000 + row.rowId && !seen.has(row.token), 'Unique physical row');
      seen.add(row.token);
    }
  }
  assert(seen.size === inventory.totalRows && seen.size === inventory.accountedRows, 'Full census');
  assert(inventory.accountingComplete && !inventory.sourceComplete, 'Accounting differs from C# completeness');
}

export async function run() {
  const report = { passed: false, checks: [], native: null };
  try {
    const inspector = new AssemblyInspector(tablesFixture().bytes);
    checkCounts(decompileAssembly(inspector).inventory, inspector.metadata.counts);
    const result = decompileAssembly(arithmeticLibrary());
    const methods = result.inventory.tables.find((table) => table.table === 6).rows;
    assert(methods.every((row) => row.status === 'summarized' && row.renderedOutput.extent === 'method-body'), 'Partial output links');
    methods[0].raw[0] = 0xffffffff;
    assert(decompileAssembly(arithmeticLibrary()).inventory.tables.find((table) => table.table === 6).rows[0].raw[0] !== 0xffffffff,
      'Owned census');
    for (const options of [{ inventory: { maxRows: 0 } }, { signal: AbortSignal.abort() }]) {
      let rejected = false;
      try { decompileAssembly(inspector, options); } catch (error) {
        rejected = ['CILDI0002', 'CILCFG0003'].includes(error.code);
      }
      assert(rejected, 'Bounded/cancelled assembly census');
    }
    report.checks.push('All 45 CLI tables, owned rows, partial method output, budgets and cancellation');
    const response = await fetch('/tests/fixtures/metadata-table-views/native.json');
    assert(response.ok, 'Native reference fetch');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(hex(await crypto.subtle.digest('SHA-256', bytes)) ===
      'b9fe9c749515f4d14ab4da150b00a7f4bd33037d7bb903c40e03c67d865f05b7', 'Native reference hash');
    const reference = JSON.parse(new TextDecoder().decode(bytes));
    const input = reference.images.find((image) => image.label === 'srm-cli-tables-pe');
    const image = Uint8Array.from(atob(input.image), (character) => character.charCodeAt(0));
    assert(hex(await crypto.subtle.digest('SHA-256', image)) === input.sha256, 'Native image hash');
    const native = reference.native.images.find((item) => item.label === input.label);
    const inventory = decompileAssembly(image).inventory;
    checkCounts(inventory, Object.fromEntries(native.tables.map((table) => [table.table, table.rowCount])));
    for (const table of native.tables) {
      const actual = inventory.tables.find((item) => item.table === table.table);
      assert(JSON.stringify(actual.rows.map((row) => row.token)) === JSON.stringify(table.rows.map((row) => row.token)), 'Native tokens');
    }
    report.native = { retainedReference: true, toolchain: reference.toolchain.sdk,
      imageSha256: input.sha256, qualification: 'Retained SRM row observations; no live native execution' };
    report.checks.push('Native PE table counts and every physical token');
    report.passed = true;
  } catch (error) {
    report.error = { name: error.name, code: error.code, message: error.message };
  }
  return report;
}
