import {createTestResult, TestOutcome} from '@sharpforge/msbuild';
import {NativeClientTestAdapter} from './native-client.js';
import {PortableWorkerTestAdapter} from './worker-client.js';
import {downloadNativeArtifact} from '../native-build/settings.js';

export const testProviders = Object.freeze([
  ['portable-source', 'Portable source VM'], ['portable-cil', 'Portable managed CIL'],
  ['native-vstest', 'Native VSTest'], ['native-mtp', 'Native Microsoft.Testing.Platform'], ['native-mtp-bridge', 'Native MTP VSTest bridge']
]);

function discoveryContext(request) {
  const properties = Object.entries(request.properties ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return JSON.stringify([request.project, request.framework, request.runtime, request.configuration,
    request.platform, request.runner, request.settings, properties]);
}

/** Framework-neutral explorer controller owns selection and result state; adapters own execution. */
export class TestExplorerController {
  constructor(host, {createPortable = () => new PortableWorkerTestAdapter(), createNative = client => new NativeClientTestAdapter(client)} = {}) {
    this.host = host;
    this.createPortable = createPortable;
    this.createNative = createNative;
    this.adapters = new Map();
    this.provider = 'portable-source';
    this.tests = [];
    this.discovery = null;
    this.discoveryContext = null;
    this.selected = new Set();
    this.results = new Map();
    this.diagnostics = [];
    this.session = null;
    this.result = null;
    this.output = '';
    this.filter = '';
    this.focused = null;
    this.busy = false;
    this.controller = null;
    this.settings = {noBuild: false, coverage: false, debug: false, timeoutMs: 30000};
    this.sourceSnapshot = null;
    this.disposed = false;
    this.renderTimer = null;
  }

  get native() { return this.provider.startsWith('native-'); }

  adapter(native = this.native) {
    const key = native ? 'native' : 'portable';
    if (!this.adapters.has(key)) {
      if (native && !this.host.client?.service) throw new Error('Connect a native host with test services');
      this.adapters.set(key, native ? this.createNative(this.host.client) : this.createPortable());
    }
    return this.adapters.get(key);
  }

  configure({provider, ...settings} = {}) {
    if (this.busy) throw new Error('Finish the current test operation before changing settings');
    if (provider && !testProviders.some(([id]) => id === provider)) throw new Error('Unknown test provider');
    if (provider && provider !== this.provider) {
      this.provider = provider;
      this.discovery = null;
      this.tests = [];
      this.selected.clear();
      this.results.clear();
      this.result = null;
      this.session = null;
    }
    if (settings.timeoutMs !== undefined && (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 1 || settings.timeoutMs > 3600000)) {
      throw new Error('Test timeout must be 1–3600000 ms');
    }
    Object.assign(this.settings, settings);
    this.notify();
  }

  async input(signal) {
    const supplied = this.host.getTestInput ? await this.host.getTestInput({signal}) : null;
    const files = supplied?.files ?? await this.host.getTestSources?.({signal}) ?? this.host.contexts.compilation?.files ?? [];
    if (!Array.isArray(files)) throw new Error('Test sources must be a hydrated file collection');
    return {...supplied, files, compilationOptions: supplied?.compilationOptions ?? {}};
  }

  request() {
    const native = this.host.contexts.request();
    return {...native, ...this.settings, project: this.native ? native.project :
      (this.host.getTestProject?.() ?? native.project) || 'Browser.csproj', runner: this.provider.slice(7),
      backend: this.provider === 'portable-cil' ? 'cil' : 'source'};
  }

  async operation(label, action) {
    if (this.disposed) throw new Error('Test Explorer is disposed');
    if (this.busy || this.host.busy) throw new Error('Finish the active operation first');
    this.busy = true;
    this.controller = new AbortController();
    this.diagnostics = [];
    this.notify();
    try {
      return this.native ? await this.host.operation(label, signal => action(AbortSignal.any([signal, this.controller.signal]))) :
        await action(this.controller.signal);
    } catch (error) {
      if (!this.controller.signal.aborted && error.name !== 'AbortError') {
        this.diagnostics.push({code: error.code ?? 'SFT_UI_OPERATION', severity: 'error', message: error.message});
      }
      throw error;
    } finally { this.busy = false; this.controller = null; this.notify(); }
  }

  async discover() {
    return this.operation('Discover tests', async signal => {
      const request = this.request();
      const input = await this.input(signal);
      const sources = input.files;
      let sourceTests = [];
      if (this.native && sources.length) {
        const metadata = await this.adapter(false).discover({sources, project: request.project,
          compilationOptions: input.compilationOptions, evaluateData: false}, {signal});
        sourceTests = metadata.tests;
      }
      const discovery = await this.adapter().discover(this.native ? {...request, sourceTests} :
        {...request, sources, compilationOptions: input.compilationOptions}, {signal});
      signal.throwIfAborted();
      if (!Array.isArray(discovery.tests) || discovery.tests.length > 10000) throw new Error('Test Explorer supports at most 10000 discovered tests');
      this.discovery = discovery;
      this.discoveryContext = discoveryContext(request);
      this.tests = discovery.tests;
      this.selected = new Set(this.tests.map(test => test.id));
      this.results.clear();
      this.diagnostics = discovery.diagnostics ?? [];
      this.sourceSnapshot = sources.map(source => ({uri: source.uri, version: source.version, text: source.text}));
      this.inputSnapshot = input;
      this.result = null;
      this.session = null;
      this.output = (discovery.output?.stdout ?? '') + (discovery.output?.stderr ?? '');
      this.focused = this.tests[0]?.id ?? null;
      return discovery;
    });
  }

  select(id, included) {
    if (this.busy) throw new Error('Cannot change selection during a run');
    const test = this.tests.find(test => test.id === id);
    if (!test) throw new Error('Select a discovered test');
    const matching = this.provider === 'native-vstest' ? this.tests.filter(value => value.fqn === test.fqn) : [test];
    for (const value of matching) included ? this.selected.add(value.id) : this.selected.delete(value.id);
    this.notify();
  }

  selectAll(included) {
    if (this.busy) throw new Error('Cannot change selection during a run');
    this.selected = new Set(included ? this.tests.map(test => test.id) : []);
    this.notify();
  }

  async verifyDiscovery(signal) {
    if (!this.discovery) throw new Error('Discover tests before running them');
    if (!this.selected.size) throw new Error('Select at least one test');
    if (discoveryContext(this.request()) !== this.discoveryContext) {
      throw new Error('Project context changed after discovery; discover tests again');
    }
    if (this.native) return;
    const input = await this.input(signal);
    const sources = input.files;
    if (input.contextId !== this.inputSnapshot.contextId || input.revision !== this.inputSnapshot.revision) {
      throw new Error('Project context changed after discovery; discover tests again');
    }
    if (sources.length !== this.sourceSnapshot.length || sources.some((source, index) => {
      const prior = this.sourceSnapshot[index];
      return source.uri !== prior.uri || source.version !== prior.version || source.text !== prior.text;
    })) throw new Error('Source changed after discovery; discover tests again');
  }

  async run() {
    return this.operation('Run selected tests', async signal => {
      await this.verifyDiscovery(signal);
      const tests = this.tests.filter(test => this.selected.has(test.id));
      const request = {...this.request(), tests, testIds: tests.map(test => test.id), discoveryId: this.discovery.discoveryId};
      this.results.clear();
      this.result = null;
      this.output = '';
      const options = {signal, onSession: session => { this.session = {...session, state: 'running'}; this.notify(); },
        onEvent: event => this.event(event)};
      try {
        const result = await this.adapter().run(request, options);
        this.result = result;
        this.session = {id: result.id ?? this.session?.id, state: result.state ?? (result.cancelled ? 'cancelled' : 'completed'),
          debuggerHandoff: result.debuggerHandoff ?? this.session?.debuggerHandoff};
        for (const result of this.result.results ?? []) this.results.set(result.testId, result);
        this.diagnostics = [...this.diagnostics, ...(this.result.diagnostics ?? [])];
        return result;
      } finally {
        if (signal.aborted) {
          if (this.session) this.session.state = 'cancelled';
          for (const test of tests) if (!this.results.has(test.id)) this.results.set(test.id, createTestResult(test,
            {outcome: TestOutcome.NotRun, message: 'Run cancelled before this test produced a result', backend: this.provider}));
        }
      }
    });
  }

  event(event) {
    if (event.result) this.results.set(event.result.testId, event.result);
    if (event.kind === 'output') this.output = (this.output + event.text + '\n').slice(-1048576);
    if (event.kind === 'debugger-handoff' && this.session) this.session.debuggerHandoff = {
      pid: event.pid, protocol: event.protocol, waitingForDebugger: event.waitingForDebugger};
    if (event.kind === 'run-completed' && this.session) this.session.state = event.state;
    this.notify();
  }

  cancel() { this.controller?.abort(); }

  async openSource(id = this.focused) {
    const test = this.tests.find(test => test.id === id);
    const source = this.results.get(id)?.source ?? test?.source;
    if (!source) throw new Error('This test has no source location');
    if (this.host.onOpenTestSource) return this.host.onOpenTestSource(source);
    return this.host.open(source.path, source.line, source.column ?? 1);
  }

  async artifact(path) {
    if (!this.native || !this.result?.artifacts?.some(artifact => artifact.path === path)) throw new Error('Unknown test artifact');
    const bytes = await this.adapter().artifact(this.session.id, path);
    (this.host.download ?? downloadNativeArtifact)(bytes, path);
    return bytes;
  }

  notify() {
    if (this.renderTimer !== null || this.disposed) return;
    this.renderTimer = setTimeout(() => { this.renderTimer = null; this.host.renderTests?.(); }, 0);
  }

  snapshot() {
    return {provider: this.provider, busy: this.busy, tests: this.tests, selected: [...this.selected], results: [...this.results.values()],
      diagnostics: this.diagnostics, session: this.session, artifacts: this.result?.artifacts ?? [], coverage: this.result?.coverage ?? []};
  }

  async close() {
    this.disposed = true;
    clearTimeout(this.renderTimer);
    this.cancel();
    await Promise.all([...this.adapters.values()].map(adapter => adapter.close()));
    this.adapters.clear();
  }
}
