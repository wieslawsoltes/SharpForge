import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs, isDeepStrictEqual} from 'node:util';
import {ProtocolMessageReader, encodeProtocolMessage} from '../../../packages/protocol/src/framing.js';
import {loadModels} from './schema.js';
import {validator} from './messages.js';
import {readSession, validateSession} from './session.js';
import {isMain} from '../../planning/test-manifests.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const canonical = (message, protocol) => { const result = structuredClone(message); if (protocol === 'dap') delete result.seq; return result; };
export async function replaySession(session, {timeout = 10000, allowSynthetic = false} = {}) {
  validateSession(session);
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120000) throw new Error('Replay timeout must be 100..120000 ms');
  if (session.kind !== 'recording' && !allowSynthetic) throw new Error('Synthetic sessions cannot qualify recorded VS Code interoperability');
  const models = await loadModels(), validate = validator(session.protocol, models);
  const child = spawn(process.execPath, [resolve(root, `packages/protocol/bin/sharpforge-${session.protocol}.js`)], {cwd: root, stdio: ['pipe', 'pipe', 'pipe']});
  const reader = new ProtocolMessageReader({maxMessageBytes: 4 * 1024 * 1024}), queue = [], waiters = [];
  let failure = null, closed = false, stderr = '', outputCount = 0;
  const abort = error => { failure = error; while (waiters.length) waiters.shift().reject(error); child.kill('SIGKILL'); };
  const timer = setTimeout(() => abort(new Error('Protocol replay timeout')), timeout);
  child.on('error', abort); child.stdin.on('error', abort);
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-65536); });
  child.stdout.on('data', bytes => { try {
    for (const message of reader.feed(bytes)) { if (++outputCount > 10000) throw new Error('Server message limit'); validate(message, 'serverToClient');
      if (waiters.length) waiters.shift().resolve(message); else queue.push(message); }
  } catch (error) { abort(error); } });
  const done = new Promise(resolveDone => child.on('close', (code, signal) => { closed = true;
    try { reader.finish(); } catch (error) { failure ??= error; }
    while (waiters.length) waiters.shift().reject(failure ?? new Error('Server closed before expected response'));
    resolveDone({code, signal});
  }));
  const receive = () => queue.length ? Promise.resolve(queue.shift()) : failure ? Promise.reject(failure)
    : closed ? Promise.reject(new Error('Server is closed')) : new Promise((resolveMessage, reject) => waiters.push({resolve: resolveMessage, reject}));
  const actual = [], differences = [];
  try {
    for (const [index, row] of session.messages.entries()) {
      if (failure) throw failure;
      if (row.direction === 'clientToServer') { validate(row.message, row.direction); child.stdin.write(encodeProtocolMessage(row.message)); }
      else {
        const message = await receive(); actual.push(message);
        if (!isDeepStrictEqual(canonical(message, session.protocol), canonical(row.message, session.protocol))) differences.push({index, expected: row.message, actual: message});
      }
    }
    child.stdin.end(); const result = await done;
    if (failure) throw failure;
    if (result.code !== 0 || queue.length) throw new Error('Server failed or emitted unexpected additional messages: ' + stderr);
    return {status: differences.length ? 'different' : 'passed', protocol: session.protocol, sourceKind: session.kind,
      qualification: session.kind === 'recording' ? 'recorded-session-only' : 'synthetic-tooling-only', responses: actual.length, differences};
  } finally { clearTimeout(timer); if (!closed) { child.kill('SIGKILL'); await done; } }
}
export async function replayFiles(paths, {output = 'artifacts/protocol/replay.json', ...options} = {}) {
  const report = {schemaVersion: 1, status: paths.length ? 'passed' : 'not-run', qualification: 'unknown', sessions: []};
  for (const path of paths) { try { report.sessions.push({path, ...await replaySession(await readSession(path), options)}); }
    catch (error) { report.sessions.push({path, status: 'failed', error: error.message}); } }
  if (report.sessions.some(row => row.status !== 'passed')) report.status = 'failed';
  if (!paths.length) report.reason = 'No reviewed VS Code session recordings supplied; synthetic tests are not recordings.';
  await mkdir(dirname(resolve(output)), {recursive: true}); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); return report;
}
if (isMain(import.meta.url)) {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {output: {type: 'string'}, timeout: {type: 'string'}, registry: {type: 'string'}}});
  if (values.registry) {
    const registry = JSON.parse(await readFile(values.registry, 'utf8'));
    if (registry.schemaVersion !== 1 || !Array.isArray(registry.recordings)) throw new Error('Invalid recording registry');
    for (const row of registry.recordings) {
      if (!/^tests\/conformance\/protocol\/recordings\/[^/]+\.json$/.test(row.path) || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('Invalid reviewed recording path or digest');
      if (createHash('sha256').update(await readFile(resolve(root, row.path))).digest('hex') !== row.sha256) throw new Error('Recording changed since review');
      positionals.push(resolve(root, row.path));
    }
  }
  const report = await replayFiles(positionals, {...values, ...(values.timeout ? {timeout: Number(values.timeout)} : {})});
  console.log(JSON.stringify({status: report.status, sessions: report.sessions.length})); if (report.status === 'failed') process.exitCode = 1;
}
