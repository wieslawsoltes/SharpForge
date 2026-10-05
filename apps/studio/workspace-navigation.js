function targetLocation(history, records, direction) {
  const snapshot = history.snapshot();
  const members = new Set(records.map(record => record.path ?? record.uri));
  const step = direction === 'back' ? -1 : 1;
  for (let index = snapshot.index + step; index >= 0 && index < snapshot.entries.length; index += step) {
    const location = snapshot.entries[index];
    if (members.has(location.uri)) return {location, index, snapshot};
  }
  return null;
}

/** Serialize bounded history requests across lazy opens. Failed reads do not advance history. */
export function createWorkspaceNavigation(host, {maxPending = 32} = {}) {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 10000) {
    throw new RangeError('Invalid pending navigation limit');
  }
  let generation = 0;
  let pending = 0;
  let tail = Promise.resolve();

  function current(request, context = host.context()) {
    return request.generation === generation && request.identity === context.identity && request.disk === context.disk;
  }

  async function replay(request) {
    const context = host.context();
    if (!current(request, context)) return null;
    const target = targetLocation(host.history, context.records, request.direction);
    if (!target) return null;
    const before = host.currentLocation();
    host.setReplay(true);
    try {
      await host.openFile(target.location.uri, target.location.start, target.location.end);
      if (!current(request)) return null;
      const after = host.history.snapshot();
      if (after.index !== target.snapshot.index || after.entries.length !== target.snapshot.entries.length ||
          after.entries.some((entry, index) => entry !== target.snapshot.entries[index])) return null;
      if (before) host.history.update(before);
      const distance = Math.abs(target.snapshot.index - target.index);
      for (let step = 0; step < distance; step++) host.history[request.direction]();
      return target.location;
    } finally {
      if (request.generation === generation) host.setReplay(false);
      host.renderButtons();
    }
  }

  return Object.freeze({
    navigate(direction) {
      if (direction !== 'back' && direction !== 'forward') return Promise.reject(new TypeError('Invalid history direction'));
      if (pending >= maxPending) return Promise.reject(new Error('Too many pending navigation requests'));
      const context = host.context();
      const request = {direction, generation, identity: context.identity, disk: context.disk};
      pending++;
      const result = tail.then(() => replay(request));
      tail = result.then(() => undefined, () => undefined);
      return result.finally(() => {
        if (request.generation === generation) pending--;
      });
    },
    cancel() {
      generation++;
      pending = 0;
      tail = Promise.resolve();
      host.setReplay(false);
    }
  });
}
