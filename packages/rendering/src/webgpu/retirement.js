/** Destruction waits for the last submission which actually used a resource. */
export class RetirementQueue {
  constructor({onError = () => {}} = {}) {
    this.onError = onError;
    this.lastUses = new Map();
    this.pending = new Map();
    this.closed = false;
  }

  use(resource, ticket) {
    if (!resource || !ticket || !(ticket.done instanceof Promise)) {
      throw new TypeError('A resource and submission completion ticket are required');
    }
    if (this.pending.has(resource)) throw new Error('A retired resource cannot be submitted again');
    const previous = this.lastUses.get(resource);
    if (!previous || ticket.id > previous.id) this.lastUses.set(resource, ticket);
  }

  retire(resource, destroy = value => value.destroy?.()) {
    if (!resource) return Promise.resolve();
    if (this.pending.has(resource)) return this.pending.get(resource);
    const ticket = this.lastUses.get(resource);
    this.lastUses.delete(resource);
    const done = Promise.resolve(ticket?.done).catch(this.onError).then(() => destroy(resource));
    this.pending.set(resource, done);
    done.then(() => this.pending.delete(resource), error => {
      this.pending.delete(resource);
      this.onError(error);
    });
    return done;
  }

  async drain() {
    await Promise.allSettled(this.pending.values());
  }

  async dispose() {
    if (this.closed) return this.drain();
    this.closed = true;
    for (const resource of this.lastUses.keys()) this.retire(resource);
    await this.drain();
  }
}
