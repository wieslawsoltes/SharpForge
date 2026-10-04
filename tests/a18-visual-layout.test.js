import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign, editGridTracks, resizeGridTracks, resolveGridTracks, layoutInsertion,
  DesignPreviewEnvironment, anchoredDesignZoom, fitDesignBounds, setResponsiveState, applyResponsivePreview,
  selectedResponsiveState, generateResponsiveMethods, generateDesignCode, csharpValue, designScene} from '@sharpforge/designer';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

function gridFixture() {
  const document = new DesignDocument(createDesign());
  const id = document.add('Grid', 'canvas');
  document.tracks(id, ['Auto', '*'], [100, '*', '2*']);
  document.move('action', id);
  document.setProperty('Column', 1, ['action']);
  return {document, id};
}

test('Grid insertion, deletion and splitting reindex child starts and spans atomically', () => {
  const {document, id} = gridFixture();
  const before = document.serialize();
  const count = document.undoStack.length;
  editGridTracks(document, {id, axis: 'columns', action: 'insert', index: 1, value: 80});
  assert.equal(document.node('action').properties.Column, 2);
  assert.equal(document.node(id).columns.length, 4);
  assert.equal(document.undoStack.length, count + 1);
  document.undo();
  assert.equal(document.serialize(), before);
  editGridTracks(document, {id, axis: 'columns', action: 'split', index: 1});
  assert.equal(document.node('action').properties.ColumnSpan, 2);
  assert.equal(document.node(id).columns[1].Value, .5);
  editGridTracks(document, {id, axis: 'columns', action: 'remove', index: 1});
  assert.equal(document.node('action').properties.ColumnSpan, 1);
});

test('Grid reorder preserves child coverage and rejects discontiguous spans without writes', () => {
  const {document, id} = gridFixture();
  editGridTracks(document, {id, axis: 'columns', action: 'reorder', index: 1, destination: 2});
  assert.equal(document.node('action').properties.Column, 2);
  document.setProperty('Column', 0, ['action']);
  document.setProperty('ColumnSpan', 2, ['action']);
  const before = document.serialize();
  assert.throws(() => editGridTracks(document, {id, axis: 'columns', action: 'reorder', index: 0, destination: 2}),
    {code: 'SFD_TRACK_DISCONTIGUOUS'});
  assert.equal(document.serialize(), before);
});

test('Grid unit changes and adjacent resizing preserve Star weight and finite measured geometry', () => {
  const {document, id} = gridFixture();
  editGridTracks(document, {id, axis: 'columns', action: 'size', index: 0, value: '2*'});
  assert.equal(document.node(id).columns[0].GridUnitType, 2);
  resizeGridTracks(document, {id, axis: 'columns', index: 0, sizes: [200, 100, 200], delta: 50});
  assert.equal(document.node(id).columns[0].Value + document.node(id).columns[1].Value, 3);
  assert.deepEqual(resolveGridTracks(['Auto', '*', '2*'], 350, {autoSizes: [50], spacing: 0}), [50, 100, 200]);
  assert.throws(() => resizeGridTracks(document, {id, axis: 'columns', index: 9, sizes: [200, 100], delta: 10}),
    {code: 'SFD_TRACK_BOUNDARY'});
  assert.throws(() => editGridTracks(document, {id, axis: 'rows', action: 'split', index: 0}), {code: 'SFD_TRACK_SPLIT_AUTO'});
});

test('layout insertion is index 2 between the second and third child in either orientation', () => {
  for (const orientation of ['horizontal', 'vertical']) {
    const horizontal = orientation === 'horizontal';
    const children = Array.from({length: 4}, (_, index) => ({Left: horizontal ? index * 40 : 0,
      Top: horizontal ? 0 : index * 40, Width: 30, Height: 30}));
    const point = horizontal ? {x: 75, y: 10} : {x: 10, y: 75};
    assert.equal(layoutInsertion({children, point, orientation}).index, 2);
  }
  assert.equal(layoutInsertion({children: [], point: {x: 0, y: 0}}).index, 0);
  const wrapped = layoutInsertion({children: [{Left: 0, Top: 0, Width: 20, Height: 20},
    {Left: 30, Top: 0, Width: 20, Height: 20}, {Left: 0, Top: 30, Width: 20, Height: 20}],
  orientation: 'horizontal', wrap: true, point: {x: 5, y: 35}});
  assert.equal(wrapped.index, 2);
});

