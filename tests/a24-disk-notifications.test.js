import test from 'node:test';
import assert from 'node:assert/strict';
import {DiskServicesView} from '../apps/studio/explorer/disk-services-view.js';
import {diskTestView} from './support/a24-disk-dom.js';

test('disk import reports render every rejected path through bounded accessible pages', () => {
  const host = diskTestView();
  const ui = new DiskServicesView(host, {choose() {}, open() {}});
  assert.equal(ui.root.getAttribute('aria-label'), 'Disk workspace notifications');
  assert.equal(ui.status.getAttribute('role'), 'status');
  assert.equal(host.element.children[1], ui.root);
  assert.equal(ui.report.hidden, true);
  ui.importReport(Array.from({length: 250}, (_, index) => ({path: `Rejected${index}.cs`, reason: 'file-too-large'})));
  const list = ui.report.querySelector('ol');
  const next = ui.report.querySelector('button');
  assert.equal(ui.report.hidden, false);
  assert.equal(list.children.length, 100);
  assert.match(list.children[0].textContent, /^Rejected0.cs/);
  next.click();
  assert.equal(list.children.length, 100);
  assert.match(list.children[0].textContent, /^Rejected100.cs/);
  next.click();
  assert.equal(list.children.length, 50);
  assert.match(list.children.at(-1).textContent, /^Rejected249.cs/);
  assert.equal(next.hidden, true);
  ui.importReport([]);
  assert.equal(ui.report.hidden, true);
  ui.dispose();
  assert.equal(ui.root.parentNode, null);
});

test('reload choices and path results invoke explicit callbacks and comparison text stays read-only', () => {
  const actions = [];
  const opened = [];
  const ui = new DiskServicesView(diskTestView(), {
    choose: (path, choice) => actions.push({path, choice}), open: path => opened.push(path)
  });
  ui.prompt({path: 'A.cs'});
  const row = ui.promptRows.get('A.cs');
  assert.equal(row.getAttribute('aria-label'), 'External change to A.cs');
  for (const button of row.querySelectorAll('button')) button.click();
  assert.deepEqual(actions, ['reload', 'keep', 'compare'].map(choice => ({path: 'A.cs', choice})));
  ui.compare({path: 'A.cs', localText: 'unsaved', diskText: 'external'});
  assert.deepEqual(row.querySelectorAll('textarea').map(node => [node.value, node.readOnly]), [['unsaved', true], ['external', true]]);
  ui.compare({path: 'A.cs', localText: 'unsaved', diskText: '', deleted: true});
  assert.equal(row.querySelectorAll('textarea').length, 2);
  assert.match(row.textContent, /Deleted on disk/);
  ui.paths('A', [{path: 'A.cs'}], {truncated: true});
  assert.match(ui.results.textContent, /first 100 shown/);
  ui.results.querySelector('button').click();
  assert.deepEqual(opened, ['A.cs']);
  ui.removePrompt('A.cs');
  assert.equal(ui.promptRows.size, 0);
  ui.reset();
  assert.equal(ui.results.hidden, true);
  assert.equal(ui.status.textContent, '');
  ui.dispose();
});
