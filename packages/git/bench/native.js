import { spawn } from 'node:child_process';
import { GitError, checkCancelled } from '@sharpforge/git';

/** Benchmark fixture setup uses native Git without a shell or unbounded captured output. */
export function benchmarkGit(args, { cwd, env, timeoutMs = 30 * 60_000, signal, spawnChild = spawn } = {}) {
  return new Promise((resolve, reject) => {
    checkCancelled(signal);
    const child = spawnChild('git', ['-c', 'core.autocrlf=false', ...args], {
      cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    const output = [];
    let bytes = 0;
    let failure;
    const stop = error => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const abort = () => stop(new GitError('Cancelled', 'Benchmark fixture setup was cancelled'));
    const timer = setTimeout(() => stop(new Error('Native benchmark fixture exceeded its deadline')), timeoutMs);
    child.stdout.on('data', data => {
      bytes += data.length;
      if (bytes > 4 * 1024 * 1024) stop(new Error('Native benchmark output limit exceeded'));
      else output.push(data);
    });
    child.stderr.resume();
    child.on('error', error => { failure ??= error; });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code) reject(new Error(`Native Git benchmark setup command ${args[0]} failed with exit ${code}`));
      else resolve(Buffer.concat(output).toString('utf8').trimEnd());
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
