import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {
  analyzeDesignSources, CSharpDesignSession, DesignDocument, generateDesignCode, planDesignSourceUpdate, validateDesign
} from '@sharpforge/designer';

const marker = '// SharpForge adaptive states v1: ["Wide","Compact"]';
const uri = 'Views/DesignedView.g.cs';
const options = {uri, className: 'DesignedView', methodName: 'Create'};

function responsiveDesign(width = 960) {
  return validateDesign({version: 1, name: 'DesignedView', width, height: 640, root: 'window', nodes: [
    {id: 'window', type: 'Window', properties: {Title: 'Adaptive source'}, children: ['root']},
    {id: 'root', type: 'Canvas', properties: {Name: 'Root', Width: 960, Height: 640}, children: ['action', 'caption']},
    {id: 'action', type: 'Button', properties: {Name: 'Action', Content: 'Run', Width: 160, Height: 40, Left: 50, Top: 162}, children: []},
    {id: 'caption', type: 'TextBlock', properties: {Text: 'Status', Width: 220, Height: 32, Left: 50, Top: 103}, children: []}
  ], responsive: {version: 1, states: [
    {id: 'Compact', minWidth: 0, maxWidth: 600, overrides: {action: {Width: 100, Left: 8, Top: 24}}},
    {id: 'Wide', minWidth: 600, maxWidth: null, overrides: {action: {Width: 240}}}
  ]}});
}

function generatedSources(width = 960) {
  return [{uri, version: 4, text: generateDesignCode(responsiveDesign(width))}];
}

function analyze(sources, overrides = {}) {
  const analysis = analyzeDesignSources(sources, {...options, uri: sources[0].uri, ...overrides});
  assert.equal(analysis.compilationSucceeded, true, JSON.stringify(analysis.compilerDiagnostics));
  return analysis;
}

function planEdit(analysis, edit, current = analysis.sources) {
  const document = structuredClone(analysis.document);
  const previous = structuredClone(analysis.document);
  const sources = structuredClone(current);
  edit(document);
  const plan = planDesignSourceUpdate(analysis, document, current, {requireCompilation: true});
  assert.equal(plan.compilationSucceeded, true, JSON.stringify(plan.diagnostics));
  assert.deepEqual(analysis.document, previous);
  assert.deepEqual(current, sources);
  return plan;
}

function execute(sources, body, expected, inspect = () => {}) {
  const compilation = compileToIL([...sources, {uri: 'ResponsiveRunner.cs', text: `
    class ResponsiveRunner { static void Main() { ${body} } }`}]);
  assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
  for (const Machine of [VirtualMachine, CilVirtualMachine]) {
    const machine = new Machine(Machine === VirtualMachine ? compilation.image : compilation.assembly);
    const result = machine.run();
    assert.equal(result.state, 'terminated', Machine.name + ': ' + JSON.stringify(result.fault));
    const output = expected.flat();
    assert.equal(result.output.replace(/\r/g, ''), output.length ? output.join('\n') + '\n' : '', Machine.name);
    inspect(machine);
  }
}

function printGeometry(target) {
  return `Console.WriteLine(${target}.Width);
    Console.WriteLine(Microsoft.UI.Xaml.Controls.Canvas.GetLeft(${target}));
    Console.WriteLine(Microsoft.UI.Xaml.Controls.Canvas.GetTop(${target}));`;
}

function fieldPlayback(sources, widths, expected, symbol = 'v_action') {
  const print = printGeometry('DesignedView.' + symbol);
  const steps = widths.map(width => `DesignedView.ApplyAdaptive(${width}); ${print}`).join('\n');
  execute(sources, `DesignedView.Create(); ${print} ${steps}`, expected);
}

