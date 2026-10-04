import test from 'node:test';
import assert from 'node:assert/strict';
import { DesignDocument, createDesign } from '@sharpforge/designer';

test('root Toolbox insertion descends into the existing content container', () => {
  const document = new DesignDocument(createDesign());
  document.select(document.value.root);
  const id = document.add('Button');
  assert.equal(document.parent(id).id, 'canvas');
  assert.deepEqual(document.node('window').children, ['canvas']);
  document.undo();
  assert.equal(document.node(id), undefined);
});

test('a completed gesture commits its final geometry as one exact undo operation', () => {
  const document = new DesignDocument(createDesign());
  document.select('action');
  const before = document.serialize();
  const transaction = document.beginTransaction('Resize selection');
  transaction.stage(next => { next.nodes.find(node => node.id === 'action').properties.Width = 220; });
  transaction.stage(next => { next.nodes.find(node => node.id === 'action').properties.Width = 280; });
  assert.equal(document.node('action').properties.Width, 160);
  assert.equal(document.revision, 0);
  transaction.commit();
  assert.equal(document.node('action').properties.Width, 280);
  assert.equal(document.undoStack.length, 1);
  document.undo();
  assert.equal(document.serialize(), before);
  assert.deepEqual(document.selection, ['action']);
  document.undo(true);
  assert.equal(document.node('action').properties.Width, 280);
});

test('cancelled, invalid and concurrently changed gestures never publish staged state', () => {
  const document = new DesignDocument(createDesign());
  const cancelled = document.beginTransaction('Cancelled drag');
  cancelled.stage(next => { next.nodes.find(node => node.id === 'action').properties.Left = 320; });
  cancelled.cancel();
  assert.equal(document.node('action').properties.Left, 50);
  assert.equal(document.revision, 0);
  assert.throws(() => cancelled.commit(), /closed/);
  const invalid = document.beginTransaction('Invalid drag');
  assert.throws(() => invalid.stage(next => { next.nodes.find(node => node.id === 'action').properties.Width = -1; }));
  invalid.cancel();
  const stale = document.beginTransaction('Stale drag');
  document.setProperty('Width', 190, ['action']);
  assert.throws(() => stale.commit(), /changed/);
  stale.cancel();
  assert.equal(document.node('action').properties.Width, 190);
});

test('indexes follow reparenting, deletions, source replacement and undo', () => {
  const document = new DesignDocument(createDesign());
  const panel = document.add('StackPanel', 'canvas');
  document.move('title', panel);
  assert.equal(document.parent('title').id, panel);
  document.remove([panel]);
  assert.equal(document.node('title'), undefined);
  assert.equal(document.parent('title'), undefined);
  document.undo();
  assert.equal(document.parent('title').id, panel);
  document.load(createDesign('Replaced'));
  assert.equal(document.parent('title').id, 'canvas');
  assert.equal(document.node(panel), undefined);
});

test('history has explicit entry and byte bounds and disposal closes outstanding work', () => {
  const document = new DesignDocument(createDesign(), { historyLimit: 2 });
  for (const width of [170, 180, 190]) document.setProperty('Width', width, ['action']);
  assert.equal(document.undoStack.length, 2);
  const bounded = new DesignDocument(createDesign(), { historyByteLimit: 1 });
  bounded.setProperty('Width', 170, ['action']);
  assert.equal(bounded.undoStack.length, 0);
  const transaction = document.beginTransaction('Disposed drag');
  document.dispose();
  document.dispose();
  assert.throws(() => transaction.commit(), /closed/);
  assert.throws(() => document.setProperty('Width', 200, ['action']), /disposed/);
});

test('five thousand node design remains addressable without repeated tree scans', () => {
  const value = createDesign('Large tree');
  const canvas = value.nodes.find(node => node.id === 'canvas');
  for (let index = value.nodes.length; index < 5000; index++) {
    const id = 'label_' + index;
    value.nodes.push({ id, type: 'TextBlock', properties: { Text: String(index) }, children: [], events: {} });
    canvas.children.push(id);
  }
  const document = new DesignDocument(value, { historyLimit: 1 });
  assert.equal(document.value.nodes.length, 5000);
  assert.equal(document.parent('label_4999').id, 'canvas');
  assert.equal(document.node('label_4999').properties.Text, '4999');
  assert.throws(() => document.add('Button', 'canvas'), /oversized|limit/);
  assert.equal(document.value.nodes.length, 5000);
});

test('copy imports conflicting BasedOn resources without changing either source or destination style', () => {
  const source = new DesignDocument(createDesign('Source'));
  source.setStyle('Base', { targetType: 'Button', setters: { FontSize: 32 } });
  source.setStyle('Accent', { targetType: 'Button', basedOn: 'Base', setters: { Width: 190 } });
  const destination = new DesignDocument(createDesign('Destination'));
  destination.setStyle('Base', { targetType: 'Button', setters: { FontSize: 10 } });
  const [id] = destination.paste(source.value, ['action'], 'canvas');
  const style = destination.value.styles[destination.node(id).style];
  assert.equal(style.basedOn, 'Base_1');
  assert.equal(destination.value.styles.Base.setters.FontSize, 10);
  assert.equal(destination.value.styles.Base_1.setters.FontSize, 32);
  assert.equal(source.value.styles.Accent.basedOn, 'Base');
});
