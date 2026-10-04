const isCatch = region => region.kind === 'catch' || region.kind === 'filter-handler';

/** Advance through validated regions in instruction order, visiting each region twice without per-instruction records. */
export class ExceptionRegionCursor {
  #regions;
  #pending;
  #active = [];
  region = null;
  catches = 0;

  constructor(tree) {
    this.#regions = tree.regions;
    this.#pending = [...tree.roots].reverse();
  }

  advance(offset) {
    while (this.#active.length && this.#active.at(-1).end <= offset) {
      if (isCatch(this.#active.pop())) this.catches--;
    }
    while (this.#pending.length && this.#regions[this.#pending.at(-1)].start <= offset) {
      const region = this.#regions[this.#pending.pop()];
      this.#active.push(region);
      if (isCatch(region)) this.catches++;
      for (let index = region.children.length - 1; index >= 0; index--) this.#pending.push(region.children[index]);
    }
    this.region = this.#active.at(-1) ?? null;
  }
}