function verifyControls(sources, expected) {
  execute(sources, 'DesignedView.Create();', [], machine => {
    const nodes = machine.platform.scene().nodes;
    for (const [name, properties] of Object.entries(expected)) {
      const node = nodes.find(item => item.properties.Name === name);
      if (properties === null) assert.equal(node, undefined, name + ' was still attached');
      else {
        assert.ok(node, 'Missing runtime control ' + name);
        for (const [property, value] of Object.entries(properties)) assert.deepEqual(node.properties[property], value, name + '.' + property);
      }
    }
  });
}

const localConstruction = `
  public static Microsoft.UI.Xaml.Window Create() {
    Microsoft.UI.Xaml.Window window = new Microsoft.UI.Xaml.Window();
    Microsoft.UI.Xaml.Controls.Button action = new Microsoft.UI.Xaml.Controls.Button { Name = "Action", Width = 160, Height = 40 };
    Microsoft.UI.Xaml.Controls.Canvas.SetLeft(action, 50);
    Microsoft.UI.Xaml.Controls.Canvas.SetTop(action, 162);
    window.Content = action;
    ApplyAdaptive(480.0, action);
    window.Activate();
    return window;
  }
`;
const localHelper = `
  // The helper's ordinary comments remain user-authored trivia.
  public static void ApplyAdaptive(double width, Microsoft.UI.Xaml.Controls.Button target) {
    ${marker}
    target.Width = 160; // baseline width
    Microsoft.UI.Xaml.Controls.Canvas.SetLeft(target, 50);
    Microsoft.UI.Xaml.Controls.Canvas.SetTop(target, 162);
    if (width >= 600.0) {
      target.Width = 240; // wide width
      return;
    }
    if (width >= 0.0 && width < 600.0) {
      target.Width = 100;
      Microsoft.UI.Xaml.Controls.Canvas.SetLeft(target, 8);
      Microsoft.UI.Xaml.Controls.Canvas.SetTop(target, 24);
      return;
    }
  }
`;

function localSources(partial = false, extra = '') {
  const wrap = body => `public partial class LocalView {\n${body}\n}\n`;
  const files = [{uri: 'Views/LocalView.g.cs', version: 7,
    text: wrap(localConstruction + (partial ? '' : localHelper) + extra)}];
  if (partial) files.push({uri: 'Views/LocalView.Adaptive.cs', version: 12, text: wrap(localHelper)});
  return files;
}

function localPlayback(sources, widths, expected) {
  // Invoke the compiled helper on the control Create attached, keeping candidate C# unchanged.
  execute(sources, 'LocalView.Create();', [], machine => {
    const methods = machine.inspector ? [...machine.inspector.methods.values()] : machine.image.methods;
    const helpers = methods.filter(method => method.owner === 'LocalView' && method.name === 'ApplyAdaptive');
    assert.equal(helpers.length, 1);
    const helper = machine.inspector ? machine.inspector.getMethod(helpers[0].token) : helpers[0];
    const parameters = machine.inspector ? helper.signature.parameters : helper.parameters.map(parameter => parameter.type);
    assert.deepEqual(parameters, ['double', 'Microsoft.UI.Xaml.Controls.Button']);
    const action = () => {
      const nodes = machine.platform.scene().nodes.filter(node => node.properties.Name === 'Action');
      assert.equal(nodes.length, 1);
      return nodes[0];
    };
    const initial = action();
    const [h, g] = initial.id.split(':').map(Number);
    const reference = Object.freeze({h, g});
    assert.equal(machine.heap.get(reference).type, 'Microsoft.UI.Xaml.Controls.Button');
    const geometry = node => [node.properties.Width, node.properties.Left, node.properties.Top];
    const observed = [geometry(initial)];
    for (const width of widths) {
      machine.call(helper.token ?? helper.id, [machine.platform.managed(width, 'double'), reference]);
      machine.state = 'ready';
      const result = machine.run();
      assert.equal(result.state, 'terminated', machine.constructor.name + ': ' + JSON.stringify(result.fault));
      const node = action();
      assert.equal(node.id, initial.id);
      observed.push(geometry(node));
    }
    assert.deepEqual(observed, expected, machine.constructor.name);
  });
}

