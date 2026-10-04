/** Preserve enumerable own-field semantics while giving fixed pool fields stable stores. */
export function scrubPreparedSourceFrame(frame) {
  for (const key in frame) {
    if (!Object.hasOwn(frame, key)) continue;
    // Host edits may remove or hide even factory fields; never read an inherited replacement.
    switch (key) {
      case 'id':
        frame.id = undefined;
        break;
      case 'method':
        frame.method = undefined;
        break;
      case 'methodId':
        frame.methodId = undefined;
        break;
      case 'args':
        frame.args.length = 0;
        break;
      case 'locals':
        frame.locals.length = 0;
        break;
      case 'stack':
        frame.stack.length = 0;
        break;
      case 'caught':
        frame.caught.length = 0;
        break;
      case 'unwinds':
        frame.unwinds.length = 0;
        break;
      case 'pc':
        frame.pc = undefined;
        break;
      case 'lastOffset':
        frame.lastOffset = undefined;
        break;
      case 'offsets':
        frame.offsets = undefined;
        break;
      case 'base':
        frame.base = undefined;
        break;
      case 'point':
        frame.point = undefined;
        break;
      case 'exception':
        frame.exception = undefined;
        break;
      case 'pending':
        frame.pending = undefined;
        break;
      case 'needsInitialization':
        frame.needsInitialization = undefined;
        break;
      case 'rootCaptures':
        frame.rootCaptures = undefined;
        break;
      default:
        // Late generic, delegate, exception, capability and host metadata must not survive recycling.
        frame[key] = undefined;
    }
  }
}
