import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandRegistry} from '../apps/studio/commands/registry.js';
import {mountMenuBar, workbenchMenus} from '../apps/studio/workbench/menus.js';
import {WorkbenchShell} from '../apps/studio/workbench/shell.js';
import {menuDom, menuKey} from './support/a19-menu-dom.js';

const contribution = () => ({id: 'git', title: 'Git', mnemonic: 'g', before: 'build', commands: ['git.clone', 'git.push']});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};

function mounted(t, options = {}) {
  const dom = menuDom();
  const registry = createCommandRegistry();
  const errors = [];
  const menu = mountMenuBar(dom.host, {registry, execute: id => registry.execute(id), onError: error => errors.push(error), ...options});
  t.after(() => { menu.dispose(); registry.dispose(); });
  return {...dom, registry, errors, menu, bar: dom.host.children[0]};
}

const topButtons = bar => bar.children.filter(node => node.getAttribute('aria-haspopup') === 'menu');
const popup = bar => bar.children.find(node => node.getAttribute('role') === 'menu');

test('contributed Git menu uses real contextual commands, shortcuts, keyboard navigation and disposal', async t => {
  const descriptor = contribution();
  const fixture = mounted(t, {menuContributions: [descriptor],
    keybindings: {list: () => [{command: 'git.clone', keys: ['Ctrl+G']}]}});
  const {registry, bar, document, outside, menu} = fixture;
  const executed = deferred();
  let enabled = false;
  registry.registerCommand('git.clone', 'Clone Repository…', '', () => executed.resolve('clone'), {enabled: () => enabled});
  registry.registerCommand('git.push', 'Push', '', () => {}, {enabled: false});
  descriptor.commands.length = 0;
  const labels = topButtons(bar).map(button => button.textContent);
  assert.equal(labels.indexOf('Git') + 1, labels.indexOf('Build'));
  topButtons(bar).find(button => button.textContent === 'Git').click();
  assert.deepEqual(popup(bar).children.map(row => row.disabled), [true, true]);
  menu.close();
  enabled = true;
  assert.equal(menuKey(document, 'g', {altKey: true}).defaultPrevented, true);
  const rows = popup(bar).children;
  assert.deepEqual(rows.map(row => row.disabled), [false, true]);
  assert.equal(rows[0].children[0].textContent, 'Clone Repository…');
  assert.equal(rows[0].children[1].textContent, 'Ctrl+G');
  assert.equal(document.activeElement, rows[0]);
  menuKey(bar, 'ArrowRight');
  assert.equal(popup(bar).getAttribute('aria-label'), 'Build');
  menuKey(bar, 'ArrowLeft');
  assert.equal(popup(bar).getAttribute('aria-label'), 'Git');
  popup(bar).children[0].click();
  assert.equal(await executed.promise, 'clone');
  assert.equal(popup(bar), undefined);
  outside.focus();
  menuKey(document, 'g', {altKey: true});
  menuKey(bar, 'Escape');
  assert.equal(document.activeElement, outside);
  menu.dispose();
  assert.equal(fixture.host.children.length, 0);
  assert.equal(menuKey(document, 'g', {altKey: true}).defaultPrevented, false);
  assert.deepEqual(fixture.errors, []);
});

test('malformed or colliding contributions reject before creating DOM and leave default menus unchanged', () => {
  const snapshot = JSON.stringify(workbenchMenus);
  let coerced = false;
  for (const menus of [
    [{...contribution(), id: 'build'}], [contribution(), contribution()], [{...contribution(), mnemonic: 'b'}],
    [{...contribution(), before: 'missing'}], [{...contribution(), before: {toString() { coerced = true; return 'build'; }}}],
    [{...contribution(), execute() {}}],
    [{...contribution(), commands: [() => {}]}], [{...contribution(), commands: ['git.clone', 'git.clone']}],
    [{...contribution(), commands: Array(1)}], Array(65).fill(contribution())
  ]) {
    const {host} = menuDom();
    assert.throws(() => mountMenuBar(host, {registry: {}, menuContributions: menus}));
    assert.equal(host.children.length, 0);
    assert.equal(JSON.stringify(workbenchMenus), snapshot);
  }
  assert.equal(coerced, false, 'Invalid anchors must reject without invoking user coercion');
});

test('a current contributed command failure retains its exact identity at the existing menu reporter', async t => {
  const failure = new Error('Clone rejected by repository policy');
  const reported = deferred();
  const fixture = mounted(t, {menuContributions: [contribution()], onError: error => reported.resolve(error)});
  const remove = fixture.registry.registerCommand('git.clone', 'Clone Repository…', '', () => { throw failure; });
  topButtons(fixture.bar).find(button => button.textContent === 'Git').click();
  assert.equal(popup(fixture.bar).children.length, 1, 'Unregistered git.push must not render');
  popup(fixture.bar).children[0].click();
  assert.equal(await reported.promise, failure);
  remove();
  topButtons(fixture.bar).find(button => button.textContent === 'Git').click();
  assert.equal(popup(fixture.bar).children.length, 0, 'Removed commands must not retain dispatch rows');
});

test('the production shell mount forwards menu contributions to its native renderer', t => {
  const {host, document} = menuDom();
  const root = document.createElement('main');
  const registry = createCommandRegistry();
  const shell = {
    root, commands: registry, options: {menuContributions: [contribution()]}, disposers: [],
    metrics: {start() {}, end() {}, observeInput: () => () => {}}, settings: {snapshot: () => ({})},
    applySettings() {}, onError: error => { throw error; }, execute: id => registry.execute(id)
  };
  t.after(() => { for (const dispose of shell.disposers) dispose(); shell.announcer.dispose(); registry.dispose(); });
  assert.equal(WorkbenchShell.prototype.mount.call(shell, {menuHost: host}), shell);
  assert.ok(topButtons(host.children[0]).some(button => button.textContent === 'Git'));
});
