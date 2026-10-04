/** Validate source clause metadata before traversing its implicit control-flow entries. */
export function exceptionRegionEntries(method, fail) {
  const count = method.code.length / 3;
  const entries = [];
  for (const handler of method.handlers) {
    const positions = [handler.start, handler.end, handler.target];
    const hasFilter = handler.filter !== undefined;
    if (positions.some(value => !Number.isInteger(value)) || handler.start < 0 || handler.end > count ||
      handler.start >= handler.end || handler.target < 0 || handler.target >= count ||
      ![undefined, 'catch', 'filter', 'finally'].includes(handler.kind) ||
      (handler.kind === 'finally' ? hasFilter || !Number.isInteger(handler.handlerEnd) :
        !Number.isInteger(handler.slot) || handler.slot < 0 || handler.slot >= method.locals.length) ||
      handler.handlerEnd !== undefined && (!Number.isInteger(handler.handlerEnd) ||
        handler.handlerEnd <= handler.target || handler.handlerEnd > count) ||
      hasFilter && (!Number.isInteger(handler.filter) || handler.filter < 0 || handler.filter >= handler.target)) {
      fail(method, 0, 'Invalid exception handler');
      continue;
    }
    entries.push([handler.target, 0]);
    if (hasFilter) entries.push([handler.filter, 0]);
  }
  return entries;
}
