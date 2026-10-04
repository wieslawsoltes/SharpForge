# Run-slot inheritance validation

Both runs passed on clean `c40e007469c60d3ad17e9756043eb5d37c904558`
(tree `881ff57e62f79136c9a34245359ccfce0a1ffad3`). The raw logs are copied
byte for byte; `manifest.json` records their hashes, the tested source hashes,
Node/V8 identity and exact results. Each journal retains the full argv, working
directory, clean status, start/end timestamps and explicit 1/1/512 controls.

- `focused.log`: 27/27 resource-limit, lease-inheritance and runner-cancellation
  tests passed, with zero failures or skips. It exercises real nested synchronous
  process spawning, independent contention, normal owner exit, abrupt owner exit,
  inherited ownership validation and old numeric-lock readability.
- `registration.log`: 3/3 selected registration tests passed, with zero failures
  or skips. The original selected-area runner path now completes beneath the
  outer limiter; serial argument validation and non-overlapping test files remain
  enforced. The argv explicitly filters out unrelated registration tests.

The waiting line in the first log comes from a private fixture testing a replaced
lock; the nested synchronous manifest fixture separately asserts that it never
waits for a second slot. No global lock was manually removed during these runs.

This is Linux x64 evidence. Other platforms retain ordinary-PID ownership and
conservative explicit recovery of dead unguarded locks; these logs do not claim
cross-platform qualification. They also do not claim a completed full A00 run,
package packing, build or product-performance result. The separately preserved
original A00 deadlock remains a failed historical attempt. Runtime files are
unchanged by this fix.
