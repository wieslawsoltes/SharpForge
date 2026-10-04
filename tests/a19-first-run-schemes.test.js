import assert from 'node:assert/strict';
import test from 'node:test';
import {SettingsStore, settingsDefaults, settingsKey} from '../apps/studio/workbench/settings-store.js';
import {showFirstRun} from '../apps/studio/workbench/first-run.js';
import {showSettingsProfile} from '../apps/studio/workbench/settings-profile.js';
import {OptionsDialog} from '../apps/studio/workbench/options-dialog.js';
import {keyboardOptionsPage} from '../apps/studio/workbench/options/keyboard-page.js';
import {StudioKeyboard} from '../apps/studio/workbench/studio-keyboard.js';
import {WorkbenchShell} from '../apps/studio/workbench/shell.js';
import {subscribeShellServices} from '../apps/studio/workbench/shell-events.js';
import {registerShellCommands} from '../apps/studio/workbench/shell-commands.js';
import {createStudioEditorHost} from '../apps/studio/workbench/studio-editor-host.js';
import {createCommandRegistry} from '../apps/studio/commands/registry.js';
import {UnifiedSearch} from '../apps/studio/workbench/unified-search.js';
import {createNativeEditor, keyboardEvent, selectionPairs} from './support/native-editor-fixture.js';
import {choose, createSettingsDialogs, descendants, memorySettingsStorage} from './support/settings-dialog-fixture.js';

function environmentFixture() {
  const storage = memorySettingsStorage();
  const settings = new SettingsStore({storage, workspaceId: 'one'});
  settings.load();
  const dialogs = createSettingsDialogs();
  const commands = createCommandRegistry();
  const opened = [];
  const errors = [];
  const downloads = [];
  const state = {keymap: 'visual-studio', uri: 'file:///fixture.cs', activeDocumentKind: 'code', debugState: 'stopped'};
  const documents = {active: state.uri, activeViews: new Map()};
  const host = createStudioEditorHost({documents, commands, docking: {tabs: {panel() {}}}});
  const editor = createNativeEditor('alpha alpha\r\nbeta', {mode: state.keymap, requestHost: host, selections: [[0, 5]]});
  let active = editor;
  const shell = {
    commands, settings, dialogs, documents, document: dialogs.document, toolDefinitions: [],
    services: {sessions: {maxSessions: 4}}, fileWatch: {start() {}}, tests: {providers: new Map(), tests: new Map()},
    context: () => state, onError: error => errors.push(error),
    unifiedSearch: {open: (_dialogs, options) => opened.push({kind: 'search', ...options})},
    optionsDialog: {open: page => opened.push({kind: 'options', page})},
    activateTool: tool => opened.push({kind: 'tool', tool}),
    options: {
      getEditor: () => active,
      download: (...args) => downloads.push(args),
      setKeymap(id) { editor.adapter.setMode(id); keyboard.profile(id); state.keymap = id; },
      applyKeybindings: bindings => keyboard.apply(bindings)
    },
    applySettings(value) { WorkbenchShell.prototype.applySettings.call(this, value); }
  };
  const removeCommands = registerShellCommands(shell);
  commands.registerCommand('save', 'Save', 'Ctrl+S', () => opened.push({kind: 'save'}));
  const keyboard = new StudioKeyboard({commands, getEditor: () => active, context: () => state, onError: error => errors.push(error)});
  keyboard.profile(state.keymap);
  keyboard.attach(editor);
  const unsubscribe = subscribeShellServices(shell);
  return {
    storage, settings, dialogs, commands, shell, editor, keyboard, opened, errors, downloads, state,
    setActive(value) { active = value; },
    async selectProfile(id, theme = 'blue') {
      const handle = showFirstRun({dialogs, settings, force: true});
      choose(handle, 'Keyboard scheme', id);
      choose(handle, 'Theme', theme);
      await handle.run('Start coding');
      return handle;
    },
    async send(sequence, kind = 'global') {
      for (const stroke of sequence.split(' ')) {
        const event = {...keyboardEvent(stroke), target: {closest: selector => kind === 'editor' && selector === '.sf-editor' ? {} : null}};
        keyboard.capture(event);
        if (!event.defaultPrevented && kind === 'editor') editor.adapter.handle(event);
        if (!event.defaultPrevented) keyboard.handle(event);
        assert.equal(event.defaultPrevented, true, sequence);
      }
      await new Promise(setImmediate);
    },
    dispose() {
      unsubscribe();
      shell.restoreEnvironment?.();
      keyboard.dispose();
      editor.dispose();
      removeCommands();
      commands.dispose();
      settings.dispose();
    }
  };
}

