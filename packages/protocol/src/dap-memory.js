function pausedSession(adapter) {
  if (!adapter.configured || adapter.session?.vm.state !== 'paused') {
    throw new Error('A configured, paused debug session is required for managed memory');
  }
  return adapter.session;
}

function encode(bytes) {
  const chunks = [];
  for (let start = 0; start < bytes.length; start += 4096) {
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 4096)));
  }
  return btoa(chunks.join(''));
}

function decode(text, maximumBytes) {
  if (typeof text !== 'string' || text.length > Math.ceil(maximumBytes / 3) * 4) {
    throw new RangeError('Memory data exceeds the configured byte-transfer budget');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new TypeError('Memory data must be canonical base64');
  }
  const binary = atob(text);
  if (binary.length > maximumBytes) throw new RangeError('Memory data exceeds the configured byte-transfer budget');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (encode(bytes) !== text) throw new TypeError('Memory data must be canonical base64');
  return bytes;
}

function readMemory(adapter, arguments_) {
  const result = pausedSession(adapter).readMemory(arguments_.memoryReference, arguments_);
  return {...result, data: encode(result.data)};
}

function writeMemory(adapter, arguments_) {
  const session = pausedSession(adapter);
  const bytes = decode(arguments_.data, session.memoryTransferLimit);
  const result = session.writeMemory(arguments_.memoryReference, bytes, arguments_);
  if (result.bytesWritten && adapter.supportsMemoryEvents) {
    adapter.event('memory', {memoryReference: arguments_.memoryReference, offset: result.offset, count: result.bytesWritten});
  }
  return result;
}

function pinMemory(adapter, arguments_) {
  const session = pausedSession(adapter);
  const fromVariable = arguments_.variablesReference !== undefined;
  const fromExpression = arguments_.expression !== undefined;
  if (fromVariable === fromExpression) throw new TypeError('Select one variablesReference or side-effect-free expression');
  let value;
  if (fromVariable) {
    const target = adapter.refs.get(arguments_.variablesReference);
    if (target?.kind !== 'heap') throw new Error('A current managed object variablesReference is required');
    value = target.ref;
  } else {
    const evaluated = session.evaluate(arguments_.expression, arguments_.frameId);
    value = evaluated.reference ?? evaluated.value;
  }
  return session.pinMemory(value, {byteOffset: arguments_.byteOffset, byteLength: arguments_.byteLength, readOnly: arguments_.readOnly});
}

/** Additional DAP commands use the same bounded, per-stop pin service in both execution engines. */
export const memoryRequests = new Map([
  ['readMemory', readMemory],
  ['writeMemory', writeMemory],
  ['sharpforge/pinMemory', pinMemory],
  ['sharpforge/releaseMemory', (adapter, arguments_) => ({released: pausedSession(adapter).releaseMemory(arguments_.memoryReference)})]
]);
