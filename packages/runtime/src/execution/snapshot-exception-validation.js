import {snapshotInteger as integer, invalidSnapshot as fail, snapshotFault} from './snapshot-validation-helpers.js';

const methodFor = (vm, frame) => vm.inspector ? frame.method : vm.image.methods[frame.methodId];
const limitFor = (vm, method) => vm.inspector ? method.codeSize : method.code.length / 3;

function instructionOffset(vm, frame, offset, {end = false} = {}) {
  const method = methodFor(vm, frame), limit = limitFor(vm, method);
  return integer(offset) && offset <= limit && (offset === limit ? end : !vm.inspector || frame.offsets.has(offset));
}

function knownHandler(vm, frame, handler, {cleanup = false} = {}) {
  const method = methodFor(vm, frame);
  if (!handler || typeof handler !== 'object' || Array.isArray(handler)) fail('exception handler state');
  const keys = Object.keys(handler);
  const matched = (method.handlers ?? []).find(candidate => keys.length === Object.keys(candidate).length &&
    keys.every(key => Object.hasOwn(candidate, key) && Object.is(handler[key], candidate[key])));
  if (!matched || cleanup && !(vm.inspector ? matched.flags === 2 || matched.flags === 4 : matched.kind === 'finally')) {
    fail('exception handler code identity');
  }
  return matched;
}

function validateSearch(vm, snapshot, frames, search) {
  if (!search || typeof search !== 'object' || !Array.isArray(search.frames) || !(search.locations instanceof Map) ||
      !integer(search.cursor) || search.cursor > search.frames.length || !integer(search.clause) ||
      search.clauses !== null && !Array.isArray(search.clauses)) fail('exception search state');
  snapshotFault(search.error);
  if (!search.error || search.frames.length > snapshot.frameId || search.locations.size !== search.frames.length) fail('exception search inventory');
  const identities = new Set();
  for (const location of search.frames) {
    if (!location || !integer(location.id) || location.id < 1 || location.id > snapshot.frameId ||
        identities.has(location.id) || !integer(location.offset) || search.locations.get(location.id) !== location.offset) {
      fail('exception search location');
    }
    identities.add(location.id);
    const frame = frames.get(location.id);
    if (frame && !instructionOffset(vm, frame, location.offset, {end: true})) fail('exception search instruction');
  }
  if (search.clauses === null) {
    if (search.clause !== 0) fail('exception search clause cursor');
  } else {
    if (search.clause > search.clauses.length || search.cursor === search.frames.length) fail('exception search clause cursor');
    const frame = frames.get(search.frames[search.cursor].id);
    if (frame) for (const handler of search.clauses) knownHandler(vm, frame, handler);
  }
  if (search.selection !== null) {
    const selection = search.selection, frame = frames.get(selection?.frameId);
    if (!frame || !['catch', 'initializer', 'filter-failure', 'event-failure', 'event-failfast'].includes(selection.kind)) {
      fail('exception search selection');
    }
    if (selection.kind === 'catch') knownHandler(vm, frame, selection.handler);
    if (selection.kind === 'initializer' && !frame.initializes || selection.kind === 'filter-failure' && !frame.filterSearch ||
        selection.kind === 'event-failure' && frame.exceptionEventContinuation?.phase !== 'unhandled') fail('exception search selection owner');
    if (selection.kind === 'event-failfast' && (frame.exceptionEventContinuation?.phase !== 'firstChance' ||
        frame.exceptionEventContinuation.failurePolicy !== 'after-unwind')) fail('exception failfast boundary');
  }
}

/** Pending cleanup and filter searches retain their original fault, handler and frame identities. */
export function validateSnapshotExceptions(vm, snapshot, frames) {
  const searches = new Set();
  const visitSearch = search => {
    if (searches.has(search)) return;
    searches.add(search);
    validateSearch(vm, snapshot, frames, search);
  };
  for (const frame of frames.values()) {
    if (frame.caught !== undefined && !Array.isArray(frame.caught) || frame.unwinds !== undefined && !Array.isArray(frame.unwinds)) {
      fail('exception frame storage');
    }
    for (const caught of frame.caught ?? []) {
      if (!caught || !instructionOffset(vm, frame, caught.start) || !instructionOffset(vm, frame, caught.end, {end: true}) ||
          caught.end <= caught.start) fail('exception catch bounds');
      snapshotFault(caught.fault);
      if (!caught.fault) fail('exception catch fault');
    }
    if (vm.inspector && (frame.pending ?? null) !== (frame.unwinds?.at(-1) ?? null)) fail('exception pending unwind alias');
    for (const unwind of frame.unwinds ?? []) {
      if (!unwind || !Array.isArray(unwind.handlers) ||
          !(vm.inspector ? ['leave', 'exception'] : ['return', 'jump', 'exception']).includes(unwind.kind)) fail('exception unwind state');
      for (const handler of unwind.handlers) knownHandler(vm, frame, handler, {cleanup: true});
      if (unwind.active) knownHandler(vm, frame, unwind.active, {cleanup: true});
      if (['leave', 'jump'].includes(unwind.kind) && !instructionOffset(vm, frame, unwind.target)) fail('exception leave target');
      if (unwind.kind === 'exception') {
        snapshotFault(unwind.error);
        if (!unwind.error || !unwind.search || unwind.error !== unwind.search.error) fail('exception unwind fault alias');
        if (unwind.catch) knownHandler(vm, frame, unwind.catch);
        visitSearch(unwind.search);
      }
    }
    if (frame.filterSearch !== undefined && frame.filterSearch !== null) {
      const owner = frames.get(frame.filterOwnerId);
      if (!owner || methodFor(vm, owner) !== methodFor(vm, frame)) fail('exception filter owner');
      const handler = knownHandler(vm, owner, frame.filterHandler);
      if (vm.inspector ? handler.flags !== 1 : handler.filter === undefined) fail('exception filter handler');
      visitSearch(frame.filterSearch);
      const location = frame.filterSearch.frames[frame.filterSearch.cursor];
      if (location?.id !== owner.id) fail('exception filter search owner');
    }
  }
}
