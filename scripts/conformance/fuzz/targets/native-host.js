import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMSBuildHost } from '@sharpforge/msbuild/node';
import {
  nativeHostContents, nativeHostFile, nativeHostOutside, nativeHostPlan, nativeHostToken,
} from './native-host-input.js';
import { nativeHostClient, nativeHostLimits } from './native-host-http.js';

function requireFact(condition, message) {
  if (!condition) throw new Error('Native host invariant: ' + message);
}

export function inspectNativeHostResponse(response) {
  requireFact(response.expectedStatuses.includes(response.statusCode),
    `${response.check} returned ${response.statusCode}; expected ${response.expectedStatuses.join('/')}`);
  const value = JSON.parse(response.body);
  const encoded = JSON.stringify(value);
  const includes = text => encoded.includes(JSON.stringify(text).slice(1, -1));
  requireFact(!includes(nativeHostOutside), 'outside-root bytes were returned');
  requireFact(!includes(nativeHostToken), 'session token was returned');
  if (response.check === 'valid') {
    requireFact(value.path === nativeHostFile && value.text === nativeHostContents, 'owned control file did not round-trip');
  } else {
    requireFact(typeof value.error === 'string' && !Object.hasOwn(value, 'text'), 'denial did not return an error envelope');
    requireFact(!includes(nativeHostContents), 'denied request returned owned file bytes');
  }
  return { check: response.check, variant: response.variant, statusCode: response.statusCode, responseBytes: response.responseBytes };
}

async function disposeFixture(client, host, directory) {
  const errors = [];
  try { await client?.dispose(); } catch (error) { errors.push(error); }
  if (host) {
    try {
      const closing = host.close();
      host.server.closeAllConnections();
      await closing;
    } catch (error) { errors.push(error); }
  }
  try { await rm(directory, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  return errors;
}

/** Real token/Origin/Host/path checks on a disposable local server; no SDK, build request or external destination is admitted. */
export async function runNativeHost(plan, limits) {
  const selected = nativeHostPlan({ operation: 'native-host', ...plan });
  limits.signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-fuzz-native-'));
  let host, client, failure, responses, failed = false;
  let spawnAttempts = 0;
  try {
    const workspace = join(directory, 'workspace');
    await mkdir(workspace);
    await mkdir(join(workspace, 'child'));
    await writeFile(join(workspace, nativeHostFile), nativeHostContents, { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'Outside.txt'), nativeHostOutside, { flag: 'wx', mode: 0o600 });
    limits.signal?.throwIfAborted();
    host = await startMSBuildHost({
      root: workspace, port: 0, token: nativeHostToken, trusted: false,
      spawnProcess() { spawnAttempts++; throw new Error('Native process spawning is forbidden by this fixture'); },
    });
    limits.signal?.throwIfAborted();
    requireFact(host.engine.trusted === false, 'native trust was enabled');
    client = nativeHostClient(host, limits);
    const control = inspectNativeHostResponse(await client.read({ check: 'valid', variant: 0 }));
    const challenge = inspectNativeHostResponse(await client.read(selected));
    responses = [control, challenge];
  } catch (error) { failure = error; failed = true; }
  const cleanupErrors = await disposeFixture(client, host, directory);
  if (cleanupErrors.length) {
    throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors,
      'Native host fixture teardown failed: ' + cleanupErrors.map(error => error.message).join('; '));
  }
  if (failed) throw failure;
  limits.signal?.throwIfAborted();
  requireFact(spawnAttempts === 0, 'an SDK/native process was requested');
  requireFact(host.engine.closed === true && host.server.listening === false && client.pending === 0,
    'owned server, engine or request did not close');
  const proof = {
    profile: 'actual-loopback-native-host', address: '127.0.0.1', method: 'GET', route: '/api/msbuild/file',
    requests: client.requests, responseBytes: client.responseBytes,
    limits: { ...nativeHostLimits, responseBytes: Math.min(nativeHostLimits.responseBytes, limits.maxOutputBytes) }, responses,
    outsideRootBytes: false, nativeSpawnAttempts: spawnAttempts, nativeTrust: false,
    serverClosed: true, engineClosed: true, pendingRequests: 0,
  };
  const detail = JSON.stringify(proof);
  requireFact(Buffer.byteLength(detail) <= limits.maxOutputBytes, 'proof exceeds output limit');
  return { status: 'accepted', code: 'NETWORK_NATIVE_HOST', detail };
}
