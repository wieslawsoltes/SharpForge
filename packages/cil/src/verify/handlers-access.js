/** Check reachable try starts using the existing offset/height indexes; no allocation for valid input. */
export function validateHandlerEntryHeights(method, offsets, heights, issue) {
  let reported;
  for (const handler of method.handlers) {
    const index = offsets.get(handler.start);
    const height = heights.get(index);
    if (height === undefined || height === 0 || reported?.has(handler.start)) continue;
    // Shared try families report once; match the execution profile's bounded diagnostic capacity.
    if (reported?.size === 200) return;
    (reported ??= new Set()).add(handler.start);
    issue(method, method.instructions[index], 'IL_EH_ENTRY', 'Try entry requires an empty evaluation stack', { height });
  }
}
