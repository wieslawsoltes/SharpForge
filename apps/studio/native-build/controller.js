import {createNativeBuildSettings} from '../workbench/lazy-features/native-settings.js';
import {MSBuildClient, inspectSlnx} from '@sharpforge/msbuild';
import {runNativeOperation, acceptNativeJob, cancelNativeJob, disposeNativeOperations} from '../workbench/native-operation.js';
import {nativeBuildRequest, terminalBuild, delay, downloadNativeArtifact} from './settings.js';
import {NativeProjectContexts} from './project-context.js';
import {NativeProjectProfiles} from './profiles.js';
import {renderNativeBuild} from './build-view.js';
import {renderNativeSource, renderNativeTree} from './source-view.js';
import {renderNativeInspector} from './inspector-view.js';
import {TestExplorerController} from '../test-explorer/controller.js';
import {renderTestExplorer} from '../test-explorer/view.js';

/** Native build UI owns an explicit host session; rendering and semantic hydration are separate contributions. */
export class MSBuildTools {
  constructor(options = {}) {
    const callbacks = ['onAttach', 'onOpenSource', 'getSourceChanges', 'onSaved', 'onJob', 'onJobFailure', 'onAssembly', 'onSelectPanel',
      'onError', 'onWorkspace', 'onProjectContext', 'getTestSources', 'getTestInput', 'getTestProject', 'onOpenTestSource', 'download'];
    for (const name of callbacks) this[name] = options[name];
    this.testAdapters = options.testAdapters;
    this.client = null;
    this.capabilities = null;
    this.workspace = null;
    this.job = null;
    this.cursor = 0;
    this.log = '';
    this.buffers = options.buffers ?? new Map();
    this.sourcePath = null;
    this.hosts = new Map();
    this.inspection = null;
    this.attached = false;
    this.busy = false;
    this.disposed = false;
    this.operationStatus = '';
    this.operationController = null;
    this.settings = options.settings ?? createNativeBuildSettings();
    this.contexts = new NativeProjectContexts(this);
    this.profiles = new NativeProjectProfiles(this);
    this.tests = new TestExplorerController(this, this.testAdapters);
  }

  async autoConnect() {
    try {
      const client = MSBuildClient.fromLocation();
      if (client) { this.onSelectPanel?.('msbuild'); await this.connect(client); }
    } catch (error) { this.onError?.(error); }
  }

  async connect(client = this.client) {
    if (!client) throw new Error('Start the local host and open its printed Studio URL');
    if (this.busy || this.tests.busy) throw new Error('Finish the active operation before reconnecting');
    const capabilities = await client.connect();
    const workspace = await client.workspace();
    await this.tests.close();
    this.tests = new TestExplorerController(this, this.testAdapters);
    this.tests.configure({provider: 'native-vstest'});
    this.client = client;
    this.capabilities = capabilities;
    this.workspace = workspace;
    this.settings.project = workspace.solutions[0] ?? workspace.projects[0] ?? '';
    this.settings.trusted = false;
    this.contexts.reset(workspace);
    this.profiles.reset();
    this.renderBuild(true);
    this.onWorkspace?.(workspace);
    return this.snapshot();
  }

  snapshot() {
    return {connected: !!this.capabilities, attached: this.attached, capabilities: this.capabilities,
      workspace: this.workspace, job: this.job, inspection: this.inspection, busy: this.busy,
      sourcePath: this.sourcePath, dirtyBuffers: [...this.buffers.values()].filter(buffer => buffer.text !== buffer.baseline).map(buffer => buffer.path),
      projectContexts: this.contexts.snapshot(), profiles: this.profiles.snapshot(), testing: this.tests.snapshot()};
  }

  async attach() {
    if (!this.client || !this.workspace) throw new Error('Connect the native host first');
    if (this.attached) return;
    await this.onAttach?.(this.workspace);
    this.attached = true;
    this.renderBuild();
  }

  async refresh() {
    if (!this.client) throw new Error('No local host is connected');
    this.workspace = await this.client.workspace();
    if (!this.workspace.projects.includes(this.contexts.project)) { this.contexts.reset(this.workspace); this.profiles.reset(); }
    this.onWorkspace?.(this.workspace);
    this.renderBuild(true);
    return this.workspace;
  }

  async open(path, line = null, column = 1) {
    if (!this.client) throw new Error('No local host is connected');
    await this.attach();
    if (/\.cs$/i.test(path)) {
      const generated = this.contexts.compilation?.files.find(file => file.uri === path && file.generated);
      const file = generated ? {...generated, path} : await this.client.read(path);
      await this.onOpenSource?.(file, line, column);
      return file;
    }
    let file = this.buffers.get(path);
    if (!file) {
      file = await this.client.read(path);
      file = {...file, baseline: file.text};
      this.buffers.set(path, file);
    }
    this.sourcePath = path;
    this.onSelectPanel?.('project-source');
    this.renderSource(true);
    return file;
  }

  sourceChanges() {
    return [...this.buffers.values()].filter(file => file.text !== file.baseline || file.hash === null)
      .map(file => ({path: file.path, text: file.text, expectedHash: file.hash}));
  }

