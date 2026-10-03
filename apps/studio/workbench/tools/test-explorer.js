import {WorkbenchEvents} from '../events.js';
import {createToolTree} from './tree-host.js';
import {button, select, runAction} from '../ui.js';

export class TestProviders extends WorkbenchEvents {
  constructor() { super(); this.providers = new Map(); this.tests = new Map(); this.runs = new Map(); this.serial = 0; }
  register(id, provider) {
    if (!id || this.providers.has(id) || typeof provider.discover !== 'function' || typeof provider.run !== 'function') {
      throw new TypeError('A test provider requires discover and run');
    }
    this.providers.set(id, provider);
    this.emit({type: 'provider', id});
    return () => {
      for (const controller of this.runs.values()) if (controller.providerIds.has(id)) controller.abort();
      this.providers.delete(id);
      for (const [key, test] of this.tests) if (test.providerId === id) this.tests.delete(key);
      this.emit({type: 'provider-removed', id});
    };
  }
  async discover({signal} = {}) {
    const next = new Map();
    for (const [providerId, provider] of this.providers) {
      signal?.throwIfAborted();
      const tests = await provider.discover({signal});
      if (!Array.isArray(tests) || tests.length > 100000) throw new TypeError('Invalid test discovery result');
      for (const test of tests) {
        if (!test.id || !test.name) throw new TypeError('Tests require id and name');
        const id = providerId + ':' + test.id;
        if (next.has(id)) throw new Error('Duplicate discovered test ' + id);
        if (next.size >= 100000) throw new RangeError('Test discovery limit exceeded');
        next.set(id, {...test, providerTestId: test.id, id, providerId, state: this.tests.get(id)?.state ?? 'not-run'});
      }
    }
    signal?.throwIfAborted();
    this.tests = next;
    this.emit({type: 'discovered'});
    return [...next.values()];
  }
  async run(ids, {debug = false, signal} = {}) {
    const selected = ids ? ids.map(id => this.tests.get(id)).filter(Boolean) : [...this.tests.values()];
    if (!this.providers.size) throw new Error('No test provider is registered for this workspace');
    const groups = new Map();
    for (const test of selected) {
      const group = groups.get(test.providerId) ?? [];
      group.push(test); groups.set(test.providerId, group);
    }
    const runId = 'test-run:' + ++this.serial;
    const controller = new AbortController();
    controller.providerIds = new Set(groups.keys());
    const abort = () => controller.abort(signal?.reason);
    signal?.throwIfAborted();
    signal?.addEventListener('abort', abort, {once: true});
    this.runs.set(runId, controller);
    const selectedById = new Map(selected.map(test => [test.providerId + ':' + test.providerTestId, test]));
    const update = event => {
      if (controller.signal.aborted) return;
      const test = selectedById.get(event.providerId + ':' + event.id);
      if (!test) throw new Error('Provider updated an unselected test');
      if (!['queued', 'running', 'passed', 'failed', 'skipped', 'cancelled'].includes(event.state)) throw new TypeError('Invalid test state');
      Object.assign(test, {state: event.state, duration: event.duration, message: event.message, output: event.output});
      this.emit({type: 'test-state', runId, test});
    };
    for (const test of selected) { test.state = 'queued'; this.emit({type: 'test-state', runId, test}); }
    try {
      await Promise.all([...groups].map(async ([id, tests]) => {
        const provider = this.providers.get(id);
        if (debug && provider.canDebug !== true) throw new Error('Test provider ' + id + ' does not support debugging');
        return provider.run(tests.map(test => test.providerTestId), {debug, signal: controller.signal,
          onResult: event => update({...event, providerId: id})});
      }));
      controller.signal.throwIfAborted();
      for (const test of selected.filter(item => ['queued', 'running'].includes(item.state))) {
        test.state = 'failed'; test.message = 'Provider completed without reporting a final result';
      }
    } catch (error) {
      for (const test of selected) {
        if (!['queued', 'running'].includes(test.state)) continue;
        test.state = controller.signal.aborted ? 'cancelled' : 'failed';
        test.message = error.message;
      }
      controller.abort(error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      this.runs.delete(runId);
      for (const test of selected) if (controller.signal.aborted && ['queued', 'running'].includes(test.state)) test.state = 'cancelled';
      this.emit({type: 'run-ended', runId});
    }
  }
  cancel(runId) {
    if (runId) this.runs.get(runId)?.abort();
    else for (const controller of this.runs.values()) controller.abort();
  }
  dispose() { this.cancel(); this.providers.clear(); this.tests.clear(); super.dispose(); }
}

export function testTree(tests, groupBy = 'project') {
  const roots = new Map();
  for (const test of tests) {
    const parts = groupBy === 'state' ? [test.state] : [test.project ?? '(workspace)', test.namespace ?? '(global)', test.className ?? '(tests)'];
    let map = roots, children;
    let path = 'tests';
    for (const part of parts) {
      path += ':' + part;
      let node = map.get(part);
      if (!node) map.set(part, node = {id: path, label: part, children: [], groups: new Map(), defaultExpanded: true});
      children = node.children; map = node.groups;
    }
    children.push({id: test.id, label: test.name + ' · ' + test.state, detail: test.message ?? test.output ?? '', test, children: []});
  }
  const flatten = nodes => [...nodes.values()].map(({groups, ...node}) => ({...node, children: [...flatten(groups), ...node.children]}));
  return flatten(roots);
}

export function mountTestExplorer(host, {model, tasks, navigate, onError}) {
  let groupBy = 'project';
  const tree = createToolTree(host, {label: 'Test Explorer', onError,
    onOpen: node => node.test?.uri && navigate(node.test), onSelect: node => {
      if (node?.test) tree.details.textContent = `${node.test.name}\n${node.test.state}` +
        (node.test.duration !== undefined ? ` · ${node.test.duration} ms` : '') + '\n' + (node.test.message ?? node.test.output ?? '');
    }});
  const refresh = () => {
    const tests = [...model.tests.values()];
    tree.setNodes(testTree(tests, groupBy));
    tree.status.textContent = model.providers.size ? ['passed', 'failed', 'running', 'not-run', 'skipped']
      .map(state => `${tests.filter(test => test.state === state).length} ${state}`).join(' · ') :
      'No test adapter is registered. Test discovery and execution require a workspace test provider.';
  };
  const run = (debug, failed = false) => tasks.run({label: debug ? 'Debug tests' : 'Run tests'}, operation => {
    const selected = [...tree.model.selected].flatMap(id => {
      const node = tree.model.nodes.get(id);
      const gather = item => item.test ? [item.test.id] : (item.children ?? []).flatMap(gather);
      return node ? gather(node) : [];
    });
    const ids = failed ? [...model.tests.values()].filter(test => test.state === 'failed').map(test => test.id) : selected.length ? selected : undefined;
    return model.run(ids, {debug, signal: operation.signal});
  });
  tree.toolbar.append(button(host.ownerDocument, 'Discover', runAction(() => model.discover(), onError)),
    button(host.ownerDocument, 'Run', runAction(() => run(false), onError)),
    button(host.ownerDocument, 'Debug', runAction(() => run(true), onError)),
    button(host.ownerDocument, 'Run failed', runAction(() => run(false, true), onError)),
    button(host.ownerDocument, 'Cancel', () => model.cancel()),
    select(host.ownerDocument, 'Group tests by', ['project', 'state'], groupBy, value => { groupBy = value; refresh(); }));
  refresh();
  return {refresh, run, dispose: () => tree.dispose()};
}
