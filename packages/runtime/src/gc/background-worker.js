function sharedIntegers(buffer, name) {
  if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength % 4) throw new TypeError(`Invalid shared ${name} buffer`);
  return new Int32Array(buffer);
}

/** Worker-side SATB traversal over an immutable CSR graph and shared mark/card tables. */
export function markSnapshotGraph(graph) {
  const count = graph.vertexCount;
  if (graph.schemaVersion !== 1 || !Number.isInteger(count) || count < 0 || count > 1_000_000) {
    throw new RangeError('Invalid background graph vertex bound');
  }
  const offsets = sharedIntegers(graph.offsets, 'offset');
  const edges = sharedIntegers(graph.edges, 'edge');
  const roots = sharedIntegers(graph.roots, 'root');
  const marks = sharedIntegers(graph.marks, 'mark');
  const cards = sharedIntegers(graph.cards, 'card');
  const status = sharedIntegers(graph.status, 'status');
  if (offsets.length !== count + 1 || marks.length !== count || cards.length !== count || status.length !== 4) {
    throw new TypeError('Background graph table lengths disagree');
  }
  if (edges.length > 10_000_000 || offsets[0] !== 0 || offsets[count] !== edges.length) {
    throw new RangeError('Invalid background graph edge bound');
  }
  if (roots.length > 1_000_000) throw new RangeError('Invalid background graph root bound');
  if (Atomics.load(status, 0)) return {status: 'cancelled', markedObjects: 0};
  for (let index = 0; index < count; index++) {
    if (offsets[index] < 0 || offsets[index] > offsets[index + 1]) throw new RangeError('Background graph offsets are unordered');
  }
  for (let index = 0; index < edges.length; index++) {
    if ((index & 1023) === 0 && Atomics.load(status, 0)) return {status: 'cancelled', markedObjects: 0};
    const vertex = edges[index];
    if (vertex < 0 || vertex >= count) throw new RangeError('Background graph edge is outside its vertex table');
  }
  const work = new Int32Array(count);
  let length = 0;
  let visited = 0;
  for (const vertex of roots) {
    if (vertex < 0 || vertex >= count) throw new RangeError('Background graph root is outside its vertex table');
    if (Atomics.compareExchange(marks, vertex, 0, 1) === 0) work[length++] = vertex;
  }
  while (length) {
    if (Atomics.load(status, 0)) return {status: 'cancelled', markedObjects: visited};
    const vertex = work[--length];
    visited++;
    for (let index = offsets[vertex]; index < offsets[vertex + 1]; index++) {
      if ((index & 1023) === 0 && Atomics.load(status, 0)) return {status: 'cancelled', markedObjects: visited};
      const next = edges[index];
      if (Atomics.compareExchange(marks, next, 0, 1) === 0) work[length++] = next;
    }
  }
  Atomics.store(status, 2, visited);
  Atomics.store(status, 1, 1);
  Atomics.notify(status, 1);
  return {status: 'complete', markedObjects: visited};
}

/** The protocol is also reusable by a native test-worker adapter without changing the algorithm. */
export function handleBackgroundMessage(message, reply) {
  if (message?.kind !== 'mark' || !Number.isSafeInteger(message.id)) throw new TypeError('Invalid background worker message');
  try {
    reply({kind: 'result', id: message.id, result: markSnapshotGraph(message.graph)});
  } catch (error) {
    reply({kind: 'error', id: message.id, error: {name: error.name, message: error.message}});
  }
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.addEventListener('message', event => handleBackgroundMessage(event.data, reply => globalThis.postMessage(reply)));
}
