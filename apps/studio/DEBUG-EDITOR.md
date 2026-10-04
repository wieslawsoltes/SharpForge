# Debugger editor presentation

This batch composes the verified source-identity helpers from `DEBUG-SOURCES.md`.
Workspace breakpoint anchors retain the user's paths and requested lines, while
runtime requests carry the selected assembly-qualified execution URI.

- `debugBreakpointRows(state)` matches source rows against that execution identity
  and retains existing function, data, and instruction breakpoint rows.
- `decorateDebugEditors(host)` paints only source text matching the executing
  snapshot. It converts line/column locations using each editor's source snapshot,
  preserves UTF-16 offsets across CRLF and surrogate pairs, and keeps selected
  caller highlights distinct from the current instruction.
- `createSourceBreakpointController(host)` provides `toggle`, `sync`, and `edit`.
  Source anchors remain stable when binding moves a requested line. Successful
  responses and failures are admitted only for the captured runtime session and newest request.
  Persisted requests survive cancellation or an unavailable runtime.
- `updateDebugStopBanner(host)` retains the executable URI, stop phase, caller,
  source-match, and muted-breakpoint explanations. Escaped text and a content key
  avoid unsafe or redundant DOM updates. Existing next-statement/settings actions
  remain attached.

The legacy `DebuggerTools` delegates only row construction and banner rendering;
its other behavior is unchanged and the frozen file shrinks. Editor painting and
breakpoint callback registration in the protected Studio entry are owned by the
application integration batch. These helpers already form a usable standalone
host contract and introduce no runtime dependency.

Qualification reuses the completed Node 22.23.3 source cohort at `4a49a23b`: six
editor/controller cases, three banner cases, and the unchanged frame/row/source
integration case passed. The aggregate retained six unrelated failures among 794
cases (788 passed); no new broad qualification was started for this projection.
The inherited five pure source-model tests remain registered. Worker source
publication and assembly graph execution stay in their separate runtime batch.

A projection audit found that a superseded request's rejection could still report
an error after the success path was fenced. The matching session/request guard
now applies to failures too; the current request's error is still reported. The
new rejection regression is staged with the equivalent root correction and awaits
the parent's scheduled qualification. Its result is not included in the prior
passed-case count.
