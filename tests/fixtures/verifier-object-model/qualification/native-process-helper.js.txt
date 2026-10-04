import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

/** Native processes only. Reject on cancellation/timeout/overflow after reaping the child. */
export function runProcess(command, args, { cwd, env = {}, signal, timeoutMs = 30000, maxOutputBytes = 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new Error('Process limits must be positive safe integers');
  }
  if (signal?.aborted) return Promise.reject(new Error('Oracle process cancelled before launch'));
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(command, args, {
      cwd, windowsHide: true,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_CLI_UI_LANGUAGE: 'en-US', VSLANG: '1033', COMPlus_DbgEnableMiniDump: '0', DOTNET_ROLL_FORWARD: 'Disable', DOTNET_ROLL_FORWARD_TO_PRERELEASE: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = { stdout: [], stderr: [] };
    let bytes = 0;
    let failure;
    let force;
    const stop = message => {
      failure ??= new Error(message);
      child.kill('SIGTERM');
      force ??= setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const abort = () => stop('Oracle process cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(`Oracle process timed out after ${timeoutMs}ms`), timeoutMs);
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', data => {
      bytes += data.length;
      if (bytes > maxOutputBytes) stop(`Oracle process exceeded output limit ${maxOutputBytes}`);
      else chunks[stream].push(data);
    });
    child.on('error', error => { failure ??= error; });
    child.on('close', (exitCode, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(force);
      signal?.removeEventListener('abort', abort);
      const result = {
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'),
        exitCode, signal: exitSignal, elapsedMs: performance.now() - start,
      };
      if (failure) { failure.result = result; reject(failure); }
      else resolve(result);
    });
    if (signal?.aborted) abort();
  });
}
