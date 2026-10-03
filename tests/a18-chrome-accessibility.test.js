import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, createDesign, checkDesignAccessibility, designerContrastRatio,
  designerKeyboardIntent, DesignerAnnouncements
} from '@sharpforge/designer';

test('unnamed Button is reported even with a C# Name and fixing Content clears its finding', () => {
  const document = new DesignDocument(createDesign());
  document.setProperty('Content', '', ['action']);
  const findings = checkDesignAccessibility(document.value);
  assert(findings.some(item => item.nodeId === 'action' && item.code === 'SFDA0001'));
  document.setProperty('Content', 'Save changes', ['action']);
  assert(!checkDesignAccessibility(document.value).some(item => item.nodeId === 'action' && item.code === 'SFDA0001'));
});

test('accessibility checks do not mutate source documents and hidden controls are omitted', () => {
  const document = new DesignDocument(createDesign());
  document.setProperty('Content', '', ['action']);
  const before = document.serialize();
  const findings = checkDesignAccessibility(document.value, {isVisible: id => id !== 'action'});
  assert(!findings.some(item => item.nodeId === 'action'));
  assert.equal(document.serialize(), before);
});

test('contrast follows sRGB luminance and alpha compositing, with unknown backgrounds left unknown', () => {
  assert.equal(designerContrastRatio('#000000', '#ffffff'), 21);
  assert.equal(designerContrastRatio('#ffffff', '#000000'), 21);
  assert.equal(designerContrastRatio('#112233', '#112233'), 1);
  const semiTransparent = designerContrastRatio('#80ffffff', '#000000');
  assert(semiTransparent > 5.2 && semiTransparent < 5.4);
  assert.equal(designerContrastRatio('#ffffff', '#80000000'), null);
  assert.equal(designerContrastRatio('not a color', '#ffffff'), null);
});

test('checker reports explicit color contrast and the 24-unit target boundary', () => {
  const document = new DesignDocument(createDesign());
  document.setProperty('Foreground', '#222222', ['action']);
  document.setProperty('Background', '#222222', ['action']);
  document.setProperty('Width', 23, ['action']);
  document.setProperty('Height', 24, ['action']);
  const findings = checkDesignAccessibility(document.value);
  assert(findings.some(item => item.code === 'SFDA0002' && item.nodeId === 'action' && item.ratio === 1));
  assert(findings.some(item => item.code === 'SFDA0004' && item.nodeId === 'action'));
  document.setProperty('Width', 24, ['action']);
  assert(!checkDesignAccessibility(document.value).some(item => item.code === 'SFDA0004' && item.nodeId === 'action'));
});

test('cancellation and malformed limits are explicit and deterministic', () => {
  const document = createDesign();
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => checkDesignAccessibility(document, {signal: controller.signal}), {name: 'AbortError'});
  assert.throws(() => checkDesignAccessibility(document, {maxDiagnostics: 0}), /limit/);
  assert.throws(() => checkDesignAccessibility({nodes: null}), /bounded/);
  const malformed = createDesign();
  malformed.nodes.find(node => node.id === 'canvas').children.push('window');
  assert.throws(() => checkDesignAccessibility(malformed), /cycle/);
});

test('keyboard navigation supports descend, parent, ordered tab traversal and leaving the surface', () => {
  const document = new DesignDocument(createDesign());
  assert.deepEqual(designerKeyboardIntent(document, {key: 'Enter'}), {kind: 'select', id: 'canvas'});
  document.select('canvas');
  assert.deepEqual(designerKeyboardIntent(document, {key: 'Escape'}), {kind: 'select', id: 'window'});
  document.select('title');
  assert.deepEqual(designerKeyboardIntent(document, {key: 'Tab'}, {isVisible: id => id !== 'caption'}), {
    kind: 'select', id: 'action'
  });
  document.select('action');
  assert.equal(designerKeyboardIntent(document, {key: 'Tab'}), null);
  assert.deepEqual(designerKeyboardIntent(document, {key: 'Tab', shiftKey: true}), {kind: 'select', id: 'caption'});
});

test('keyboard insertion, reorder, precise movement and resizing are separate intentions', () => {
  const document = new DesignDocument(createDesign());
  assert.deepEqual(designerKeyboardIntent(document, {key: 'Insert'}), {kind: 'insert'});
  assert.deepEqual(designerKeyboardIntent(document, {key: 'ArrowDown', altKey: true}), {kind: 'reorder', delta: 1});
  assert.deepEqual(designerKeyboardIntent(document, {key: 'ArrowLeft'}), {kind: 'move', dx: -1, dy: 0});
  assert.deepEqual(designerKeyboardIntent(document, {key: 'ArrowRight', ctrlKey: true, shiftKey: true}), {
    kind: 'resize', dx: 10, dy: 0
  });
  assert.equal(designerKeyboardIntent(document, {key: 'ArrowRight', isComposing: true}), null);
  assert.equal(designerKeyboardIntent(document, {key: 'z', ctrlKey: true}), null);
});

test('screen-reader transcript retains selection and synchronization transitions in order', () => {
  const callbacks = new Map();
  const spoken = [];
  let serial = 0;
  const announcements = new DesignerAnnouncements({
    announce: message => spoken.push(message),
    schedule: callback => { const id = ++serial; callbacks.set(id, callback); return id; },
    cancel: id => callbacks.delete(id)
  });
  announcements.push('Selected Save, Button');
  announcements.push('Synchronization: validating');
  announcements.push('Synchronization: synced');
  announcements.push('Synchronization: synced');
  while (callbacks.size) {
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    callback();
  }
  assert.deepEqual(spoken, ['Selected Save, Button', 'Synchronization: validating', 'Synchronization: synced']);
  assert.deepEqual(announcements.transcript, spoken);
  announcements.push('Never announce after disposal');
  announcements.dispose();
  assert.equal(callbacks.size, 0);
  assert.equal(announcements.push('Disposed'), false);
});
