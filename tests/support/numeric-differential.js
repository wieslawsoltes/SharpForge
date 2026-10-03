import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

/** Load only a checked-in, native-generated oracle; missing evidence is a hard failure. */
export function numericOracle(name, directory = new URL('../fixtures/a05/numeric-oracle/', import.meta.url)) {
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', directory), 'utf8'));
  const entry = provenance.files[name];
  assert(entry, 'Native numeric oracle has no entry for ' + name);
  const bytes = readFileSync(new URL(name, directory));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, 'Native oracle hash: ' + name);
  const text = (name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
  return {text, provenance};
}

/** Compare one C# source against native output in source, reloaded source and direct CIL. */
export function numericDifferential(source, expected, options = {}) {
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const settings = {nativeIntBits: options.nativeIntBits ?? 32, ...options.vmOptions};
  const engines = [
    ['source', new VirtualMachine(compiled.image, settings)],
    ['reloaded source', new VirtualMachine(loadAssembly(compiled.assembly), settings)],
    ['direct CIL', new CilVirtualMachine(compiled.assembly, settings)],
  ];
  const outputs = {};
  for (const [engine, vm] of engines) {
    const result = vm.run();
    const label = `${options.family ?? 'numeric'} / ${engine} / ${options.operands ?? source}`;
    assert.equal(result.state, 'terminated', label + ': ' + result.fault?.stack);
    assert.equal(result.output, expected, label);
    outputs[engine] = result.output;
  }
  return {compiled, outputs};
}
