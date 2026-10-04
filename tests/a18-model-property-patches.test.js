import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, DesignGeometrySession, DesignerTemplateScope, createDesign, normalizeDesignerBrush, resolvedProperties
} from '@sharpforge/designer';
import {MEDIA} from '@sharpforge/framework';

function fixture(context, options = {}, value = createDesign('Property patches')) {
  const document = new DesignDocument(value, options);
  context.after(() => document.dispose());
  return document;
}

function observe(context, document) {
  const events = [];
  context.after(document.subscribe(event => events.push(structuredClone(event))));
  return events;
}

function state(document, events) {
  return {value: document.snapshot(), revision: document.revision, savedRevision: document.savedRevision,
    selection: [...document.selection], undo: document.undoStack.length, redo: document.redoStack.length,
    events: structuredClone(events)};
}

function atomicRejection(document, events, operation, error) {
  const before = state(document, events);
  assert.throws(operation, error);
  assert.deepEqual(state(document, events), before);
}

function changedProperties(event) {
  assert.deepEqual(Object.keys(event.changes).sort(), ['kind', 'nodes']);
  assert.equal(event.changes.kind, 'properties');
  const result = {};
  for (const node of event.changes.nodes) {
    assert.deepEqual(Object.keys(node).sort(), ['id', 'properties']);
    assert.equal(Object.hasOwn(result, node.id), false, 'Each changed control is reported once');
    assert.equal(new Set(node.properties).size, node.properties.length, 'Changed keys are unique');
    result[node.id] = [...node.properties].sort();
  }
  return result;
}

test('A18 property patches normalize every target and emit exact changed keys for one undo/redo unit', context => {
  const document = fixture(context);
  document.select(['action', 'caption']);
  const before = document.snapshot();
  const events = observe(context, document);
  assert.equal(document.patchProperties({action: {Width: '240', Height: '40', Left: 75.5}, caption: {Top: '123'}},
    {label: 'Resize selection', expectedRevision: 0}), true);
  assert.equal(document.node('action').properties.Width, 240);
  assert.equal(document.node('action').properties.Left, 75.5);
  assert.equal(document.node('action').properties.Height, 40);
  assert.equal(document.node('caption').properties.Top, 123);
  assert.equal(document.revision, 1);
  assert.equal(document.undoStack.length, 1);
  assert.deepEqual(document.selection, ['action', 'caption']);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'Resize selection');
  assert.equal(events[0].revision, 1);
  assert.deepEqual(events[0].selection, ['action', 'caption']);
  const expected = {action: ['Left', 'Width'], caption: ['Top']};
  assert.deepEqual(changedProperties(events[0]), expected);
  const after = document.snapshot();
  assert.equal(document.undo(), true);
  assert.deepEqual(document.snapshot(), before);
  assert.deepEqual(document.selection, ['action', 'caption']);
  assert.equal(events[1].kind, 'undo');
  assert.deepEqual(changedProperties(events[1]), expected);
  assert.equal(document.undo(true), true);
  assert.deepEqual(document.snapshot(), after);
  assert.equal(events[2].kind, 'redo');
  assert.deepEqual(changedProperties(events[2]), expected);
  assert.equal(document.revision, 3);
});

test('A18 empty and normalized no-op patches preserve revision, events, selection and pending redo', context => {
  const document = fixture(context);
  const events = observe(context, document);
  document.patchProperties({action: {Width: 240}});
  assert.equal(events[0].kind, 'Edit properties');
  document.undo();
  const before = state(document, events);
  for (const patch of [{}, {action: {}}, {action: {Width: '160', Height: 40, Opacity: undefined}}]) {
    assert.equal(document.patchProperties(patch), false);
    assert.deepEqual(state(document, events), before);
  }
  assert.equal(document.undo(true), true);
  assert.equal(document.node('action').properties.Width, 240);
});

