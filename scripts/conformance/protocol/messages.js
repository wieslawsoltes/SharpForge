import {lspValidator, dapValidator} from './schema.js';
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export function validator(protocol, models) {
  const lsp = lspValidator(models.lsp), dap = dapValidator(models.dap), pending = new Map();
  return (message, direction) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid protocol envelope');
    if (protocol === 'lsp') {
      if (message.jsonrpc !== '2.0') throw new Error('Expected JSON-RPC 2.0');
      if (has(message, 'method')) {
        if (typeof message.method !== 'string') throw new Error('Invalid method');
        const row = has(message, 'id') ? lsp.request(message.method) : lsp.notification(message.method);
        if (row?.messageDirection && !['both', direction].includes(row.messageDirection)) throw new Error('LSP message direction mismatch');
        if (row?.params) lsp.check(message.params, row.params);
        if (has(message, 'id')) {
          if (!(typeof message.id === 'string' || Number.isSafeInteger(message.id)) || pending.has(direction + ':' + typeof message.id + ':' + message.id)) throw new Error('Invalid or duplicate request ID');
          pending.set(direction + ':' + typeof message.id + ':' + message.id, {method: message.method, result: row?.result});
        } else if (!row) throw new Error('Unmodelled notification: ' + message.method);
      } else {
        const key = (direction === 'serverToClient' ? 'clientToServer:' : 'serverToClient:') + typeof message.id + ':' + message.id;
        const request = pending.get(key); if (!request) throw new Error('Uncorrelated LSP response'); pending.delete(key);
        if (has(message, 'error') === has(message, 'result')) throw new Error('Response needs exactly one result or error');
        if (has(message, 'error')) {
          if (!Number.isInteger(message.error?.code) || typeof message.error.message !== 'string') throw new Error('Malformed JSON-RPC error');
          if (!request.result && message.error.code !== -32601) throw new Error('Unsupported LSP request must return -32601');
        } else { if (!request.result) throw new Error('Unmodelled request succeeded'); lsp.check(message.result, request.result); }
      }
    } else if (protocol === 'dap') {
      if (message.type === 'request') {
        const definition = dap.definition(message.command, 'Request'); dap.check(message, definition ?? 'Request');
        if (pending.has(message.seq)) throw new Error('Duplicate DAP request sequence');
        pending.set(message.seq, {command: message.command, direction, definition});
      } else if (message.type === 'response') {
        const request = pending.get(message.request_seq); if (!request || request.command !== message.command || request.direction === direction) throw new Error('Uncorrelated DAP response');
        pending.delete(message.request_seq);
        if (!message.success) { dap.check(message, 'ErrorResponse'); if (typeof message.message !== 'string' || !message.message.length) throw new Error('DAP error requires an explanatory message'); }
        else { const definition = dap.definition(message.command, 'Response'); if (!definition) throw new Error('Unmodelled DAP request succeeded'); dap.check(message, definition); }
      } else if (message.type === 'event') { const definition = dap.definition(message.event, 'Event'); if (!definition) throw new Error('Unmodelled DAP event'); dap.check(message, definition); }
      else throw new Error('Invalid DAP message type');
    } else throw new Error('Unsupported protocol');
  };
}