test('preview device/theme/contrast/RTL/scale never changes source serialization or history', () => {
  const document = new DesignDocument(createDesign());
  const before = document.serialize();
  const environment = new DesignPreviewEnvironment({width: 390, height: 844, theme: 'light', direction: 'rtl', contrast: 'high', scale: 2});
  const preview = environment.document(document.value);
  assert.equal(preview.width, 390);
  const scene = environment.applyToScene(designScene(preview));
  assert.equal(scene.nodes.find(node => node.id === 'action').properties.Background.Color.R, 0);
  assert.equal(document.serialize(), before);
  assert.equal(document.undoStack.length, 0);
  assert.throws(() => environment.update({scale: 0}), {code: 'SFD_PREVIEW_SCALE'});
  assert.throws(() => environment.update({width: 1}), {code: 'SFD_PREVIEW_SIZE'});
});

test('pointer-anchored zoom remains exact with document margins and both scroll offsets', () => {
  const viewport = {zoom: 2, scrollLeft: 142, scrollTop: 211, originX: 38, originY: 36, width: 900, height: 700};
  const point = {x: 137.5, y: 246.25};
  const next = anchoredDesignZoom(viewport, point, 3.75);
  for (const [position, scroll, origin] of [['x', 'scrollLeft', 'originX'], ['y', 'scrollTop', 'originY']]) {
    const before = (viewport[scroll] + point[position] - viewport[origin]) / viewport.zoom;
    const after = (next[scroll] + point[position] - viewport[origin]) / next.zoom;
    assert(Math.abs(before - after) < 1e-9);
  }
  const fit = fitDesignBounds(viewport, {Left: 100, Top: 100, Width: 400, Height: 300});
  assert.equal(fit.zoom, Math.min(900 / 480, 700 / 360));
  assert(Math.abs(viewport.originX + 300 * fit.zoom - fit.scrollLeft - viewport.width / 2) < 1e-9);
  assert.equal(anchoredDesignZoom(viewport, point, 100).zoom, 8);
});

test('adaptive width ranges select exactly one state and preserve all baseline properties', () => {
  const document = new DesignDocument(createDesign());
  setResponsiveState(document, {id: 'Compact', minWidth: 0, maxWidth: 600, overrides: {action: {Width: 100, Left: 8}}});
  setResponsiveState(document, {id: 'Wide', minWidth: 600, maxWidth: null, overrides: {action: {Width: 240}}});
  assert.equal(selectedResponsiveState(document.value, 599.99).id, 'Compact');
  assert.equal(selectedResponsiveState(document.value, 600).id, 'Wide');
  assert.equal(applyResponsivePreview(document.value, 300).nodes.find(node => node.id === 'action').properties.Width, 100);
  assert.equal(applyResponsivePreview(document.value, 900).nodes.find(node => node.id === 'action').properties.Left, 50);
  assert.throws(() => setResponsiveState(document, {id: 'Broken', minWidth: 100, maxWidth: 50, overrides: {}}),
    {code: 'SFD_RESPONSIVE_RANGE'});
  assert.throws(() => setResponsiveState(document, {id: 'Missing', minWidth: 0, overrides: {missing: {Width: 10}}}),
    {code: 'SFD_RESPONSIVE_NODE'});
});

