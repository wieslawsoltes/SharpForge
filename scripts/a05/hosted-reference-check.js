import {join} from 'node:path';
import {hostedResources} from './hosted-plan.js';
import {readJson} from './hosted-provenance.js';
import {runHostedProcess} from './hosted-process.js';

/** A separate untimed process avoids retaining the reference API in the queue's parent heap. */
export async function verifyHostedReference({directory, product, signal}) {
  const output = join(directory, 'profiler-reference-after-off.json');
  const argv = ['scripts/limited.js', process.execPath, 'scripts/a05/hosted-reference-worker.js',
    join(directory, 'profiler-reference.json'), output];
  const result = await runHostedProcess({argv, cwd: product, signal,
    env: {...process.env, ...hostedResources}, log: join(directory, 'profiler-reference-after-off.log')});
  let report;
  try { report = readJson(output); }
  catch (error) { report = {status: 'failed', error: {message: error.message}}; }
  return {command: [process.execPath, ...argv], cwd: product, process: result, report};
}