function documentState(editor) {
  return {model: editor.model, text: editor.value, version: editor.model.version, selections: selectionPairs(editor),
    primaryIndex: editor.primaryIndex, undo: editor.model.undoStack.depth, dirty: editor.model.isDirty};
}

for (const [profile, globalKey, duplicated] of [
  ['visual-studio', 'Mod+,', true], ['vscode', 'Mod+P', false], ['resharper', 'Mod+N', true]
]) {
  test(`first-run ${profile} applies theme, global navigation and actual editor shortcuts`, async () => {
    const fixture = environmentFixture();
    await fixture.selectProfile(profile);
    assert.equal(fixture.settings.get('environment', 'keymap'), profile);
    assert.equal(fixture.editor.keymap, profile);
    assert.equal(fixture.dialogs.document.documentElement.dataset.theme, 'blue');
    assert.equal(fixture.settings.get('environment', 'firstRunComplete'), true);
    await fixture.send(globalKey);
    assert.equal(fixture.opened.at(-1).kind, 'search');
    assert.equal(fixture.opened.at(-1).goTo, true);
    await fixture.send('Mod+D', 'editor');
    assert.equal(fixture.editor.value, duplicated ? 'alphaalpha alpha\r\nbeta' : 'alpha alpha\r\nbeta');
    if (!duplicated) assert.deepEqual(selectionPairs(fixture.editor), [[0, 5], [6, 11]]);
    assert.deepEqual(fixture.errors, []);
    fixture.dispose();
  });
}

test('global ReSharper navigation retains file/member/symbol/recent arguments without an active editor', async () => {
  const fixture = environmentFixture();
  await fixture.selectProfile('resharper');
  fixture.setActive(null);
  const cases = [['Mod+Shift+N', 'f '], ['Mod+Alt+Shift+N', '# '], ['Mod+F12', 'm '], ['Mod+E', 'recent '],
    ['Mod+K Mod+N', ''], ['Mod+K Mod+F', 'f '], ['Mod+K Mod+S', '# '], ['Mod+K Mod+M', 'm '], ['Mod+K Mod+E', 'recent ']];
  for (const [keys, query] of cases) {
    const before = fixture.opened.length;
    await fixture.send(keys);
    assert.equal(fixture.opened.length, before + 1, keys);
    assert.equal(fixture.opened.at(-1).query, query, keys);
  }
  await fixture.send('Mod+Shift+A');
  assert.equal(fixture.opened.at(-1).goTo, undefined);
  await fixture.send('Mod+K Mod+,');
  assert.equal(fixture.opened.at(-1).kind, 'options');
  assert.deepEqual(fixture.errors, []);
  fixture.dispose();
});

