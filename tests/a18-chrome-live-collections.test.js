import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, bindLinkedLiveDesign, designFromScene, designPatch, readDesignSource
} from '@sharpforge/designer';
import {compileToIL} from '@sharpforge/compiler';
import {applyDesignPatch} from '@sharpforge/runtime';
import {DebugSession, CilDebugSession} from '@sharpforge/debugger';
import {CONTROLS} from '@sharpforge/framework';

const source = `using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
class View {
  static int count;
  static TextBox input;
  static TextBlock status;
  static void Main() { Create(); }
  static void Clicked(object sender, RoutedEventArgs args) { count++; status.Text = input.Text + ":" + count; GC.Collect(); }
  static Window Create() {
    var window = new Window();
    var root = new Canvas() { Name = "Root" };
    var choices = new ComboBox() { Name = "Choices", Width = 160 };
    choices.Items.Add(true);
    choices.Items.Add(false);
    choices.Items.Add(1);
    choices.Items.Add(1.5);
    var stable = new ComboBoxItem() { Name = "StableItem", Content = "Stable" };
    choices.Items.Add(stable);
    choices.Items.Add("Last");
    input = new TextBox() { Name = "Input", Text = "Source value" };
    status = new TextBlock() { Name = "Status", Text = "0" };
    var action = new Button() { Name = "Action", Content = "Count" };
    action.Click += Clicked;
    root.Children.Add(choices);
    root.Children.Add(input);
    root.Children.Add(status);
    root.Children.Add(action);
    window.Content = root;
    window.Activate();
    return window;
  }
}`;
let compilation;
let analysis;
const visual = (session, name) => session.vm.platform.scene().nodes.find(node => node.properties.Name === name);
const ref = id => { const [h, g] = id.split(':').map(Number); return {h, g}; };

function launch(engine, text = source) {
  const compiled = text === source ? compilation ??= compileToIL(text) : compileToIL(text);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const session = engine === 'CIL' ? new CilDebugSession(compiled.assembly, {initialThreshold: 64}) :
    new DebugSession(compiled.image, {initialThreshold: 64});
  session.start(false);
  session.runUntilStop();
  assert.ok(['paused', 'waiting', 'terminated'].includes(session.vm.state));
  return session;
}

// Exercise the actual managed ABI without claiming unsupported C# literal syntax compiles.
function seedTypedItems(session, entries) {
  const platform = session.vm.platform;
  const owner = ref(visual(session, 'Choices').id);
  const list = platform.getProperty(owner, {
    owner: CONTROLS + 'ComboBox', property: 'Items', result: 'Microsoft.UI.Xaml.ItemCollection'
  });
  platform.heap.withRoots([owner, list], () => {
    const items = [];
    for (const [type, value] of entries) {
      const item = platform.heap.allocate('box', type, [value]);
      platform.heap.pins.push(item);
      items.push(item);
    }
    platform.replaceItems(list, items);
  });
}

function linked(session) {
  analysis ??= readDesignSource(source);
  const scene = session.vm.platform.scene();
  const captured = designFromScene(scene, {collectionOwners: [{type: CONTROLS + 'ComboBox', name: 'Choices'}]});
  const bound = bindLinkedLiveDesign(analysis.document, captured, {scene});
  const document = new DesignDocument(bound.document);
  const choices = document.value.nodes.find(node => node.properties.Name === 'Choices');
  return {before: bound.baseline, document, choices};
}

function items(session) {
  const scene = session.vm.platform.scene();
  const nodes = new Map(scene.nodes.map(node => [node.id, node]));
  const control = scene.nodes.find(node => node.properties.Name === 'Choices');
  return control.collections.Items.map(value => value?.$ref ? nodes.get(value.$ref).properties.Content : value);
}

