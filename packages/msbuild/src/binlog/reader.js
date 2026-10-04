import { randomUUID } from 'node:crypto';
import { mkdir, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNativeProcess } from '../process.js';
import { discoverSdkEnvironment } from '../sdk-discovery.js';
import { indexBinlogEvents, queryBinlogEvents } from './query.js';

/** The SDK's versioned reader decodes gzip, string/name-value tables and event payloads; JS retains a bounded event index. */
export class NativeBinlogReader {
  constructor(engine, { maxInputBytes = 536870912, maxSpoolBytes = 1073741824, maxNodes = 100000 } = {}) {
    Object.assign(this, { engine, maxInputBytes, maxSpoolBytes, maxNodes });
    this.preparing = null;
    this.logs = new Map();
  }
  async prepare() {
    if (this.preparing) return this.preparing;
    this.preparing = this.buildReader();
    try { return await this.preparing; }
    catch (error) { this.preparing = null; throw error; }
  }
  async buildReader() {
    const inventory = await discoverSdkEnvironment({ executable: this.engine.executable, cwd: this.engine.workspace.root });
    if (!inventory.available || !inventory.info.basePath) throw new Error('Binary-log reading requires an installed .NET SDK');
    const directory = await this.engine.workspace.jobDirectory(randomUUID());
    const output = join(directory, 'bin');
    await mkdir(output, { recursive: true });
    const project = fileURLToPath(new URL('../../binlog-reader/BinlogReader.csproj', import.meta.url));
    const major = Number(inventory.sdks.at(-1)?.version.split('.')[0] ?? 10);
    const result = await runNativeProcess({ executable: this.engine.executable,
      arguments: ['build', project, '--nologo', '-v:quiet', '-o', output, '-p:TargetFramework=net' + major + '.0',
        '-p:BaseIntermediateOutputPath=' + join(directory, 'obj') + '/', '-p:UseSharedCompilation=false', '-nodeReuse:false'],
      cwd: dirname(project), timeoutMs: 120000, maxOutputBytes: 1048576 });
    if (result.exitCode !== 0) throw new Error('Could not build SDK binlog reader: ' + result.stdout + result.stderr);
    return { assembly: join(output, 'BinlogReader.dll'), sdkDirectory: inventory.info.basePath, inventory };
  }
  async open(jobId) {
    if (this.logs.has(jobId)) return this.logs.get(jobId);
    const pending = this.load(jobId);
    this.logs.set(jobId, pending);
    try { return await pending; }
    catch (error) { this.logs.delete(jobId); throw error; }
  }
  async load(jobId) {
    const job = this.engine.executions.get(jobId);
    const artifact = job?.artifacts.find(item => item.kind === 'binlog');
    if (!artifact) throw Object.assign(new Error('Job has no binary log'), { status: 404 });
    const file = await this.engine.workspace.path(artifact.path, { internal: true }), info = await lstat(file);
    if (info.size > this.maxInputBytes) throw new Error('Binary log input size limit exceeded');
    const prepared = await this.prepare(), spool = join(job.directory, 'events.ndjson');
    const result = await runNativeProcess({ executable: this.engine.executable,
      arguments: [prepared.assembly, file, spool, prepared.sdkDirectory, String(this.maxSpoolBytes)],
      cwd: this.engine.workspace.root, timeoutMs: 120000, maxOutputBytes: 1048576 });
    if (result.exitCode !== 0) throw new Error('Binary log replay failed: ' + result.stderr);
    const model = await indexBinlogEvents(spool, { maxNodes: this.maxNodes });
    const value = { spool, model, reader: JSON.parse(result.stdout.trim()), backend: 'Microsoft.Build.BinaryLogReplayEventSource' };
    while (this.logs.size >= 8) this.logs.delete(this.logs.keys().next().value);
    return value;
  }
  async query(jobId, options = {}) {
    const log = await this.open(jobId);
    if (options.kind === 'timings') return { entries: log.model.timings(options), summary: log.model.summary() };
    if (options.kind === 'tree') return { ...log.model.page(options.parentId, options), summary: log.model.summary() };
    return { ...await queryBinlogEvents(log.spool, options), summary: log.model.summary(), reader: log.reader, backend: log.backend };
  }
}
