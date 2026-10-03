import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inventoryOptions} from '../packages/bcl-core/scripts/inventory.js';
import {
  assertInventoryDocument, renderInventory, updateInventoryDocument, updateRuntimeDocument
} from '../packages/bcl-core/scripts/inventory-renderer.js';

const documentURL = new URL('../docs/bcl-api.md', import.meta.url);
const runtimeURL = new URL('../docs/runtime14-api.md', import.meta.url);
let optionsPromise;
const options = () => optionsPromise ??= inventoryOptions();

test('A07 inventory is byte-stable and contains all registered module members', async () => {
  const configuration = await options();
  const document = await readFile(documentURL, 'utf8');
  const first = updateInventoryDocument(document, configuration);
  const second = updateInventoryDocument(first, configuration);
  assert.equal(first, second);
  assert.equal(document, first, 'Regenerate docs with node packages/bcl-core/scripts/inventory.js');
  assertInventoryDocument(document, configuration);
  const runtime = await readFile(runtimeURL, 'utf8');
  assert.equal(runtime, updateRuntimeDocument(runtime));
});

test('A07 inventory rejects a removed registered member and altered reference status', async () => {
  const configuration = await options();
  const document = updateInventoryDocument('', configuration);
  const registered = document.split('\n').find(line => /^\| \d+ \|/.test(line));
  assert.ok(registered);
  assert.throws(() => assertInventoryDocument(document.replace(registered + '\n', ''), configuration), /stale/);
  assert.throws(() => assertInventoryDocument(document.replace('| missing |', '| implemented |'), configuration), /stale/);
  assert.throws(() => assertInventoryDocument('', configuration), /stale/);
});

test('A07 inventory exposes additional registered signatures as documentation drift', async () => {
  const configuration = await options();
  const member = configuration.contracts.find(row => row.owner === 'System.Random');
  const changed = {...member, id: 999999, name: 'InventoryDriftProbe'};
  const document = updateInventoryDocument('', configuration);
  const expanded = {...configuration, contracts: [...configuration.contracts, changed]};
  assert.throws(() => assertInventoryDocument(document, expanded), /stale/);
});

test('A07 exact reference comparison does not equate a closed Array overload with a generic method', async () => {
  const configuration = await options();
  const genericFill = configuration.reference.rows.find(row => row.owner === 'System.Array'
    && row.name === 'Fill' && row.kind === 'method' && row.genericArity === 1);
  assert.ok(genericFill);
  const rendered = renderInventory(configuration);
  const row = rendered.split('\n').find(line => line.includes('System.Array::Fill``1'));
  assert.match(row, /\| missing \|/);
  assert.match(rendered, /System.Random::Next``0\(\):System.Int32 instance<\/code> \| implemented \|/);
});

test('A07 released String contract section remains byte-identical', async () => {
  const document = await readFile(documentURL, 'utf8');
  const start = document.indexOf('## `System.String`\n');
  const end = document.indexOf('\n## ', start + 1);
  assert.ok(start >= 0 && end > start);
  const section = document.slice(start, end + 1);
  const expected = await readFile(new URL('../packages/bcl-core/reference/legacy-string.md', import.meta.url), 'utf8');
  assert.equal(section, expected);
});

test('A07 reference snapshot retains real extractor and source assembly hashes', async () => {
  const {reference} = await options();
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.referencePack, '10.0.5');
  assert.equal(reference.extractor.sdk, '10.0.201');
  const source = await readFile(new URL('../tests/conformance/inventory/metadata/Program.cs', import.meta.url));
  assert.equal(reference.extractor.sourceSHA256, createHash('sha256').update(source).digest('hex'));
  assert.ok(reference.files.length > 0);
  for (const file of reference.files) assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.equal(new Set(reference.rows.map(row => row.signature)).size, reference.rows.length);
});

test('A07 inventory handles an empty module and rejects duplicate ownership', () => {
  const reference = {runtime: '10.0.5', referencePack: '10.0.5', extractor: {sdk: '10.0.201'}, files: [], rows: []};
  const module = {name: 'empty', families: ['empty']};
  const configuration = {modules: [module], contracts: [], types: new Map(), reference};
  assert.match(renderInventory(configuration), /No registered members/);
  assert.throws(() => renderInventory({...configuration, modules: [module, module]}), /Duplicate inventory module/);
  const duplicateFamily = {name: 'second', families: ['empty']};
  assert.throws(() => renderInventory({...configuration, modules: [module, duplicateFamily]}), /Duplicate inventory family/);
});
