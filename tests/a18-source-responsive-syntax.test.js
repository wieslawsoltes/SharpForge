import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {analyzeDesignSources, CSharpDesignSession, DesignDocument, planDesignSourceUpdate} from '@sharpforge/designer';

const uri = 'Views/AdaptiveSyntax.cs';
const options = {uri, className: 'AdaptiveSyntax', methodName: 'Create'};
const marker = '// SharpForge adaptive states v1: ["Wide","Compact"]';

function sources(settings = {}) {
  const threshold = settings.threshold ?? '600.0';
  const initializer = settings.initializer ?? 'ApplyAdaptive(480.0, action);';
  const helper = settings.helper === false ? '' : `
  public static void ApplyAdaptive(${settings.parameters ?? 'double width, Button target'}) {
    ${marker}
    // keep adaptive note
    target.Width = 160;
    if (width >= ${threshold}) {
      target.Width = 240;
      return;
    }
    if (width >= 0.0 && width < ${threshold}) {
      target.Width = 100;
      return;
    }
  }
`;
  return [{uri, version: 7, text: `using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
public class AdaptiveSyntax {
  public static Window Create() {
    ${settings.local ?? ''}
    Window window = new Window();
    Canvas root = new Canvas();
    Button action = new Button { Name = "Action", Width = 160, Height = 40 };
    root.Children.Add(action);
    window.Content = root;
    ${initializer}
    window.Activate();
    return window;
  }
${helper}}
${settings.terminator ?? ''}
${settings.tail ?? ''}`}];
}

function compile(files, body = 'AdaptiveSyntax.Create();') {
  const compilation = compileToIL([...files, {uri: 'Views/AdaptiveSyntaxRunner.cs',
    text: `class AdaptiveSyntaxRunner { static void Main() { ${body} } }`}]);
  assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
  return compilation;
}

function run(files, body, inspect) {
  const compilation = compile(files, body);
  for (const Machine of [VirtualMachine, CilVirtualMachine]) {
    const machine = new Machine(Machine === VirtualMachine ? compilation.image : compilation.assembly);
    const result = machine.run();
    assert.equal(result.state, 'terminated', Machine.name + ': ' + JSON.stringify(result.fault));
    inspect(machine, result);
  }
}

function analyze(files) {
  const analysis = analyzeDesignSources(files, options);
  assert.equal(analysis.compilationSucceeded, true, JSON.stringify(analysis.compilerDiagnostics));
  return analysis;
}

function planEdit(analysis, edit) {
  const document = structuredClone(analysis.document);
  const original = structuredClone(analysis.document);
  const files = structuredClone(analysis.sources);
  edit(document);
  const plan = planDesignSourceUpdate(analysis, document, analysis.sources, {requireCompilation: true});
  assert.equal(plan.compilationSucceeded, true, JSON.stringify(plan.diagnostics));
  assert.deepEqual(analysis.document, original);
  assert.deepEqual(analysis.sources, files);
  assert.deepEqual(analyze(plan.sources).document, plan.document);
  return plan;
}

function playback(files, widths, expected) {
  // Invoke the compiled helper on the control Create attached, keeping candidate C# unchanged.
  run(files, 'AdaptiveSyntax.Create();', machine => {
    const methods = machine.inspector ? [...machine.inspector.methods.values()] : machine.image.methods;
    const helpers = methods.filter(method => method.owner === 'AdaptiveSyntax' && method.name === 'ApplyAdaptive');
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
    const observed = [initial.properties.Width];
    for (const width of widths) {
      machine.call(helper.token ?? helper.id, [machine.platform.managed(width, 'double'), reference]);
      machine.state = 'ready';
      const result = machine.run();
      assert.equal(result.state, 'terminated', machine.constructor.name + ': ' + JSON.stringify(result.fault));
      const node = action();
      assert.equal(node.id, initial.id);
      observed.push(node.properties.Width);
    }
    assert.deepEqual(observed, expected, machine.constructor.name);
  });
}

function sceneWidths(files, expected) {
  run(files, 'AdaptiveSyntax.Create();', (machine, result) => {
    assert.equal(result.output, '');
    const nodes = machine.platform.scene().nodes;
    for (const [name, width] of Object.entries(expected)) {
      const node = nodes.find(item => item.properties.Name === name);
      if (width === null) assert.equal(node, undefined, name + ' remains in the runtime tree');
      else {
        assert.ok(node, 'Missing runtime control ' + name);
        assert.equal(node.properties.Width, width, name + '.Width');
      }
    }
  });
}

function responsive() {
  return {version: 1, states: [
    {id: 'Compact', minWidth: 0, maxWidth: 600, overrides: {action: {Width: 100}}},
    {id: 'Wide', minWidth: 600, maxWidth: null, overrides: {action: {Width: 240}}}
  ]};
}

test('A18 adaptive helpers cannot decode their width parameter from a same-named construction local', context => {
  const original = sources();
  const session = new CSharpDesignSession(original[0].text, {...options, sources: original});
  context.after(() => session.dispose());
  const baseline = session.analysis;
  const invalid = [
    sources({local: 'double width = 600;', threshold: 'width'}),
    sources({local: 'double width = 600;'}).map(file => ({...file,
      text: file.text.replace('target.Width = 240;', 'target.Width = width;')})),
    sources({local: 'double width = 160;'}).map(file => ({...file,
      text: file.text.replace('target.Width = 160;', 'target.Width = width;')}))
  ];
  for (const files of invalid) {
    const before = structuredClone(files);
    compile(files);
    assert.throws(() => session.readSources(files), {code: 'SFSYNC_OWNERSHIP'});
    assert.equal(session.analysis, baseline);
    assert.equal(session.version, 0);
    assert.deepEqual(files, before);
    assert.deepEqual(session.analysis.sources, original);
  }
});

