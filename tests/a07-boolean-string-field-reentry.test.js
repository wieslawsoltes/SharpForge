import test from 'node:test';
import assert from 'node:assert/strict';
import {booleanFieldHost, booleanFieldEngines, assertStringInitializationReleased, observeAllocation} from './fixtures/a07/boolean-string-fields.js';

for (const engine of booleanFieldEngines) {
  for (const kind of ['field', 'literal']) {
    test(`String initialization ${engine}/${kind}: swallowed same-key reentry still aborts outer publication and permits retry`, () => {
      const host = booleanFieldHost(engine, {weakStringInterning: true});
      const read = () => kind === 'field' ? host.read() : host.literal();
      let inner, calls = 0;
      const undo = observeAllocation(host, () => {
        calls++;
        try { read(); } catch (error) { inner = error; }
      });
      try {
        assert.throws(read, error => error === inner && error.name === 'InvalidOperationException' && /Reentrant/.test(error.message));
        assert.equal(calls, 1);
        assert.equal(host.has('TrueString'), false);
        assert.equal(host.vm.strings.has('True'), false);
        assertStringInitializationReleased(host);
        undo();
        const saved = host.vm.snapshot();
        assert.equal(host.vm.heap.get(read()).data, 'True');
        host.vm.restore(saved);
        assert.equal(host.vm.heap.get(read()).data, 'True');
      } finally { undo(); host.stop(); }
    });

    test(`String initialization ${engine}/${kind}: observer exception identity and pending cleanup survive retry`, () => {
      const host = booleanFieldHost(engine, {weakStringInterning: true});
      const read = () => kind === 'field' ? host.read() : host.literal();
      const failure = new Error('Allocation observer failed');
      const undo = observeAllocation(host, () => { throw failure; });
      try {
        assert.throws(read, error => error === failure);
        assert.equal(host.has('TrueString'), false);
        assert.equal(host.vm.strings.has('True'), false);
        assert.equal(host.vm.fault, null);
        assertStringInitializationReleased(host);
        undo();
        host.vm.restore(host.vm.snapshot());
        assert.equal(host.vm.heap.get(read()).data, 'True');
      } finally { undo(); host.stop(); }
    });
  }

  test(`String initialization ${engine}: completed cross-field observer changes survive a later outer failure`, () => {
    const host = booleanFieldHost(engine, {weakStringInterning: true});
    const failure = new Error('Outer observer failed after nested publication');
    let calls = 0, nested;
    const undo = observeAllocation(host, () => {
      if (++calls !== 1) return;
      nested = host.read('FalseString');
      throw failure;
    });
    try {
      assert.throws(() => host.read(), error => error === failure);
      assert.equal(host.has('TrueString'), false);
      assert.equal(host.vm.strings.has('True'), false);
      assert.equal(host.has('FalseString'), true);
      assert.equal(host.read('FalseString'), nested);
      host.vm.heap.collect();
      assert.equal(host.vm.heap.get(nested).data, 'False');
      assert.equal(host.vm.strings.get('False'), nested);
      assertStringInitializationReleased(host);
      undo();
      assert.equal(host.vm.heap.get(host.read()).data, 'True');
      assert.equal(host.read('FalseString'), nested);
    } finally { undo(); host.stop(); }
  });

  test(`String initialization ${engine}: heap exhaustion publishes no field or pool placeholder`, () => {
    const host = booleanFieldHost(engine, {weakStringInterning: true});
    const {heap} = host.vm;
    const budget = heap.maxBytes;
    try {
      heap.maxBytes = 1;
      assert.throws(() => host.read(), {name: 'OutOfMemoryException'});
      assert.equal(host.has('TrueString'), false);
      assert.equal(host.vm.strings.has('True'), false);
      assertStringInitializationReleased(host);
      heap.maxBytes = budget;
      host.vm.restore(host.vm.snapshot());
      assert.equal(heap.get(host.read()).data, 'True');
    } finally { heap.maxBytes = budget; host.stop(); }
  });

  for (const action of ['snapshot', 'restore']) {
    for (const kind of ['field', 'literal']) {
      test(`String initialization ${engine}/${kind}: active allocation rejects ${action} without replacing live state`, () => {
        const host = booleanFieldHost(engine, {weakStringInterning: true});
        const {vm} = host;
        const saved = vm.snapshot();
        let rejection, calls = 0;
        const undo = observeAllocation(host, () => {
          calls++;
          const frames = vm.frames, strings = vm.strings, statics = vm.statics, constants = vm.constantValues;
          const pins = [...vm.heap.pins], revision = vm.heap.mutationRevision;
          try {
            if (action === 'snapshot') vm.snapshot();
            else vm.restore(saved);
          } catch (error) { rejection = error; }
          assert.equal(vm.frames, frames);
          assert.equal(vm.strings, strings);
          assert.equal(vm.statics, statics);
          assert.equal(vm.constantValues, constants);
          assert.deepEqual(vm.heap.pins, pins);
          assert.equal(vm.heap.mutationRevision, revision);
        });
        try {
          const value = kind === 'field' ? host.read() : host.literal();
          assert.equal(calls, 1);
          assert.equal(rejection?.name, 'TypeError');
          assert.match(rejection.message, /synchronous host callbacks/);
          assert.equal(vm.heap.get(value).data, 'True');
          assertStringInitializationReleased(host);
          undo();
          vm.restore(saved);
          assert.equal(host.has('TrueString'), false);
          assert.equal(vm.strings.has('True'), false);
          assert.equal(vm.heap.get(host.read()).data, 'True');
        } finally { undo(); host.stop(); }
      });
    }
  }
}
