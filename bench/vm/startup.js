import {spawn} from 'node:child_process';
import {writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {serialize} from 'node:v8';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {abortIfNeeded} from './operations.js';
import {finalizeRow} from './evidence.js';
import {metricPlan} from './metric-contracts.js';
export {coldSample} from './cold-sample.js';

/** Preserve VM flags without recursively launching a test runner when called by a focused test. */
export function coldProcessFlags(args) {
  const result = [];
  const booleanTests = new Set(['--test', '--test-only', '--test-force-exit', '--test-update-snapshots']);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--test' || argument.startsWith('--test-')) {
      if (!argument.includes('=') && !booleanTests.has(argument) && args[index + 1] && !args[index + 1].startsWith('-')) index++;
    } else result.push(argument);
  }
  return result;
}

export function childSample(input, signal) {
  abortIfNeeded(signal);
  const directory = mkdtempSync(join(tmpdir(), 'sharpforge-vm-cold-'));
  const path = join(directory, 'input.bin');
  try { writeFileSync(path, serialize(input)); }
  catch (error) {
    rmSync(directory, {recursive: true, force: true});
    throw error;
  }
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const worker = fileURLToPath(new URL('./cold-worker.js', import.meta.url));
    const child = spawn(process.execPath, [...coldProcessFlags(process.execArgv), worker, path],
      {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    let errors = '';
    let failure = null;
    const cancel = () => {
      failure = signal.reason instanceof Error ? signal.reason : new DOMException('Cold sample cancelled', 'AbortError');
      child.kill('SIGTERM');
    };
    const timeout = setTimeout(() => {
      failure = new Error('Cold sample exceeded 120 seconds');
      child.kill('SIGKILL');
    }, 120000);
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
    const append = (chunk, error) => {
      if (error) errors += chunk;
      else output += chunk;
      if (output.length + errors.length > 2000000) {
        failure = new Error('Cold worker output limit exceeded');
        child.kill('SIGKILL');
      }
    };
    child.stdout.on('data', chunk => append(chunk, false));
    child.stderr.on('data', chunk => append(chunk, true));
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      rmSync(directory, {recursive: true, force: true});
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`Cold worker failed (${code}): ${errors || output}`));
      try { resolve({...JSON.parse(output), childProcessMs: performance.now() - start}); }
      catch (error) { reject(new Error('Malformed cold worker report: ' + error.message)); }
    });
  });
}

export async function measureStartup(fixture, engine, artifact, protocol, signal, onRow = () => {}) {
  const row = {id: `startup/${fixture.id}/${engine}`, kind: 'startup', engine, fixture: fixture.id,
    isolation: 'fresh-node-process-per-sample', samples: [], ...metricPlan('startup', engine, protocol)};
  onRow(row);
  for (let index = 0; index < protocol.samples; index++) {
    const sample = await childSample({fixture, engine, artifact, vmOptions: protocol.vmOptions}, signal);
    const expected = protocol.preparation[engine].status;
    if ((sample.preparation.status === 'prepared') !== (expected === 'available')) {
      throw new Error('Startup preparation capability changed in cold worker');
    }
    row.samples.push({index, phase: 'measured', ...sample});
  }
  return finalizeRow(row);
}