test('A18 generated adaptive source reopens normalized states and preserves the construction baseline', () => {
  const sources = generatedSources();
  assert.ok(sources[0].text.includes(marker));
  const analysis = analyze(sources);
  assert.deepEqual(analysis.document, responsiveDesign());
  assert.equal(analysis.structuralEditable, true);
  assert.equal(analysis.document.nodes.find(node => node.id === 'action').properties.Width, 160);
  fieldPlayback(sources, [599, 600, 900, 300], [
    [240, 50, 162], [100, 8, 24], [240, 50, 162], [240, 50, 162], [100, 8, 24]
  ]);
});

test('A18 adaptive initialization width round-trips independently of the canvas width', () => {
  const sources = generatedSources(480);
  const analysis = analyze(sources);
  assert.equal(analysis.document.width, 480);
  assert.equal(analysis.document.nodes.find(node => node.id === 'root').properties.Width, 960);
  fieldPlayback(sources, [600], [[100, 8, 24], [240, 50, 162]]);
  const plan = planEdit(analysis, document => { document.width = 800; });
  assert.equal(plan.document.width, 800);
  assert.deepEqual(plan.document.responsive, analysis.document.responsive);
  fieldPlayback(plan.sources, [300], [[240, 50, 162], [100, 8, 24]]);
});

test('A18 adaptive no-op source plans preserve LF, CRLF, integer lexemes and comments byte for byte', () => {
  const original = localSources()[0];
  for (const text of [original.text, original.text.replaceAll('\n', '\r\n')]) {
    const sources = [{...original, text}];
    const analysis = analyze(sources, {className: 'LocalView'});
    const plan = planDesignSourceUpdate(analysis, analysis.document, sources, {requireCompilation: true});
    assert.equal(plan.text, text);
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.sources, sources);
  }
});

test('A18 baseline property edits refresh every adaptive reset without changing state overrides', () => {
  const analysis = analyze(generatedSources());
  const plan = planEdit(analysis, document => {
    Object.assign(document.nodes.find(node => node.id === 'action').properties, {Width: 180, Left: 60, Top: 172});
  });
  assert.deepEqual(plan.document.responsive, analysis.document.responsive);
  assert.equal(plan.document.nodes.find(node => node.id === 'action').properties.Width, 180);
  assert.deepEqual(analyze(plan.sources).document, plan.document);
  fieldPlayback(plan.sources, [300, 900], [[240, 60, 172], [100, 8, 24], [240, 60, 172]]);
});

test('A18 state and threshold edits compile and select exact inclusive and exclusive boundaries', () => {
  const analysis = analyze(generatedSources(480));
  const plan = planEdit(analysis, document => {
    const [compact, wide] = document.responsive.states;
    compact.maxWidth = 700;
    compact.overrides.action.Width = 120;
    compact.overrides.action.Left = 9;
    wide.id = 'Expanded';
    wide.minWidth = 700;
    wide.overrides.action.Width = 300;
  });
  assert.equal(plan.document.responsive.states[0].maxWidth, 700);
  assert.equal(plan.document.responsive.states[1].minWidth, 700);
  assert.equal(plan.document.responsive.states[1].id, 'Expanded');
  fieldPlayback(plan.sources, [699, 700, 900], [[120, 9, 24], [120, 9, 24], [300, 50, 162], [300, 50, 162]]);
});

test('A18 field renames update adaptive references while retaining stable design state targets', () => {
  const analysis = analyze(generatedSources());
  const plan = planEdit(analysis, document => { document.nodes.find(node => node.id === 'action').properties.Name = 'RenamedAction'; });
  assert.equal(plan.analysis.bindings.action.name, 'RenamedAction');
  assert.deepEqual(plan.document.responsive, analysis.document.responsive);
  assert.ok(!plan.text.includes('v_action'));
  fieldPlayback(plan.sources, [300, 900], [[240, 50, 162], [100, 8, 24], [240, 50, 162]], 'RenamedAction');
});

