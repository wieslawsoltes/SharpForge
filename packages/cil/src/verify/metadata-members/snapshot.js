import { decodeCoded } from '../../metadata/indices.js';
import { rejectMember, requireMemberToken, metadataOperation } from './budget.js';
import { snapshotNesting } from './nesting.js';

function heapCopies(metadata, budget) {
  const names = new Map();
  const signatures = new Map();
  let nameBytes = 0;
  let signatureBytes = 0;
  return {
    name(index) {
      if (names.has(index)) return names.get(index);
      const heap = metadata.streams.get('#Strings');
      if (!Number.isInteger(index) || index < 0 || !heap || index >= heap.length) rejectMember('CILVM0001', 'member name');
      let end = index;
      while (end < heap.length && heap[end] && end - index <= 1024) end++;
      if (end - index > 1024 || (nameBytes += end - index) > budget.maxMemberBytes) rejectMember('CILVM0002', 'member names');
      if (end === heap.length) rejectMember('CILVM0001', 'unterminated member name');
      const name = metadata.string(index);
      names.set(index, name);
      return name;
    },
    signature(index) {
      if (signatures.has(index)) return signatures.get(index);
      const bytes = metadata.blob(index);
      if (bytes.length > 4096 || (signatureBytes += bytes.length) > budget.maxMemberBytes) rejectMember('CILVM0002', 'signatures');
      // The fixed 4 KiB limit bounds argument expansion; the key preserves every byte without a hash collision bucket.
      const signature = { bytes: new Uint8Array(bytes), key: String.fromCharCode(...bytes) };
      signatures.set(index, signature);
      return signature;
    },
  };
}

function indexMember(index, record) {
  let names = index.get(record.ownerToken);
  if (!names) index.set(record.ownerToken, names = new Map());
  let signatures = names.get(record.name);
  if (!signatures) names.set(record.name, signatures = new Map());
  const key = record.signature.key;
  signatures.set(key, signatures.has(key) ? null : record);
}

/** Snapshot bounded definition/reference facts and unique blobs; no inspector or PE views escape. */
export function snapshotMembers(inspector, budget) {
  return metadataOperation(() => {
    budget.check();
    const metadata = inspector.metadata;
    const counts = Object.fromEntries([1, 2, 3, 4, 5, 6, 10, 26, 27, 43].map(table => [table, metadata.rows[table]?.length ?? 0]));
    if (counts[4] + counts[6] + counts[10] > budget.maxMembers ||
        counts[3] > budget.maxMembers || counts[5] > budget.maxMembers) rejectMember('CILVM0002', 'member rows');
    if ((metadata.rows[41]?.length ?? 0) > counts[2]) rejectMember('CILVM0002', 'nested type rows');
    const copies = heapCopies(metadata, budget);
    // The composed type adapter preflights TypeDef count before this bounded allocation.
    const visibility = new Uint8Array(counts[2]);
    const definitions = new Map();
    const references = new Map();
    const index = new Map();
    for (let row = 1; row <= counts[2]; row++) {
      budget.check();
      const flags = metadata.rows[2][row - 1][0];
      if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff) rejectMember('CILVM0001', 'type visibility');
      visibility[row - 1] = flags & 7;
      const ownerToken = 0x02000000 + row;
      for (const [column, kind] of [['FieldList', 'field'], ['MethodList', 'method']]) {
        for (const token of metadata.list(ownerToken, column)) {
          budget.check();
          if (definitions.has(token)) rejectMember('CILVM0001', 'duplicate member ownership');
          const data = metadata.row(token);
          const method = kind === 'method';
          const record = { token, kind, ownerToken, flags: data[method ? 2 : 0],
            name: copies.name(data[method ? 3 : 1]), signature: copies.signature(data[method ? 4 : 2]) };
          definitions.set(token, record);
          indexMember(index, record);
        }
      }
    }
    if (definitions.size !== counts[4] + counts[6]) rejectMember('CILVM0001', 'orphan member definition');
    for (let row = 1; row <= counts[10]; row++) {
      budget.check();
      const token = 0x0a000000 + row;
      const data = metadata.row(token);
      const ownerToken = requireMemberToken(decodeCoded('MemberRefParent', data[0]), counts, [1, 2, 6, 26, 27]);
      references.set(token, { token, ownerToken, name: copies.name(data[1]), signature: copies.signature(data[2]) });
    }
    const nesting = snapshotNesting(metadata.rows[41] ?? [], visibility, budget);
    return { counts, definitions, references, index, visibility, nesting };
  });
}
