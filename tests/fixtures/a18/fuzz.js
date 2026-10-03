import assert from 'node:assert/strict';
import {readDesignSource, DesignDocument, planDesignSourceUpdate} from '@sharpforge/designer';
import {canonicalDocument} from './corpus.js';
import {executeDesign} from './runtime.js';

export const fuzzSource = `using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
public class View {
    public static Window Create() {
        Window window = new Window();
        Grid root = new Grid { Name = "Root" };
        Canvas leftPanel = new Canvas { Name = "Left", Width = 400, Height = 300 };
        Canvas rightPanel = new Canvas { Name = "Right", Width = 400, Height = 300 };
        Button action = new Button { Name = "Action", Content = "Run", Width = 160, Height = 40 };
        TextBlock caption = new TextBlock { Name = "Caption", Text = "Unchanged", Width = 120 };
        leftPanel.Children.Add(action);
        rightPanel.Children.Add(caption);
        root.Children.Add(leftPanel);
        root.Children.Add(rightPanel);
        window.Content = root;
        return window;
    }
    // This handwritten method and its trivia are never part of the editable graph.
    public static int Handwritten() { return 19; }
}
class Program { static void Main() { Window window = View.Create(); window.Activate(); } }
`;

export const firstSeed = 0x18c0ffee;
export const sequenceCount = 1000;

/** xorshift32 with an explicit nonzero state; each failing sequence prints its independent seed. */
export function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return maximum => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % maximum;
  };
}

function insert(document, random, serial, seed, log) {
  const type = ['Button', 'TextBlock', 'Border'][random(3)];
  const parent = ['leftPanel', 'rightPanel'][random(2)];
  const properties = {Name: `Node_${seed}_${serial}`, Width: random(321), Height: random(81), Left: random(101), Top: random(101)};
  if (type === 'Button') properties.Content = `Command ${random(101)}`;
  if (type === 'TextBlock') properties.Text = `Label ${random(101)}`;
  const id = document.add(type, parent, properties);
  log.push({operation: 'insert', id, parent, type, properties});
  return id;
}

function randomOperation(document, random, serial, seed, log) {
  const controls = document.value.nodes.filter(node => !['window', 'root', 'leftPanel', 'rightPanel'].includes(node.id));
  const operation = random(4);
  if (operation === 0 || !controls.length) return insert(document, random, serial, seed, log);
  const selected = controls[random(controls.length)];
  if (operation === 1) {
    const parent = ['leftPanel', 'rightPanel'][random(2)];
    const available = document.node(parent).children.filter(id => id !== selected.id).length;
    const index = random(available + 1);
    log.push({operation: 'move', id: selected.id, parent, index});
    document.move(selected.id, parent, index);
  } else if (operation === 2 && controls.length > 1) {
    document.remove([selected.id]);
    log.push({operation: 'delete', id: selected.id});
  } else {
    const value = random(401);
    document.setProperty('Width', value, [selected.id]);
    log.push({operation: 'property', id: selected.id, property: 'Width', value});
  }
}

/** Each sequence includes all four edit classes, then seeded extras; no source/compiler/runtime stand-ins are used. */
export function runSeededSequence(seed, {baseline, execute = true} = {}) {
  const random = seededRandom(seed);
  const analysis = baseline ?? readDesignSource(fuzzSource, {uri: 'Fuzz.cs', className: 'View', methodName: 'Create'});
  const document = new DesignDocument(analysis.document);
  const log = [];
  try {
    insert(document, random, 0, seed, log);
    document.move('action', 'rightPanel', random(2));
    log.push({operation: 'move', id: 'action', parent: 'rightPanel'});
    document.remove(['caption']);
    log.push({operation: 'delete', id: 'caption'});
    const width = random(321);
    document.setProperty('Width', width, ['action']);
    log.push({operation: 'property', id: 'action', property: 'Width', value: width});
    const extraCount = 2 + random(5);
    for (let index = 1; index <= extraCount; index++) randomOperation(document, random, index, seed, log);
    const plan = planDesignSourceUpdate(analysis, document.value, analysis.sources, {requireCompilation: true});
    assert.equal(plan.compilationSucceeded, true);
    assert.deepEqual(canonicalDocument(plan.document), canonicalDocument(document.value));
    const independent = readDesignSource(plan.text, {uri: 'Fuzz.cs', className: 'View', methodName: 'Create'});
    assert.deepEqual(canonicalDocument(independent.document), canonicalDocument(document.value));
    assert.equal(planDesignSourceUpdate(independent, independent.document).text, plan.text);
    const protectedSource = fuzzSource.slice(fuzzSource.indexOf('    // This handwritten'));
    assert.ok(plan.text.endsWith(protectedSource));
    const runtime = execute ? executeDesign(plan.sources, document.value) : null;
    assert.equal(analysis.text, fuzzSource, 'The immutable baseline was modified');
    return {seed, operations: log, nodes: document.value.nodes.length, runtime};
  } catch (cause) {
    const error = new Error(`Designer sequence seed=${seed >>> 0} (0x${(seed >>> 0).toString(16)}) failed.\n`
      + JSON.stringify(log) + '\n' + cause.message, {cause});
    error.seed = seed >>> 0;
    throw error;
  } finally {
    document.dispose();
  }
}
