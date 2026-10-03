# SharpForge 0.9.0 — exact debugger locations and stop workflows

Built from the uploaded 0.8.0 source. This is a development preview, not complete C#/CLR/MSBuild/Visual Studio parity. No GitHub or package-registry publication was performed.

## Reported problem and fixes

The Fibonacci screenshot's line-16 `Paused – entry` was caused by an unconditional entry stop. **F5 now runs to the requested breakpoint**; F10/F11 from idle request entry explicitly and the settings tool offers an opt-in entry preference. The reported line-20 breakpoint is tested through ten Fibonacci iterations before output at each stop.

Actual independent bugs were repaired, not just the entry policy: multiline requests binding to the next statement, closing braces binding into the next method, caller writes inheriting a callee's last point, after-write resume skipping the next source breakpoint, mutable exception state corrupting reverse snapshots, and repeated Continue requests consuming multiple stops. Disabled instruction breakpoint flags are retained when neighboring disassembly rules are edited and on restart.

Compiler-generated sequence spans now bound control-flow headers and persist method ranges/accessor flags in #SF. A shared source index reports exact UTF-16 spans and executable locations. The editor paints those spans, preserves red breakpoint dots alongside execution arrows, and differentiates selected caller (blue) from actual execution (yellow). CRLF/UTF-16 mapping and mismatched compiled source are tested. Missing PDB/source metadata is never replaced by guessed decompiled-source mappings.

## Debugging additions

The unified Breakpoints tool manages source, function, write and instruction entries with stable IDs, true/changed conditions, encounter-count filters, logpoints, one-shot rules and global mute. Function signatures bind parameters and stop once per invocation. Live changes retain unchanged counters and deliberately reset changed-rule seeds. Run-to targets respect frame identity and cancel at intervening stops. Source accessor stepping is configurable.

Two independent docking tools bring the total to **29**: **Debugger / Exception Settings** and **Immediate**. The stop banner reports reason, before/after phase, current position and selected caller. Show Next Statement returns to execution. Immediate performs bounded selected-frame, side-effect-free reads; it does not call methods/getters or execute arbitrary C# statements. Exception settings add managed-type overrides to none/all/uncaught policies.

Source and direct-CIL reverse replay restore retained managed state and breakpoint counters/condition observations. Deep exception copies, post-write checkpoints, monotonic identities, session ownership, generation guards and single-flight execution requests prevent stale control state crossing stops or launches. History is optional/bounded, estimates host storage, and cannot undo external callbacks.

The DAP adapter now honors configurationDone before execution, defaults to run-to-breakpoint, handles client zero/one-based coordinates, and reports loaded sources, executable breakpoint locations, bound changes and hit IDs. Source storage/reverse requests join existing direct-IL requests. Bad replacement launches preserve the live session and unhandled managed failures exit nonzero. External IDE/native debugging is not qualified.

## Examples and deliverables

Five new Studio examples cover exact/multiline stops, callsite writes, changed-value conditions, function signatures and exception cleanup. **37 Studio examples** now include **36 runnable cases** and one intentional diagnostic case. DebuggerWorkshop supplies .csproj/.slnx and multi-file source. All five run through the internal VM, canonical CIL reload, direct CIL and IL export/reassembly tests, plus both debugging engines and browser workers.

The release includes 17 independent npm tarballs, browser build and self-contained HTML with two real workers. Visual Studio remains the default keyboard profile; existing offline Vim/Emacs/Sublime/VS Code alternatives and native project/file tools are retained.

## Verification and boundaries

See [validation-0.9.0.md](validation-0.9.0.md), [debugger guide](debugger.md), and the per-suite JSON/TAP reports. Native HTTP page navigation was attempted but blocked by runner policy; production-worker browser checks therefore use the documented in-memory harness. Native SDK/CLR/PDB execution, external IDE clients, broad third-party DLL compatibility, durable browser storage and native OS dialogs are not newly qualified.

This release focuses on debugger correctness and workflow. It does not add native process attachment, Portable PDBs, async/thread stacks, hot reload, arbitrary function evaluation, complete language/runtime semantics or pixel-exact Visual Studio compatibility. Source reverse snapshots are retained source/control checkpoints, direct IL snapshots are instruction checkpoints; neither is full-system time travel.
