# Paused reverse-debugger root diagnosis

This is one bounded reproduction at clean, unchanged revision
`867fc2493620de9c375f6f01bc6b3506f70f6168`, tree
`2b7535d9daf5bd7653372bf633cfd50821929868`. The original full focused run
reported `tests/debugger.test.js` expecting zero live objects after `GC.Collect`
and observing one. This diagnostic identifies that object without changing the
program, enabling liveness pruning, changing resource limits, or editing the
running checkout.

[execution.json](execution.json) records the exact wrapper command, environment,
working directory, UTC start, duration and clean before/after identities. The run
finished with exit code 0 in 2065.491629 milliseconds under the existing 1/1/512
controls and `NODE_OPTIONS=--max-old-space-size=512`. [driver.mjs.txt](driver.mjs.txt)
retains the exact executed script as an archive text file; [roots.jsonl](roots.jsonl) preserves every
output byte. The historical executed filename and command in the raw journal remain unchanged. [manifest.json](manifest.json) records original paths, byte sizes,
and SHA-256 digests. This is a diagnostic observation, not a passing test suite.

The initial pause already contains the implicit empty `string[] args` array at
handle 0, generation 1: one object and 32 bytes. Object construction adds `N` at
handle 1, generation 2, with field value 11. Its hidden initializer temporary
`$t1` is already null. After `n=null`, only entry-argument aliases remain in the
root inventory. Explicit collection frees `N` (one object, 40 bytes), leaves its
record null, and retains only the original empty argument array. Execution is
paused at source line 4, before `Console.WriteLine(0)`; it is not terminal.

This **falsifies the initial static hypothesis** that an uncleared compiler
Sequence temporary retained `N`. No compiler or runtime repair is justified by
this result. The entry-argument contract is explicit in
`packages/compiler/src/codegen/entry-startup.js` and
`packages/runtime/src/execution/entry-arguments.js`: top-level statements receive
`args`, whose managed array stays rooted through entry-frame locals.

The separate test correction `4d7eaaf51d691e14d3d22bb736f2ac70e861d59f`
keeps the original guest and reverse-step scenario. It checks the exact initial
argument-array baseline, the collected `N` handle, restoration of that same
managed identity and field value 11, and unchanged entry arguments. Syntax and
whitespace checks passed; that revised test had not been executed when this
archive was written. The original failed focused result remains failed evidence.
