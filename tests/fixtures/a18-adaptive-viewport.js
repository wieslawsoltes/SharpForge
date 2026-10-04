import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {generateDesignCode, validateDesign} from '@sharpforge/designer';

export const viewportUri = 'DesignedView.g.cs';
export const viewportOptions = {uri: viewportUri, className: 'DesignedView', methodName: 'Create'};

export function viewportDesign() {
  return validateDesign({version: 1, name: 'Adaptive viewport', width: 800, height: 640, root: 'window', nodes: [
    {id: 'window', type: 'Window', children: ['canvas']},
    {id: 'canvas', type: 'Canvas', properties: {Width: 960, Height: 640}, children: ['action']},
    {id: 'action', type: 'Button', properties: {Name: 'Action', Width: 160, Height: 40, Left: 50, Top: 24}, children: []}
  ], responsive: {version: 1, states: [
    {id: 'Compact', minWidth: 0, maxWidth: 600, overrides: {action: {Width: 100, Left: 8, RowSpan: 2}}},
    {id: 'Wide', minWidth: 600, maxWidth: 1000, overrides: {action: {Width: 240, Left: 40, RowSpan: 3}}}
  ]}});
}

export function viewportSources(design = viewportDesign()) {
  return [{uri: viewportUri, version: 1, text: generateDesignCode(design)}];
}

export function viewportCompilation(sources = viewportSources(), observe = true) {
  const result = compileToIL([...sources, {uri: 'Program.cs', text: `
    class Program {
      static void Observe(object sender, Microsoft.UI.Xaml.WindowSizeChangedEventArgs args) {
        System.Console.WriteLine(args.Size.Width);
        System.Console.WriteLine(args.Size.Height);
        args.Handled = true;
        System.GC.Collect();
      }
      static void Main() {
        DesignedView.Create();
        ${observe ? 'DesignedView.v_window.SizeChanged += Observe;' : ''}
      }
    }`}]);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

export const viewportMachines = [VirtualMachine, CilVirtualMachine];

export function viewportMachine(Machine, compilation) {
  const machine = new Machine(Machine === VirtualMachine ? compilation.image : compilation.assembly,
    {initialThreshold: 64, virtualTime: true});
  const result = machine.run();
  assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
  return machine;
}

export function viewportNode(machine, name = 'Action') {
  return machine.platform.scene().nodes.find(node => node.properties.Name === name);
}
