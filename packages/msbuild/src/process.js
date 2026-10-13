import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { performance } from 'node:perf_hooks';
import { createBuildEnvironment, createLaunchEnvironment } from './environment.js';

/** Terminate the detached process group, or the Windows process tree, with escalation. */
export function terminateProcessTree(child, { force = false, platform = process.platform, spawnProcess = spawn } = {}) {
  if (!child?.pid) return;
  if (platform === 'win32') {
    const killer = spawnProcess('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], {
      windowsHide: true, shell: false, stdio: 'ignore'
    });
    killer.once('error', () => child.kill(force ? 'SIGKILL' : 'SIGTERM'));
    killer.once('exit', code => { if (code) child.kill(force ? 'SIGKILL' : 'SIGTERM'); });
  } else {
    try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); }
    catch (error) {
      if (error.code !== 'ESRCH') child.kill(force ? 'SIGKILL' : 'SIGTERM');
    }
  }
}

/** Run one trusted tool without shell interpolation, retaining bounded UTF-8 output. */
export function runNativeProcess(request, options = {}) {
  const { executable, arguments: args = [], cwd, environment, timeoutMs = 1800000, maxOutputBytes = 33554432 } = request;
  const { signal, onLine, onStart, spawnProcess = spawn, sourceEnvironment = process.env } = options;
  if (typeof executable !== 'string' || !Array.isArray(args) || args.some(arg => typeof arg !== 'string' || /\0/.test(arg))) {
    throw new Error('Invalid native process request');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000) throw new Error('Invalid process timeout');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 268435456) {
    throw new Error('Invalid process output limit');
  }
  signal?.throwIfAborted();
  if (request.environmentMode && request.environmentMode !== 'launch') throw new Error('Unknown native process environment mode');
  const makeEnvironment = request.environmentMode === 'launch' ? createLaunchEnvironment : createBuildEnvironment;
  return new Promise((resolveResult, reject) => {
    const started = performance.now(), decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const tails = { stdout: '', stderr: '' }, output = { stdout: '', stderr: '' };
    let bytes = 0, child, timer, escalation, settled = false, reason = null, callbackError = null;
    const cancel = value => {
      if (reason) return;
      reason = value;
      terminateProcessTree(child);
      escalation = setTimeout(() => terminateProcessTree(child, { force: true }), 750);
      escalation.unref?.();
    };
    const consume = (stream, text) => {
      if (!text) return;
      bytes += Buffer.byteLength(text);
      if (bytes > maxOutputBytes) { cancel('output-limit'); return; }
      output[stream] += text;
      tails[stream] += text;
      let end;
      while ((end = tails[stream].indexOf('\n')) >= 0) {
        const line = tails[stream].slice(0, end).replace(/\r$/, '');
        tails[stream] = tails[stream].slice(end + 1);
        try { onLine?.({ stream, text: line }); }
        catch (error) { callbackError = error; cancel('callback-error'); }
      }
      if (tails[stream].length > 1024 * 1024) cancel('line-limit');
    };
    const abort = () => cancel('cancelled');
    const finish = (exitCode, processSignal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Keep escalation armed after the parent exits: a descendant can retain the process group.
      if (!reason) clearTimeout(escalation);
      signal?.removeEventListener('abort', abort);
      for (const stream of ['stdout', 'stderr']) {
        consume(stream, decoders[stream].end());
        if (tails[stream]) {
          try { onLine?.({ stream, text: tails[stream] }); } catch (failure) { callbackError = failure; }
        }
      }
      if (error || callbackError) { reject(error ?? callbackError); return; }
      resolveResult({ ...output, exitCode, signal: processSignal, durationMs: performance.now() - started,
        cancelled: reason === 'cancelled', timedOut: reason === 'timeout', reason, truncated: bytes > maxOutputBytes });
    };
    try {
      child = spawnProcess(executable, args, { cwd, env: makeEnvironment(sourceEnvironment, environment), shell: false,
        windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      onStart?.({ pid: child.pid });
    } catch (error) { finish(null, null, error); return; }
    for (const stream of ['stdout', 'stderr']) child[stream]?.on('data', data => consume(stream, decoders[stream].write(data)));
    child.once('error', error => finish(null, null, error));
    child.once('close', (code, childSignal) => finish(code, childSignal));
    timer = setTimeout(() => cancel('timeout'), timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
