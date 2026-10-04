# A18 compiler-result presentation follow-up

Task: SF-A18-T04.1 (#1682). This is a targeted Studio correction for the retained
3,000-line source-analysis browser failure. It does not change the 16 ms budget,
the browser fixture, or the source/worker functional assertions.

## Observed work

The coordinator's `browser-source-latency-02` receipt at `a5c1ad3a` retained passing
stale-request, latest-source/preview and trusted-input checks before failing the
renderer budget: maximum 46.094 ms, 32 tasks over 16 ms out of 303, p95 18.917 ms.
The worker-reply task included 10.52 ms of HTML parsing. Read-only code inspection
confirmed that every accepted analysis unconditionally rebuilt the hidden
bytecode method selector and generated-source view.

The coordinator then captured `diagnostic-source-profile-01` at `10fa4311`, with
1 ms CPU sampling and the unchanged interaction. Inside its
`a18-source-analysis-start`/`a18-source-analysis-end` trace marks, sampled totals
included 168.8 ms in Studio `onChange`, 105.1 ms in Solution Explorer rendering,
35.1 ms in tool rendering during analysis, and 11.0 ms in breakpoint remapping.
These instrumented cumulative samples identify work; they are not acceptance
latencies or before/after performance claims. Solution Explorer is a separate
coordinated correction.

## Implementation and boundaries

The existing ToolRegistry now owns the two result presentations through its
per-mount state and disposal callbacks. Hidden, detached or parked result tools
retain current Studio state without reading methods, decoding an assembly, or
building DOM. The existing docking subscription and owner-document
ResizeObserver refresh them on actual visibility. Other tools keep their
existing renderer and visibility behavior.

Visible bytecode updates retain the complete native method selector. Unchanged
method ID/name values reuse its index and options; build status, format,
selected method and current instruction continue to update. Changed images
invalidate instruction data. The existing public result/getter aliases remain
mutable: generated-file URI/text and method labels are compared by value, while
decoded selected-method words and referenced point labels have an owned cache
of at most 12,288 words. Larger methods use fresh rendering instead of retaining
an incomplete cache. Explicit tool activation invalidates CIL inspection, so an
in-place edit of the public assembly bytes appears when the tool is reopened.
CIL and decoded VM data still come from their
public package disassemblers, and sequence-point activation reads the current
source map. Equal generated-source snapshots keep their DOM, scroll and expanded
state; changed text and removed files are reflected when visible. The cache is
owned by the mounted tool and released on disposal.

The debugger change preserves the public `remapSourceBreakpoints` contract. It
validates all arguments before returning a fresh empty array for empty requests.
Nonempty requests keep the existing anchor algorithm, now extracted from the
frozen legacy file into a readable module. This is the only debugger-package
change and must be listed under changes outside A18 in the curated PR.

Initial visible rendering remains proportional to the method inventory or
generated source size. Selected-method disassembly remains proportional to that
method, and first CIL inspection uses the existing assembly inspector. This
change does not claim a universal sub-16 ms first opening time.

## Prepared validation

- `tests/a18-result-presentation.test.js`: actual compiler/assembly output,
  2,000-method option identity, hidden/latest/visible transitions, CIL and decoded
  instruction parity, source navigation, live status and selection, generated
  text retention, unrelated-tool behavior, and complete observer/handler cleanup.
  Direct alias mutation tests cover generated arrays, method names, instruction
  words, source points, the selected-method cache bound and assembly-byte reopen.
- `tests/a18-breakpoint-remap-empty.test.js`: empty large-source requests,
  retained invalid-input errors, nonempty anchors, metadata and snapshots.
- Existing `tests/release08-breakpoints.test.js` remains unchanged.

No test, static check, build, benchmark or browser run was executed in this
worktree. The coordinator owns the combined validation slot and the unchanged
production source-latency rerun. The prior failed receipts remain failed.
