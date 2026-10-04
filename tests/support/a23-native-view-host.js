import { defaultNativeSettings, buildActions } from '../../apps/studio/native-build/settings.js';

/** Minimal element port for view contracts; it deliberately does not parse HTML or emulate browser layout. */
export class NativeViewElement {
  constructor(values = {}) {
    Object.assign(this, { innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
      type: '', dataset: {}, scrollHeight: 100, scrollTop: 60, clientHeight: 40 }, values);
    this.nodes = new Map();
    this.groups = new Map();
    this.listeners = new Map();
  }

  node(selector, values) {
    const element = new NativeViewElement(values);
    this.nodes.set(selector, element);
    return element;
  }

  querySelector(selector) { return this.nodes.get(selector) ?? null; }
  querySelectorAll(selector) { return this.groups.get(selector) ?? []; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}

export function nativeViewHost() {
  const calls = [];
  const errors = [];
  const record = name => (...args) => { calls.push({ name, args }); };
  const host = {
    hosts: new Map(), settings: defaultNativeSettings(), workspace: { root: '/workspace',
      projects: ['App.csproj'], solutions: [], files: [] }, capabilities: { available: true, version: 'SDK fixture' },
    buffers: new Map(), busy: false, log: '', job: null, sourcePath: '', client: {},
    contexts: { project: 'App.csproj', active: null, contexts: [], compilation: null, diagnostics: [],
      setProject: record('setProject'), select: record('select'), load: record('loadContexts') },
    profiles: { launch: { profiles: [] }, launchProfile: '', publish: [], publishProfile: '', noBuild: true,
      diagnostics: [], refresh: record('readProfiles'), selectLaunch: record('selectLaunch'), selectPublish: record('selectPublish') },
    onError: error => errors.push(error), onSelectPanel: record('panel')
  };
  for (const name of ['run', 'cancel', 'refresh', 'connect', 'attach', 'save', 'open', 'artifact',
    'runProject', 'publishProfile', 'renderSource', 'inspectSolution']) host[name] = record(name);
  return { host, calls, errors };
}

export function nativeContextElement() {
  const element = new NativeViewElement();
  const selectors = ['context-project', 'context-load', 'context-select', 'profiles-refresh', 'launch-profile',
    'publish-profile', 'run-no-build', 'project-run', 'profile-publish', 'tests-open'];
  const controls = selectors.map(name => element.node('[data-native-' + name + ']'));
  element.groups.set('.native-project-context button, .native-project-context select, [data-native-run-no-build]', controls);
  return element;
}

export function nativeBuildElement() {
  const element = nativeContextElement();
  for (const name of ['cancel', 'connect', 'attach', 'save']) element.node('[data-native-' + name + ']');
  const actions = buildActions.map(([action]) => new NativeViewElement({ dataset: { nativeAction: action } }));
  element.groups.set('[data-native-action]', actions);
  const configuration = new NativeViewElement({ dataset: { nativeSetting: 'configuration' }, value: 'Debug' });
  const trust = new NativeViewElement({ dataset: { nativeSetting: 'trusted' }, type: 'checkbox' });
  element.groups.set('[data-native-setting]', [configuration, trust]);
  for (const selector of ['.native-operation-status', '.native-invocation', '.native-build-output',
    '.native-diagnostics', '.native-artifacts']) element.node(selector);
  return element;
}

export function nativeSourceElement() {
  const element = new NativeViewElement();
  for (const selector of ['.native-source-picker', '[data-native-source-save]', '[data-native-solution-inspect]',
    '.native-xml-editor', '[data-native-new-project]', '[data-native-new-solution]', '.native-source-status']) {
    element.node(selector);
  }
  return element;
}
