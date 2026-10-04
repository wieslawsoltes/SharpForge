import test from 'node:test';
import assert from 'node:assert/strict';
import { LanguageServer } from '@sharpforge/protocol';
import { Workspace } from '@sharpforge/workspace';

function invalidParameters(id, message) {
  return { jsonrpc: '2.0', id, error: { code: -32602, message } };
}

for (const method of ['initialize', 'workspace/symbol', 'textDocument/hover', 'callHierarchy/incomingCalls']) {
  test(`LSP ${method} explicitly rejects malformed parameter containers`, async () => {
    const server = new LanguageServer();
    for (const params of [null, false, 0, '', []]) {
      assert.deepEqual(await server.handle({ id: 'parameters', method, params }),
        invalidParameters('parameters', 'params must be an object'));
    }
  });
}

for (const method of ['textDocument/hover', 'textDocument/formatting', 'textDocument/semanticTokens/full']) {
  test(`LSP ${method} explicitly requires the textDocument container`, async () => {
    const server = new LanguageServer();
    for (const textDocument of [undefined, null, false, 0, '', []]) {
      assert.deepEqual(await server.handle({ id: 0, method, params: { textDocument } }),
        invalidParameters(0, 'params.textDocument must be an object'));
    }
    assert.deepEqual(await server.handle({ id: 0, method }),
      invalidParameters(0, 'params.textDocument must be an object'));
  });
}

test('LSP requires a non-empty string document URI before document lookup', async () => {
  const server = new LanguageServer();
  for (const uri of [undefined, null, false, 0, '', []]) {
    assert.deepEqual(await server.handle({
      id: 1, method: 'textDocument/hover', params: { textDocument: { uri }, position: { line: 0, character: 0 } }
    }), invalidParameters(1, 'params.textDocument.uri must be a non-empty string'));
  }
  assert.deepEqual(await server.handle({
    id: 2, method: 'textDocument/hover', params: { textDocument: { uri: 'Unopened.cs' }, position: { line: 0, character: 0 } }
  }), invalidParameters(2, 'Document is not open'));
});

test('LSP malformed document notifications produce no response or document mutation', async () => {
  const workspace = new Workspace();
  const events = [];
  const server = new LanguageServer({ workspace, send: event => events.push(event) });
  for (const method of ['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose']) {
    for (const params of [null, {}, { textDocument: null }, { textDocument: { uri: '' } }]) {
      assert.equal(await server.handle({ method, params }), null);
    }
  }
  assert.equal(workspace.documents.size, 0);
  assert.deepEqual(events, []);
  assert.equal(await server.handle({
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: 'Program.cs', text: 'int count = 1;', version: 1 } }
  }), null);
  assert.equal(workspace.documents.get('Program.cs').source.text, 'int count = 1;');
  assert.equal(events[0].method, 'textDocument/publishDiagnostics');
});

test('LSP optional params and unknown methods preserve their existing public behavior', async () => {
  const server = new LanguageServer();
  for (const params of [undefined, {}]) {
    const initialized = await server.handle({ id: 1, method: 'initialize', params });
    assert.equal(initialized.result.capabilities.positionEncoding, 'utf-16');
    assert.deepEqual(await server.handle({ id: 2, method: 'workspace/symbol', params }),
      { jsonrpc: '2.0', id: 2, result: [] });
  }
  assert.deepEqual(await server.handle({ id: 3, method: 'unknown', params: null }), {
    jsonrpc: '2.0', id: 3, error: { code: -32601, message: "Method 'unknown' is not implemented" }
  });
  for (const method of ['initialized', '$/cancelRequest', 'unknown']) {
    assert.equal(await server.handle({ method, params: null }), null);
  }
});

test('LSP shutdown and notification handling take precedence over parameter validation', async () => {
  const server = new LanguageServer();
  assert.deepEqual(await server.handle({ id: 1, method: 'shutdown', params: null }),
    { jsonrpc: '2.0', id: 1, result: null });
  assert.deepEqual(await server.handle({ id: 2, method: 'textDocument/hover', params: null }), {
    jsonrpc: '2.0', id: 2, error: { code: -32600, message: 'The language server has shut down' }
  });
  assert.equal(await server.handle({ method: 'textDocument/hover', params: null }), null);
  assert.equal(await server.handle({ method: 'exit', params: null }), null);
});
