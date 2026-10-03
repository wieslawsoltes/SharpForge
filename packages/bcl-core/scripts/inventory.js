import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {assertInventoryDocument, updateInventoryDocument, updateRuntimeDocument} from './inventory-renderer.js';

/** Load the committed registry and native metadata snapshot without invoking the reference toolchain. */
export async function inventoryOptions() {
  const {bclModules} = await import('../src/index.js');
  const {contracts, types} = await import('@sharpforge/framework');
  const reference = JSON.parse(await readFile(new URL('../reference/dotnet-10.0.5.json', import.meta.url), 'utf8'));
  return {modules: bclModules, contracts, types, reference};
}

/** Generate documentation, or check drift without writing tracked files when check is true. */
export async function generateInventory({check = false} = {}) {
  const options = await inventoryOptions();
  const bclPath = new URL('../../../docs/bcl-api.md', import.meta.url);
  const runtimePath = new URL('../../../docs/runtime14-api.md', import.meta.url);
  const bclDocument = await readFile(bclPath, 'utf8');
  const runtimeDocument = await readFile(runtimePath, 'utf8');
  const runtimeOutput = updateRuntimeDocument(runtimeDocument);
  if (check) {
    assertInventoryDocument(bclDocument, options);
    if (runtimeDocument !== runtimeOutput) throw new Error('Runtime Array/Random documentation is stale');
    return;
  }
  await writeFile(bclPath, updateInventoryDocument(bclDocument, options));
  await writeFile(runtimePath, runtimeOutput);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some(argument => argument !== '--check')) throw new Error('Usage: inventory.js [--check]');
  await generateInventory({check: arguments_.includes('--check')});
  console.log(arguments_.includes('--check') ? 'BCL module inventory is current.' : 'Generated BCL module inventory.');
}
