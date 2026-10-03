import { Reader, Writer } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { writeSignedCompressed } from './signed-integer.js';

function minimumOffset(records, initial) {
  return records.reduce((minimum, record) => Math.min(minimum, record.syntaxOffset ?? minimum), initial);
}

export function readSlots(bytes, { maxRecords }) {
  const reader = new Reader(bytes);
  const slots = [];
  let syntaxOffsetBaseline = -1;
  while (reader.position < reader.end) {
    const header = reader.u8();
    if (header === 255) {
      if (slots.length) fail('EnC slot baseline must precede slots');
      syntaxOffsetBaseline = -reader.compressed();
      continue;
    }
    if (slots.length >= maxRecords) fail('Custom debug record limit exceeded');
    if (header === 0) slots.push({ kind: null });
    else {
      if (header & 64 || !(header & 63)) fail('Invalid EnC local slot kind');
      const syntaxOffset = reader.compressed() + syntaxOffsetBaseline;
      const ordinal = header & 128 ? reader.compressed() : 0;
      slots.push({ kind: (header & 63) - 1, syntaxOffset, ordinal });
    }
  }
  return { syntaxOffsetBaseline, slots };
}

export function writeSlots(record) {
  const slots = record.slots ?? [];
  const baseline = record.syntaxOffsetBaseline ?? minimumOffset(slots, -1);
  const writer = new Writer();
  if (baseline !== -1) writer.u8(255).compressed(-baseline);
  for (const slot of slots) {
    if (slot.kind === null) {
      writer.u8(0);
      continue;
    }
    if (!Number.isInteger(slot.kind) || slot.kind < 0 || slot.kind > 62) fail('Invalid EnC local slot kind');
    const ordinal = slot.ordinal ?? 0;
    writer.u8(slot.kind + 1 + (ordinal > 0 ? 128 : 0)).compressed(slot.syntaxOffset - baseline);
    if (!Number.isInteger(ordinal) || ordinal < 0) fail('Invalid EnC local slot ordinal');
    if (ordinal > 0) writer.compressed(ordinal);
  }
  return writer.finish();
}

export function readLambdas(bytes, { maxRecords }) {
  if (!bytes.length) return { methodOrdinal: -1, syntaxOffsetBaseline: -1, closures: [], lambdas: [] };
  const reader = new Reader(bytes);
  const methodOrdinal = reader.compressed() - 1;
  const syntaxOffsetBaseline = -reader.compressed();
  const count = reader.compressed();
  if (count > maxRecords || count > reader.end - reader.position) fail('Invalid EnC closure count');
  const closures = [];
  for (let index = 0; index < count; index++)
    closures.push({ syntaxOffset: reader.compressed() + syntaxOffsetBaseline });
  const lambdas = [];
  while (reader.position < reader.end) {
    if (closures.length + lambdas.length >= maxRecords) fail('Custom debug record limit exceeded');
    const syntaxOffset = reader.compressed() + syntaxOffsetBaseline;
    const closureOrdinal = reader.compressed() - 2;
    if (closureOrdinal >= closures.length) fail('Invalid EnC lambda closure ordinal');
    lambdas.push({ syntaxOffset, closureOrdinal });
  }
  return { methodOrdinal, syntaxOffsetBaseline, closures, lambdas };
}

export function writeLambdas(record) {
  const closures = record.closures ?? [];
  const lambdas = record.lambdas ?? [];
  const baseline = record.syntaxOffsetBaseline ?? minimumOffset(lambdas, minimumOffset(closures, -1));
  const writer = new Writer()
    .compressed(record.methodOrdinal + 1)
    .compressed(-baseline)
    .compressed(closures.length);
  for (const closure of closures) writer.compressed(closure.syntaxOffset - baseline);
  for (const lambda of lambdas) {
    if (
      !Number.isInteger(lambda.closureOrdinal) ||
      lambda.closureOrdinal < -2 ||
      lambda.closureOrdinal >= closures.length
    ) {
      fail('Invalid EnC lambda closure ordinal');
    }
    writer.compressed(lambda.syntaxOffset - baseline).compressed(lambda.closureOrdinal + 2);
  }
  return writer.finish();
}

export function readStates(bytes, { maxRecords }) {
  if (!bytes.length) return { syntaxOffsetBaseline: 0, states: [] };
  const reader = new Reader(bytes);
  const count = reader.compressed();
  if (count > maxRecords || count * 2 > reader.end - reader.position) fail('Invalid EnC state count');
  const syntaxOffsetBaseline = count ? -reader.compressed() : 0;
  const states = [];
  let previous = -Infinity;
  let relativeOrdinal = 0;
  for (let index = 0; index < count; index++) {
    const stateNumber = reader.signedCompressed();
    const syntaxOffset = reader.compressed() + syntaxOffsetBaseline;
    if (syntaxOffset < previous) fail('EnC states must be sorted by syntax offset');
    relativeOrdinal = syntaxOffset === previous ? relativeOrdinal + 1 : 0;
    if (relativeOrdinal > 255) fail('EnC relative state ordinal exceeds byte range');
    states.push({ stateNumber, syntaxOffset, relativeOrdinal });
    previous = syntaxOffset;
  }
  if (reader.position !== reader.end) fail('Trailing EnC state data');
  return { syntaxOffsetBaseline, states };
}

export function writeStates(record) {
  const states = [...(record.states ?? [])].sort(
    (left, right) =>
      left.syntaxOffset - right.syntaxOffset || (left.relativeOrdinal ?? 0) - (right.relativeOrdinal ?? 0),
  );
  const baseline = record.syntaxOffsetBaseline ?? minimumOffset(states, 0);
  const writer = new Writer().compressed(states.length);
  if (states.length) writer.compressed(-baseline);
  for (const state of states) {
    writeSignedCompressed(writer, state.stateNumber);
    writer.compressed(state.syntaxOffset - baseline);
  }
  return writer.finish();
}
