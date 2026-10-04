import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, DesignerCollectionDraft, readDesignSource, planDesignSourceUpdate, designSourceSnapshot,
  generateDesignProject, generateDesignerNodeStatements, createDesign
} from '@sharpforge/designer';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {CONTROLS} from '@sharpforge/framework';

const source = `using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
class View {
  static void Main() { Create(); }
  static Window Create() {
    var window = new Window();
    var root = new Canvas();
    var choices = new ComboBox() { Name = "Choices", Width = 160 };
    choices.Items.Add("First"); // scalar comment
    ComboBoxItem item = new ComboBoxItem() { Content = "Second" }; // object comment
    choices.Items.Add(item);
    choices.Items.Add("Third");
    root.Children.Add(choices);
    window.Content = root;
    window.Activate();
    return window;
  }
  // unrelated method
  static string Spare() { return "preserve exactly"; }
}`;
const expected = ['First', {type: CONTROLS + 'ComboBoxItem', properties: {Content: 'Second'}}, 'Third'];
const choicesOf = analysis => analysis.document.nodes.find(node => node.properties.Name === 'Choices');

function edit(analysis, update) {
  const document = new DesignDocument(analysis.document);
  const draft = new DesignerCollectionDraft(document, choicesOf(analysis).id, 'Items');
  update(draft);
  draft.apply();
  return planDesignSourceUpdate(analysis, document.value, analysis.sources, {requireCompilation: true});
}

function runtimeItems(plan) {
  const compiled = compileToIL(plan.sources);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const values = [];
  for (const vm of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    const scene = vm.platform.scene();
    const nodes = new Map(scene.nodes.map(node => [node.id, node]));
    const control = scene.nodes.find(node => node.properties.Name === 'Choices');
    values.push((control.collections.Items ?? []).map(value => value?.$ref ? nodes.get(value.$ref).properties.Content : value));
  }
  return values;
}

test('closed scalar and object Items become an owned value collection with byte-identical no-op source', () => {
  const analysis = readDesignSource(source);
  const choices = choicesOf(analysis);
  assert.deepEqual(choices.collections.Items, expected);
  assert.equal(analysis.document.nodes.length, 3);
  assert.equal(analysis.detached.length, 0);
  assert.equal(analysis.structuralEditable, true);
  assert.equal(designSourceSnapshot(analysis).bindings[choices.id].collections.Items.capability, 'edit');
  assert.equal(planDesignSourceUpdate(analysis, analysis.document).text, source);
});

test('Items reorder, replacement and insertion preserve unrelated source and execute on source and CIL VMs', () => {
  const plan = edit(readDesignSource(source), draft => {
    draft.move(2, 0);
    draft.set(2, {type: 'ComboBoxItem', properties: {Content: 'Replaced'}});
    draft.add(true);
    draft.add(false);
    draft.add(1);
  });
  assert.deepEqual(choicesOf(plan.analysis).collections.Items,
    ['Third', 'First', {type: CONTROLS + 'ComboBoxItem', properties: {Content: 'Replaced'}}, true, false, 1]);
  assert.ok(plan.text.includes('// scalar comment'));
  assert.ok(plan.text.includes('// object comment'));
  assert.ok(plan.text.includes('var choices = new ComboBox() { Name = "Choices", Width = 160 };'));
  assert.ok(plan.text.includes(source.slice(source.indexOf('  // unrelated method'))));
  assert.deepEqual(runtimeItems(plan), [['Third', 'First', 'Replaced', true, false, 1], ['Third', 'First', 'Replaced', true, false, 1]]);
});

test('clearing Items removes only their owned Add and object construction statements', () => {
  const plan = edit(readDesignSource(source), draft => {
    while (draft.items.length) draft.remove(draft.items.length - 1);
  });
  assert.deepEqual(choicesOf(plan.analysis).collections?.Items ?? [], []);
  assert.ok(!plan.text.includes('new ComboBoxItem'));
  assert.ok(!plan.text.includes('choices.Items.Add'));
  assert.ok(plan.text.includes('root.Children.Add(choices);'));
  assert.deepEqual(runtimeItems(plan), [[], []]);
});

