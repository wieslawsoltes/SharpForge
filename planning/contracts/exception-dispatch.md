# Exception dispatch

Required portable model: first search handlers from the throw site through caller frames, evaluate filters in order without unwinding, then unwind inner-to-outer finally/fault regions to the selected handler. Fault clauses run only on exceptional exit; finally runs also on leave/return. Rethrow keeps the original exception and stack origin. A throw during unwind replaces the outgoing exception and restarts search; a catch wholly inside the active finally preserves its original continuation.

Current source VM handleFault/resumeUnwind and CIL raise/resumeUnwind execute catch/finally for the verified subset. They do not implement a general two-pass filter search. Filter/fault clauses are inspection-only in the current CIL execution profile. This is an explicit unsupported boundary, not native CLR parity.

A parked await records the task dependency and continuation frames. Resuming a fault routes through beforeInstruction into normal dispatch. HostOperations catches JS callback/convert failures and completes the managed task with a managed error; observer callback errors are recorded as lastExternalObserverError and do not corrupt task completion. A host callback must retain borrowed references through any reentry/GC.

Expected handler order fixtures: nested-finally = inner, catch, outer; rethrow = rethrow, first; await-fault = await-catch, await-finally; nested-fault = terminal second exception. Host callback rejection becomes faulted task; disposal creates canceled task. These are run on both JS VMs; Rust/native filters remain unqualified.
