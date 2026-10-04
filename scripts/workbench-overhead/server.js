import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {rootDirectory} from '../editor-benchmarks/common.js';

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill('SIGTERM');
  });
}

/** Use the production server/CSP. Never implicitly build or install a browser during capture. */
export async function productionServer(url = process.env.SHARPFORGE_BROWSER_URL) {
  if (url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      || parsed.username || parsed.password) {
      throw new Error('Instrumentation captures require a local production HTTP server');
    }
    return {url: parsed.href, stop: async () => {}};
  }
  const directory = resolve(process.env.SERVE_ROOT ?? resolve(rootDirectory, 'dist'));
  try { await access(resolve(directory, 'index.html')); }
  catch { throw new Error('Build the production Studio artifact before capturing instrumentation overhead'); }
  const port = await availablePort(), address = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/serve.js'], {cwd: rootDirectory,
    env: {...process.env, HOST: '127.0.0.1', PORT: String(port), SERVE_ROOT: directory}, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  const append = chunk => { output = (output + chunk).slice(-16000); };
  child.stderr.on('data', append);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Production server startup timed out: ' + output)), 15000);
      const onError = error => finish(error);
      const onExit = code => finish(new Error(`Production server exited (${code}): ${output}`));
      const onData = chunk => { append(chunk); if (output.includes(`SharpForge Studio: ${address}`)) finish(); };
      const finish = error => {
        clearTimeout(timeout);
        child.off('error', onError); child.off('exit', onExit); child.stdout.off('data', onData);
        error ? reject(error) : resolve();
      };
      child.once('error', onError); child.once('exit', onExit); child.stdout.on('data', onData);
    });
  } catch (error) { await stop(child); throw error; }
  return {url: address, stop: () => stop(child)};
}
