import { DiagnosticCollector } from './diagnostics.js';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { normalizeBuildRequest } from './contract.js';
import { validateResponseFiles } from './argument-policy.js';
import { createInvocation } from './invocation.js';
import { runNativeProcess } from './process.js';
import { runQueuedNativeTool, runWorkspaceExecutable } from './native-tool.js';
import { BuildScheduler } from './scheduler.js';
import { collectJobArtifacts } from './artifacts.js';
import { createWorkloadPreflight } from './workload-preflight.js';
import { shutdownBuildServers } from './build-server.js';
export { createInvocation } from './invocation.js';

/** Native SDK execution with bounded scheduling, explicit trust and per-job cancellation. */
export class NativeMSBuild {
  constructor(workspace, options = {}) {
    const { executable = 'dotnet', engine = 'dotnet', trusted = false, timeoutMs = 1800000,
      maxOutputBytes = 33554432, maxJobs = 32, spawnProcess, elevated = false, trustStore = null } = options;
    if (!['dotnet', 'msbuild'].includes(engine)) throw new Error('Engine must be dotnet or msbuild');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 86400000) throw new Error('Invalid build timeout');
    if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 256) throw new Error('Job retention limit must be 1–256');
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 268435456) throw new Error('Output limit must be 1 KiB–256 MiB');
    Object.assign(this, { workspace, executable, engine, trusted, timeoutMs, maxOutputBytes, maxJobs, spawnProcess, elevated, trustStore });
    this.scheduler = new BuildScheduler({ maxRecords: maxJobs });
    this.jobs = this.scheduler.records;
    this.executions = new Map();
    this.startingCount = 0;
    this.closed = false;
    this.reusedServers = false;
    this.preflights = [...(engine === 'dotnet' ? [createWorkloadPreflight(workspace, { executable, spawnProcess })] : []),
      ...(options.preflights ?? [])];
  }

  get starting() { return this.startingCount > 0; }

  get active() { return this.scheduler.running.keys().next().value ?? null; }

  async authorize(request) {
    const persisted = this.trustStore ? await this.trustStore.get(this.workspace.root) : null;
    if (!(this.trustStore ? persisted : this.trusted) || !request.trusted) {
      throw Object.assign(new Error('Native MSBuild requires host and explicit client workspace trust. Evaluation executes local code.'),
        { status: 403, code: 'SFMSB_UNTRUSTED' });
    }
    if (request.elevated && !(this.elevated || persisted?.elevated)) {
      throw Object.assign(new Error('Elevated native toolset and logger switches are not permitted by the host'), { status: 403 });
    }
  }

  async probe() {
    try {
      const result = await runNativeProcess({ executable: this.executable,
        arguments: [...(this.engine === 'dotnet' ? ['msbuild'] : []), '-version', '-nologo'],
        cwd: this.workspace.root, timeoutMs: 15000, maxOutputBytes: 65536 }, { spawnProcess: this.spawnProcess });
      return { available: result.exitCode === 0, version: result.stdout.trim(),
        error: result.exitCode === 0 ? undefined : result.stderr || 'MSBuild version probe failed' };
    } catch (error) {
      return { available: false, error: `${this.executable}: ${error.message}. Install a .NET SDK or select an installed MSBuild executable.` };
    }
  }

  async start(input) {
    if (this.closed) throw new Error('MSBuild host is closing');
    const request = normalizeBuildRequest(input);
    this.startingCount++;
    try {
      await this.authorize(request);
      const projectPath = await this.workspace.path(request.project);
      if (!(await lstat(projectPath)).isFile()) throw new Error('Project is not a file');
      await validateResponseFiles(request.arguments, async path => {
        const file = await this.workspace.path(path), info = await lstat(file);
        if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Response file size limit exceeded');
        return readFile(file, 'utf8');
      }, { elevated: request.elevated });
      for (const preflight of this.preflights) await preflight(request);
      const id = this.scheduler.enqueue(request, (jobId, signal) => this.execute(jobId, request, projectPath, signal), {
        priority: request.designTime ? 0 : 10,
        coalesceKey: request.designTime ? JSON.stringify([request.project, request.properties]) : null
      });
      for (const key of this.executions.keys()) if (!this.jobs.has(key)) this.executions.delete(key);
      return this.snapshot(id);
    } finally { this.startingCount--; }
  }

  async execute(id, request, projectPath, signal) {
    await this.authorize(request);
    const directory = await this.workspace.jobDirectory(id);
    const invocation = createInvocation(request, { projectPath, jobDirectory: directory, executable: this.executable, engine: this.engine });
    const job = { id, request, status: 'running', started: new Date().toISOString(), ended: null, exitCode: null, signal: null,
      events: [], nextCursor: 1, logBytes: 0, totalBytes: 0, truncated: false, diagnostics: [], diagnosticKeys: new Set(),
      invocation: { executable: invocation.executable, arguments: invocation.args }, artifacts: [], result: null, error: null, directory };
    this.executions.set(id, job);
    this.reusedServers ||= request.nodeReuse || request.compilerServer;
    try {
      const result = await runNativeProcess({ executable: invocation.executable, arguments: invocation.args,
        cwd: this.workspace.root, timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes }, {
        signal, spawnProcess: this.spawnProcess, onLine: ({ stream, text }) => this.append(job, stream, text)
      });
      job.exitCode = result.exitCode;
      job.signal = result.signal;
      job.totalBytes = Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
      if (result.reason) {
        job.cancelReason = result.reason === 'cancelled' ? this.scheduler.get(id).cancelReason ?? 'user' : result.reason;
        job.error = result.timedOut ? 'MSBuild operation timed out' : result.truncated ? 'MSBuild output limit exceeded' : null;
      }
      const status = job.cancelReason ? 'cancelled' : result.exitCode === 0 ? 'succeeded' : 'failed';
      if (status === 'failed' && !job.error) {
        job.error = job.diagnostics.find(diagnostic => diagnostic.severity === 'error')?.message ??
          (result.stderr.trim().slice(-4096) || `Native process exited with ${result.exitCode ?? result.signal}`);
      }
      const artifactJob = { ...job, status };
      await collectJobArtifacts(this.workspace, artifactJob, { output: result.stdout + result.stderr, projectPath });
      job.artifacts = artifactJob.artifacts;
      job.result = artifactJob.result;
      job.status = status;
    } catch (error) {
      job.error = `Unable to run ${this.executable}: ${error.message}. Native builds require an installed SDK/MSBuild; the browser compiler is not substituted.`;
      job.status = signal.aborted ? 'cancelled' : 'failed';
      if (signal.aborted) job.cancelReason = this.scheduler.get(id).cancelReason ?? 'user';
    }
    job.ended = new Date().toISOString();
    return this.snapshot(id);
  }

  append(job, stream, text) {
    const line = text + '\n', bytes = Buffer.byteLength(line);
    job.events.push({ cursor: job.nextCursor++, stream, text: line });
    job.logBytes += bytes;
    while (job.logBytes > 1048576 && job.events.length > 1) {
      job.logBytes -= Buffer.byteLength(job.events.shift().text);
      job.truncated = true;
    }
    this.diagnostic(job, text);
  }

  diagnostic(job, line) {
    const collector = job.diagnosticCollector ??= new DiagnosticCollector();
    const diagnostic = collector.accept(line);
    if (!diagnostic || job.diagnostics.length >= 10000) return;
    const key = JSON.stringify(diagnostic);
    if (job.diagnosticKeys.has(key)) return;
    job.diagnosticKeys.add(key);
    if (diagnostic.file) {
      const root = this.workspace.root, file = diagnostic.file.replaceAll('\\', '/');
      const project = (diagnostic.project ?? job.request?.project ?? '').replace(/(::| \[).*$/, '').replaceAll('\\', '/');
      const projectPath = project ? resolve(root, project) : null;
      const projectFolder = projectPath ? this.workspace.relative(dirname(projectPath)) : null;
      const full = isAbsolute(file) ? file : projectPath?.replaceAll('\\', '/').endsWith('/' + file) && !file.includes('/')
        ? projectPath : projectFolder && file.startsWith(projectFolder + '/') ? resolve(root, file)
          : resolve(projectPath ? dirname(projectPath) : root, file);
      diagnostic.workspacePath = this.workspace.relative(full);
    }
    job.diagnostics.push(diagnostic);
  }

  snapshot(id, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid log cursor');
    const entry = this.scheduler.get(id), job = this.executions.get(id);
    if (!job) return { id, status: entry.status, request: entry.request, error: entry.error?.message ?? null,
      cancelReason: entry.cancelReason, events: [], nextCursor: 0, diagnostics: [], artifacts: [], result: null, truncated: false };
    return { id, status: job.status, request: job.request, started: job.started, ended: job.ended, exitCode: job.exitCode,
      signal: job.signal, error: job.error, cancelReason: job.cancelReason ?? entry.cancelReason ?? null, invocation: job.invocation,
      events: job.events.filter(event => event.cursor > after), nextCursor: job.nextCursor - 1,
      truncated: job.truncated && after < (job.events[0]?.cursor ?? 0) - 1,
      diagnostics: job.diagnostics, artifacts: job.artifacts, result: job.result, totalOutputBytes: job.totalBytes };
  }

  async wait(id) { await this.scheduler.wait(id); return this.snapshot(id); }
  cancel(id, reason = 'user') { this.scheduler.cancel(id, reason); return this.snapshot(id); }

  async artifact(id, path) {
    const artifact = this.executions.get(id)?.artifacts.find(item => item.path === path && item.downloadable !== false);
    if (!artifact) throw Object.assign(new Error('Artifact was not listed for this job'), { status: 404 });
    return this.workspace.artifact(path);
  }

  async runTool(request, options = {}) {
    return runQueuedNativeTool(this, request, options);
  }

  async runWorkspaceExecutable(request, options = {}) {
    return runWorkspaceExecutable(this, request, options);
  }

  async close() {
    this.closed = true;
    await this.scheduler.close();
    if (this.reusedServers && this.engine === 'dotnet') {
      await shutdownBuildServers({ executable: this.executable, cwd: this.workspace.root, spawnProcess: this.spawnProcess });
      this.reusedServers = false;
    }
  }
}
