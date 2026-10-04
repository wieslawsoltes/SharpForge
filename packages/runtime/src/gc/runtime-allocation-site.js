/** Sampled-only source lookup. Cached entries contain code metadata, never managed values. */
export class RuntimeAllocationSite {
  constructor(vm) {
    this.vm = vm;
    this.points = null;
    this.byMethod = new Map();
  }

  cilPoint(frame) {
    const points = this.vm.inspector.debug?.sequencePoints;
    // Loading Portable PDBs or replacing code publishes a new point array.
    if (points !== this.points) {
      this.points = points;
      this.byMethod.clear();
      for (const point of points ?? []) {
        let method = this.byMethod.get(point.methodToken);
        if (!method) this.byMethod.set(point.methodToken, method = []);
        method.push(point);
      }
      for (const method of this.byMethod.values()) method.sort((a, b) => a.ilOffset - b.ilOffset);
    }
    const method = this.byMethod.get(frame?.method.token) ?? [];
    let low = 0, high = method.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (method[middle].ilOffset <= frame.lastOffset) low = middle + 1;
      else high = middle;
    }
    const point = method[low - 1];
    return point && !point.hidden ? point : null;
  }

  capture() {
    const frame = this.vm.top;
    const method = frame?.method ?? this.vm.image?.methods[frame?.methodId];
    return {methodToken: method?.token ?? method?.id ?? null, ilOffset: frame?.lastOffset ?? null,
      sequencePoint: this.vm.inspector ? this.cilPoint(frame) : frame?.point ?? this.vm.currentPoint ?? null,
      methodName: method?.qualifiedName ?? method?.name ?? null};
  }
}