test('projected query prefixes use the real workbench search filters and source navigation', async () => {
  const navigated = [];
  const symbols = [{id: 'type', name: 'Box', kind: 'class', uri: 'Box.cs'},
    {id: 'member', name: 'Run', kind: 'method', uri: 'Box.cs', line: 2}];
  const search = new UnifiedSearch({registry: {search: () => []}, options: {list: () => []},
    documents: {list: () => [{uri: 'Box.cs', version: 7}, {uri: 'Program.cs', version: 3}]},
    recent: {list: () => [{uri: 'Program.cs'}]}, context: () => ({uri: 'Box.cs'}),
    symbols: {query: async (_query, {onBatch}) => onBatch(symbols)}, navigate: item => navigated.push(item)});
  const files = await search.query('f Box', {goTo: true});
  assert.deepEqual(files.map(item => item.kind), ['File']);
  search.activate(files[0]);
  assert.deepEqual(navigated.at(-1), {uri: 'Box.cs', version: 7, preview: true});
  assert.deepEqual((await search.query('m ', {goTo: true})).map(item => item.kind), ['method']);
  assert.deepEqual((await search.query('# ', {goTo: true})).map(item => item.kind), ['class', 'method']);
  const recent = await search.query('recent ', {goTo: true});
  search.activate(recent[0]);
  assert.deepEqual(navigated.at(-1), {uri: 'Program.cs', preview: true});
});

test('cancelled first-run selection has no effect, completed setup is skipped, and reselect preserves documents', async () => {
  const fixture = environmentFixture();
  fixture.editor.insertText('changed', {undoStop: true});
  const before = documentState(fixture.editor);
  const initial = fixture.settings.snapshot();
  const cancelled = showFirstRun(fixture);
  choose(cancelled, 'Keyboard scheme', 'resharper');
  cancelled.close(false);
  assert.deepEqual(fixture.settings.snapshot(), initial);
  assert.deepEqual(documentState(fixture.editor), before);
  await fixture.selectProfile('resharper', 'high-contrast');
  assert.equal(showFirstRun(fixture), null);
  await fixture.selectProfile('vscode');
  assert.deepEqual(documentState(fixture.editor), before);
  fixture.editor.undo();
  assert.equal(fixture.editor.value, 'alpha alpha\r\nbeta');
  fixture.dispose();
});

test('profile changes keep custom bindings and one effective copy of each common global shortcut', async () => {
  const fixture = environmentFixture();
  fixture.settings.apply({keyboard: {bindings: [{id: 'custom:search', command: 'workbench.goToAll',
    keys: 'Ctrl+Alt+U', scope: 'Global', args: {query: 'm '}}]}});
  for (const profile of ['resharper', 'vscode', 'visual-studio']) {
    await fixture.selectProfile(profile);
    await fixture.send('Mod+Alt+U');
    assert.equal(fixture.opened.at(-1).query, 'm ');
    assert.equal(fixture.keyboard.bindingsFor('save').length, 1);
    const before = fixture.opened.length;
    await fixture.send('Mod+S');
    assert.equal(fixture.opened.length, before + 1);
  }
  fixture.dispose();
});

test('choosing a user scheme clears only supplied current-workspace overrides and persists across reload', async () => {
  const fixture = environmentFixture();
  fixture.settings.apply({environment: {keymap: 'vim', theme: 'light', density: 'comfortable'}, editor: {tabSize: 7}}, {scope: 'workspace'});
  const other = new SettingsStore({storage: fixture.storage, workspaceId: 'two'});
  other.load();
  other.apply({environment: {keymap: 'emacs', theme: 'system'}}, {scope: 'workspace'});
  await fixture.selectProfile('resharper');
  assert.equal(fixture.settings.get('environment', 'density'), 'comfortable');
  assert.equal(fixture.settings.get('editor', 'tabSize'), 7);
  const persisted = JSON.parse(fixture.storage.getItem(settingsKey));
  assert.deepEqual(persisted.workspaces.one.environment, {density: 'comfortable'});
  assert.deepEqual(persisted.workspaces.two.environment, {keymap: 'emacs', theme: 'system'});
  assert.equal(new SettingsStore({storage: fixture.storage, workspaceId: 'one'}).load().environment.keymap, 'resharper');
  assert.equal(new SettingsStore({storage: fixture.storage, workspaceId: 'two'}).load().environment.keymap, 'emacs');
  fixture.dispose();
});

