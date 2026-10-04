import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {MEDIA} from '@sharpforge/framework';
import {generateDesignCode, normalizeDesignerBrush, validateDesign} from '@sharpforge/designer';

export const gradientUri = 'Views/GradientView.cs';
export const gradientOptions = {uri: gradientUri, className: 'DesignedView', methodName: 'Create'};
export const linearType = MEDIA + 'LinearGradientBrush';

export function gradientBrush(overrides = {}) {
  return normalizeDesignerBrush({valueType: linearType, StartPoint: {X: -0.25, Y: 0.2}, EndPoint: {X: 0.75, Y: 1.2},
    Opacity: 0.75, GradientStops: [
      {Color: '#80ff0000', Offset: 0}, {Color: '#ff00ff00', Offset: 0.5},
      {Color: '#ff0000ff', Offset: 0.5}, {Color: '#00ffffff', Offset: 1}
    ], ...overrides});
}

export function gradientDesign(brush = gradientBrush()) {
  return validateDesign({version: 1, name: 'DesignedView', width: 640, height: 480, root: 'window', nodes: [
    {id: 'window', type: 'Window', properties: {Title: 'Gradient values'}, children: ['root']},
    {id: 'root', type: 'Canvas', properties: {Name: 'Root', Width: 640, Height: 480}, children: ['action']},
    {id: 'action', type: 'Button', properties: {Name: 'Action', Content: 'Gradient', Width: 240, Height: 80,
      Background: brush}, children: []}
  ]});
}

export function gradientSources(brush = gradientBrush()) {
  return [{uri: gradientUri, version: 7, text: generateDesignCode(gradientDesign(brush))}];
}

export function compileGradient(sources, body = 'DesignedView.Create();') {
  const runner = body === null ? [] : [{uri: 'GradientRunner.cs', text: `
    class GradientRunner { static void Main() { ${body} } }`}];
  const compilation = compileToIL([...sources, ...runner]);
  assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
  return compilation;
}

export function gradientVisual(machine, name = 'Action') {
  const node = machine.platform.scene().nodes.find(node => node.properties.Name === name);
  assert.ok(node, 'Missing visual ' + name);
  return node;
}

export function runGradient(compilation, inspect = () => {}) {
  for (const Machine of [VirtualMachine, CilVirtualMachine]) {
    const machine = new Machine(Machine === VirtualMachine ? compilation.image : compilation.assembly, {initialThreshold: 64});
    const result = machine.run();
    assert.equal(result.state, 'terminated', Machine.name + ': ' + JSON.stringify(result.fault));
    assert.equal(result.fault, null);
    inspect(machine, result);
  }
}

export const gradientReference = id => {
  const [h, g] = id.split(':').map(Number);
  return Object.freeze({h, g});
};