  async save() {
    if (!this.client) throw new Error('No local host is connected');
    if (this.job && !terminalBuild(this.job.status)) throw new Error('Stop the native operation before saving inputs');
    const changes = [...(this.getSourceChanges?.() ?? []), ...this.sourceChanges()];
    if (!changes.length) return {written: []};
    const byPath = new Map(changes.map(change => [change.path, change]));
    const reconcile = written => {
      for (const saved of written ?? []) {
        const change = byPath.get(saved.path);
        if (!change) continue;
        const buffer = this.buffers.get(saved.path);
        if (buffer) { buffer.hash = saved.hash; buffer.baseline = change.text; }
        this.onSaved?.(saved, change);
      }
      this.renderSource();
    };
    let report;
    try { report = await this.client.save(changes); }
    catch (error) { reconcile(error.written); throw error; }
    reconcile(report.written);
    await this.refresh();
    return report;
  }

  request(action) { return nativeBuildRequest(this.settings, action); }

  assertConnected(trust = true) {
    if (!this.client || !this.capabilities) throw new Error('Open Studio from the local MSBuild host URL');
    if (!trust) return;
    if (!this.capabilities.available) throw new Error(this.capabilities.error ?? 'MSBuild is not installed');
    if (!this.capabilities.trusted || !this.settings.trusted) throw new Error(
      'Enable native execution on the host and explicitly trust this workspace before running MSBuild, including evaluation.');
  }

  async operation(label, action, {trust = true, save = true} = {}) {
    if (this.disposed) throw new Error('Native build tools are disposed');
    if (this.busy) throw new Error('A native operation is already running');
    this.assertConnected(trust);
    this.busy = true;
    this.operationController = new AbortController();
    this.operationStatus = label + ' · running';
    this.renderBuild();
    try {
      if (save && (this.getSourceChanges?.().length || this.sourceChanges().length)) {
        if (!this.settings.save) throw new Error('Unsaved native changes. Save them or enable Save before operation.');
        await this.save();
      }
      this.operationController.signal.throwIfAborted();
      const result = await action(this.operationController.signal);
      this.operationStatus = label + (this.operationController.signal.aborted ? ' · cancelled' : ' · completed');
      return result;
    } catch (error) {
      this.operationStatus = label + (this.operationController.signal.aborted ? ' · cancelled' : ' · failed: ' + error.message);
      throw error;
    } finally { this.busy = false; this.operationController = null; this.renderBuild(); this.renderTests(); }
  }

  async monitorJob(started, signal) {
    this.log = '';
    this.cursor = 0;
    this.accept(started);
    this.onSelectPanel?.('msbuild');
    while (!terminalBuild(this.job.status) && !this.disposed) {
      if (signal.aborted) { this.accept(await this.client.cancel(this.job.id)); break; }
      await delay(200);
      this.accept(await this.client.job(this.job.id, this.cursor));
    }
    if (this.job.status === 'succeeded' && this.job.result) {
      this.inspection = {project: this.job.request.project, action: this.job.request.action, result: this.job.result, jobId: this.job.id};
      this.renderInspector();
      if (['evaluate', 'preprocess', 'targets'].includes(this.job.request.action)) this.onSelectPanel?.('msbuild-inspector');
    }
    return this.job;
  }

  run(action = 'build') { return runNativeOperation(this, action); }

  runProject() {
    return this.operation('Run project', async signal => {
      if (!this.client.runProject) throw new Error('This native host does not expose project launch');
      this.log = '';
      const result = await this.client.runProject(this.profiles.runRequest(), {signal});
      this.log = ((result.stdout ?? '') + (result.stderr ?? '')).slice(-1048576);
      if (result.exitCode !== 0 && !result.cancelled) throw new Error('Native project exited with code ' + result.exitCode);
      return result;
    });
  }

  publishProfile() {
    return this.operation('Publish profile', async signal => {
      if (!this.client.publishProfile) throw new Error('This native host does not expose publish profiles');
      return this.monitorJob(await this.client.publishProfile(this.profiles.publishRequest(), {signal}), signal);
    });
  }

  accept(job, options) { return acceptNativeJob(this, job, options); }

  cancel() {
    this.operationController?.abort();
    return cancelNativeJob(this);
  }

  inspectSolution() {
    const buffer = this.buffers.get(this.sourcePath);
    if (!buffer || !/\.slnx$/i.test(buffer.path)) throw new Error('Open a .slnx file first');
    this.inspection = {project: buffer.path, action: 'solution-structure', result: {Solution: inspectSlnx(buffer.text, {path: buffer.path})}};
    this.onSelectPanel?.('msbuild-inspector');
    this.renderInspector();
    return this.inspection;
  }

  async artifact(file, {inspect = false} = {}) {
    if (!this.job) throw new Error('No build output');
    const bytes = await this.client.artifact(this.job.id, file.path);
    if (inspect) return this.onAssembly?.(bytes, file.path);
    (this.download ?? downloadNativeArtifact)(bytes, file.path);
  }

  render(panel, element) {
    this.hosts.set(panel, element);
    const renderers = {msbuild: () => this.renderBuild(), 'msbuild-inspector': () => this.renderInspector(),
      'project-source': () => this.renderSource(), tests: () => this.renderTests()};
    renderers[panel]?.();
  }
  renderBuild(force = false) { renderNativeBuild(this, force); }
  renderInspector() { renderNativeInspector(this); }
  renderSource(force = false) { renderNativeSource(this, force); }
  renderTests() { renderTestExplorer(this.tests, this.hosts.get('tests')); }
  renderTree(element, query = '') { renderNativeTree(this, element, query); }

  dispose() {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.operationController?.abort();
    // Test adapters may need the same authenticated client to cancel their sessions.
    this.disposal = this.tests.close().finally(() => disposeNativeOperations(this));
    return this.disposal;
  }
}
