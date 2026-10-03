import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, DesignerPropertyCommands, createDesign, convertCanvasToGrid, generateDesignCode,
  setResponsiveState} from '@sharpforge/designer';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

function position(document, id) {
  const node = document.node(id);
  const grid = document.parent(id);
  return {left: grid.columns.slice(0, node.properties.Column).reduce((sum, track) => sum + track.Value, 0) +
    (node.properties.Margin?.Left ?? 0),
  top: grid.rows.slice(0, node.properties.Row).reduce((sum, track) => sum + track.Value, 0) +
    (node.properties.Margin?.Top ?? 0), width: node.properties.Width, height: node.properties.Height};
}

test('Canvas conversion retains identifiers, child bounds and one exact undo/redo transaction', () => {
  const document = new DesignDocument(createDesign());
  document.select('canvas');
  const before = document.snapshot();
  convertCanvasToGrid(document);
  assert.match(document.node('canvas').type, /\.Grid$/);
  assert.deepEqual(document.node('canvas').children, before.nodes.find(node => node.id === 'canvas').children);
  for (const id of document.node('canvas').children) {
    const original = before.nodes.find(node => node.id === id).properties;
    assert.deepEqual(position(document, id), {left: original.Left, top: original.Top, width: original.Width, height: original.Height});
    assert.equal(document.node(id).properties.Left, undefined);
    assert.equal(document.node(id).properties.Top, undefined);
  }
  assert.equal(document.undoStack.length, 1);
  const converted = document.snapshot();
  document.undo();
  assert.deepEqual(document.snapshot(), before);
  document.undo(true);
  assert.deepEqual(document.snapshot(), converted);
});

test('Canvas conversion measures automatic sizes, retains margins and represents negative offsets', () => {
  const document = new DesignDocument(createDesign());
  document.setProperty('Left', -12, ['action']);
  document.setProperty('Margin', [3, 4, 5, 6], ['action']);
  document.setProperty('Width', undefined, ['action']);
  const before = document.snapshot();
  assert.throws(() => convertCanvasToGrid(document, {id: 'canvas'}), error => error.code === 'SFD_CONVERT_MEASUREMENT');
  assert.deepEqual(document.snapshot(), before);
  convertCanvasToGrid(document, {id: 'canvas', childBounds: {action: {Width: 180, Height: 40}}});
  assert.deepEqual(position(document, 'action'), {left: -9, top: 166, width: 180, height: 40});
});

test('Canvas conversion rejects incompatible, locked, read-only and stale inputs atomically', () => {
  for (const options of [{id: 'action'}, {id: 'canvas', readOnly: true}, {id: 'canvas', canEdit: id => id !== 'action'},
    {id: 'canvas', expectedRevision: -1}]) {
    const document = new DesignDocument(createDesign());
    const before = document.snapshot();
    assert.throws(() => convertCanvasToGrid(document, options));
    assert.deepEqual(document.snapshot(), before);
    assert.equal(document.undoStack.length, 0);
  }
});

test('Canvas conversion rejects protected expressions, adaptive layout and disposed documents', () => {
  const document = new DesignDocument(createDesign());
  new DesignerPropertyCommands(document).bind('Width', {path: 'MeasuredWidth'}, ['action']);
  const before = document.snapshot();
  assert.throws(() => convertCanvasToGrid(document, {id: 'canvas'}), error => error.code === 'SFD_CONVERT_EXPRESSION');
  assert.deepEqual(document.snapshot(), before);
  const adaptive = new DesignDocument(createDesign());
  setResponsiveState(adaptive, {id: 'Narrow', minWidth: 0, maxWidth: 600, overrides: {action: {Left: 8}}});
  assert.throws(() => convertCanvasToGrid(adaptive, {id: 'canvas'}), error => error.code === 'SFD_CONVERT_ADAPTIVE');
  adaptive.dispose();
  assert.throws(() => convertCanvasToGrid(adaptive, {id: 'canvas'}), /disposed/);
});

test('converted row, column and spanning properties execute on source VM and direct CIL', () => {
  const document = new DesignDocument(createDesign());
  convertCanvasToGrid(document, {id: 'canvas'});
  const action = document.node('action');
  const members = ['Row', 'Column', 'RowSpan', 'ColumnSpan'];
  const print = members.map(member => `System.Console.WriteLine(Microsoft.UI.Xaml.Controls.Grid.Get${member}(DesignedView.v_action));`);
  const source = generateDesignCode(document.value) + `class Program {
    public static void OnAction(object sender, Microsoft.UI.Xaml.RoutedEventArgs args) {}
    static void Main() { DesignedView.Create().Activate(); ${print.join('\n')} }
  }`;
  const compilation = compileToIL(source);
  assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
  const expected = members.map(member => action.properties[member]).join('\n') + '\n';
  for (const Machine of [VirtualMachine, CilVirtualMachine]) {
    const machine = new Machine(Machine === VirtualMachine ? compilation.image : compilation.assembly);
    const result = machine.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output.replace(/\r/g, ''), expected, Machine.name);
    const scene = machine.platform.scene();
    assert(scene.nodes.some(node => node.type.endsWith('.Grid') && node.properties.Name === 'Root'));
  }
});

test('Canvas conversion rejects more than 64 tracks before publishing any partial conversion', () => {
  const design = createDesign();
  const canvas = design.nodes.find(node => node.id === 'canvas');
  for (let index = 0; index < 34; index++) {
    const id = `extra${index}`;
    canvas.children.push(id);
    design.nodes.push({id, type: 'Button', properties: {Left: index * 3, Top: 0, Width: 1, Height: 1}, children: []});
  }
  const document = new DesignDocument(design);
  const before = document.snapshot();
  assert.throws(() => convertCanvasToGrid(document, {id: 'canvas'}), error => error.code === 'SFD_CONVERT_TRACK_LIMIT');
  assert.deepEqual(document.snapshot(), before);
  assert.equal(document.undoStack.length, 0);
});