test('named collection insertion emits its items in the same structural transaction', () => {
  const text = source.split('\n').filter(line => !line.includes('choices') && !line.includes('ComboBoxItem item')).join('\n');
  const analysis = readDesignSource(text);
  const document = new DesignDocument(analysis.document);
  const id = document.add('ComboBox', 'root', {Name: 'Choices'});
  const draft = new DesignerCollectionDraft(document, id, 'Items');
  draft.add('New');
  draft.add({type: 'ComboBoxItem', properties: {Content: 'Object'}});
  draft.apply();
  const plan = planDesignSourceUpdate(analysis, document.value, text, {requireCompilation: true});
  assert.deepEqual(choicesOf(plan.analysis).collections.Items,
    ['New', {type: CONTROLS + 'ComboBoxItem', properties: {Content: 'Object'}}]);
  assert.deepEqual(runtimeItems(plan), [['New', 'Object'], ['New', 'Object']]);
});

test('deleting a collection owner removes all exclusively owned item dependencies', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  document.remove([choicesOf(analysis).id]);
  const plan = planDesignSourceUpdate(analysis, document.value, source, {requireCompilation: true});
  assert.ok(!plan.text.includes('choices'));
  assert.ok(!plan.text.includes('ComboBoxItem'));
  assert.equal(plan.document.nodes.length, 2);
});

test('closed inline Items object initializers round-trip with their normalized property bag', () => {
  const text = source.replace('ComboBoxItem item = new ComboBoxItem() { Content = "Second" }; // object comment\n    ', '')
    .replace('choices.Items.Add(item)', 'choices.Items.Add(new ComboBoxItem() { Content = "Second" })');
  const analysis = readDesignSource(text);
  assert.deepEqual(choicesOf(analysis).collections.Items, expected);
  assert.equal(planDesignSourceUpdate(analysis, analysis.document).text, text);
});

for (const operation of ['choices.Items.Clear();', 'choices.Items[0] = "Dynamic";', 'Console.WriteLine(choices.Items);']) {
  test('unknown collection operation remains protected: ' + operation, () => {
    const analysis = readDesignSource(source.replace('root.Children.Add(choices);', operation + '\n    root.Children.Add(choices);'));
    assert.equal(designSourceSnapshot(analysis).bindings[choicesOf(analysis).id].collections.Items.capability, 'navigate');
    assert.throws(() => edit(analysis, draft => draft.add('Unsafe')), error => ['SFSYNC_DYNAMIC', 'SFSYNC_OWNERSHIP'].includes(error.code));
    const document = new DesignDocument(analysis.document);
    document.setProperty('Width', 180, [choicesOf(analysis).id]);
    const plan = planDesignSourceUpdate(analysis, document.value);
    assert.equal(plan.text, analysis.text.replace('Width = 160', 'Width = 180'));
  });
}

test('dynamic item values retain the prior collection preview and refuse writeback', () => {
  const previous = readDesignSource(source);
  const text = source.replace('choices.Items.Add("Third")', 'choices.Items.Add(Spare())');
  const analysis = readDesignSource(text, {previous});
  assert.deepEqual(choicesOf(analysis).collections.Items, expected);
  assert.equal(analysis.bindings.choices.collections.Items.dynamic, true);
  assert.throws(() => edit(analysis, draft => draft.add('Unsafe')), error => error.code === 'SFSYNC_DYNAMIC');
  assert.equal(planDesignSourceUpdate(analysis, analysis.document).text, text);
});

for (const replacement of ['choices.Items.Add(item);', 'Console.WriteLine(item.Content);']) {
  test('shared or handwritten object references remain protected: ' + replacement, () => {
    const text = source.replace('choices.Items.Add("Third");', replacement);
    const analysis = readDesignSource(text);
    assert.equal(analysis.bindings.choices.collections.Items.dynamic, true);
    assert.throws(() => edit(analysis, draft => draft.add('Unsafe')), error => error.code === 'SFSYNC_DYNAMIC');
    assert.equal(planDesignSourceUpdate(analysis, analysis.document).text, text);
  });
}