test('A18 owned local-control helper arguments reopen and round-trip literal edits', () => {
  const analysis = analyze(localSources(), {className: 'LocalView'});
  assert.equal(analysis.document.width, 480);
  assert.equal(analysis.structuralEditable, true);
  const plan = planEdit(analysis, document => { document.responsive.states[1].overrides.action.Width = 280; });
  assert.ok(plan.text.includes('target.Width = 160; // baseline width'));
  assert.ok(plan.text.includes('// wide width'));
  assert.ok(plan.text.includes('width >= 600.0'));
  localPlayback(plan.sources, [600, 300], [[100, 8, 24], [280, 50, 162], [100, 8, 24]]);
});

test('A18 newly authored adaptive states generate a typed helper for named local construction controls', () => {
  const sources = localSources().map(file => ({...file,
    text: file.text.replace(localHelper, '').replace('    ApplyAdaptive(480.0, action);\n', '')}));
  const analysis = analyze(sources, {className: 'LocalView'});
  assert.equal(analysis.document.responsive, undefined);
  const plan = planEdit(analysis, document => {
    document.width = 480;
    document.responsive = structuredClone(responsiveDesign().responsive);
  });
  assert.deepEqual(plan.document.responsive, responsiveDesign().responsive);
  localPlayback(plan.sources, [600, 300], [[100, 8, 24], [240, 50, 162], [100, 8, 24]]);
});

test('A18 new adaptive helper parameters cannot collide with a construction control named width', () => {
  const sources = localSources().map(file => ({...file, text: file.text.replace(localHelper, '')
    .replace('    ApplyAdaptive(480.0, action);\n', '').replaceAll('action', 'width')}));
  const analysis = analyze(sources, {className: 'LocalView'});
  const plan = planEdit(analysis, document => {
    document.width = 480;
    document.responsive = structuredClone(responsiveDesign().responsive);
    for (const state of document.responsive.states) state.overrides = {width: state.overrides.action};
  });
  assert.equal(plan.document.responsive.states[0].overrides.width.Width, 100);
  localPlayback(plan.sources, [600], [[100, 8, 24], [240, 50, 162]]);
});

test('A18 structural adaptive helper regeneration preserves ordinary comments exactly once', () => {
  const analysis = analyze(localSources(), {className: 'LocalView'});
  const plan = planEdit(analysis, document => {
    document.responsive.states.push({id: 'Huge', minWidth: 1000, maxWidth: null, overrides: {action: {Width: 400}}});
  });
  for (const comment of ["// The helper's ordinary comments remain user-authored trivia.", '// baseline width', '// wide width']) {
    assert.equal(plan.text.split(comment).length, 2, comment);
  }
  localPlayback(plan.sources, [1200], [[100, 8, 24], [400, 50, 162]]);
});

test('A18 an absent baseline local property remains absent and resets through ClearValue on both engines', () => {
  const value = responsiveDesign();
  value.responsive.states[0].overrides.action.Opacity = 0.5;
  const sources = [{uri, version: 4, text: generateDesignCode(value)}];
  const analysis = analyze(sources);
  assert.equal(Object.hasOwn(analysis.document.nodes.find(node => node.id === 'action').properties, 'Opacity'), false);
  const plan = planEdit(analysis, document => { document.responsive.states[0].overrides.action.Opacity = 0.75; });
  assert.equal(Object.hasOwn(plan.document.nodes.find(node => node.id === 'action').properties, 'Opacity'), false);
  execute(plan.sources, `DesignedView.Create(); Console.WriteLine(DesignedView.v_action.Opacity);
    DesignedView.ApplyAdaptive(300.0); Console.WriteLine(DesignedView.v_action.Opacity);
    DesignedView.ApplyAdaptive(900.0); Console.WriteLine(DesignedView.v_action.Opacity);`, [[1], [0.75], [1]]);
});

