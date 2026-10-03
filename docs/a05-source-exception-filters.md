# Source typed catches and exception filters

The source adapter, legacy method compiler, bound pipeline and semantic lowering retain the exception type
and optional `when` expression. Catch variables have their declared type. Semantic catch ordering and the
BCL exception hierarchy come from the A02 T44 binding implementation, rather than a second runtime-specific
copy of those language rules.

A source catch descriptor has `{start, end, target, handlerEnd, slot, type, filter?}`. `type` is the full CLI
name, including `System.Exception`. A filtered handler's `filter` points to code emitted immediately before
its body; `Op.ENDFILTER` (45) consumes the filter result. Both filter and body begin with an empty operand
stack and an initialized exception local. `handlerEnd` excludes the next filter or handler. The runtime
performs the search pass before unwinding finally blocks, and treats a throwing filter as false.

The bound tree stores the filter as a child before its catch body. Rewriting visits it, and flow analysis
checks its reads and passes the accepted condition's assignment state to the body. Filter side effects
execute through shared locals in the runtime filter frame.

`tests/a05-source-filter-binding.test.js` covers both emission pipelines, definite assignment and bound-tree
visitation. `tests/a05-source-filters.test.js` in the parent E01 integration supplies runtime parity and
portable replay cases. These E01 cases have not been executed during assembly.

Captured catch variables reuse closure cells. A filtered catch initializes its cell before the filter,
then shares it with its body and any escaping delegates. Existing BCL exception symbols now attach exact
constructor/member signatures from the shared exception execution catalog. Source construction preserves
the derived type, message and inner chain; `StackTrace`, `HResult` and `GetBaseException` use the CIL runtime's
existing implementation. The source emitter and reload adapter use those same signatures.

`tests/a05-source-exception-objects.test.js` prepares matching-catch, inner-chain, trace and captured-derived
exception cases for the three execution paths. These cases remain unexecuted until the E01 qualification gate.
Constructors outside the finite catalog, including parameter-name/object-name overloads whose semantics
differ from the message constructor, still report a profile diagnostic. Unsupported constructors are never
converted to `System.Exception`, and typed catches are never erased to catch-all handlers.
