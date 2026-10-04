/** A deliberately small injected owner isolates native value-model contracts from visual rendering. */
export function compositionOwner() {
  let serial = 0;
  return {
    closed: false,
    objects: new Map(),
    changes: [],
    animations: {stop() {}, stopAll() {}},
    allocate(object) { const id = ++serial; this.objects.set(id, object); return id; },
    invalidate(object, property) { this.changes.push({object, property}); },
    forget(object) { this.objects.delete(object.id); },
    link() {}
  };
}