test('A18 partial helpers update baseline and state source files in one versioned plan', () => {
  const sources = localSources(true);
  const analysis = analyze(sources, {className: 'LocalView'});
  const plan = planEdit(analysis, document => {
    document.nodes.find(node => node.id === 'action').properties.Width = 180;
    document.responsive.states[1].overrides.action.Width = 280;
  });
  assert.deepEqual(new Set(plan.changes.map(change => change.uri)), new Set(sources.map(file => file.uri)));
  assert.deepEqual(plan.expectedSources, sources);
  for (const change of plan.changes) assert.equal(change.expectedVersion, sources.find(file => file.uri === change.uri).version);
  assert.deepEqual(plan.document.responsive, analyze(plan.sources, {className: 'LocalView'}).document.responsive);
  localPlayback(plan.sources, [600], [[100, 8, 24], [280, 50, 162]]);
});

test('A18 adding and removing adaptive states owns only helper and initializer source', () => {
  const initial = generatedSources();
  const analysis = analyze(initial);
  const expanded = planEdit(analysis, document => {
    document.responsive.states.push({id: 'Huge', minWidth: 1000, maxWidth: null, overrides: {action: {Width: 400}}});
  });
  assert.equal(expanded.document.responsive.states.at(-1).id, 'Huge');
  fieldPlayback(expanded.sources, [1200, 600], [[240, 50, 162], [400, 50, 162], [240, 50, 162]]);
  const removed = planEdit(expanded.analysis, document => { delete document.responsive; });
  assert.equal(removed.document.responsive, undefined);
  assert.ok(!removed.text.includes('ApplyAdaptive'));
  assert.ok(removed.text.includes('v_action = new Microsoft.UI.Xaml.Controls.Button();'));
  execute(removed.sources, `DesignedView.Create(); ${printGeometry('DesignedView.v_action')}`, [[160, 50, 162]]);
  const restored = planEdit(removed.analysis, document => { document.responsive = structuredClone(responsiveDesign().responsive); });
  assert.deepEqual(restored.document.responsive, analysis.document.responsive);
  fieldPlayback(restored.sources, [300], [[240, 50, 162], [100, 8, 24]]);
});

test('A18 control insertion and deletion keep responsive initialization after construction on both engines', context => {
  const analysis = analyze(generatedSources());
  const document = new DesignDocument(analysis.document);
  context.after(() => document.dispose());
  const secondary = document.add('Button', 'root', {Name: 'Secondary', Content: 'Side', Width: 90, Height: 30, Left: 12, Top: 70});
  document.change('Extend adaptive targets', candidate => {
    candidate.responsive.states[0].overrides[secondary] = {Width: 70, Left: 4, Top: 15};
    candidate.responsive.states[1].overrides[secondary] = {Width: 260};
  });
  const added = planDesignSourceUpdate(analysis, document.value, analysis.sources, {requireCompilation: true});
  assert.equal(added.compilationSucceeded, true, JSON.stringify(added.diagnostics));
  assert.ok(added.document.nodes.some(node => node.id === secondary));
  verifyControls(added.sources, {Action: {Width: 240, Left: 50, Top: 162}, Secondary: {Width: 260, Left: 12, Top: 70}});
  const compact = planEdit(added.analysis, candidate => { candidate.width = 480; });
  verifyControls(compact.sources, {Action: {Width: 100, Left: 8, Top: 24}, Secondary: {Width: 70, Left: 4, Top: 15}});
  const removal = new DesignDocument(compact.document);
  context.after(() => removal.dispose());
  removal.change('Remove adaptive target', candidate => {
    for (const state of candidate.responsive.states) delete state.overrides[secondary];
  });
  removal.remove([secondary]);
  const removed = planDesignSourceUpdate(compact.analysis, removal.value, compact.sources, {requireCompilation: true});
  assert.equal(removed.compilationSucceeded, true, JSON.stringify(removed.diagnostics));
  assert.ok(!removed.document.nodes.some(node => node.id === secondary));
  assert.equal(removed.analysis.detached.length, 0);
  assert.deepEqual(removed.document.responsive, responsiveDesign().responsive);
  verifyControls(removed.sources, {Action: {Width: 100, Left: 8, Top: 24}, Secondary: null});
});

