import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {childSlot} from '@sharpforge/designer';
import {canonical} from './corpus.js';

export const unavailableTargets = Object.freeze({
  browser: {status: 'unqualified', reason: 'No browser DOM, accessibility tree, rendering, or input automation is run by this Node corpus.'},
  nativeWinUI: {status: 'unavailable', reason: 'A Windows App SDK/WinUI host and native rendering reference are unavailable in this environment.'},
  rustNative: {status: 'unqualified', reason: 'No Rust designer/WinUI host adapter is exercised by this corpus.'},
  rustWasm: {status: 'unqualified', reason: 'No Rust Wasm designer/WinUI host adapter is exercised by this corpus.'},
});

const engines = {
  source: compilation => new VirtualMachine(compilation.image, {initialThreshold: 64, virtualTime: true}),
  cil: compilation => new CilVirtualMachine(compilation.assembly, {initialThreshold: 64, virtualTime: true}),
};

/** Compile original/edited C# and compare actual managed runtime nodes with source-derived design identity. */
export function executeDesign(sources, document, {strict = true, includeProperties = true} = {}) {
  const compilation = compileToIL(sources);
  assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
  const result = {};
  for (const [engine, create] of Object.entries(engines)) {
    const vm = create(compilation);
    const execution = vm.run();
    assert.equal(execution.state, 'terminated', engine + ': ' + JSON.stringify(execution.fault));
    assert.equal(execution.fault, null, engine);
    const scene = vm.platform.scene();
    assert.equal(scene.windows.length, 1, engine + ': expected one activated window');
    const runtimeNodes = new Map(scene.nodes.map(node => [node.id, node]));
    const designNodes = new Map(document.nodes.map(node => [node.id, node]));
    const identity = {};
    const compare = (designId, runtimeId) => {
      const design = designNodes.get(designId);
      const runtime = runtimeNodes.get(runtimeId);
      assert.ok(runtime, engine + ': no live node for ' + designId);
      assert.equal(runtime.type, design.type, engine + ': type ' + designId);
      identity[designId] = runtimeId;
      if (includeProperties) {
        for (const [name, value] of Object.entries(design.properties)) {
          assert.deepEqual(canonical(runtime.properties[name]), canonical(value), engine + ': ' + designId + '.' + name);
        }
      }
      const slot = childSlot(design.type);
      const children = !slot ? [] : slot.many
        ? (runtime.collections[slot.property] ?? []).filter(value => value?.$ref).map(value => value.$ref)
        : runtime.properties[slot.property]?.$ref ? [runtime.properties[slot.property].$ref] : [];
      if (strict) assert.equal(children.length, design.children.length, engine + ': children of ' + designId);
      for (let index = 0; index < design.children.length; index++) compare(design.children[index], children[index]);
    };
    compare(document.root, scene.windows[0]);
    assert.equal(new Set(Object.values(identity)).size, document.nodes.length, engine + ': aliased runtime identities');
    vm.heap.collect();
    const retained = new Set(vm.platform.scene().nodes.map(node => node.id));
    for (const id of Object.values(identity)) assert.ok(retained.has(id), engine + ': lost reachable object after GC');
    result[engine] = {status: 'passed', identity, output: execution.output};
  }
  assert.equal(result.source.output, result.cil.output, 'source/direct-CIL output divergence');
  return result;
}
