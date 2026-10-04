# Reusing managed stack accounting

The candidate preserves the default finite byte quota and every existing
preallocation admission, rollback and retirement boundary. It changes only the
internal storage used for accounting.

Frame charges use a `WeakMap`. Retirement replaces the charge with zero, allowing
a pooled frame to reuse its accounting entry. Zero is never a valid live frame
charge; repeated release is a no-op. The weak key does not keep a retired frame
or its former managed roots alive. Restore, code-epoch changes, metadata changes
and quota re-enabling still rebuild charges from the live frame inventory.

Each budget retains at most 32 inactive reservation tickets. A ticket remains
exclusive to its admission scope through all commit and rollback paths. It is
returned only from the scope's final `finally`, after temporary root cleanup.
Recycling during commit would be unsafe because a later registration failure
can still cancel the ticket while host callbacks admit nested frames.

The five scopes are ordinary CIL frame construction, ordinary source calls,
prepared CIL calls, prepared source calls and synthetic control-frame admission.
The release operation rolls back an uncommitted ticket if cleanup itself throws,
then clears its budget and byte references before caching it. Abandoned budgets
keep separate pools, so an outstanding ticket from before restore, stop, an
epoch change or disabling the quota cannot release bytes from the new budget.
Released tickets are internal scratch storage and must not be retained by callers.

The focused reservation tests cover exact quota boundaries after repeated pool
reuse, idempotent frame release, reentrant allocation failure, post-commit
registration failure with an independently live nested reservation, bounded
ticket retention, budget replacement and root-pin setup failure. Existing stack,
filter, tail-call, prepared-call, async and snapshot suites provide integration
coverage for the unchanged boundaries.

This is an unmeasured performance candidate based on published revision
`312cd9242a492ce6f03e7e034a51cc17669a7edf`. That revision's 100-pair Fibonacci result
was inconclusive against 1.5×, and its virtual-cache result missed 3×. The candidate
changes no qualification fixture, option, warmup, threshold or measurement
protocol. Syntax and diff checks are complete; execution and paired performance
validation remain pending the shared slot.
