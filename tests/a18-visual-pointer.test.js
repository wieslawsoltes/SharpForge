import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerSurfaceController} from '../apps/studio/designer-surface-controller.js';
import {DesignDocument, createDesign} from '@sharpforge/designer';
import {DesignerSurfaceGeometry} from '../apps/studio/designer-surface-geometry.js';

class PointerDocument {
  constructor() {
    this.listeners = new Map();
    this.frames = new Map();
    this.nextFrame = 1;
    this.defaultView = {
      requestAnimationFrame: callback => { const id = this.nextFrame++; this.frames.set(id, callback); return id; },
      cancelAnimationFrame: id => this.frames.delete(id)
    };
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  emit(type, value = {}) {
    for (const callback of [...this.listeners.get(type) ?? []]) {
      callback({preventDefault() {}, stopPropagation() {}, ...value});
    }
  }

  count() {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

function fixture() {
  const dom = new PointerDocument();
  const errors = [];
  const view = {document: new DesignDocument(createDesign()), stage: {ownerDocument: dom},
    safe: callback => { try { return callback(); } catch (error) { errors.push(error); return null; } },
    error: error => errors.push(error)};
  return {dom, controller: new DesignerSurfaceController(view), errors};
}

test('pointer session coalesces 200 events and commits latest geometry exactly once', () => {
  const {dom, controller, errors} = fixture();
  const moves = [];
  let commits = 0;
  controller.trackPointer({pointerId: 4}, event => moves.push(event.clientX), () => commits++);
  for (let index = 1; index <= 200; index++) dom.emit('pointermove', {pointerId: 4, clientX: index});
  assert.equal(dom.frames.size, 1);
  dom.emit('pointerup', {pointerId: 9});
  assert.equal(commits, 0);
  dom.emit('pointerup', {pointerId: 4, clientX: 200});
  assert.deepEqual(moves, [200]);
  assert.equal(commits, 1);
  assert.equal(dom.count(), 0);
  assert.equal(dom.frames.size, 0);
  assert.deepEqual(errors, []);
});

test('Escape and matching pointercancel cancel exactly once and leave no listeners or animation frames', () => {
  for (const type of ['keydown', 'pointercancel']) {
    const {dom, controller} = fixture();
    let cancels = 0;
    let commits = 0;
    controller.trackPointer({pointerId: 4}, () => {}, () => commits++, () => cancels++);
    dom.emit('pointermove', {pointerId: 4, clientX: 12});
    dom.emit(type, {pointerId: 4, key: 'Escape'});
    dom.emit(type, {pointerId: 4, key: 'Escape'});
    assert.equal(cancels, 1);
    assert.equal(commits, 0);
    assert.equal(dom.count(), 0);
    assert.equal(dom.frames.size, 0);
  }
});

test('starting another pointer cancels the previous owner without accepting unrelated contact movement', () => {
  const {dom, controller} = fixture();
  let canceled = 0;
  const moves = [];
  controller.trackPointer({pointerId: 1}, () => {}, () => {}, () => canceled++);
  controller.trackPointer({pointerId: 2}, event => moves.push(event.clientX), () => {});
  assert.equal(canceled, 1);
  dom.emit('pointercancel', {pointerId: 1});
  dom.emit('pointermove', {pointerId: 1, clientX: 99});
  dom.emit('pointermove', {pointerId: 2, clientX: 7});
  dom.emit('pointerup', {pointerId: 2, clientX: 7});
  assert.deepEqual(moves, [7]);
  assert.equal(dom.count(), 0);
});

test('failed move reports an explicit error and cancels rather than committing partial input', () => {
  const {dom, controller, errors} = fixture();
  let canceled = 0;
  let committed = false;
  controller.trackPointer({pointerId: 1}, () => { throw new Error('Invalid transformed geometry'); },
    () => { committed = true; }, () => canceled++);
  dom.emit('pointermove', {pointerId: 1, clientX: 1});
  dom.emit('pointerup', {pointerId: 1, clientX: 1});
  assert.equal(canceled, 1);
  assert.equal(committed, false);
  assert.equal(errors[0].message, 'Invalid transformed geometry');
  assert.equal(dom.count(), 0);
});

test('large geometry cache measures selection first and completes bounded background slices with disposal', () => {
  const dom = new PointerDocument();
  let reads = 0;
  dom.defaultView.performance = {now: () => reads * .25};
  dom.defaultView.getComputedStyle = element => ({width: `${element.width}px`, height: '20px', boxSizing: 'border-box', transform: 'none'});
  const element = (left, width, parent = null) => ({ownerDocument: dom, parentElement: parent, width, isConnected: true,
    getBoundingClientRect() { reads++; return {left, top: 0, width, height: 20}; }});
  const stage = element(0, 800);
  const nodes = [{id: 'root', type: 'Canvas', properties: {}, children: []}];
  const elements = new Map([['root', stage]]);
  for (let index = 1; index < 5000; index++) {
    nodes.push({id: `n${index}`, type: 'Button', properties: {Left: index * 10, Top: 0}, children: []});
    nodes[0].children.push(`n${index}`);
    elements.set(`n${index}`, element(index * 10, 24, stage));
  }
  const document = {value: {nodes, root: 'root'}, selection: ['n1'], revision: 0,
    parent: id => id === 'root' ? null : nodes[0]};
  const geometry = new DesignerSurfaceGeometry({stage, document, host: {elements}, safe: callback => callback()});
  geometry.refresh();
  assert(reads < 10, `Cold selection used ${reads} DOM reads`);
  assert.equal(geometry.rect('n1').Width, 24);
  assert.equal(dom.frames.size, 1);
  const [id, frame] = dom.frames.entries().next().value;
  dom.frames.delete(id);
  frame();
  assert(reads < 40, `One background slice used ${reads} DOM reads`);
  assert(geometry.pending);
  geometry.dispose();
  assert.equal(dom.frames.size, 0);
  assert.equal(geometry.entries.size, 0);
});