test('A18 adaptive thresholds use C# integer division and conversion semantics on both engines', () => {
  for (const threshold of ['1201 / 2', '(int)600.9']) {
    const files = sources({threshold});
    const analysis = analyze(files);
    assert.deepEqual(analysis.document.responsive, responsive());
    const noop = planDesignSourceUpdate(analysis, analysis.document, files, {requireCompilation: true});
    assert.equal(noop.text, files[0].text);
    assert.deepEqual(noop.changes, []);
    playback(files, [599.75, 600, 900], [100, 100, 240, 240]);
    const plan = planEdit(analysis, document => {
      document.responsive.states[0].maxWidth = 650;
      document.responsive.states[1].minWidth = 650;
    });
    playback(plan.sources, [649.75, 650], [100, 100, 240]);
  }
});

test('A18 adaptive helper value decoding keeps framework constants and structured brush constructors', () => {
  const files = sources().map(file => ({...file, text: file.text
    .replace('Width = 160, Height = 40',
      'Width = 160, Height = 40, Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Black)')
    .replace('    target.Width = 160;', `    target.Width = 160;
    target.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Black);`)
    .replace('      target.Width = 240;', `      target.Width = 240;
      target.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Red);`)}));
  const analysis = analyze(files);
  const foreground = analysis.document.responsive.states[1].overrides.action.Foreground;
  assert.equal(foreground.valueType, 'Microsoft.UI.Xaml.Media.SolidColorBrush');
  assert.deepEqual(foreground.Color, {valueType: 'Windows.UI.Color', A: 255, R: 255, G: 0, B: 0});
  const noop = planDesignSourceUpdate(analysis, analysis.document, files, {requireCompilation: true});
  assert.equal(noop.text, files[0].text);
  playback(files, [600, 300], [100, 240, 100]);
});

test('A18 parenthesized adaptive arguments retain balanced syntax and comments through local target insertion and deletion', () => {
  const files = sources({
    initializer: 'ApplyAdaptive((480.0 /* width argument */), (action /* action argument */)); // keep initializer note',
    parameters: 'double width /* width declaration */, Button target /* target declaration */'
  });
  const analysis = analyze(files);
  const document = new DesignDocument(analysis.document);
  const secondary = document.add('Button', 'root', {Name: 'Secondary', Width: 90, Height: 30});
  document.change('Add adaptive target', candidate => {
    candidate.responsive.states[0].overrides[secondary] = {Width: 70};
    candidate.responsive.states[1].overrides[secondary] = {Width: 260};
  });
  const inserted = planDesignSourceUpdate(analysis, document.value, files, {requireCompilation: true});
  assert.equal(inserted.compilationSucceeded, true, JSON.stringify(inserted.diagnostics));
  assert.deepEqual(analyze(inserted.sources).document, inserted.document);
  sceneWidths(inserted.sources, {Action: 100, Secondary: 70});
  const wide = planEdit(inserted.analysis, candidate => { candidate.width = 900; });
  sceneWidths(wide.sources, {Action: 240, Secondary: 260});
  const removal = new DesignDocument(wide.document);
  removal.change('Remove adaptive target', candidate => {
    for (const state of candidate.responsive.states) delete state.overrides[secondary];
  });
  removal.remove([secondary]);
  const removed = planDesignSourceUpdate(wide.analysis, removal.value, wide.sources, {requireCompilation: true});
  assert.equal(removed.compilationSucceeded, true, JSON.stringify(removed.diagnostics));
  assert.deepEqual(removed.document.responsive, responsive());
  assert.deepEqual(analyze(removed.sources).document, removed.document);
  sceneWidths(removed.sources, {Action: 240, Secondary: null});
  for (const plan of [inserted, wide, removed]) {
    for (const comment of ['/* width argument */', '/* action argument */', '/* width declaration */',
      '/* target declaration */', '// keep initializer note', '// keep adaptive note']) {
      assert.equal(plan.text.split(comment).length - 1, 1, comment);
    }
  }
  assert.deepEqual(analysis.sources, files);
  assert.equal(analysis.document.nodes.length, 3);
});

test('A18 editing an adaptive threshold retains the full span of a parenthesized binary operand', () => {
  const files = sources({threshold: '(600) + 0'});
  const analysis = analyze(files);
  assert.deepEqual(analysis.document.responsive, responsive());
  const plan = planEdit(analysis, document => {
    document.responsive.states[0].maxWidth = 700;
    document.responsive.states[1].minWidth = 700;
  });
  assert.equal(plan.text.split('// keep adaptive note').length - 1, 1);
  playback(plan.sources, [699.75, 700], [100, 100, 240]);
});

test('A18 adaptive helper insertion uses the class closing brace before an optional trailing semicolon', () => {
  const neighbor = 'public class Neighbor { public static int Preserved() { return 17; } }';
  const files = sources({helper: false, initializer: '', terminator: '; // keep type terminator', tail: neighbor});
  const analysis = analyze(files);
  assert.equal(analysis.document.responsive, undefined);
  const plan = planEdit(analysis, document => {
    document.width = 480;
    document.responsive = responsive();
  });
  const helper = plan.text.indexOf('public static void ApplyAdaptive');
  const terminator = plan.text.indexOf('; // keep type terminator');
  assert.ok(helper >= 0 && helper < terminator);
  assert.ok(plan.text.includes(neighbor));
  assert.equal(plan.text.split('; // keep type terminator').length - 1, 1);
  sceneWidths(plan.sources, {Action: 100});
});