test('A18 adaptive ownership cannot whitelist a true handwritten reference to a deleted control', context => {
  const sources = generatedSources();
  const source = sources[0].text;
  sources[0].text = source.slice(0, source.lastIndexOf('}')) + '\n'
    + 'public static double InspectAction() { return v_action.Width; }\n}\n';
  const before = structuredClone(sources);
  const analysis = analyze(sources);
  const document = new DesignDocument(analysis.document);
  context.after(() => document.dispose());
  document.change('Remove adaptive target', candidate => {
    for (const state of candidate.responsive.states) delete state.overrides.action;
  });
  document.remove(['action']);
  assert.throws(() => planDesignSourceUpdate(analysis, document.value, sources, {requireCompilation: true}), error => {
    assert.equal(error.code, 'SFSYNC_REFERENCE');
    assert.ok(error.details.references.length > 0);
    return true;
  });
  assert.deepEqual(sources, before);
  assert.ok(analysis.document.nodes.some(node => node.id === 'action'));
});

test('A18 helper source snapshots support source undo/redo reads and reject stale partial versions', context => {
  const sources = localSources(true);
  const session = new CSharpDesignSession(sources[0].text, {uri: sources[0].uri, sources, className: 'LocalView', methodName: 'Create'});
  context.after(() => session.dispose());
  const original = session.document;
  const next = structuredClone(original);
  next.responsive.states[1].overrides.action.Width = 280;
  const plan = session.plan(next, sources, {requireCompilation: true});
  assert.deepEqual(session.document, original);
  assert.equal(session.version, 0);
  const stale = sources.map(file => ({...file, version: file.version + 1}));
  assert.throws(() => session.commit(plan, {currentSources: stale, requireCompilation: true}), {code: 'SFSYNC_CONFLICT'});
  assert.equal(session.version, 0);
  assert.deepEqual(session.document, original);
  session.commit(plan, {currentSources: sources, requireCompilation: true});
  const committed = session.document;
  assert.equal(committed.responsive.states[1].overrides.action.Width, 280);
  assert.deepEqual(session.readSources(sources), original);
  assert.deepEqual(session.analysis.sources, sources);
  assert.deepEqual(session.readSources(plan.sources), committed);
  assert.deepEqual(session.analysis.sources, plan.sources);
});

test('A18 edited, malformed or dynamic adaptive helpers never replace the synchronized baseline', context => {
  const sources = localSources();
  const session = new CSharpDesignSession(sources[0].text, {uri: sources[0].uri, className: 'LocalView', methodName: 'Create'});
  context.after(() => session.dispose());
  const baseline = session.analysis;
  const malformed = [
    text => text.replace(marker, '// SharpForge adaptive states v1: ["Wide",]'),
    text => text.replace(marker, '// SharpForge adaptive states v1: ["Wide","Wide"]'),
    text => text.replace('target.Width = 160;', 'target.Width = 159;'),
    text => text.replace('target.Width = 160;', 'Console.WriteLine("user logic"); target.Width = 160;'),
    text => text.replace('target.Width = 240;', 'target.Width = Math.Max(200.0, 240.0);'),
    text => text.replace('width >= 600.0', 'width > 600.0'),
    text => text.replace('ApplyAdaptive(480.0, action);', 'ApplyAdaptive(480.0, action); ApplyAdaptive(480.0, action);'),
    text => text.replace('ApplyAdaptive(480.0, action);', 'ApplyAdaptive(480.0, action); action.Height = 41;'),
    text => text.replace('ApplyAdaptive(480.0, action);', 'ApplyAdaptive(99.0, action);')
  ];
  for (const change of malformed) {
    assert.throws(() => session.read(change(sources[0].text)), {code: 'SFSYNC_OWNERSHIP'});
    assert.equal(session.analysis, baseline);
    assert.equal(session.version, 0);
  }
});

