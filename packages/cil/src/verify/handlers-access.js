/** Check ordinary arrivals at reachable try starts; exception injection is a separate entry path. */
export function validateHandlerEntryHeights(method, offsets, heights, issue) {
  let entries;
  for (const handler of method.handlers) {
    const index = offsets.get(handler.start);
    const height = heights.get(index);
    if (height === undefined || height === 0 || entries?.has(index)) continue;
    (entries ??= new Map()).set(index, { height, exceptional: false, reported: false });
  }
  if (!entries) return;
  let exceptional = false;
  for (const handler of method.handlers) {
    const entry = handler.flags === 0 && entries.get(offsets.get(handler.target));
    if (!entry || entry.height !== 1) continue;
    entry.exceptional = true;
    exceptional = true;
  }
  let count = 0;
  const report = index => {
    const entry = entries.get(index);
    if (!entry || entry.reported || count === 200) return;
    entry.reported = true;
    count++;
    issue(method, method.instructions[index], 'IL_EH_ENTRY',
      'Ordinary try entry requires an empty evaluation stack', { height: entry.height });
  };
  for (const [index, entry] of entries) if (!entry.exceptional) report(index);
  if (!exceptional || count === 200) return;
  reportOrdinaryArrivals(method, offsets, heights, report);
}

function reportOrdinaryArrivals(method, offsets, heights, report) {
  // A successful traversal has consistent joins, so every ordinary predecessor has the
  // recorded target height. Conflicting heights already prevent admission with IL_STACK.
  for (const index of heights.keys()) {
    const instruction = method.instructions[index];
    const name = instruction.name;
    if (name === 'ret' || name === 'throw' || name === 'rethrow' || name === 'endfinally') continue;
    // leave clears the stack before its successor; its inconsistent joins are already rejected.
    if (name === 'leave' || name === 'leave.s') continue;
    if (instruction.operandKind.startsWith('br')) report(offsets.get(instruction.operand));
    if (name === 'switch') for (const target of instruction.operand) report(offsets.get(target));
    if (name !== 'br' && name !== 'br.s') report(index + 1);
  }
}
