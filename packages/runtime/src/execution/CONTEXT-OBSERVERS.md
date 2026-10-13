# Managed context completion observers

`ContextCompletions` is an internal dependency of acknowledged UI decisions. It
accepts an owner with a `contexts` map and observes each context's explicit
`completed`, `faulted`, or `canceled` status. A waiting or suspended context does
not complete an observation. The scheduler remains responsible for executing,
suspending, resuming, and retiring its managed frames.

`wait(id, {signal})` resolves with `{id, status}` on successful completion and
rejects with the original fault or a cancellation error otherwise. Unknown
identities fail immediately. At most 4,096 observers may be pending; an embedding
may select a smaller positive limit. Completion removes listeners and entries
before resolving a Promise, so repeated completion notifications have no effect.

Aborting an observation releases only that native waiter. It does not cancel the
managed context or change ownership of managed continuations. `cancelAll()` ends
external observations at rewind, shutdown, or session replacement. It does not
replay an external browser action after restoration.

The scheduler integration calls `complete(context)` at terminal lifecycle
boundaries and `cancelAll()` when external decisions become stale. There is no
per-instruction polling or duplicate continuation executor. An independent
publication stage can include this injected component before activating the
managed UI request service.

The authored fixture `tests/a16-context-completions.test.js` covers suspension,
one-shot resolution, preserved faults, quota and identity errors, abort, rewind,
and released listeners. Exact-branch validation belongs to the consolidated
completed-scope gate; the presence of this fixture does not claim a test run.