test('A18 undefined removes a local property and history restores its presence independently of its style', context => {
  const value = createDesign('Style reset');
  value.styles.Accent.setters.Width = 91;
  const document = fixture(context, {}, value);
  const events = observe(context, document);
  assert.equal(document.patchProperties({action: {Width: undefined}}), true);
  assert.equal(Object.hasOwn(document.node('action').properties, 'Width'), false);
  assert.equal(resolvedProperties(document.value, document.node('action')).properties.Width, 91);
  assert.equal(document.value.styles.Accent.setters.Width, 91);
  assert.deepEqual(changedProperties(events[0]), {action: ['Width']});
  document.undo();
  assert.equal(document.node('action').properties.Width, 160);
  document.undo(true);
  assert.equal(Object.hasOwn(document.node('action').properties, 'Width'), false);
  assert.equal(document.value.styles.Accent.setters.Width, 91);
});

test('A18 invalid, missing, unknown and out-of-range later targets reject the entire property patch', context => {
  const document = fixture(context);
  const events = observe(context, document);
  const invalid = [
    {action: {Width: 200}, title: {Width: -1}},
    {action: {Width: 200}, title: {Width: Infinity}},
    {action: {Width: 200}, title: {Opacity: 1.01}},
    {action: {Width: 200}, title: {Row: 1.5}},
    {action: {Width: 200}, title: {Row: 2147483648}},
    {action: {Width: 200}, title: {RowSpan: 0}},
    {action: {Width: 200}, title: {UnknownProperty: 20}},
    {action: {Width: 200}, title: {UnknownProperty: undefined}},
    {action: {Width: 200}, title: {Width: null}},
    {action: {Width: 200}, missing: {Width: 20}}
  ];
  for (const patch of invalid) atomicRejection(document, events, () => document.patchProperties(patch), TypeError);
  assert.equal(document.patchProperties({action: {Width: 0, Opacity: 0}, title: {Row: 0, RowSpan: 1, Opacity: 1}}), true);
  assert.equal(document.node('action').properties.Width, 0);
  assert.equal(document.node('action').properties.Opacity, 0);
  assert.equal(document.node('title').properties.Opacity, 1);
});

test('A18 property patch dictionaries enforce input and bounded target/property shapes atomically', context => {
  const document = fixture(context);
  const events = observe(context, document);
  for (const patch of [null, [], {action: null}, {action: []}]) {
    atomicRejection(document, events, () => document.patchProperties(patch), TypeError);
  }
  const targets = Object.fromEntries(Array.from({length: 5001}, (_, index) => ['node_' + index, {Width: 20}]));
  atomicRejection(document, events, () => document.patchProperties(targets), RangeError);
  const properties = Object.fromEntries(Array.from({length: 129}, (_, index) => ['Property_' + index, 20]));
  atomicRejection(document, events, () => document.patchProperties({action: properties}), RangeError);
});

for (const source of ['binding', 'resource']) {
  test(`A18 property patches retain ${source} expressions and reject both overwriting and clearing them`, context => {
    const value = createDesign('Protected source');
    const action = value.nodes.find(node => node.id === 'action');
    delete action.properties.Width;
    if (source === 'binding') action.bindings = {Width: {path: 'Sizing.Width', mode: 'OneWay'}};
    else {
      value.resources = {SharedWidth: {kind: 'value', type: 'double', value: 180}};
      action.resourceReferences = {Width: {kind: 'static', key: 'SharedWidth'}};
    }
    const document = fixture(context, {}, value);
    const events = observe(context, document);
    for (const width of [220, undefined]) {
      atomicRejection(document, events,
        () => document.patchProperties({caption: {Top: 123}, action: {Width: width}}),
        {code: source === 'binding' ? 'SFD1820' : 'SFD1821'});
    }
    assert.equal(document.patchProperties({action: {Height: 44}}), true);
    assert.equal(document.node('action').properties.Height, 44);
    assert.deepEqual(document.node('action')[source === 'binding' ? 'bindings' : 'resourceReferences'],
      action[source === 'binding' ? 'bindings' : 'resourceReferences']);
    assert.deepEqual(changedProperties(events[0]), {action: ['Height']});
  });
}

