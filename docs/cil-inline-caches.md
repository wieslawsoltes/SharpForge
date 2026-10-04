# Bounded CIL call-site caches

Direct CIL virtual and interface calls now retain a small set of receiver
MethodTable identities and resolved method tokens per calling method and IL offset.
The first receiver uses one entry; further receiver types extend the site up to
four entries by default. Encountering a fifth distinct type clears those entries
and makes the site megamorphic: later calls use the existing virtual/interface
dispatcher without growing the site. No receiver objects or managed handles are
stored in the cache.

`inlineCacheSize` accepts integers from 1 through 16 and is validated when the
first virtual site executes. `inlineCaches: false` bypasses the cache. Null checks,
live heap-record validation, verified-target membership, argument normalization
and ordinary frame entry/return remain on their existing execution paths. Cache
misses and megamorphic sites call `CilTypeSystem.virtualTarget`, preserving its
virtual-slot and interface-map rules, including any dispatcher-specific rejection.

Sites belong to the token/decode code epoch. Successful restore, stop, explicit
`invalidateExecutionCode`, inspector replacement and MethodTable registry changes
discard them. Rejected restores and rejected Hot Reload updates preserve them.
Replacing a method's instruction array discards its sites, and changing a site's
operand or declaration identity resets that site. In-place metadata changes still
require the existing explicit invalidation/replacement contract. Snapshots store
no site maps, handler functions or receiver identities.

The prepared regressions use independently authored CLI virtual/interface metadata
and real execution with caches both enabled and disabled. They cover repeated,
polymorphic and megamorphic receivers, capacity boundaries, invalid settings,
null/wrong/collected receivers, dispatch-hook counts, independent VMs, one-instruction
budgets, snapshot replay and actual instruction-breakpoint Hot Reload. Internal
`inlineCacheStatistics` reports entries/hits/misses/megamorphic status without
exposing cached metadata.

Serial validation at `a0365151` passed all 56 tests across inline-cache,
virtual-slots, B03 dispatch, token-cache, decode-plan and method-events suites
under Node 24.21.0, one worker and a 512 MB heap cap. Static/manifests and
build validation use the required core check. Benchmarks remain staged.
The focused command is:

```sh
node scripts/limited.js node --test tests/a05-inline-cache.test.js tests/a05-b03-dispatch.test.js tests/a05-token-cache.test.js tests/a05-decode-plan.test.js tests/a05-cil-method-events.test.js
```

This is an independently useful T07.2 implementation increment. The issue's
required 3× virtual-call benchmark speedup has not been measured or claimed.
Browser/native qualification and full T07 acceptance remain open. Source dispatch,
generic/constrained virtual calls and unsupported external virtual declarations
retain their existing limits.
