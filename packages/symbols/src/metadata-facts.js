import { fail } from './contracts.js';

/** Resolve list ownership once, rejecting duplicate pointer targets before projecting symbol facts. */
export function metadataMemberOwners(metadata, table, column, label) {
  const owners = new Map();
  const first = table * 0x1000000;
  for (let row = 1; row <= (metadata.counts[2] ?? 0); row++) {
    const type = 0x02000000 | row;
    for (const member of metadata.list(type, column)) {
      if (!Number.isInteger(member) || member <= first || member > first + (metadata.counts[table] ?? 0)) {
        fail(`Invalid ${label} ownership token`);
      }
      if (owners.has(member)) fail(`Ambiguous ${label} ownership`);
      owners.set(member, type);
    }
  }
  return owners;
}

/** Bound UTF-8 scanning before decoding a metadata name, then cap its UTF-16 length. */
export function metadataName(metadata, index, label) {
  const heap = metadata.streams.get('#Strings');
  if (!heap || !Number.isInteger(index) || index < 0 || index >= heap.length) {
    fail(`Invalid ${label.toLowerCase()} name`);
  }
  let end = index;
  while (end < heap.length && end - index <= 3072 && heap[end] !== 0) end++;
  if (end - index > 3072) fail(`${label} name exceeds length limit`);
  if (end === heap.length) fail(`Unterminated ${label.toLowerCase()} name`);
  const name = metadata.string(index);
  if (name.length > 1024) fail(`${label} name exceeds length limit`);
  return name;
}