test('A18 unmarked user helpers remain protected and cannot be claimed by adding responsive metadata', () => {
  const sources = localSources().map(file => ({...file, text: file.text.replace(marker, '// User-maintained viewport logic')}));
  const analysis = analyze(sources, {className: 'LocalView'});
  assert.equal(analysis.document.responsive, undefined);
  assert.equal(analysis.structuralEditable, false);
  assert.equal(planDesignSourceUpdate(analysis, analysis.document, sources).text, sources[0].text);
  const document = structuredClone(analysis.document);
  document.responsive = structuredClone(responsiveDesign().responsive);
  assert.throws(() => planDesignSourceUpdate(analysis, document, sources), {code: 'SFSYNC_OWNERSHIP'});
  assert.equal(analysis.text, sources[0].text);
});

test('A18 adaptive source identity metadata enforces the 64-state bound before ownership is claimed', () => {
  const ids = Array.from({length: 65}, (_, index) => 'State' + index);
  const sources = localSources().map(file => ({...file,
    text: file.text.replace(marker, '// SharpForge adaptive states v1: ' + JSON.stringify(ids))}));
  const before = structuredClone(sources);
  assert.throws(() => analyzeDesignSources(sources, {uri: sources[0].uri, className: 'LocalView', methodName: 'Create'}),
    {code: 'SFSYNC_LIMIT'});
  assert.deepEqual(sources, before);
});

test('A18 externally referenced helper removal and read-only partial writes fail before changing sources', () => {
  const external = 'public static void Reapply(Microsoft.UI.Xaml.Controls.Button target) { ApplyAdaptive(900.0, target); }';
  const sources = localSources(false, external);
  const analysis = analyze(sources, {className: 'LocalView'});
  const next = structuredClone(analysis.document);
  delete next.responsive;
  assert.throws(() => planDesignSourceUpdate(analysis, next, sources), {code: 'SFSYNC_REFERENCE'});
  const readonly = localSources(true).map((file, index) => ({...file, readOnly: index === 1}));
  const readonlyAnalysis = analyze(readonly, {className: 'LocalView'});
  const edited = structuredClone(readonlyAnalysis.document);
  edited.responsive.states[1].overrides.action.Width = 280;
  const original = structuredClone(readonly);
  assert.throws(() => planDesignSourceUpdate(readonlyAnalysis, edited, readonly), {code: 'SFSYNC_OWNERSHIP'});
  assert.deepEqual(readonly, original);
});

test('A18 cancelled responsive plans and malformed editor syntax retain source snapshots', () => {
  const sources = generatedSources();
  const analysis = analyze(sources);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => planDesignSourceUpdate(analysis, analysis.document, sources, {signal: controller.signal}),
    {code: 'SFSYNC_CANCELLED'});
  const broken = sources.map(file => ({...file, text: file.text.replace('ApplyAdaptive(double width)', 'ApplyAdaptive(double width')}));
  assert.throws(() => analyzeDesignSources(broken, options), {code: 'SFSYNC_PARSE'});
  assert.deepEqual(analysis.sources, sources);
});

test('A18 an adaptive target outside the selected visual root cannot leak into a projected source document', context => {
  const sources = generatedSources();
  const detached = sources.map(file => ({...file, text: file.text.replace('v_root.Children.Add(v_action);', '')}));
  const compiled = compileToIL([...detached, {uri: 'DetachedRunner.cs',
    text: 'class DetachedRunner { static void Main() { DesignedView.Create(); } }'}]);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const session = new CSharpDesignSession(sources[0].text, {...options, sources});
  context.after(() => session.dispose());
  const baseline = session.analysis;
  assert.throws(() => session.readSources(detached), error => {
    assert.equal(error.code, 'SFSYNC_OWNERSHIP');
    assert.match(error.message, /outside the selected visual root/);
    return true;
  });
  assert.equal(session.analysis, baseline);
  assert.equal(session.version, 0);
  assert.deepEqual(session.analysis.sources, sources);
});
