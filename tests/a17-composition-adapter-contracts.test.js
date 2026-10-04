import test from 'node:test';
import assert from 'node:assert/strict';
import {Compositor, registerCompositionAdapters} from '@sharpforge/rendering';

function fixture() {
  const callbacks = new Map();
  registerCompositionAdapters({register(descriptor, handler) {
    callbacks.set([descriptor.owner, descriptor.kind ?? 'method', descriptor.name, descriptor.arity ?? '*'].join('|'), handler);
  }});
  const writes = [];
  const context = {
    services: {}, unwrapModel: value => value?.model ?? value, wrapModel: value => ({model: value}), managed: value => value,
    native(value) { if (value?.array) throw new Error('The managed array must use array hooks'); return value; },
    writeReference: (holder, value) => { holder.value = value; },
    arrayLength: holder => holder.array.length,
    arraySet(holder, index, value) { writes.push({index, value}); holder.array[index] = value; }
  };
  const invoke = (owner, name, receiver, args, parameters = [], result = 'void') => {
    const key = ['Microsoft.UI.Composition.' + owner, 'method', name, args.length].join('|');
    const generic = ['Microsoft.UI.Composition.' + owner, 'method', name, '*'].join('|');
    const callback = callbacks.get(key) ?? callbacks.get(generic);
    assert.ok(callback, owner + '.' + name);
    return callback({context, receiver: context.wrapModel(receiver), args, descriptor: {parameters, result}});
  };
  return {invoke, writes};
}

test('composition adapters write typed out values and distinguish missing and mismatched property sets', async () => {
  const compositor = new Compositor();
  const {invoke} = fixture();
  try {
    const values = compositor.CreatePropertySet();
    values.InsertScalar('Progress', 0.5);
    const output = {value: -1};
    assert.equal(invoke('CompositionPropertySet', 'TryGetScalar', values, ['Progress', output]), 0);
    assert.equal(output.value, 0.5);
    assert.equal(invoke('CompositionPropertySet', 'TryGetScalar', values, ['Missing', output]), 2);
    assert.equal(output.value, 0);
    values.InsertBoolean('Ready', true);
    assert.equal(invoke('CompositionPropertySet', 'TryGetScalar', values, ['Ready', output]), 1);
    assert.equal(output.value, 0);
    values.dispose();
    assert.throws(() => invoke('CompositionPropertySet', 'TryGetScalar', values, ['Progress', output]), /disposed/);
  } finally { await compositor.dispose(); }
});

test('composition dash adapters use managed array writes, exact GetMany counts and bounded source ranges', async () => {
  const compositor = new Compositor();
  const {invoke, writes} = fixture();
  try {
    const dashes = compositor.CreateSpriteShape().StrokeDashArray;
    dashes.ReplaceAll([0, 2, 3]);
    const destination = {array: [-1, -1, -1, -1]};
    invoke('CompositionStrokeDashArray', 'CopyTo', dashes, [destination, 1]);
    assert.deepEqual(destination.array, [-1, 0, 2, 3]);
    assert.deepEqual(writes.map(entry => entry.index), [1, 2, 3]);
    writes.length = 0;
    const part = {array: [-1, -1, -1, -1]};
    assert.equal(invoke('CompositionStrokeDashArray', 'GetMany', dashes, [2, part]), 1);
    assert.deepEqual(part.array, [3, -1, -1, -1]);
    assert.equal(writes.length, 1);
    assert.throws(() => invoke('CompositionStrokeDashArray', 'CopyTo', dashes, [destination, 2]), /index/);
    assert.equal(writes.length, 1, 'Rejected copies do not partially mutate their destination');
    const index = {value: 99};
    assert.equal(invoke('CompositionStrokeDashArray', 'IndexOf', dashes, [2, index]), true);
    assert.equal(index.value, 1);
    assert.equal(invoke('CompositionStrokeDashArray', 'IndexOf', dashes, [10, index]), false);
    assert.equal(index.value, 0);
  } finally { await compositor.dispose(); }
});
