# Managed stack byte budgets (T02.10)

`maxStackBytes` limits each cooperative execution context independently. The default is 1 MiB. These are deterministic logical managed bytes, not measured JavaScript heap consumption. A frame costs a 16-byte header, eight bytes per maximum evaluation-stack slot, and its argument/local storage rounded up to eight-byte slots. Source locals already include parameters. A value type occupies its full declared layout; a reference occupies one slot. The optional legacy `maxFrames` setting remains an explicit additional limit, with no default depth cap.

Admission is atomic and happens before a frame becomes live. Returning, unwinding, finishing a filter and replacing an eligible tail frame release its bytes and its managed-pointer lifetime. Budget exhaustion raises a runtime-origin fatal `StackOverflowException`; a guest catch cannot intercept it. Each parked scheduler context keeps its own budget, so waiting tasks do not consume another context's stack allowance.

`frame.stackBytes` and `frame.stackContextId` describe captured execution state. `vm.stackBudget` and the live-frame index are derived counters, excluded from snapshots and rebuilt after restoration. Snapshot preflight recomputes costs from method metadata and rejects forged costs or over-budget stacks before mutation.

The focused fixture calls a small recursive method 10,000 times on both engines. Boundary tests cover exact admission, one-byte overflow, duplicate release, fatal catch bypass and parked-context accounting. Execution and native/performance qualification are deferred until the complete E01 scope is assembled; this document records no passing results or performance claim.
