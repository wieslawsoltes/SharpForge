# Combined compiler diagnostic review

Hosted core 37141641883 at source 125f12a reported three failing tests. No full local rerun was started.

A targeted compiler inspection of the three differential fixtures confirmed that struct constructors retain distinct field diagnostics at the same source span. The native capture in `packages/compiler/test/differential/tools/Program.cs` explicitly applies `Distinct` after projecting code/start/length/severity. The comparison now applies that same projection on both sides; diagnostic messages remain intact in the compiler. A regression checks the projection rather than hiding compiler diagnostics.

The `namespaces/file-scoped` output fixture reaches the semantic generator's explicit unsupported `typeof` expression. Its former warning-only baseline entry did not establish execution support and is removed. No execution pass is added; `typeof` emission remains a compiler/runtime capability gap.

C# 8 parsing now records `AsyncUsing` itself, so its feature gate is asserted. A generated type referenced from another document still rejects unsupported nested-record emission; the workspace regression retains that failure while checking the actual contextual grammar and parse-cache invalidation.

Hosted core 37142064324 at d0ab4bb reported zero differential regressions and one newly matching diagnostic fixture, `syntax/cs1026-missing-close-paren`. That single observed diagnostic pass is now recorded in the baseline; no other axis is changed.
