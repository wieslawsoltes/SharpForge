import test from 'node:test';
import assert from 'node:assert/strict';
import { gitDialog, gitField } from '../apps/studio/git-dom.js';
import { fixtureDocument } from './a25-auth-ui-fixture.js';

test('repository dialog controls retain exact accessible labels independently of option text', async () => {
  const document = fixtureDocument();
  let submitted;
  gitDialog(document, {
    title: 'Initialize Repository',
    fields: [
      { name: 'name', label: 'Repository name', value: 'example' },
      { name: 'algorithm', label: 'Object format', value: 'sha1', options: [
        { value: 'sha1', label: 'SHA-1' }, { value: 'sha256', label: 'SHA-256' }
      ] }
    ],
    onSubmit: values => { submitted = values; }
  });
  const select = document.elements.find(element => element.tag === 'select');
  assert.equal(select.getAttribute('aria-label'), 'Object format');
  assert.equal(document.elements.find(element => element.tag === 'input').getAttribute('aria-label'), 'Repository name');
  select.value = 'sha256';
  await document.elements.find(element => element.tag === 'form').dispatch('submit');
  assert.deepEqual(submitted, { name: 'example', algorithm: 'sha256' });
});

test('field grouping preserves an existing descriptive accessible name', () => {
  const document = fixtureDocument();
  const result = document.createElement('textarea');
  result.setAttribute('aria-label', 'Resolved content');
  gitField(document, 'Result', result);
  assert.equal(result.getAttribute('aria-label'), 'Resolved content');
  const referenced = document.createElement('input');
  referenced.setAttribute('aria-labelledby', 'descriptive-label');
  gitField(document, 'Value', referenced);
  assert.equal(referenced.getAttribute('aria-labelledby'), 'descriptive-label');
  assert.equal(referenced.getAttribute('aria-label'), null);
});
