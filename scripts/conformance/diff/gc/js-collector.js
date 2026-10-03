import {ManagedHeap} from '../../../../packages/runtime/src/heap.js';
/** Observes the production heap after explicit collection; does not simulate marking. */
export function traceFixture(fixture) {
  const heap = new ManagedHeap({maxBytes: 16 * 1024 * 1024, initialThreshold: 16 * 1024 * 1024});
  const references = new Map(), roots = new Set(), handles = new Map(), checkpoints = [];
  heap.rootProvider = () => [...roots].map(id => references.get(id));
  const reference = id => { if (!references.has(id)) throw new Error('Unknown object ' + id); return references.get(id); };
  const live = () => [...references].filter(([, ref]) => heap.generations[ref.h] === ref.g && heap.records[ref.h]).map(([id]) => id).sort();
  for (const [step, operation] of fixture.operations.entries()) {
    const {op, id} = operation;
    switch (op) {
      case 'allocate':
        if (references.has(id) || typeof id !== 'string' || !Number.isInteger(operation.fields) || operation.fields < 0 || operation.fields > 1000) throw new Error('Invalid allocation');
        references.set(id, heap.object('GCTraceNode', Array(operation.fields).fill(null))); break;
      case 'link': {
        const record = heap.get(reference(id));
        if (!Number.isInteger(operation.field) || operation.field < 0 || operation.field >= record.data.length) throw new Error('Invalid field');
        const target = operation.target === null ? null : reference(operation.target);
        if (target) heap.get(target);
        record.data[operation.field] = target; break;
      }
      case 'root': heap.get(reference(id)); roots.add(id); break;
      case 'clear-roots': roots.clear(); break;
      case 'handle':
        if (handles.has(operation.handle) || typeof operation.weak !== 'boolean') throw new Error('Invalid host handle');
        handles.set(operation.handle, {value: heap.createHandle(reference(id), {weak: operation.weak}), id, weak: operation.weak}); break;
      case 'release':
        if (!handles.has(operation.handle) || !heap.releaseHandle(handles.get(operation.handle).value)) throw new Error('Unknown or released handle');
        handles.delete(operation.handle); break;
      case 'collect': {
        const before = live(); heap.collect(); const reachable = live();
        checkpoints.push({step, reachable, collected: before.filter(value => !reachable.includes(value)),
          weak: Object.fromEntries([...handles].filter(([, handle]) => handle.weak).map(([name, handle]) => [name, heap.getHandle(handle.value) ? handle.id : null]).sort(([a], [b]) => a.localeCompare(b)))});
        break;
      }
      default: throw new Error('Unsupported fixture operation: ' + op);
    }
  }
  return {fixture: fixture.id, checkpoints, finalization: {status: 'unsupported', order: null,
    reason: 'ManagedHeap has no finalizer queue; C# finally handlers are not GC finalization.'}};
}
