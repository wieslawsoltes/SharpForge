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

Captured catch variables and framework exception constructors outside the existing execution catalog
remain explicit frontend limitations. This change does not convert an unsupported exception constructor
into `System.Exception` or erase a typed catch to a catch-all.
