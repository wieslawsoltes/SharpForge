import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const maximumOracleBytes = 256 * 1024 * 1024;

function oracleDirectory() {
  const configured = process.env.SHARPFORGE_NUMERIC_ORACLE_DIR;
  return configured ? pathToFileURL(resolve(configured) + sep) : new URL('../fixtures/a05/numeric-oracle/', import.meta.url);
}

/** Load a hash-checked native oracle, using an explicit artifact directory only when qualification requests it. */
export function numericOracle(name, directory = oracleDirectory()) {
  assert.match(name, /^[a-z0-9][a-z0-9.-]*$/, 'Oracle name must identify one fixture file');
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', directory), 'utf8'));
  assert.equal(provenance.format, 'SharpForge.NativeNumericOracle/1', 'Native oracle schema');
  assert.match(provenance.sdk, /^10\./, 'Native oracle pins .NET 10');
  assert([32, 64].includes(provenance.nativeIntBits), 'Native oracle records its actual pointer width');
  const entry = provenance.files[name];
  assert(entry, 'Native numeric oracle has no entry for ' + name);
  const bytes = readFileSync(new URL(name, directory));
  assert.equal(bytes.byteLength, entry.bytes, 'Native oracle byte length: ' + name);
  assert(bytes.byteLength <= maximumOracleBytes, 'Native oracle is bounded');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, 'Native oracle hash: ' + name);
  const text = (name.endsWith('.gz') ? gunzipSync(bytes, {maxOutputLength: maximumOracleBytes}) : bytes).toString('utf8');
  return {text, provenance};
}

/** Drain output after each bounded slice so million-row differential runs retain one oracle, not three outputs. */
function compareExecution(vm, expected, label) {
  let offset = 0;
  while (vm.state === 'ready' || vm.state === 'running') {
    vm.runSlice({instructionBudget: 32768, timeBudgetMs: 16});
    for (const chunk of vm.output) {
      if (!expected.startsWith(chunk, offset)) {
        const row = expected.slice(0, offset).split('\n').length;
        assert.equal(chunk, expected.slice(offset, offset + chunk.length), `${label}, output row ${row}`);
      }
      offset += chunk.length;
    }
    vm.output.length = 0;
  }
  assert.equal(vm.state, 'terminated', label + ': ' + vm.fault?.stack);
  assert.equal(offset, expected.length, label + ': missing or excess output');
  return {characters: offset, instructions: vm.instructions};
}

/** Compare one C# source against native output in source, reloaded source and direct CIL. */
export function numericDifferential(source, expected, options = {}) {
  assert.equal(typeof expected, 'string', 'A native output string is required');
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const settings = {nativeIntBits: options.nativeIntBits ?? 32,
    maxOutputCharacters: Math.max(1, expected.length), ...options.vmOptions};
  const engines = [
    ['source', () => new VirtualMachine(compiled.image, settings)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly), settings)],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly, settings)],
  ];
  const outputs = {};
  for (const [engine, create] of engines) {
    const label = `${options.family ?? 'numeric'} / ${engine} / ${options.operands ?? source}`;
    outputs[engine] = compareExecution(create(), expected, label);
  }
  return {compiled, outputs};
}
