import assert from 'node:assert/strict';
import test from 'node:test';
import { KeybindingService } from '../packages/editor/src/index.js';
import { createNativeEditor, keyboardEvent } from './support/native-editor-fixture.js';

function hostTimers(t) {
  const pending = new Map();
  const cleared = [];
  let serial = 0;
  t.mock.method(globalThis, 'setTimeout', function(callback, delay) {
    assert.equal(this, globalThis, 'The host timer requires its global receiver');
    const id = ++serial;
    pending.set(id, { callback, delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', function(id) {
    assert.equal(this, globalThis, 'Host cancellation requires its global receiver');
    cleared.push(id);
    pending.delete(id);
  });
  return {
    pending,
    cleared,
    flush() {
      for (const [id, { callback }] of [...pending]) {
        pending.delete(id);
        callback();
      }
    }
  };
}

function resolver(t, options = {}) {
  const commands = [];
  const messages = [];
  const service = new KeybindingService({
    execute: command => commands.push(command),
    onStatus: message => messages.push(message),
    ...options
  });
  t.after(() => service.dispose());
  service.setBindings([{ keys: 'Ctrl+K Ctrl+C', command: 'comment' }]);
  return { service, commands, messages };
}

test('native editor chords use host receivers and preserve the real edit and undo result', t => {
  const timers = hostTimers(t);
  const editor = createNativeEditor('int value = 1;', { mode: 'visual-studio' });
  t.after(() => editor.dispose());
  assert.equal(editor.adapter.handle(keyboardEvent('Ctrl+K')), true);
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending.values()][0].delay, 1500);
  assert.equal(editor.value, 'int value = 1;');
  assert.equal(editor.adapter.handle(keyboardEvent('Ctrl+C')), true);
  assert.equal(editor.value, '// int value = 1;');
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(timers.cleared, [1]);
  timers.flush();
  assert.equal(editor.model.undoStack.depth, 1);
  editor.undo();
  assert.equal(editor.value, 'int value = 1;');
});

test('Escape cancels the host timer without executing the pending chord or a later timeout', t => {
  const timers = hostTimers(t);
  const { service, commands, messages } = resolver(t);
  service.handle(keyboardEvent('Ctrl+K'));
  const escape = keyboardEvent('Escape');
  assert.equal(service.handle(escape), true);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(service.pending, null);
  assert.deepEqual(timers.cleared, [1]);
  assert.equal(timers.pending.size, 0);
  timers.flush();
  assert.deepEqual(commands, []);
  assert.equal(messages.at(-1), 'Key sequence cancelled');
});

test('binding replacement cancels the old chord and the replacement still uses the host clock', t => {
  const timers = hostTimers(t);
  const { service, commands } = resolver(t);
  service.handle(keyboardEvent('Ctrl+K'));
  service.setBindings([{ keys: 'Ctrl+R Ctrl+R', command: 'rename' }]);
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(timers.cleared, [1]);
  assert.equal(service.pending, null);
  service.handle(keyboardEvent('Ctrl+R'));
  assert.equal(timers.pending.size, 1);
  service.handle(keyboardEvent('Ctrl+R'));
  assert.deepEqual(commands, ['rename']);
  assert.deepEqual(timers.cleared, [1, 2]);
  assert.equal(timers.pending.size, 0);
});

test('disposing a pending chord clears the host timer and prevents further scheduling', t => {
  const timers = hostTimers(t);
  const { service, commands, messages } = resolver(t);
  service.handle(keyboardEvent('Ctrl+K'));
  const statusCount = messages.length;
  service.dispose();
  assert.deepEqual(timers.cleared, [1]);
  assert.equal(timers.pending.size, 0);
  assert.equal(service.pending, null);
  timers.flush();
  assert.equal(service.handle(keyboardEvent('Ctrl+K')), false);
  service.dispose();
  assert.deepEqual(commands, []);
  assert.equal(messages.length, statusCount);
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(timers.cleared, [1]);
});

test('default host timeout reports an incomplete chord and allows a fresh complete chord', t => {
  const timers = hostTimers(t);
  const { service, commands, messages } = resolver(t, { timeout: 250 });
  service.handle(keyboardEvent('Ctrl+K'));
  assert.equal([...timers.pending.values()][0].delay, 250);
  timers.flush();
  assert.equal(service.pending, null);
  assert.equal(messages.at(-1), 'The key sequence Ctrl+K timed out');
  assert.deepEqual(commands, []);
  service.handle(keyboardEvent('Ctrl+K'));
  service.handle(keyboardEvent('Ctrl+C'));
  assert.deepEqual(commands, ['comment']);
  assert.equal(timers.pending.size, 0);
});

test('a deferred exact binding executes once when its default host timer expires', t => {
  const timers = hostTimers(t);
  const { service, commands } = resolver(t);
  service.setBindings([
    { keys: 'Ctrl+K Ctrl+C', command: 'comment' },
    { keys: 'Ctrl+K', command: 'palette', deferForChord: true }
  ]);
  service.handle(keyboardEvent('Ctrl+K'));
  assert.deepEqual(commands, []);
  timers.flush();
  assert.equal(service.pending, null);
  assert.deepEqual(commands, ['palette']);
  service.dispose();
  timers.flush();
  assert.deepEqual(commands, ['palette']);
});

test('injected clocks retain their own method receiver through replacement and disposal', t => {
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('Injected clocks must not use the global timer'));
  t.mock.method(globalThis, 'clearTimeout', () => assert.fail('Injected clocks must not use global cancellation'));
  const clock = {
    pending: new Map(),
    serial: 0,
    cleared: [],
    setTimeout(callback, delay) {
      assert.equal(this, clock);
      const id = ++this.serial;
      this.pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      assert.equal(this, clock);
      this.cleared.push(id);
      this.pending.delete(id);
    }
  };
  const { service, commands } = resolver(t, { clock, timeout: 700 });
  assert.equal(service.clock, clock);
  service.handle(keyboardEvent('Ctrl+K'));
  assert.equal(clock.pending.get(1).delay, 700);
  service.handle(keyboardEvent('Ctrl+C'));
  assert.deepEqual(commands, ['comment']);
  service.setBindings([{ keys: 'Ctrl+R Ctrl+R', command: 'rename' }]);
  service.handle(keyboardEvent('Ctrl+R'));
  service.dispose();
  assert.equal(clock.pending.size, 0);
  assert.deepEqual(clock.cleared, [1, 2]);
  assert.equal(service.clock, clock);
});