test('generated object local names avoid handwritten symbols without changing their declarations', () => {
  const text = source.replace('var choices =', 'int v_item_choices_Items_0 = 17;\n    var choices =');
  const plan = edit(readDesignSource(text), draft => {
    draft.set(0, {type: 'ComboBoxItem', properties: {Content: 'First object'}});
  });
  assert.ok(plan.text.includes('int v_item_choices_Items_0 = 17;'));
  assert.ok(plan.text.includes('ComboBoxItem v_item_choices_Items_0_1 = new'));
  assert.equal(plan.compilationSucceeded, true);
});

test('the shared generator retains default names and accepts an explicit scoped item allocator', () => {
  const node = {id: 'choices', type: CONTROLS + 'ComboBox', collections: {Items: [expected[1]]}};
  const normal = generateDesignerNodeStatements({}, node, 'choices');
  const allocated = generateDesignerNodeStatements({}, node, 'choices', {itemName: () => 'uniqueItem'});
  assert.ok(normal[0].includes('item_v_choices_Items_0'));
  assert.ok(allocated[0].includes('uniqueItem'));
  assert.equal(allocated.at(-1), 'choices.Items.Add(uniqueItem);');
});

test('generated authoring projects reopen with scalar and object Items', () => {
  const document = new DesignDocument(createDesign('Generated items'));
  const id = document.add('ComboBox', 'canvas', {Name: 'Choices'});
  const draft = new DesignerCollectionDraft(document, id, 'Items');
  expected.forEach(item => draft.add(item));
  draft.apply();
  const files = generateDesignProject(document.value).filter(file => file.path.endsWith('.cs'));
  const uri = 'DesignedView.g.cs';
  const analysis = readDesignSource(files.find(file => file.path === uri).text,
    {uri, sources: files.map(file => ({uri: file.path, text: file.text}))});
  assert.deepEqual(choicesOf(analysis).collections.Items, expected);
  assert.equal(analysis.compilationSucceeded, true);
});

test('field-backed visual Items retain their existing outline identities', () => {
  const document = new DesignDocument(createDesign('Visual items'));
  const owner = document.add('ComboBox', 'canvas', {Name: 'Choices'});
  const child = document.add('ComboBoxItem', owner, {Content: 'Visual child'});
  const files = generateDesignProject(document.value).filter(file => file.path.endsWith('.cs'));
  const analysis = readDesignSource(files.find(file => file.path === 'DesignedView.g.cs').text,
    {sources: files.map(file => ({uri: file.path, text: file.text}))});
  assert.deepEqual(choicesOf(analysis).children, [child]);
  assert.equal(choicesOf(analysis).collections?.Items, undefined);
  assert.ok(analysis.document.nodes.some(node => node.id === child));
  assert.equal(analysis.compilationSucceeded, true);
});

test('source collection analysis enforces the 1000-item bound', () => {
  const bare = source.split('\n').filter(line => !line.includes('choices.Items.Add') && !line.includes('ComboBoxItem item')).join('\n');
  const values = Array.from({length: 1001}, (_, index) => `choices.Items.Add(${index});`).join('\n');
  const text = bare.replace('root.Children.Add(choices);', values + '\nroot.Children.Add(choices);');
  assert.throws(() => readDesignSource(text), error => error.code === 'SFSYNC_LIMIT');
});

test('runtime visual-state metadata requires its matching framework source capability', () => {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  document.change('Runtime state', design => {
    design.nodes.find(node => node.id === 'choices').states = [
      {name: 'Display', states: [{name: 'Wide', setters: [{target: 'choices', property: 'Width', value: 300}]}]}
    ];
  });
  assert.throws(() => planDesignSourceUpdate(analysis, document.value), error => error.code === 'SFSYNC_OWNERSHIP');
  assert.equal(analysis.text, source);
});

test('adaptive authoring never takes ownership of custom construction calls around Items', () => {
  const text = source.replace('root.Children.Add(choices);', 'Spare();\n    root.Children.Add(choices);');
  const analysis = readDesignSource(text);
  const document = new DesignDocument(analysis.document);
  document.change('Runtime state', design => {
    design.responsive = {version: 1, states: [{id: 'Wide', minWidth: 600, overrides: {choices: {Width: 300}}}]};
  });
  assert.throws(() => planDesignSourceUpdate(analysis, document.value), error => error.code === 'SFSYNC_OWNERSHIP');
  assert.equal(analysis.text, text);
  assert.equal(planDesignSourceUpdate(analysis, analysis.document).text, text);
});
