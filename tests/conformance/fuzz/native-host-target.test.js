import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMSBuildHost } from '@sharpforge/msbuild/node';
import { target } from '../../../scripts/conformance/fuzz/targets/network.js';
import { nativeHostClient } from '../../../scripts/conformance/fuzz/targets/native-host-http.js';
import { inspectNativeHostResponse } from '../../../scripts/conformance/fuzz/targets/native-host.js';
import {
  nativeHostContents, nativeHostFile, nativeHostOutside, nativeHostToken,
} from '../../../scripts/conformance/fuzz/targets/native-host-input.js';

const limits = { maxInputBytes: 65536, maxOutputBytes: 65536 };
const input = value => new TextEncoder().encode(JSON.stringify(value));
const nativeCase = (check, variant = 0, context = limits) => target.run(input({ operation: 'native-host', check, variant }), context);

function proof(result) {
  assert.equal(result.status, 'accepted');
  assert.equal(result.code, 'NETWORK_NATIVE_HOST');
  const value = JSON.parse(result.detail);
  assert.equal(value.profile, 'actual-loopback-native-host');
  assert.equal(value.address, '127.0.0.1');
  assert.equal(value.method, 'GET');
  assert.equal(value.route, '/api/msbuild/file');
  assert.equal(value.requests, 2);
  assert.equal(value.responses.length, 2);
  assert.equal(value.responses[0].statusCode, 200);
  assert(value.responseBytes > 0 && value.responseBytes <= value.limits.responseBytes);
  assert.equal(value.nativeSpawnAttempts, 0);
  assert.equal(value.nativeTrust, false);
  assert.equal(value.outsideRootBytes, false);
  assert.equal(value.serverClosed, true);
  assert.equal(value.engineClosed, true);
  assert.equal(value.pendingRequests, 0);
  assert(!result.detail.includes(nativeHostToken));
  return value;
}

test('native host target rejects transport and filesystem authority in input before effects', () => {
  for (const [key, value] of Object.entries({
    url: 'https://example.invalid', host: '127.0.0.1', port: 80, root: '/', path: '../secret',
    route: '/api/msbuild/jobs', method: 'POST', headers: {}, token: 'b'.repeat(64), origin: 'https://foreign.invalid',
  })) {
    assert.deepEqual(target.run(input({ operation: 'native-host', check: 'token', [key]: value }), limits), {
      status: 'rejected', code: 'NETWORK_NATIVE_HOST_SCHEMA',
    });
  }
  for (const check of [undefined, null, 'jobs', 'capabilities', '../child.js', {}]) {
    assert.deepEqual(target.run(input({ operation: 'native-host', check }), limits), {
      status: 'rejected', code: 'NETWORK_NATIVE_HOST_SCHEMA',
    });
  }
  for (const variant of [-1, 0.5, 65536, '0', {}]) {
    assert.deepEqual(target.run(input({ operation: 'native-host', check: 'path', variant }), limits), {
      status: 'rejected', code: 'NETWORK_NATIVE_HOST_VARIANT',
    });
  }
});

test('native host target retains actual allowed-read status, closed resources and effective response cap', async () => {
  const observed = proof(await nativeCase('valid', 0, { ...limits, maxOutputBytes: 1024 }));
  assert.equal(observed.responses[1].statusCode, 200);
  assert.equal(observed.limits.responseBytes, 1024);
});

test('native host rejects missing, same-length wrong and short tokens over actual loopback HTTP', async () => {
  for (const variant of [0, 1, 2]) {
    const observed = proof(await nativeCase('token', variant));
    assert.equal(observed.responses[1].statusCode, 401);
  }
});

test('native host rejects foreign or opaque Origin, raw Host and both cross-site metadata values', async () => {
  for (const [check, variant] of [['origin', 0], ['origin', 1], ['host', 65535], ['fetch-site', 0], ['fetch-site', 1]]) {
    const observed = proof(await nativeCase(check, variant));
    assert.equal(observed.responses[1].statusCode, 403);
  }
});

test('native host refuses relative, absolute, encoded and reserved paths without returning its owned sibling sentinel', async () => {
  for (let variant = 0; variant < 8; variant++) {
    const observed = proof(await nativeCase('path', variant));
    assert([400, 403, 404].includes(observed.responses[1].statusCode));
  }
});

test('native response overflow propagates as a finding candidate rather than controlled policy rejection', async () => {
  await assert.rejects(nativeCase('valid', 0, { ...limits, maxOutputBytes: 1 }), error => {
    assert.equal(error.name, 'NativeHostLimitError');
    assert.match(error.message, /response bytes/);
    return true;
  });
});

test('native denial proof detects JSON-escaped leaked bytes even inside an error envelope', () => {
  for (const text of [nativeHostOutside, nativeHostContents, nativeHostToken]) {
    assert.throws(() => inspectNativeHostResponse({
      check: 'token', variant: 0, statusCode: 401, expectedStatuses: [401], responseBytes: 100,
      body: JSON.stringify({ error: 'Rejected but leaked: ' + text }),
    }), /bytes were returned|returned owned file bytes|token was returned/);
  }
  assert.throws(() => inspectNativeHostResponse({
    check: 'token', variant: 0, statusCode: 200, expectedStatuses: [401], responseBytes: 2, body: '{}',
  }), /returned 200/);
});

async function withOwnedHost(action) {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-native-target-test-'));
  let host;
  let spawns = 0;
  try {
    const root = join(directory, 'workspace');
    await mkdir(root);
    await writeFile(join(root, nativeHostFile), nativeHostContents);
    await writeFile(join(directory, 'Outside.txt'), nativeHostOutside);
    host = await startMSBuildHost({ root, port: 0, token: nativeHostToken, trusted: false,
      spawnProcess() { spawns++; throw new Error('No native process is permitted by this test'); } });
    await action(host);
    assert.equal(spawns, 0);
  } finally {
    try {
      if (host) {
        const closed = host.close();
        host.server.closeAllConnections();
        await closed;
        assert.equal(host.server.listening, false);
        assert.equal(host.engine.closed, true);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

test('active native HTTP cancellation preserves its reason and closes the request before returning', async () => {
  await withOwnedHost(async host => {
    const controller = new AbortController();
    const reason = new Error('Cancel the active owned native request');
    const client = nativeHostClient(host, { ...limits, signal: controller.signal });
    host.server.once('request', () => controller.abort(reason));
    try {
      await assert.rejects(client.read({ check: 'valid', variant: 0 }), error => error === reason);
    } finally { await client.dispose(); }
    assert.equal(client.pending, 0);
  });
});

test('native client refuses a third HTTP request even when every earlier request completed', async () => {
  await withOwnedHost(async host => {
    const client = nativeHostClient(host, limits);
    try {
      assert.equal((await client.read({ check: 'valid', variant: 0 })).statusCode, 200);
      assert.equal((await client.read({ check: 'valid', variant: 0 })).statusCode, 200);
      await assert.rejects(client.read({ check: 'valid', variant: 0 }), /request count/);
    } finally { await client.dispose(); }
    assert.equal(client.pending, 0);
  });
});
