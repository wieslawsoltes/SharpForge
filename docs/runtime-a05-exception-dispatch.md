# Two-pass exception dispatch (T04.1/T04.4)

The first pass visits all throwing-context frames before running any cleanup. Filter frames share their declaring frame's locals/arguments while younger frames remain alive, so filter side effects and reads occur before inner finally/fault handlers. A selected catch starts the second pass. Handler flag 4 runs only for exceptional exits; ordinary leave executes flag 2 finally clauses.

An explicit trampoline advances search, unwind and initializer-boundary transitions. Frame lookup is indexed and unwind locations are captured once, making traversal linear in frame count rather than repeatedly scanning the call stack. Executing a selected handler yields back to the normal interpreter loop. Filter exceptions that escape their helper calls resume the original search with a false decision.

When no handler is found, the fault records phase `unhandled` and the throwing frames remain intact for debugger inspection. No second-pass cleanup runs in this state. The VM reports the signed CLR managed-exception process status `0xe0434352`; native runner reporting must additionally record host-specific exit/signal behavior rather than equating POSIX signals with a guest numeric status. Stop/reset releases retained inspection state. A task-owned failure may complete its task and release its frames; a process-unhandled failure retains them.

Focused fixtures cover original filter ordering, unhandled local/heap visibility, restored inspection state and a 10,000-frame caught unwind. Native cleanup-order fixtures and source parity are assembled with the T04.4/T04.6 slices. Execution and performance validation are deferred until the complete E01 scope is assembled.
