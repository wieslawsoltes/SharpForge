import test from 'node:test';
import assert from 'node:assert/strict';
import { LanguageServer } from '@sharpforge/protocol';

const invalidRequestResponse = {
  jsonrpc: '2.0',
  id: null,
  error: { code: -32600, message: 'Invalid Request' }
};

const malformedEnvelopes = [
  ['null', null],
  ['undefined', undefined],
  ['string', 'initialize'],
  ['empty string', ''],
  ['number', 1],
  ['zero', 0],
  ['NaN', NaN],
  ['true', true],
  ['false', false],
  ['bigint', 0n],
  ['symbol', Symbol('request')],
  ['function', () => {}],
  ['empty array', []],
  ['batch array', [{ jsonrpc: '2.0', id: 1, method: 'initialize' }]]
];

for (const [name, envelope] of malformedEnvelopes) {
  test(`LSP rejects the ${name} envelope with a stable Invalid Request response`, async () => {
    const notifications = [];
    const server = new LanguageServer({ send: message => notifications.push(message) });
    assert.deepEqual(await server.handle(envelope), invalidRequestResponse);
    assert.deepEqual(notifications, []);
    const response = await server.handle({ id: 'after-invalid', method: 'initialize' });
    assert.equal(response.id, 'after-invalid');
    assert.equal(response.result.capabilities.positionEncoding, 'utf-16');
  });
}

test('LSP rejects arrays carrying request properties before any dispatch side effect', async () => {
  const server = new LanguageServer();
  const envelope = Object.assign([], { id: 1, method: 'shutdown' });
  assert.deepEqual(await server.handle(envelope), invalidRequestResponse);
  const response = await server.handle({ id: 2, method: 'initialize' });
  assert.equal(response.result.serverInfo.name, 'SharpForge Language Server');
});

test('LSP preserves request IDs and the optional jsonrpc field at the public adapter boundary', async () => {
  const server = new LanguageServer();
  for (const id of [0, 7, '', 'request-7', null]) {
    for (const version of [{}, { jsonrpc: '2.0' }]) {
      assert.deepEqual(await server.handle({ ...version, id, method: 'unknownMethod' }), {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: "Method 'unknownMethod' is not implemented" }
      });
    }
  }
});

test('LSP rejects missing, non-string and empty method names while preserving request correlation', async () => {
  const server = new LanguageServer();
  for (const id of [0, 7, '', 'request-7', null]) {
    for (const version of [{}, { jsonrpc: '2.0' }]) {
      assert.deepEqual(await server.handle({ ...version, id }), { ...invalidRequestResponse, id });
      for (const method of [undefined, null, false, 0, '', [], {}]) {
        assert.deepEqual(await server.handle({ ...version, id, method }), { ...invalidRequestResponse, id });
      }
    }
  }
  const initialized = await server.handle({ id: 'after-invalid-method', method: 'initialize' });
  assert.equal(initialized.result.capabilities.positionEncoding, 'utf-16');
});

test('LSP malformed methods are invalid requests even without an ID or after shutdown', async () => {
  const events = [];
  const server = new LanguageServer({ send: event => events.push(event) });
  assert.deepEqual(await server.handle({}), invalidRequestResponse);
  assert.deepEqual(await server.handle({ method: '' }), invalidRequestResponse);
  assert.deepEqual(await server.handle({ id: {}, method: null }), invalidRequestResponse);
  assert.deepEqual(await server.handle({ id: Infinity }), invalidRequestResponse);
  await server.handle({ id: 1, method: 'shutdown' });
  assert.deepEqual(await server.handle({ id: 'invalid-after-shutdown' }), {
    ...invalidRequestResponse, id: 'invalid-after-shutdown'
  });
  assert.deepEqual(events, []);
});

test('LSP retains initialization capabilities and the semantic token wire legend', async () => {
  const server = new LanguageServer();
  const response = await server.handle({
    id: 1,
    method: 'initialize',
    params: { capabilities: { workspace: { workspaceEdit: { documentChanges: true } } } }
  });
  assert.equal(response.result.capabilities.textDocumentSync, 2);
  assert.deepEqual(response.result.capabilities.renameProvider, { prepareProvider: true });
  assert.deepEqual(response.result.capabilities.semanticTokensProvider.legend, {
    tokenTypes: [
      'namespace', 'class', 'method', 'field', 'variable',
      'keyword', 'string', 'number', 'operator', 'property'
    ],
    tokenModifiers: []
  });
});

test('LSP still dispatches document notifications and publishes diagnostics after a rejected envelope', async () => {
  const notifications = [];
  const server = new LanguageServer({ send: message => notifications.push(message) });
  assert.deepEqual(await server.handle(null), invalidRequestResponse);
  assert.equal(await server.handle({
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: 'Program.cs', text: 'Console.WriteLine(1);', version: 1 } }
  }), null);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].method, 'textDocument/publishDiagnostics');
  assert.equal(notifications[0].params.uri, 'Program.cs');
  assert.equal(notifications[0].params.version, 1);
});

test('LSP still omits responses to notifications and preserves lifecycle errors', async () => {
  const notifications = [];
  const server = new LanguageServer({ send: message => notifications.push(message) });
  for (const method of ['initialized', 'unknownMethod', '$/cancelRequest']) {
    assert.equal(await server.handle({ method }), null);
    assert.equal(await server.handle({ jsonrpc: '2.0', method }), null);
  }
  assert.deepEqual(await server.handle({ id: 3, method: 'shutdown' }), { jsonrpc: '2.0', id: 3, result: null });
  assert.deepEqual(await server.handle(null), invalidRequestResponse);
  assert.deepEqual(await server.handle({ id: 4, method: 'initialize' }), {
    jsonrpc: '2.0',
    id: 4,
    error: { code: -32600, message: 'The language server has shut down' }
  });
  assert.equal(await server.handle({ method: 'initialize' }), null);
  assert.equal(await server.handle({ method: 'exit' }), null);
  assert.deepEqual(notifications, []);
});