for (const engine of ['source', 'CIL']) {
  test(engine + ': source-owned Items capture preserves scalar types and a live collection owner', () => {
    const session = launch(engine);
    const {before, choices} = linked(session);
    assert.deepEqual(items(session), [true, false, 1, 1.5, 'Stable', 'Last']);
    assert.equal(choices.children.length, 0);
    assert.equal(choices.collections.Items[4].type, CONTROLS + 'ComboBoxItem');
    assert.equal(choices.collections.Items[4].properties.Content, 'Stable');
    assert.equal(before.nodes.length, analysis.document.nodes.length);
    assert.ok(choices.runtimeId);
    const captured = designFromScene(session.vm.platform.scene());
    const live = captured.nodes.find(node => node.runtimeId === choices.runtimeId);
    assert.deepEqual(live.collections.Items.slice(0, 4), [true, false, 1, 1.5]);
    assert.equal(live.collections.Items[4].properties.Name, 'StableItem');
  });

  test(engine + ': Items reorder/add/remove preserves retained objects, user selection, other input and managed callbacks', () => {
    const session = launch(engine);
    const {before, document, choices} = linked(session);
    const kept = choices.collections.Items[4];
    const stableId = visual(session, 'StableItem').id;
    const action = visual(session, 'Action');
    const input = visual(session, 'Input');
    session.vm.platform.dispatchEvent(input.id, 'TextChanged', {value: 'User typed'});
    session.vm.platform.dispatchEvent(choices.runtimeId, 'SelectionChanged', {value: 4});
    session.vm.platform.dispatchEvent(action.id, 'Click');
    session.runUntilStop();
    document.change('Edit Items', draft => {
      draft.nodes.find(node => node.id === choices.id).collections.Items = [kept, 'Last', false, 'Inserted', 2.5,
        {type: CONTROLS + 'ComboBoxItem', properties: {Name: 'NewItem', Content: 'New'}}, true];
    });
    const patch = designPatch(before, document.value);
    assert.deepEqual(patch.commands.map(command => command.op), ['collection']);
    const result = applyDesignPatch(session, patch);
    assert.equal(result.revision, 1);
    assert.deepEqual(items(session), ['Stable', 'Last', false, 'Inserted', 2.5, 'New', true]);
    assert.equal(visual(session, 'StableItem').id, stableId);
    assert.equal(visual(session, 'Choices').properties.SelectedIndex, 0);
    assert.deepEqual(visual(session, 'Choices').properties.SelectedItem, {$ref: stableId});
    assert.equal(visual(session, 'Input').id, input.id);
    assert.equal(visual(session, 'Input').properties.Text, 'User typed');
    session.vm.platform.dispatchEvent(action.id, 'Click');
    session.runUntilStop();
    assert.equal(visual(session, 'Status').properties.Text, 'User typed:2');
    session.vm.heap.collect();
    assert.equal(visual(session, 'StableItem').id, stableId);
    assert.equal(visual(session, 'NewItem').properties.Content, 'New');
  });

  test(engine + ': failed collection batches restore the heap, visible scene, revision and emitted UI transaction', () => {
    const session = launch(engine);
    const {before, document, choices} = linked(session);
    document.change('Edit Items', draft => {
      draft.nodes.find(node => node.id === choices.id).collections.Items = [{type: 'ComboBoxItem', properties: {Content: 'Temporary'}}];
    });
    const patch = designPatch(before, document.value);
    patch.commands.push({op: 'set', id: choices.id, property: 'MissingProperty', value: 5});
    const scene = structuredClone(session.vm.platform.scene());
    const heap = session.vm.heap.snapshot();
    const emitted = [];
    const onCommand = session.vm.platform.options.onUICommand;
    session.vm.platform.options.onUICommand = command => emitted.push(command);
    try {
      assert.throws(() => applyDesignPatch(session, patch), /Unknown property/);
      assert.deepEqual(session.vm.platform.scene(), scene);
      const restored = session.vm.heap.snapshot();
      // Rollback restores records and roots, but consumed identities must never be reused.
      assert.ok(restored.generationCounter > heap.generationCounter);
      assert.ok(restored.nextHandleId >= heap.nextHandleId);
      assert.deepEqual(restored, {
        ...heap, generationCounter: restored.generationCounter, nextHandleId: restored.nextHandleId
      });
      const fresh = session.vm.heap.string('After failed collection transaction');
      assert.ok(fresh.g > restored.generationCounter);
      assert.equal(session.designRevision ?? 0, 0);
      assert.deepEqual(emitted, []);
    } finally {
      session.vm.platform.options.onUICommand = onCommand;
    }
  });

  test(engine + ': runtime Items drift and malformed or oversized collection patches are rejected atomically', () => {
    const session = launch(engine);
    const {before, document, choices} = linked(session);
    document.change('Append item', draft => { draft.nodes.find(node => node.id === choices.id).collections.Items.push('New'); });
    const patch = designPatch(before, document.value);
    const platform = session.vm.platform;
    const owner = ref(choices.runtimeId);
    const list = platform.getProperty(owner, {owner: CONTROLS + 'ComboBox', property: 'Items', result: 'Microsoft.UI.Xaml.ItemCollection'});
    const original = platform.items(list);
    platform.replaceItems(list, original.slice(1));
    const drifted = structuredClone(platform.scene());
    assert.throws(() => applyDesignPatch(session, patch), {code: 'SFDL0011'});
    assert.deepEqual(platform.scene(), drifted);
    platform.replaceItems(list, original);
    for (const items of [new Array(1001).fill('Too many'), [{type: 'System.Object', properties: {Unsupported: true}}]]) {
      const invalid = structuredClone(patch);
      invalid.commands[0].items = items;
      const scene = structuredClone(platform.scene());
      assert.throws(() => applyDesignPatch(session, invalid));
      assert.deepEqual(platform.scene(), scene);
      assert.equal(session.designRevision ?? 0, 0);
    }
  });

  test(engine + ': Items can be explicitly replaced by visual children and then by a closed collection', () => {
    const session = launch(engine);
    const {before, document, choices} = linked(session);
    document.change('Clear Items metadata', draft => { delete draft.nodes.find(node => node.id === choices.id).collections; });
    const id = document.add('ComboBoxItem', choices.id, {Name: 'ChildItem', Content: 'Visual child'});
    const first = applyDesignPatch(session, designPatch(before, document.value));
    assert.deepEqual(items(session), ['Visual child']);
    const childBaseline = document.snapshot();
    for (const item of childBaseline.nodes) item.runtimeId = first.bindings[item.id];
    const changed = new DesignDocument(childBaseline);
    changed.remove([id]);
    changed.change('Replace with Items', draft => {
      draft.nodes.find(node => node.id === choices.id).collections = {Items: ['Closed again', false]};
    });
    applyDesignPatch(session, designPatch(childBaseline, changed.value), {expectedRevision: 1});
    assert.deepEqual(items(session), ['Closed again', false]);
    assert.equal(visual(session, 'ChildItem'), undefined);
  });

  test(engine + ': typed ABI integer boundaries remain exact through live capture and insertion', () => {
    const entries = [
      ['System.Int32', 2147483647],
      ['System.UInt32', -2147483648],
      ['System.UInt32', -1],
      ['System.Int64', 4294967296n],
      ['System.Int64', 9007199254740991n],
      ['System.UInt64', 9007199254740991n],
      ['System.Int64', -9007199254740991n]
    ];
    const values = [2147483647, 2147483648, 4294967295, 4294967296,
      Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
    const session = launch(engine);
    seedTypedItems(session, entries);
    const before = designFromScene(session.vm.platform.scene());
    const document = new DesignDocument(before);
    const choices = document.value.nodes.find(node => node.properties.Name === 'Choices');
    assert.deepEqual(choices.collections.Items, values);
    document.change('Append typed values', draft => { draft.nodes.find(node => node.id === choices.id).collections.Items.push(...values); });
    applyDesignPatch(session, designPatch(before, document.value));
    assert.deepEqual(items(session).slice(-values.length), values);
  });

  test(engine + ': unsafe ABI integers stay exact and produce an explicit inspection diagnostic', () => {
    const session = launch(engine);
    seedTypedItems(session, [['System.Int64', 9223372036854775807n], ['System.UInt64', -1n]]);
    const scene = session.vm.platform.scene();
    assert.deepEqual(scene.nodes.find(node => node.properties.Name === 'Choices').collections.Items,
      [9223372036854775807n, 18446744073709551615n]);
    assert.throws(() => designFromScene(scene), error => error.code === 'SFDL0010' &&
      error.diagnostics.some(diagnostic => diagnostic.capability === 'scene.collection' && /lossless/.test(diagnostic.message)));
  });
}

test('the current compiler reports unsupported out-of-range, long and unsigned literal syntax', () => {
  for (const [literal, code] of [
    ['2147483648', 'SF2004'], ['4294967296', 'SF1004'], ['9223372036854775807L', 'SF1003'], ['4294967295U', 'SF1003']
  ]) {
    const text = source.replace('choices.Items.Add(true);', `choices.Items.Add(${literal});`);
    const compiled = compileToIL(text);
    assert.equal(compiled.success, false, literal);
    assert.ok(compiled.diagnostics.some(diagnostic => diagnostic.code === code && diagnostic.severity === 'error'),
      literal + ': ' + JSON.stringify(compiled.diagnostics));
  }
});