test('invalid scheme and persistence failure reject the complete first-run transaction before changing shortcuts', async () => {
  const fixture = environmentFixture();
  const before = fixture.settings.snapshot();
  let events = 0;
  fixture.settings.subscribe(() => events++);
  const handle = showFirstRun(fixture);
  choose(handle, 'Keyboard scheme', 'unknown');
  await assert.rejects(handle.run('Start coding'), /Invalid keymap/u);
  choose(handle, 'Keyboard scheme', 'resharper');
  fixture.storage.fail = true;
  await assert.rejects(handle.run('Start coding'), /quota/u);
  assert.deepEqual(fixture.settings.snapshot(), before);
  assert.equal(fixture.editor.keymap, 'visual-studio');
  assert.equal(events, 0);
  assert.equal(handle.closed, false);
  fixture.dispose();
});

test('Options selects ReSharper after setup and commits only edited keys over a workspace override', async () => {
  const fixture = environmentFixture();
  fixture.settings.apply({environment: {keymap: 'vim', density: 'comfortable'}, editor: {tabSize: 7}}, {scope: 'workspace'});
  fixture.editor.insertText('kept', {undoStop: true});
  const before = documentState(fixture.editor);
  const options = new OptionsDialog(fixture);
  options.register(keyboardOptionsPage({registry: fixture.commands, keybindings: fixture.keyboard}));
  const handle = options.open('Environment.keyboard');
  assert.ok(handle.control('Mapping scheme').options.some(option => option.value === 'resharper'));
  choose(handle, 'Mapping scheme', 'resharper');
  assert.equal(fixture.editor.keymap, 'vim');
  await handle.run('OK');
  assert.equal(fixture.editor.keymap, 'resharper');
  assert.deepEqual(documentState(fixture.editor), before);
  assert.equal(fixture.settings.user.editor.tabSize, settingsDefaults.editor.tabSize);
  assert.deepEqual(fixture.settings.workspace, {environment: {density: 'comfortable'}, editor: {tabSize: 7}});
  const cancelled = options.open('Environment.keyboard');
  choose(cancelled, 'Mapping scheme', 'vscode');
  cancelled.close(false);
  assert.equal(fixture.editor.keymap, 'resharper');
  fixture.dispose();
});

async function previewProfile(handle, profile) {
  const file = handle.control('Settings profile to import');
  file.files = [{size: profile.length, text: async () => profile}];
  file.dispatchEvent(new Event('change'));
  await new Promise(setImmediate);
}

function selectCategories(handle, categories) {
  for (const checkbox of descendants(handle.host, node => node.attributes.type === 'checkbox')) {
    checkbox.checked = categories.includes(checkbox.parent.textContent);
    checkbox.dispatchEvent(new Event('change'));
  }
}

test('Import and Export Settings applies a previewed scheme to both scopes without changing editor data', async () => {
  const fixture = environmentFixture();
  fixture.settings.apply({environment: {keymap: 'vim'}}, {scope: 'workspace'});
  fixture.editor.insertText('kept', {undoStop: true});
  const before = documentState(fixture.editor);
  const handle = showSettingsProfile({...fixture, download: fixture.shell.options.download});
  const profile = JSON.stringify({format: 'sharpforge-settings', version: 2,
    settings: {environment: {keymap: 'resharper', theme: 'light'}, editor: {tabSize: 2}}});
  await previewProfile(handle, profile);
  selectCategories(handle, ['environment']);
  assert.equal(fixture.editor.keymap, 'vim');
  await handle.run('Import previewed changes');
  assert.equal(fixture.editor.keymap, 'resharper');
  assert.equal(fixture.settings.get('editor', 'tabSize'), 4);
  assert.deepEqual(documentState(fixture.editor), before);
  await fixture.send('Mod+K Mod+N');
  assert.equal(fixture.opened.at(-1).goTo, true);
  fixture.dispose();
});

