import { loadError, LoadErrorCode } from '../load-errors.js';

/** One lazy context subscription shared by bounded in-flight generic traversals. */
export class GenericContextLifetime {
  #context;
  #maximum;
  #operations = new Set();
  #unsubscribe;

  constructor(context, maximum) {
    this.#context = context;
    this.#maximum = maximum;
  }

  get isUnloading() { return this.#context.isUnloading; }

  add(operation) {
    if (this.#operations.has(operation)) return this;
    if (this.#operations.size >= this.#maximum) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Concurrent generic lifetime observation limit exceeded');
    }
    if (this.#context.isUnloading) {
      operation.invalidate();
      return this;
    }
    if (!this.#unsubscribe) {
      try {
        this.#unsubscribe = this.#context.onUnloading(() => {
          for (const current of this.#operations) current.invalidate();
        });
      } catch (error) {
        if (error instanceof RangeError) throw loadError(LoadErrorCode.LimitExceeded, 'Generic context subscription capacity exceeded');
        throw error;
      }
    }
    this.#operations.add(operation);
    return this;
  }

  release(operation) {
    this.#operations.delete(operation);
    if (!this.#operations.size && this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = undefined;
    }
  }
}
