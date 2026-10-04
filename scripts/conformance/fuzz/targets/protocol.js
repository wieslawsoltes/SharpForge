import { ProtocolMessageReader, encodeProtocolMessage } from '@sharpforge/protocol';
import { checkTextOutput, runTextTarget, textSeed, TextTargetRejection } from './text-contract.js';
import { classifyProtocolError } from './text-errors.js';

function createSeeds() {
  const lsp = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } };
  const dap = { seq: 1, type: 'request', command: 'initialize', arguments: { adapterID: 'fuzz' } };
  const unicode = { jsonrpc: '2.0', id: 2, result: 'λ 🚀' };
  const first = encodeProtocolMessage(lsp), second = encodeProtocolMessage(dap);
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return [
    { name: 'lsp-initialize', input: first },
    { name: 'dap-initialize', input: second },
    { name: 'unicode-result', input: encodeProtocolMessage(unicode) },
    { name: 'coalesced-frames', input: joined },
    textSeed('duplicate-length', 'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}'),
    textSeed('truncated-body', 'Content-Length: 2\r\n\r\n{'),
    textSeed('non-object-envelope', 'Content-Length: 2\r\n\r\n[]'),
    textSeed('invalid-json', 'Content-Length: 2\r\n\r\n{x'),
  ];
}

function readChunk(reader, input) {
  try {
    return reader.feed(input);
  } catch (error) {
    // Within feed, JSON.parse is the only operation that raises SyntaxError.
    if (error instanceof SyntaxError) throw new TextTargetRejection('PROTOCOL_JSON');
    throw error;
  }
}

function parseChunks(input, limits, incremental) {
  const reader = new ProtocolMessageReader({
    maxMessageBytes: limits.maxInputBytes,
    maxHeaderBytes: Math.min(8192, Math.max(24, limits.maxInputBytes)),
  });
  const frames = [];
  let outputBytes = 0, offset = 0, chunkSize = incremental ? 1 : Math.max(1, input.length);
  while (offset < input.length) {
    limits.signal?.throwIfAborted();
    const end = Math.min(input.length, offset + chunkSize);
    for (const message of readChunk(reader, input.subarray(offset, end))) {
      const frame = encodeProtocolMessage(message, { maxMessageBytes: limits.maxOutputBytes });
      outputBytes += frame.byteLength;
      checkTextOutput({ byteLength: outputBytes }, limits);
      frames.push(frame);
    }
    offset = end;
    if (incremental) chunkSize = chunkSize === 97 ? 1 : Math.min(97, chunkSize * 2 + 1);
  }
  reader.finish();
  return frames;
}

function parse(input, limits) {
  const whole = parseChunks(input, limits, false);
  const chunks = parseChunks(input, limits, true);
  if (whole.length !== chunks.length) throw new Error('Protocol chunking changed the message count');
  for (let index = 0; index < whole.length; index++) {
    const expected = whole[index], actual = chunks[index];
    if (expected.length !== actual.length || expected.some((byte, at) => byte !== actual[at])) {
      throw new Error('Protocol chunking changed a message');
    }
  }
}

/** Offline framing target shared by LSP/DAP; it does not dispatch requests or launch programs. */
export const target = {
  id: 'protocol',
  createSeeds,
  run(input, context) {
    return runTextTarget(input, context, parse, classifyProtocolError);
  },
};