test('settings profile rejects invalid imports, exports selected categories and can reopen first-run choices', async () => {
  const fixture = environmentFixture();
  await fixture.selectProfile('resharper');
  const handle = showSettingsProfile({...fixture, download: fixture.shell.options.download, onError: error => fixture.errors.push(error)});
  await previewProfile(handle, '{broken');
  await assert.rejects(handle.run('Import previewed changes'), /valid settings profile/u);
  assert.equal(fixture.errors.length, 1);
  assert.equal(fixture.settings.get('environment', 'keymap'), 'resharper');
  selectCategories(handle, ['environment']);
  const exportButton = descendants(handle.host, node => node.tagName === 'button' && node.textContent === 'Export selected categories')[0];
  exportButton.dispatchEvent(new Event('click'));
  assert.equal(fixture.downloads[0][0], 'SharpForge.settings.json');
  assert.deepEqual(Object.keys(JSON.parse(fixture.downloads[0][1]).settings), ['environment']);
  await handle.run('Choose development environment…');
  const chooser = fixture.dialogs.current;
  assert.equal(chooser.options.title, 'Choose Your Development Environment');
  assert.equal(chooser.control('Keyboard scheme').value, 'resharper');
  choose(chooser, 'Keyboard scheme', 'vscode');
  await chooser.run('Start coding');
  assert.equal(fixture.editor.keymap, 'vscode');
  fixture.dispose();
});

test('resetting selected categories restores the default scheme while retaining unrelated settings and undo', async () => {
  const fixture = environmentFixture();
  await fixture.selectProfile('resharper');
  fixture.settings.apply({editor: {tabSize: 8}, environment: {density: 'comfortable'}}, {scope: 'workspace'});
  fixture.editor.insertText('kept', {undoStop: true});
  const before = documentState(fixture.editor);
  const handle = showSettingsProfile({...fixture, download: fixture.shell.options.download});
  selectCategories(handle, ['environment']);
  await handle.run('Reset selected categories');
  assert.deepEqual(fixture.settings.snapshot().environment, settingsDefaults.environment);
  assert.equal(fixture.settings.get('editor', 'tabSize'), 8);
  assert.equal(fixture.editor.keymap, 'visual-studio');
  assert.deepEqual(documentState(fixture.editor), before);
  await fixture.send('Mod+,');
  assert.equal(fixture.opened.at(-1).goTo, true);
  fixture.dispose();
});

test('reset validates categories and remains atomic on storage failure, including the empty boundary', () => {
  const storage = memorySettingsStorage();
  const settings = new SettingsStore({storage});
  settings.load();
  settings.apply({environment: {keymap: 'resharper'}});
  let events = 0;
  settings.subscribe(() => events++);
  const before = settings.snapshot();
  const writes = storage.writes;
  settings.reset([]);
  assert.equal(storage.writes, writes);
  assert.equal(events, 0);
  assert.throws(() => settings.reset(['environment', 'unknown']), /known settings categories/u);
  assert.throws(() => settings.reset(['__proto__']), /known settings categories/u);
  assert.throws(() => settings.apply({}, {clearWorkspaceOverrides: 'yes'}), /override policy/u);
  storage.fail = true;
  assert.throws(() => settings.reset(['environment']), /quota/u);
  assert.deepEqual(settings.snapshot(), before);
  assert.equal(events, 0);
  storage.fail = false;
  settings.reset(['environment', 'environment']);
  assert.equal(events, 1);
  assert.equal(settings.get('environment', 'keymap'), 'visual-studio');
});

test('changing schemes cancels an in-progress native and global chord before the next keystroke', async () => {
  const fixture = environmentFixture();
  await fixture.selectProfile('resharper');
  await fixture.send('Mod+K', 'editor');
  assert.ok(fixture.editor.adapter.bindings.pending);
  await fixture.send('Mod+K');
  assert.ok(fixture.keyboard.service.pending);
  await fixture.selectProfile('vscode');
  assert.equal(fixture.editor.adapter.bindings.pending, null);
  assert.equal(fixture.keyboard.service.pending, null);
  const before = fixture.opened.length;
  assert.equal(fixture.keyboard.handle(keyboardEvent('Mod+N')), false);
  assert.equal(fixture.opened.length, before);
  fixture.dispose();
});
