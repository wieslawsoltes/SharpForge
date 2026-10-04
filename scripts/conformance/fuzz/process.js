import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_BYTES, PROTOCOL, normalizeBudgets, validateTargetId } from './budgets.js';

const worker = fileURLToPath(new URL('./child.js', import.meta.url));
const selfWorker = fileURLToPath(new URL('./self-child.js', import.meta.url));

function childEnvironment(directory) {
  const env = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', TMPDIR: directory, TMP: directory, TEMP: directory };
  for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

function observeRss(child, maximum, stop) {
  const observation = { mode: process.platform === 'linux' ? 'not-observed' : 'unsupported-platform', peakBytes: 0 };
  let pending = false;
  let closed = false;
  async function sample() {
    if (closed || pending || process.platform !== 'linux' || !child.pid) return;
    pending = true;
    try {
      const status = await readFile(`/proc/${child.pid}/status`, 'utf8');
      if (closed) return;
      const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
      if (!match) { observation.mode = 'unavailable'; return; }
      observation.mode = 'sampled-linux';
      observation.peakBytes = Math.max(observation.peakBytes, Number(match[1]) * 1024);
      if (observation.peakBytes > maximum) stop('rss-limit', 'Sampled resident memory exceeds limit');
    } catch (error) {
      if (!closed && error.code !== 'ENOENT' && error.code !== 'ESRCH') observation.mode = 'unavailable';
    } finally {
      pending = false;
    }
  }
  const interval = process.platform === 'linux' ? setInterval(sample, 20) : null;
  void sample();
  return { observation, dispose() { closed = true; clearInterval(interval); } };
}

function executeChild(request, directory, signal) {
  return new Promise(resolve => {
    const started = performance.now();
    const child = spawn(process.execPath, [
      `--max-old-space-size=${request.budgets.v8HeapMb}`, '--max-semi-space-size=8', '--no-addons', request.selfTest ? selfWorker : worker,
    ], { cwd: directory, env: childEnvironment(directory), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const state = { termination: null, detail: '', outputBytes: 0, ready: false, firstLine: '', stdout: [], stderr: [] };
    let deadline;
    const stop = (kind, detail) => {
      if (state.termination) return;
      state.termination = kind;
      state.detail = detail;
      child.kill('SIGKILL');
    };
    const abort = () => stop('cancelled', 'Fixture process cancelled');
    const rss = observeRss(child, request.budgets.rssBytes, stop);
    const outputLimit = request.mode === 'seeds' ? CONTROL_BYTES : request.budgets.maxOutputBytes;
    function consume(stream, chunk) {
      state.outputBytes += chunk.length;
      if (state.outputBytes > outputLimit) { stop('output-limit', 'Fixture output exceeds byte limit'); return; }
      state[stream].push(chunk);
      if (stream !== 'stdout' || state.ready || state.termination) return;
      state.firstLine += chunk.toString('utf8');
      const newline = state.firstLine.indexOf('\n');
      if (newline < 0) return;
      try {
        const message = JSON.parse(state.firstLine.slice(0, newline));
        if (message.protocol !== PROTOCOL || message.type !== 'ready') throw new Error('Missing ready message');
        state.ready = true;
        state.firstLine = '';
        clearTimeout(deadline);
        deadline = setTimeout(() => stop('case-timeout', 'Fixture case or disposal exceeded deadline'), request.budgets.caseTimeoutMs);
      } catch {
        stop('invalid-protocol', 'Fixture child emitted an invalid ready message');
      }
    }
    deadline = setTimeout(() => stop('startup-timeout', 'Fixture child startup exceeded deadline'), request.budgets.startupTimeoutMs);
    child.stdout.on('data', chunk => consume('stdout', chunk));
    child.stderr.on('data', chunk => consume('stderr', chunk));
    child.on('error', error => stop('process-error', error.message));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop('process-error', error.message); });
    child.on('close', (exitCode, exitSignal) => {
      clearTimeout(deadline);
      rss.dispose();
      signal?.removeEventListener('abort', abort);
      resolve({
        termination: state.termination, detail: state.detail, exitCode, signal: exitSignal,
        stdout: Buffer.concat(state.stdout).toString('utf8'), stderr: Buffer.concat(state.stderr).toString('utf8'),
        elapsedMs: performance.now() - started, outputBytes: state.outputBytes,
        sampledRssBytes: rss.observation.peakBytes, rssGuard: rss.observation.mode,
      });
    });
    signal?.addEventListener('abort', abort, { once: true });
    child.stdin.end(JSON.stringify(request));
    if (signal?.aborted) abort();
  });
}

/** Fixed worker only: no command, shell, module path or inherited environment is accepted. */
export async function runIsolated(request, { signal } = {}) {
  const budgets = normalizeBudgets(request.budgets);
  const selfTest = request.selfTest ?? false;
  validateTargetId(request.targetId, selfTest);
  if (!['run', 'seeds'].includes(request.mode) || selfTest && request.mode !== 'run') throw new RangeError('Invalid fixed worker mode');
  const inputBase64 = request.mode === 'run' ? request.inputBase64 : undefined;
  if (request.mode === 'run' && (typeof inputBase64 !== 'string' || inputBase64.length > Math.ceil(budgets.maxInputBytes / 3) * 4)) {
    throw new RangeError('Encoded fixture input exceeds control limit');
  }
  const bounded = { protocol: PROTOCOL, mode: request.mode, targetId: request.targetId, selfTest, budgets, inputBase64 };
  if (signal?.aborted) return { termination: 'cancelled', detail: 'Cancelled before child launch', elapsedMs: 0 };
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-fuzz-'));
  try {
    if (signal?.aborted) return { termination: 'cancelled', detail: 'Cancelled before child launch', elapsedMs: 0 };
    return await executeChild(bounded, directory, signal);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
