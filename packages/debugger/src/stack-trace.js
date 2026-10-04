import {contextFrames} from './concurrency.js';

function provenance(point, assemblyKey, originalMethodToken) {
  return {...(assemblyKey === undefined || assemblyKey === null ? {} : {assemblyKey, originalMethodToken}),
    ...Object.fromEntries(['originalUri', 'project', 'contextId'].filter(key => point?.[key] !== undefined)
      .map(key => [key, point[key]]))};
}

/** Serialize source frames without treating a module-local CLI token as a global assembly identity. */
export function sourceStackTrace(session, threadId) {
  const {vm} = session;
  const {image} = vm;
  return [...contextFrames(session, threadId)].reverse()
    .filter(frame => !image.methods[frame.methodId].name.startsWith('<startup>'))
    .map(frame => {
      const method = image.methods[frame.methodId];
      const atSequence = frame === vm.top && vm.state === 'paused' && vm.sourcePause;
      const instruction = atSequence ? frame.pc : Math.max(0, frame.pc - 1);
      const point = frame.point && session.sourceIndex.byId.get(frame.point.id);
      const methodToken = image.il?.methodTokens?.[frame.methodId] ?? null;
      const assemblyKey = method.assemblyKey ?? image.il?.methodAssemblyKeys?.[frame.methodId];
      return {id: frame.id, name: method.asyncOrigin ? method.asyncOrigin + ' [async]' : method.qualifiedName,
        methodId: frame.methodId, source: point?.uri ?? null, line: point?.line ?? 0, column: point?.column ?? 0,
        endLine: point?.endLine, endColumn: point?.endColumn,
        point: point ? {...point} : null, pc: frame.pc, isCurrent: frame === vm.top,
        methodToken, ilOffset: image.il?.offsets?.[frame.methodId]?.[instruction] ?? null,
        ...provenance(point, assemblyKey, methodToken)};
    });
}

/** Keep direct CIL runtime addresses intact while exposing each original module/token for inspection. */
export function cilStackTrace(session, threadId, address) {
  const {vm} = session;
  return [...contextFrames(session, threadId)].reverse().map(frame => {
    const {method} = frame;
    const isCurrent = frame === vm.top;
    const before = isCurrent && (vm.state !== 'paused' || session.stoppedBeforeInstruction);
    const instruction = before ? method.instructions[frame.pc] : method.instructions.find(item => item.offset === frame.lastOffset);
    const offset = instruction?.offset ?? frame.lastOffset;
    const points = session.sourceIndex.byMethod.get(method.id) ?? [];
    const point = [...points].reverse().find(item => item.ilOffset <= offset);
    const available = point && (!session.symbols || session.symbols.location(method.token, offset));
    return {id: frame.id, name: method.owner + '::' + method.name, methodToken: method.token, ilOffset: offset,
      instructionPointerReference: address(method.token, offset), pc: frame.pc, isCurrent,
      point: available ? {...point} : null, source: available ? point.uri : null,
      line: point?.line ?? 0, column: point?.column ?? 0, endLine: point?.endLine, endColumn: point?.endColumn,
      ...provenance(available ? point : null, method.assemblyKey, method.originalToken ?? null)};
  });
}
