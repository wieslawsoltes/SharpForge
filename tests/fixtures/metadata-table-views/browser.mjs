import { CilError, MetadataTableInspector } from '@sharpforge/cil';
import { tablesFixture, heapFixture, pdbTablesFixture, deltaTablesFixture } from './fixture.js';
import { compareNativeImage, checkNativeUnsupportedImage } from './native-compare.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
function rejects(action) {
  try { action(); } catch (error) {
    assert(error instanceof CilError, 'Unexpected error type');
    return;
  }
  throw new Error('Missing rejection');
}

export async function run() {
  const report = { passed: false, checks: [] };
  try {
    const fixture = tablesFixture();
    const view = new MetadataTableInspector(fixture.bytes);
    assert(view.tables().length === 53, 'Schema inventory');
    assert(view.tables({ includeEmpty: false }).length === 45, 'CLI inventory');
    for (const table of view.tables({ includeEmpty: false })) {
      const page = view.rows(table.table, { limit: 1 });
      assert(page.rows.length === 1 && page.rows[0].byteLength === table.rowSize, 'Table row/extent');
    }
    assert(view.row(fixture.owner).columns.Extends.value.name === 'Object', 'Reference name');
    assert(view.row(fixture.owner).columns.FieldList.value.first.token === 0x03000001, 'Pointer identity');
    assert(view.rows(2, { offset: 4 }).rows.length === 0, 'End page');
    const value = view.row(fixture.field).columns.Signature.value;
    value[0] = 255;
    assert(view.row(fixture.field).columns.Signature.value[0] === 6, 'Owned blob');
    const pdb = new MetadataTableInspector(pdbTablesFixture(2).bytes);
    assert(pdb.row(0x32000001).columns.Method.value.status === 'external', 'PDB external identity');
    const delta = new MetadataTableInspector(deltaTablesFixture());
    assert(delta.row(0x33000001).columns.Name.width === 4, 'Shared minimal-delta width');
    assert(delta.row(0x31000001).columns.Document.value.reason === 'delta-context-required', 'No delta aliasing');
    report.checks.push('All 53 schemas, 45 physical CLI tables, PDB references, pointer identity and owned pages');
    const heaps = heapFixture();
    const padding = heaps.builder.heaps.userStrings.length;
    heaps.builder.heaps.userStrings.zero(2);
    const heapView = new MetadataTableInspector(heaps.builder.finish());
    assert(heapView.heap('#US', { offset: padding }).entries.every(entry => entry.isPadding), 'Physical padding');
    rejects(() => heapView.heapEntry('#US', padding));
    rejects(() => view.rows(2, { maxPageBytes: 0 }));
    rejects(() => view.rows(2, { signal: AbortSignal.abort() }));
    rejects(() => view.heap('#GUID', { offset: 1 }));
    rejects(() => view.rows(2, { limit: 1001 }));
    report.checks.push('Heap padding/direct handles, budgets, alignment, limits and cancellation');
    const reference = await (await fetch('/tests/fixtures/metadata-table-views/native.json')).json();
    report.native = [];
    for (const input of reference.images) {
      const bytes = Uint8Array.from(atob(input.image), character => character.charCodeAt(0));
      assert(hex(await crypto.subtle.digest('SHA-256', bytes)) === input.sha256, 'Native input SHA-256');
      report.native.push(compareNativeImage(bytes, reference.native.images.find(image => image.label === input.label)));
    }
    report.unsupportedNative = [];
    for (const input of reference.unsupportedImages) {
      const bytes = Uint8Array.from(atob(input.image), character => character.charCodeAt(0));
      assert(hex(await crypto.subtle.digest('SHA-256', bytes)) === input.sha256, 'Native legacy input SHA-256');
      report.unsupportedNative.push(checkNativeUnsupportedImage(bytes,
        reference.native.unsupportedImages.find(image => image.label === input.label), input.table));
    }
    report.checks.push('Retained native SRM full physical rows, typed named columns and heap probes');
    report.checks.push('Four SRM legacy-table rejections retained with successful physical inspector access');
    view.dispose();
    rejects(() => view.tables());
    report.passed = true;
  } catch (error) {
    report.error = { name: error.name, message: error.message };
  }
  return report;
}