test('A18 isolated template bindings reject local property patches without modifying their owner', context => {
  const owner = fixture(context);
  owner.setTemplate('Frame', {targetType: 'Button', root: {id: 'frame', type: 'Border',
    properties: {Padding: 4}, bindings: {Width: 'Width'}, children: []}});
  const scope = new DesignerTemplateScope(owner, 'Frame');
  context.after(() => { scope.cancel(); scope.document.dispose(); });
  const events = observe(context, scope.document);
  const ownerBefore = owner.snapshot();
  for (const width of [200, undefined]) {
    atomicRejection(scope.document, events, () => scope.document.patchProperties({frame: {Padding: 9, Width: width}}),
      {code: 'SFD1840'});
  }
  assert.deepEqual(owner.snapshot(), ownerBefore);
  assert.equal(scope.document.node('frame').templatePropertyBindings.Width, 'Width');
});

test('A18 canEdit rejects one protected or locked property before any target is committed', context => {
  const document = fixture(context);
  const events = observe(context, document);
  const checked = [];
  const canEdit = (id, property) => {
    checked.push([id, property]);
    return !(id === 'action' && property === 'Width');
  };
  atomicRejection(document, events, () => document.patchProperties({caption: {Top: 123}, action: {Width: 220}}, {canEdit}),
    {code: 'SFD1840'});
  assert(checked.some(([id, property]) => id === 'action' && property === 'Width'));
  assert.equal(document.patchProperties({action: {Height: 42}}, {canEdit}), true);
  assert.equal(document.node('action').properties.Height, 42);
});

test('A18 read-only, stale and disposed property edits cannot publish state or history', context => {
  const document = fixture(context);
  const events = observe(context, document);
  document.setReadOnly(true, 'Inherited source preview');
  atomicRejection(document, events, () => document.patchProperties({action: {Width: 220}}), {code: 'SFD1865'});
  document.setReadOnly(false);
  document.patchProperties({action: {Width: 180}});
  atomicRejection(document, events, () => document.patchProperties({action: {Width: 220}}, {expectedRevision: 0}), /changed/);
  document.dispose();
  const before = state(document, events);
  assert.throws(() => document.patchProperties({action: {Width: 220}}), /disposed/);
  assert.deepEqual(state(document, events), before);
});

test('A18 property history preserves mutable runtime bindings including runtime identifier zero', context => {
  const value = createDesign('Runtime bindings');
  value.nodes.find(node => node.id === 'action').runtimeId = 0;
  const document = fixture(context, {}, value);
  const events = observe(context, document);
  document.patchProperties({action: {Width: 220}});
  assert.equal(document.node('action').runtimeId, 0);
  assert.deepEqual(changedProperties(events[0]), {action: ['Width']});
  document.node('action').runtimeId = 902;
  document.undo();
  assert.equal(document.node('action').properties.Width, 160);
  assert.equal(document.node('action').runtimeId, 902);
  document.undo(true);
  assert.equal(document.node('action').properties.Width, 220);
  assert.equal(document.node('action').runtimeId, 902);
});

test('A18 nested patch inputs and exposed value aliases cannot rewrite captured before/after history', context => {
  const value = createDesign('Detached history');
  value.nodes.find(node => node.id === 'action').properties.Background = normalizeDesignerBrush('#112233');
  const document = fixture(context, {}, value);
  const original = structuredClone(document.node('action').properties.Background);
  const beforeAlias = document.node('action').properties.Background;
  const brush = normalizeDesignerBrush({valueType: MEDIA + 'LinearGradientBrush',
    GradientStops: [{Offset: 0, Color: '#ff0000'}, {Offset: 1, Color: '#0000ff'}]});
  const committed = structuredClone(brush);
  const padding = [1, 2, 3, 4];
  document.patchProperties({action: {Background: brush, Padding: padding}});
  brush.GradientStops[0].Color.R = 3;
  brush.StartPoint.X = 9;
  padding[0] = 900;
  assert.deepEqual(document.node('action').properties.Background, committed);
  assert.equal(document.node('action').properties.Padding.Left, 1);
  beforeAlias.Color.R = 199;
  const afterAlias = document.node('action').properties.Background;
  afterAlias.GradientStops[1].Color.B = 17;
  document.node('action').properties.Padding.Left = 888;
  document.undo();
  assert.deepEqual(document.node('action').properties.Background, original);
  assert.equal(Object.hasOwn(document.node('action').properties, 'Padding'), false);
  afterAlias.GradientStops[0].Offset = 0.25;
  document.undo(true);
  assert.deepEqual(document.node('action').properties.Background, committed);
  assert.deepEqual(['Left', 'Top', 'Right', 'Bottom'].map(key => document.node('action').properties.Padding[key]), [1, 2, 3, 4]);
});

