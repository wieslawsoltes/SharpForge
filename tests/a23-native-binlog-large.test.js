import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { NativeWorkspace } from '../packages/msbuild/src/workspace.js';
import { NativeBinlogReader } from '../packages/msbuild/src/binlog/reader.js';
import { runNativeProcess } from '../packages/msbuild/src/process.js';
import { resolveNativeReference, compileNativeJsonProgram } from './helpers/project-native-reference.js';

test('actual 200 MiB binary log replays and pages within the reader memory budget', {
  skip: process.env.SHARPFORGE_LARGE_BINLOG === '1' && process.env.SHARPFORGE_DOTNET ? false
    : 'Set SHARPFORGE_LARGE_BINLOG=1 and SHARPFORGE_DOTNET for the completed-scope memory qualification', timeout: 240000
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf-binlog-size-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const toolchain = resolveNativeReference(process.env.SHARPFORGE_DOTNET, process.env.SHARPFORGE_NATIVE_SDK);
  const source = await readFile(new URL('fixtures/a23-binlog/SizeOracle.cs', import.meta.url), 'utf8');
  compileNativeJsonProgram(toolchain, root, source, { name: 'SizeOracle', references: [
    join(toolchain.sdkDirectory, 'Microsoft.Build.dll'), join(toolchain.sdkDirectory, 'Microsoft.Build.Framework.dll')
  ] });
  const workspace = await NativeWorkspace.open(root);
  const id = randomUUID();
  const directory = await workspace.jobDirectory(id);
  const path = join(directory, 'large.binlog');
  const generation = await runNativeProcess({ executable: toolchain.dotnet,
    arguments: [join(root, 'SizeOracle.dll'), path, toolchain.sdkDirectory], cwd: root, timeoutMs: 120000, maxOutputBytes: 65536 });
  assert.equal(generation.exitCode, 0, generation.stdout + generation.stderr);
  const generated = JSON.parse(generation.stdout.trim());
  assert(generated.bytes >= 200 * 1024 * 1024, 'The physical compressed binary log must exceed 200 MiB');
  const engine = { workspace, executable: toolchain.dotnet, executions: new Map([[id, {
    directory, artifacts: [{ kind: 'binlog', path: workspace.relative(path) }]
  }]]) };
  const reader = new NativeBinlogReader(engine);
  let peakNodeRss = process.memoryUsage().rss;
  const sample = setInterval(() => { peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss); }, 20);
  const started = performance.now();
  try {
    const first = await reader.query(id, { limit: 5 });
    const next = await reader.query(id, { after: first.nextCursor, limit: 5 });
    assert(first.reader.events >= generated.records);
    assert.equal(first.events.length, 5);
    assert.equal(next.events.length, 5);
    assert(next.events[0].cursor > first.events.at(-1).cursor);
    assert(first.reader.peakWorkingSetBytes > 0);
    assert(first.reader.peakWorkingSetBytes < 512 * 1024 * 1024);
    assert(peakNodeRss < 512 * 1024 * 1024, 'JavaScript indexing/paging must remain below its independent 512 MiB RSS budget');
    assert(first.reader.peakWorkingSetBytes + peakNodeRss < 1024 * 1024 * 1024,
      'The conservative sum of independently measured peaks must stay below the 1 GiB combined qualification budget');
    t.diagnostic(JSON.stringify({ sdk: toolchain.sdk, node: process.version, platform: process.platform, architecture: process.arch,
      inputBytes: (await stat(path)).size, events: first.reader.events, spoolBytes: first.reader.bytes,
      readerVersion: first.reader.readerVersion, readerFileVersion: first.reader.readerFileVersion,
      readerProductVersion: first.reader.readerProductVersion, helperPeakRss: first.reader.peakWorkingSetBytes, nodePeakRss: peakNodeRss,
      replayAndPageMs: performance.now() - started }));
  } finally { clearInterval(sample); }
});
