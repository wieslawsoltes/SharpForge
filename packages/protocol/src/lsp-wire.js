/** Wire identifiers shared by initialization, semantic tokens and document symbols. */
export const tokenTypes = [
  'namespace', 'class', 'method', 'field', 'variable',
  'keyword', 'string', 'number', 'operator', 'property'
];

export const symbolKinds = {
  property: 7,
  class: 5,
  struct: 23,
  interface: 11,
  enum: 10,
  delegate: 12,
  method: 6,
  field: 8,
  event: 24,
  local: 13
};

/** Direct adapter calls may omit jsonrpc; one request or notification still needs an object envelope. */
export function isRequestObject(message) {
  return message !== null && typeof message === 'object' && !Array.isArray(message);
}

/** Invalid envelopes have no reliable request ID and must not be mistaken for notifications. */
export function invalidRequest() {
  return {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'Invalid Request' }
  };
}
