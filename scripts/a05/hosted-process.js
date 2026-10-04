import {spawn} from 'node:child_process';
import {openSync, closeSync} from 'node:fs';
import {hostedQueueMinutes} from './hosted-plan.js';

/** Setup and timing share one journal-origin infrastructure budget, without changing any CLI deadline. */
export async function withHostedBudget(createdAt, task) {
  const remainingMs = hostedQueueMinutes * 60 * 1000 - (Date.now() - Date.parse(createdAt));
  if (!Number.isFinite(remainingMs)) throw new Error('Invalid hosted queue origin');
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Hosted queue interrupted'));
  const expired = () => controller.abort(new Error('Hosted whole-job infrastructure budget exhausted'));
  const timer = setTimeout(expired, Math.max(1, remainingMs));
  if (remainingMs <= 0) expired();
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  try { return await task(controller.signal); }
  finally {
    clearTimeout(timer);
    process.removeListener('SIGTERM', cancel);
    process.removeListener('SIGINT', cancel);
  }
}

/** One literal argv, one exclusive log, one process group. The exit is retained even when a gate misses. */
export async function runHostedProcess({command = process.execPath, argv, cwd, env, log, signal}) {
  const descriptor = openSync(log, 'wx');
  const startedAt = new Date().toISOString();
  let child;
  let killTimer;
  const stop = () => {
    if (!child?.pid) return;
    const kill = name => {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, name); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    kill('SIGTERM');
    killTimer = setTimeout(() => kill('SIGKILL'), 5000);
    killTimer.unref();
  };
  try {
    if (signal?.aborted) return {startedAt, completedAt: new Date().toISOString(), exitCode: null, signal: null, cancelled: true};
    const result = await new Promise(resolve => {
      child = spawn(command, argv, {cwd, env, stdio: ['ignore', descriptor, descriptor], detached: process.platform !== 'win32'});
      let error;
      child.once('error', value => { error = {name: value.name, message: value.message, code: value.code}; });
      child.once('close', (exitCode, exitSignal) => resolve({exitCode, signal: exitSignal, error: error ?? null}));
      signal?.addEventListener('abort', stop, {once: true});
      if (signal?.aborted) stop();
    });
    return {startedAt, completedAt: new Date().toISOString(), ...result, cancelled: signal?.aborted ?? false};
  } finally {
    signal?.removeEventListener('abort', stop);
    if (killTimer) clearTimeout(killTimer);
    if (signal?.aborted && child?.pid && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    closeSync(descriptor);
  }
}
