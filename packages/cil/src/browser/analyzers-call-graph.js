const calls = new Set(['call', 'callvirt', 'newobj', 'ldftn', 'ldvirtftn', 'jmp']);

/** Preserve the inspector's legacy complete call graph, including per-method errors and its normal body cache. */
export function inspectorCallGraph(inspector) {
  const edges = [];
  for (const method of inspector.methods.values()) {
    try {
      for (const instruction of inspector.getMethod(method.token).instructions) {
        if (calls.has(instruction.name)) edges.push({ caller: method.token, callee: instruction.operand,
          offset: instruction.offset, kind: instruction.name });
      }
    } catch (error) { edges.push({ caller: method.token, error: error.message }); }
  }
  return edges;
}

