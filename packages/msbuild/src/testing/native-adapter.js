import {randomUUID} from 'node:crypto';
import {readdir, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {workspacePath} from '../contract.js';
import {parseNativeTestDiscovery, createTestDiscoveryArguments} from './discovery.js';
import {createTestRunArguments} from './run.js';
import {parseTrx} from './trx.js';
import {parseCobertura} from './coverage.js';
import {TestRunSession} from './session.js';
import {mapTestSource} from './source-map.js';

function requestInput(input) {
  const project = workspacePath(input.project);
  if (!/\.(csproj|fsproj|vbproj|sln|slnx)$/i.test(project)) throw new Error('Test runner requires a project or solution');
  for (const name of ['configuration', 'framework', 'settings']) {
    if (input[name] !== undefined && (typeof input[name] !== 'string' || /[\x00-\x1f]/.test(input[name]))) {
      throw new Error('Invalid native test ' + name);
    }
  }
  if (input.settings) workspacePath(input.settings);
  if (input.sourceTests !== undefined && (!Array.isArray(input.sourceTests) || input.sourceTests.length > 100_000)) {
    throw new Error('Native source-test metadata limit exceeded');
  }
  if (input.trusted !== true) throw Object.assign(new Error('Native tests require explicit workspace trust'), {code: 'SFT2304'});
  return {...input, project};
}

/** Native test provider reuses NativeMSBuild's trusted process-tree, timeout and output-budget executor. */
export class NativeTestAdapter {
  constructor({host, workspace, maxSessions = 32} = {}) {
    if (!host?.runTool || !workspace?.jobDirectory) throw new Error('Native test adapter requires a host and workspace');
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 1024) throw new Error('Invalid native session limit');
    this.id = 'native-dotnet';
    this.host = host;
    this.workspace = workspace;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
    this.operations = new Map();
    this.results = new Map();
    this.reservedSessions = 0;
    this.closed = false;
  }

  ensure() { if (this.closed) throw new Error('Native test adapter is disposed'); }

  async discover(input, options = {}) {
    this.ensure();
    const request = requestInput(input);
    const output = await this.host.runTool({arguments: createTestDiscoveryArguments(request), trusted: true,
      project: request.project, timeoutMs: request.timeoutMs}, options);
    if (output.exitCode !== 0 && !output.cancelled) throw Object.assign(new Error('Native test discovery failed'), {output});
    const result = parseNativeTestDiscovery(output.stdout, {...request, sourceTests: options.sourceTests ?? request.sourceTests, signal: options.signal});
    return {...result, output, cancelled: output.cancelled, backend: 'native-' + (request.runner ?? 'vstest')};
  }

  async reports(directory, relative, depth = 0, result = []) {
    if (depth > 12 || result.length > 2048) throw new Error('Native test artifact enumeration limit exceeded');
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      const path = relative + '/' + entry.name;
      if (entry.isDirectory()) await this.reports(absolute, path, depth + 1, result);
      else if (entry.isFile()) {
        const info = await lstat(absolute);
        if (info.size <= (this.workspace.maxArtifactBytes ?? 32_000_000)) result.push({path, name: entry.name, size: info.size});
      }
    }
    return result;
  }

  async createSession(input, options) {
    this.ensure();
    const request = requestInput(input);
    if (this.sessions.size + this.reservedSessions >= this.maxSessions) {
      const expired = [...this.sessions.values()].find(session => ['completed', 'cancelled', 'failed', 'disposed'].includes(session.state));
      if (!expired) throw new Error('Native test session limit exceeded');
      expired.dispose();
      this.sessions.delete(expired.id);
      this.operations.delete(expired.id);
      this.results.delete(expired.id);
    }
    const id = randomUUID();
    this.reservedSessions++;
    try {
      const directory = await this.workspace.jobDirectory(id);
      this.ensure();
      const relative = '.sharpforge/msbuild/' + id;
      const session = new TestRunSession({id, tests: request.tests, onEvent: options.onEvent});
      this.sessions.set(id, session);
      session.start();
      options.onSession?.({id});
      return {request, directory, relative, session};
    } finally { this.reservedSessions--; }
  }

  async executeRun(context, options) {
    const {session} = context;
    const signal = options.signal ? AbortSignal.any([options.signal, session.controller.signal]) : session.controller.signal;
    const cancel = () => session.cancel('cancelled');
    signal.addEventListener('abort', cancel, {once: true});
    if (signal.aborted) cancel();
    try { return await this.collectRun(context, {...options, signal}); }
    catch (error) {
      session.complete([]);
      session.state = signal.aborted ? 'cancelled' : 'failed';
      session.emit('run-failed', {message: error.message});
      return {...session.snapshot(), success: false,
        diagnostics: [{code: 'SFT2306', severity: 'error', message: error.message}], error: error.message};
    } finally { signal.removeEventListener('abort', cancel); }
  }

  async collectRun(context, options) {
    const {request, directory, relative, session} = context;
    const {signal} = options;
    const output = await this.host.runTool({arguments: createTestRunArguments(request, directory), trusted: true,
      project: request.project, timeoutMs: request.timeoutMs,
      environment: request.debug ? {VSTEST_HOST_DEBUG: '1'} : {}},
    {signal, onLine: line => session.line(line), onStart: process => session.emit('host-started', process)});
    if (output.cancelled) session.cancel('host-cancelled');
    const artifacts = await this.reports(directory, relative);
    const results = [];
    const coverage = [];
    for (const artifact of artifacts) {
      if (!/\.trx$|cobertura.*\.xml$/i.test(artifact.name)) continue;
      const source = new TextDecoder().decode(await this.workspace.artifact(artifact.path));
      if (/\.trx$/i.test(artifact.name)) {
        const parsed = parseTrx(source, {project: request.project, sourceTests: options.sourceTests ?? request.tests,
          backend: 'native-' + (request.runner ?? 'vstest')});
        results.push(...parsed.results.map(result => ({...result, source: mapTestSource(result,
          {...options, workspaceRoot: this.workspace.root, stackTrace: result.stackTrace})})));
      } else coverage.push(parseCobertura(source, {workspaceRoot: this.workspace.root}));
    }
    const diagnostics = !results.length && !output.cancelled ? [{code: 'SFT2305', severity: 'error',
      message: 'The native host produced no TRX test results. Console success is not treated as test success.'}] : [];
    return {...session.complete(results), output, artifacts, coverage, diagnostics,
      success: !diagnostics.length && output.exitCode === 0 && !output.cancelled &&
        results.every(result => ['passed', 'skipped'].includes(result.outcome))};
  }

  beginRun(context, options) {
    const operation = this.executeRun(context, options).then(result => {
      this.results.set(context.session.id, result);
      return result;
    });
    this.operations.set(context.session.id, operation);
    return operation;
  }

  async run(input, options = {}) {
    return this.beginRun(await this.createSession(input, options), options);
  }

  /** Start returns a pollable session id before execution completes, making remote cancellation possible. */
  async start(input, options = {}) {
    const context = await this.createSession(input, options);
    this.beginRun(context, options);
    return {id: context.session.id};
  }
  cancel(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Unknown native test session');
    session.cancel();
    return session.snapshot();
  }
  snapshot(id, after = 0) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Unknown native test session');
    return {...session.snapshot(after), result: this.results.get(id) ?? null};
  }
  async artifact(id, path) {
    this.ensure();
    if (!this.results.get(id)?.artifacts?.some(artifact => artifact.path === path)) throw new Error('Unknown test artifact');
    return this.workspace.artifact(path);
  }
  async close() {
    this.closed = true;
    for (const session of this.sessions.values()) session.dispose();
    await Promise.allSettled(this.operations.values());
  }
}

/** Register the native adapter through the host contribution seam, including nonblocking start/poll/cancel operations. */
export function registerNativeTestingServices(registry, {engine, workspace}) {
  const adapter = new NativeTestAdapter({host: engine, workspace});
  registry.disposables.push(adapter);
  registry.register('testing', 'discover', (request, options) => adapter.discover(request, options));
  registry.register('testing', 'run', (request, options) => adapter.run(request, options));
  registry.register('testing', 'start', (request, options) => adapter.start(request, options));
  registry.register('testing', 'snapshot', request => adapter.snapshot(request.id, request.after ?? 0));
  registry.register('testing', 'cancel', request => adapter.cancel(request.id));
  registry.register('testing', 'artifact', async request => ({path: request.path,
    base64: Buffer.from(await adapter.artifact(request.id, request.path)).toString('base64')}));
  return adapter;
}
