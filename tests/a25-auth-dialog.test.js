import test from 'node:test';
import assert from 'node:assert/strict';
import { showGitAuthentication } from '../apps/studio/git-auth.js';

class DialogElement extends EventTarget {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.value = ''; }
  setAttribute() {}
  append(...elements) { this.children.push(...elements); }
  prepend(...elements) { this.children.unshift(...elements); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.removed = true; }
  focus() {}
}

test('A25 authentication cancellation clears token input and does not send it to the worker', async () => {
  const elements = [];
  const document = { body: new DialogElement('body'), createElement(tag) {
    const element = new DialogElement(tag); elements.push(element); return element;
  } };
  const controller = new AbortController();
  let requests = 0;
  const dialog = showGitAuthentication({ document, remote: 'https://github.com/acme/project', provider: 'github',
    remoteId: 'origin', signal: controller.signal, invoke: async () => { requests++; } });
  const token = elements.find(element => element.type === 'password');
  token.value = 'planted-dialog-token';
  const rejected = assert.rejects(dialog, { code: 'Cancelled' });
  controller.abort();
  await rejected;
  assert.equal(token.value, '');
  assert.equal(requests, 0);
  assert.equal(elements.find(element => element.tag === 'dialog').removed, true);
});

test('A25 pre-cancelled authentication creates no dialog', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(showGitAuthentication({ signal: controller.signal,
    document: { createElement() { throw new Error('Dialog should not be created'); } } }), { code: 'Cancelled' });
});
