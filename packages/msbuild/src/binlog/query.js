import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { BuildEventModel } from './model.js';

/** Bounded event pages use an opaque byte cursor. Searches stop after the requested scanned-event budget. */
export async function queryBinlogEvents(path, {
  after = 0, limit = 100, search = '', maxScanned = 50000, maxBytes = 8388608, signal
} = {}) {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000
    || typeof search !== 'string' || search.length > 1024 || !Number.isSafeInteger(maxScanned) || maxScanned < 1 || maxScanned > 50000
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 33554432) {
    throw new Error('Invalid binlog query');
  }
  const input = createReadStream(path, { start: after, highWaterMark: 65536 }), lines = createInterface({ input, crlfDelay: Infinity });
  const events = [], needle = search.toLowerCase();
  let cursor = after, scanned = 0, complete = true, bytes = 0;
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      if (line.length > 4 * 1024 * 1024) throw new Error('Binlog event line limit exceeded');
      const size = Buffer.byteLength(line) + 1;
      scanned++;
      if (!needle || line.toLowerCase().includes(needle)) {
        if (size > maxBytes) throw new Error('Binlog event exceeds the response byte budget');
        if (bytes + size > maxBytes) { complete = false; break; }
        bytes += size;
        events.push({ cursor: cursor + size, ...JSON.parse(line) });
      }
      cursor += size;
      if (events.length >= limit || scanned >= maxScanned) { complete = false; break; }
    }
  } finally { lines.close(); input.destroy(); }
  return { events, nextCursor: complete ? null : cursor, scanned, bytes, complete };
}

export async function indexBinlogEvents(path, options = {}) {
  const model = new BuildEventModel(options), input = createReadStream(path, { highWaterMark: 65536 });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      options.signal?.throwIfAborted();
      if (line.length > 4194304) throw new Error('Binlog event line limit exceeded');
      model.accept(JSON.parse(line));
    }
  } finally { lines.close(); input.destroy(); }
  return model.finish();
}
