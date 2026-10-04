import test from 'node:test';
import assert from 'node:assert/strict';
import {ItemContainerGenerator} from '@sharpforge/winui-properties';

test('A15 ten thousand item recycles keep one container and a constant binding/event listener count', () => {
  const scheduled = [], records = [], items = Array.from({length: 32}, (_, index) => ({text: 'item ' + index, listeners: new Set()}));
  let phases = 0;
  const generator = new ItemContainerGenerator({owner: {}, maxPool: 1, schedule: action => scheduled.push(action), adapter: {
    identity: container => container.id,
    createContainer() { const container = {id: records.length, text: '', data: null}; records.push(container); return container; },
    setDataContext: (container, item) => { container.data = item; },
    resetContainer: container => { container.text = ''; },
    prepareContent(container, item) {
      const update = () => { container.text = item.text; };
      item.listeners.add(update); update();
      return {dispose: () => item.listeners.delete(update)};
    },
    disposeContainer: container => { container.disposed = true; }
  }});
  generator.onContentChanging((_owner, event) => {
    if (!event.inRecycleQueue) event.registerUpdateCallback((_sender, phase) => {
      assert.equal(phase.phase, 1); phases++;
    }, 1);
  });
  generator.setItems(items);
  for (let index = 0; index < 10000; index++) {
    const position = index % items.length, previous = items[(position + items.length - 1) % items.length];
    const container = generator.realize(position);
    assert.equal(container.data, items[position]);
    assert.equal(container.text, items[position].text);
    previous.text = 'previous ' + index;
    for (const listener of previous.listeners) listener();
    assert.equal(container.text, items[position].text, 'a recycled container must not observe its prior item');
    assert.equal(items.reduce((count, item) => count + item.listeners.size, 0), 1);
    while (scheduled.length) scheduled.shift()();
    generator.recycle(position);
    assert.equal(container.data, null);
    assert.equal(items.reduce((count, item) => count + item.listeners.size, 0), 0);
  }
  assert.equal(records.length, 1);
  assert.equal(phases, 10000);
  assert.equal(generator.phaseQueue.length, 0);
  generator.dispose();
  assert.equal(records[0].disposed, true);
});