test('A18 generic and property history retain detached values and replay in their original order', context => {
  const document = fixture(context);
  document.patchProperties({action: {Width: 180}});
  const oldValue = document.value;
  document.change('Rename document', candidate => { candidate.name = 'Renamed'; });
  oldValue.nodes.find(node => node.id === 'action').properties.Width = 999;
  assert.equal(document.node('action').properties.Width, 180);
  document.patchProperties({caption: {Top: 130}});
  assert.equal(document.undoStack.length, 3);
  document.undo();
  assert.equal(document.node('caption').properties.Top, 103);
  assert.equal(document.value.name, 'Renamed');
  document.undo();
  assert.equal(document.value.name, 'Property patches');
  assert.equal(document.node('action').properties.Width, 180);
  document.undo();
  assert.equal(document.node('action').properties.Width, 160);
  document.undo(true);
  assert.equal(document.node('action').properties.Width, 180);
  document.undo(true);
  assert.equal(document.value.name, 'Renamed');
  assert.equal(document.node('action').properties.Width, 180);
  document.undo(true);
  assert.equal(document.node('caption').properties.Top, 130);
});

test('A18 Name and Content patches use full validation for identity and child-content rules', context => {
  const document = fixture(context);
  const events = observe(context, document);
  atomicRejection(document, events, () => document.patchProperties({caption: {Top: 123}, action: {Name: 'Title'}}), /unique/);
  assert.equal(document.patchProperties({action: {Name: 'RenamedAction', Width: 220}}), true);
  assert.equal(document.node('action').properties.Name, 'RenamedAction');
  assert.equal(events.at(-1).changes, undefined);
  assert.equal(document.patchProperties({action: {Content: 'Replaced content'}}), true);
  assert.equal(document.node('action').properties.Content, 'Replaced content');
  assert.equal(events.at(-1).changes, undefined);
  document.undo();
  assert.equal(document.node('action').properties.Content, 'Run action');
  assert.equal(events.at(-1).changes, undefined);
  const child = document.add('TextBlock', 'action', {Text: 'Visual content'});
  const before = state(document, events);
  assert.equal(document.patchProperties({action: {Content: 'Cannot replace a visual child'}}), false);
  assert.deepEqual(state(document, events), before);
  assert.deepEqual(document.node('action').children, [child]);
  assert.equal(Object.hasOwn(document.node('action').properties, 'Content'), false);
});

test('A18 replacing the document validator applies custom rules through the full-validation fallback', context => {
  const document = fixture(context);
  const originalValidate = document.contracts.validate;
  let calls = 0;
  document.contracts = {...document.contracts, validate: value => {
    calls++;
    const validated = originalValidate(value);
    if (validated.nodes.find(node => node.id === 'caption').properties.Width > 700) {
      throw new TypeError('Campaign captions cannot exceed 700 pixels');
    }
    return validated;
  }};
  const events = observe(context, document);
  atomicRejection(document, events, () => document.patchProperties({action: {Width: 240}, caption: {Width: 701}}), /700/);
  assert(calls > 0, 'The custom cross-document constraint was evaluated');
  const beforeCalls = calls;
  assert.equal(document.patchProperties({action: {Width: 240}, caption: {Width: 700}}), true);
  assert(calls > beforeCalls);
  assert.equal(document.node('caption').properties.Width, 700);
  assert.equal(events[0].changes, undefined);
  document.undo();
  assert.equal(document.node('action').properties.Width, 160);
  assert.equal(events.at(-1).changes, undefined);
});