test('generated adaptive methods execute the same real property changes on source VM and direct CIL', () => {
  const document = new DesignDocument(createDesign());
  setResponsiveState(document, {id: 'Compact', minWidth: 0, maxWidth: 600, overrides: {action: {Width: 100, Left: 8}}});
  setResponsiveState(document, {id: 'Wide', minWidth: 600, maxWidth: null, overrides: {action: {Width: 240}}});
  const adaptive = generateResponsiveMethods(document.value, {symbol: id => `v_${id}`, csharpValue});
  assert(adaptive.diagnostics.some(diagnostic => diagnostic.code === 'SFD_RESPONSIVE_HOST_RESIZE'));
  const baseline = document.snapshot();
  delete baseline.responsive;
  const original = generateDesignCode(baseline);
  const source = `${original.slice(0, original.lastIndexOf('}'))}\n${adaptive.methods.join('\n')}\n}\n`
    + 'class Program { public static void OnAction(object sender, Microsoft.UI.Xaml.RoutedEventArgs args) {} '
    + 'static void Main() { DesignedView.Create(); DesignedView.ApplyAdaptive(300.0); '
    + 'Console.WriteLine(DesignedView.v_action.Width); DesignedView.ApplyAdaptive(900.0); '
    + 'Console.WriteLine(DesignedView.v_action.Width); Console.WriteLine(Microsoft.UI.Xaml.Controls.Canvas.GetLeft(DesignedView.v_action)); }}';
  const compiled = compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const machine of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
    const result = machine.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output.replace(/\r/g, ''), '100\n240\n50\n');
  }
});

test('adaptive Wrap spans keep their declared owner independent of Grid spans on both managed engines', () => {
  const document = new DesignDocument(createDesign());
  const wrap = document.add('VariableSizedWrapGrid', 'canvas');
  document.move('action', wrap);
  for (const [property, value] of [['WrapRowSpan', 1], ['WrapColumnSpan', 2], ['ColumnSpan', 3]]) {
    document.setProperty(property, value, ['action']);
  }
  setResponsiveState(document, {id: 'Compact', minWidth: 0, maxWidth: 600,
    overrides: {action: {WrapRowSpan: 2, WrapColumnSpan: 4, ColumnSpan: 5}}});
  const source = generateDesignCode(document.value) + `
    class Program {
      public static void OnAction(object sender, Microsoft.UI.Xaml.RoutedEventArgs args) {}
      static void PrintSpans() {
        Console.WriteLine(Microsoft.UI.Xaml.Controls.VariableSizedWrapGrid.GetRowSpan(DesignedView.v_action));
        Console.WriteLine(Microsoft.UI.Xaml.Controls.VariableSizedWrapGrid.GetColumnSpan(DesignedView.v_action));
        Console.WriteLine(Microsoft.UI.Xaml.Controls.Grid.GetColumnSpan(DesignedView.v_action));
      }
      static void Main() {
        DesignedView.Create();
        DesignedView.ApplyAdaptive(300.0);
        PrintSpans();
        DesignedView.ApplyAdaptive(900.0);
        PrintSpans();
      }
    }`;
  const compiled = compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const machine of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
    const result = machine.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output.replace(/\r/g, ''), '2\n4\n5\n1\n2\n3\n');
  }
});

test('adaptive unset Wrap spans address the declared dependency property members', () => {
  const document = new DesignDocument(createDesign());
  setResponsiveState(document, {id: 'Compact', minWidth: 0, maxWidth: 600,
    overrides: {action: {WrapRowSpan: 2, WrapColumnSpan: 4}}});
  const source = generateResponsiveMethods(document.value, {symbol: id => `v_${id}`, csharpValue}).methods.join('\n');
  assert(source.includes('v_action.ClearValue(Microsoft.UI.Xaml.Controls.VariableSizedWrapGrid.RowSpanProperty);'));
  assert(source.includes('v_action.ClearValue(Microsoft.UI.Xaml.Controls.VariableSizedWrapGrid.ColumnSpanProperty);'));
  assert(source.includes('Microsoft.UI.Xaml.Controls.VariableSizedWrapGrid.SetRowSpan(v_action, 2);'));
  assert(source.includes('Microsoft.UI.Xaml.Controls.VariableSizedWrapGrid.SetColumnSpan(v_action, 4);'));
  assert(!source.includes('SetWrap'));
});
