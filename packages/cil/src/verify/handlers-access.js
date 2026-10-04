/** Check reachable try starts without confusing catch exception injection with ordinary entry. */
export function validateHandlerEntryHeights(method, offsets, heights, issue, options = {}) {
  let entries;
  for (const handler of method.handlers) {
    const index = offsets.get(handler.start);
    const height = heights.get(index);
    if (height === undefined || height === 0 || entries?.has(index)) continue;
    (entries ??= new Map()).set(index, { height, exceptional: false });
  }
  if (!entries) return;
  for (const handler of method.handlers) {
    const injectsException = handler.flags === 0 || (options.filteredHandlers === true && handler.flags === 1);
    const entry = injectsException && entries.get(offsets.get(handler.target));
    if (entry?.height === 1) entry.exceptional = true;
  }
  let count = 0;
  for (const [index, entry] of entries) {
    // A coincident catch start owns the exception seed. Matching ordinary branches
    // retain that entry state; conflicting heights already fail the stack traversal.
    if (entry.exceptional) continue;
    if (count++ === 200) return;
    issue(method, method.instructions[index], 'IL_EH_ENTRY',
      'Ordinary try entry requires an empty evaluation stack', { height: entry.height });
  }
}