test('A18 mutations through public document values force full validation before the next patch', context => {
  const document = fixture(context);
  const events = observe(context, document);
  document.value.nodes.find(node => node.id === 'caption').properties.Width = -1;
  atomicRejection(document, events, () => document.patchProperties({action: {Width: 220}}), /negative/);
  document.value.nodes.find(node => node.id === 'caption').properties.Width = 670;
  document.value.nodes.push({id: 'orphan', type: 'TextBlock', properties: {Text: 'Unparented'}, children: [], events: {}});
  atomicRejection(document, events, () => document.patchProperties({action: {Width: 220}}), /Unparented/);
  document.value.nodes.pop();
  document.value.name = 'External edit';
  assert.equal(document.patchProperties({action: {Width: 220}}), true);
  assert.equal(document.value.name, 'External edit');
  assert.equal(events[0].changes, undefined);
  document.undo();
  assert.equal(document.node('action').properties.Width, 160);
  assert.equal(document.value.name, 'External edit');
});

test('A18 property history honors entry and byte bounds and a new edit truncates pending redo', context => {
  const document = fixture(context, {historyLimit: 2});
  for (const width of [170, 180, 190]) document.patchProperties({action: {Width: width}});
  assert.equal(document.undoStack.length, 2);
  assert.equal(document.undo(), true);
  assert.equal(document.undo(), true);
  assert.equal(document.undo(), false);
  assert.equal(document.node('action').properties.Width, 170);
  assert.equal(document.undo(true), true);
  document.patchProperties({action: {Width: 200}});
  assert.equal(document.redoStack.length, 0);
  assert.equal(document.undo(true), false);
  assert.equal(document.node('action').properties.Width, 200);
  for (const options of [{historyLimit: 0}, {historyByteLimit: 1}]) {
    const bounded = fixture(context, options);
    assert.equal(bounded.patchProperties({action: {Width: 180}}), true);
    assert.equal(bounded.undoStack.length, 0);
    assert.equal(bounded.undo(), false);
    assert.equal(bounded.node('action').properties.Width, 180);
  }
});

test('A18 geometry previews commit only changed coordinates as one public property history unit', context => {
  const document = fixture(context);
  const events = observe(context, document);
  const gesture = new DesignGeometrySession(document, {rectangles: {
    action: {Left: 50, Top: 162, Width: 160, Height: 40}, caption: {Left: 50, Top: 103, Width: 670, Height: 32}
  }});
  context.after(() => gesture.dispose());
  const before = state(document, events);
  gesture.update({x: 5, y: 10});
  gesture.update({x: 15, y: 20});
  assert.deepEqual(state(document, events), before);
  assert.equal(gesture.commit(), true);
  assert.equal(document.node('action').properties.Left, 65);
  assert.equal(document.node('action').properties.Top, 182);
  assert.equal(document.node('caption').properties.Top, 123);
  assert.equal(document.undoStack.length, 1);
  assert.deepEqual(changedProperties(events[0]), {action: ['Left', 'Top'], caption: ['Left', 'Top']});
  document.undo();
  assert.deepEqual(document.snapshot(), before.value);
  document.undo(true);
  assert.equal(document.node('action').properties.Left, 65);
  assert.deepEqual(changedProperties(events[2]), {action: ['Left', 'Top'], caption: ['Left', 'Top']});
});

test('A18 geometry rechecks property permissions and source revision at its final commit boundary', context => {
  const document = fixture(context);
  const events = observe(context, document);
  let editable = true;
  const options = {rectangles: {action: {Left: 50, Top: 162, Width: 160, Height: 40}}, canEdit: () => editable};
  const protectedGesture = new DesignGeometrySession(document, options);
  protectedGesture.nudge({x: 10, y: 20});
  editable = false;
  atomicRejection(document, events, () => protectedGesture.commit(), {code: 'SFD1840'});
  editable = true;
  const staleGesture = new DesignGeometrySession(document, options);
  staleGesture.nudge({x: 10, y: 20});
  document.patchProperties({caption: {Top: 120}});
  atomicRejection(document, events, () => staleGesture.commit(), /changed/);
  protectedGesture.dispose();
  staleGesture.dispose();
});
