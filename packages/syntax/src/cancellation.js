/**
 * Cooperative cancellation for lexing and parsing. JavaScript runs a parse to completion on one thread, so a token is
 * polled: the scanner checks it every 256 tokens and the parser every 256 nested constructs, and a requested
 * cancellation throws OperationCanceledError. A token is cancelled by calling cancel() (from a callback the parse
 * reaches, such as `poll`), by a deadline, or from another thread through a shared Int32Array flag.
 * Caches stay consistent after a cancelled parse: they only ever hold complete immutable tokens and nodes.
 */
export class OperationCanceledError extends Error {
  constructor(message = 'The operation was canceled.') { super(message); this.name = 'OperationCanceledError'; this.code = 'OperationCanceled'; }
}
export class CancellationToken {
  #cancelled = false; #deadline; #flag; #index; #poll;
  /** Options: `deadline` (a performance.now() time), `flag` and `index` (a shared Int32Array cell that is non-zero once cancelled), `poll` (a function returning true to cancel). */
  constructor({ deadline, flag, index = 0, poll } = {}) { this.#deadline = deadline; this.#flag = flag; this.#index = index; this.#poll = poll; }
  /** A token that is cancelled `milliseconds` from now. */
  static timeout(milliseconds) { return new CancellationToken({ deadline: performance.now() + milliseconds }); }
  /** A token cancelled by storing a non-zero value in `flag[index]`, typically an Int32Array over a SharedArrayBuffer written by another thread. */
  static fromSharedFlag(flag, index = 0) { return new CancellationToken({ flag, index }); }
  cancel() { this.#cancelled = true; }
  get isCancellationRequested() {
    if (this.#cancelled) return true;
    if (this.#deadline !== undefined && performance.now() >= this.#deadline || this.#flag && Atomics.load(this.#flag, this.#index) !== 0 || this.#poll && this.#poll() === true) this.#cancelled = true;
    return this.#cancelled;
  }
  throwIfCancellationRequested() { if (this.isCancellationRequested) throw new OperationCanceledError(); }
}
/** Tokens or nested constructs processed between two polls of a cancellation token. */
export const cancellationInterval = 256;
