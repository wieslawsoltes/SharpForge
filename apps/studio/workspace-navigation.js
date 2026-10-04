function targetLocation(history, records, request) {
  const snapshot = history.snapshot();
  const members = new Set(records.map(record => record.path ?? record.uri));
  if (request.index !== undefined) {
    const location = snapshot.entries[request.index];
    if (!location) throw new RangeError('Invalid history entry');
    return members.has(location.uri) ? {location, index: request.index, snapshot} : null;
  }
  const step = request.direction === 'back' ? -1 : 1;
  for (let index = snapshot.index + step; index >= 0 && index < snapshot.entries.length; index += step) {
    const location = snapshot.entries[index];
    if (members.has(location.uri)) return {location, index, snapshot};
  }
  return null;
}

/** Serialize bounded history requests. Optional preparation precedes replay suppression and failed reads never advance history. */
export function createWorkspaceNavigation(host, {maxPending = 32} = {}) {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 10000) {
    throw new RangeError('Invalid pending navigation limit');
  }
  let generation = 0;
  let pending = 0;
  let tail = Promise.resolve();
  let controller = new AbortController();

  function current(request, context = host.context()) {
    return request.generation === generation && request.identity === context.identity && request.disk === context.disk;
  }

  function unchanged(snapshot) {
    const after = host.history.snapshot();
    return after.index === snapshot.index && after.entries.length === snapshot.entries.length &&
      after.entries.every((entry, index) => entry === snapshot.entries[index]);
  }

  async function replay(request) {
    const context = host.context();
    if (!current(request, context)) return null;
    const target = targetLocation(host.history, context.records, request);
    if (!target) return null;
    const before = host.currentLocation();
    let replaying = false;
    try {
      if (host.prepareLocation) {
        const prepared = await host.prepareLocation(target.location, {signal: request.signal});
        if (prepared === null || prepared === false || !current(request) || !unchanged(target.snapshot)) return null;
      }
      let opened;
      if (host.openLocation) {
        opened = await host.openLocation(target.location, {
          signal: request.signal,
          isCurrent: () => current(request) && unchanged(target.snapshot)
        });
      } else {
        host.setReplay(true);
        replaying = true;
        opened = await host.openFile(target.location.uri, target.location.start, target.location.end);
      }
      if (opened === null || opened === false) return null;
      if (!current(request)) return null;
      if (!unchanged(target.snapshot)) return null;
      if (before && target.snapshot.index !== target.index) host.history.update(before);
      const direction = request.direction ?? (target.index < target.snapshot.index ? 'back' : 'forward');
      const distance = Math.abs(target.snapshot.index - target.index);
      for (let step = 0; step < distance; step++) host.history[direction]();
      return host.result ? host.result(target.location, opened) : target.location;
    } finally {
      if (replaying && request.generation === generation) host.setReplay(false);
      host.renderButtons();
    }
  }

  function enqueue(target) {
    if (pending >= maxPending) return Promise.reject(new Error('Too many pending navigation requests'));
    const context = host.context();
    const request = {...target, generation, identity: context.identity, disk: context.disk, signal: controller.signal};
    pending++;
    const result = tail.then(() => replay(request));
    tail = result.then(() => undefined, () => undefined);
    return result.finally(() => {
      if (request.generation === generation) pending--;
    });
  }

  return Object.freeze({
    navigate(direction) {
      if (direction !== 'back' && direction !== 'forward') return Promise.reject(new TypeError('Invalid history direction'));
      return enqueue({direction});
    },
    go(index) {
      if (!Number.isSafeInteger(index) || index < 0) return Promise.reject(new RangeError('Invalid history entry'));
      return enqueue({index});
    },
    cancel() {
      const previous = controller;
      generation++;
      pending = 0;
      tail = Promise.resolve();
      controller = new AbortController();
      previous.abort(new DOMException('Navigation was cancelled', 'AbortError'));
      host.setReplay(false);
    }
  });
}
