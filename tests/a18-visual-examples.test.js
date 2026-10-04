import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisualAuthoringExample} from '../packages/designer/examples/visual-layout.mjs';
import {designerLayoutReferences} from '../apps/studio/designer-layout-reference.js';
import {generateDesignCode, validateResponsiveDesign} from '@sharpforge/designer';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

test('runnable visual authoring example includes persisted guides, Grid authoring and two adaptive states', () => {
  const example = createVisualAuthoringExample();
  assert.equal(example.value.designer.guides.guides.length, 1);
  assert.equal(validateResponsiveDesign(example.value).states.length, 2);
  assert.equal(example.node(example.parent('action').id).columns.length, 3);
});

for (const document of designerLayoutReferences()) {
  test(`${document.name} reference design compiles and executes independently on source VM and CIL`, () => {
    const source = generateDesignCode(document) + '\nclass Program { static void Main() { DesignedView.Create(); } }';
    const compiled = compileToIL(source);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    for (const vm of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      const names = new Set(vm.platform.scene().nodes.map(node => node.properties.Name).filter(Boolean));
      for (const node of document.nodes) if (node.properties.Name) assert(names.has(node.properties.Name), node.id);
    }
  });
}
