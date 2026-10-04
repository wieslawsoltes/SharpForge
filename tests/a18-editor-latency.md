# A18 editor source-latency repair

## Reproduced input and scope

The root-owned `browser-source-latency-01` receipt at `d347974eaead90494fd46f6c7d7e4050d812d36d`
reported complete worker/cancellation/source-preview functional assertions before the renderer budget failure.
It recorded a 127.615 ms renderer maximum with 39 tasks over 16 ms. Individual native editor input listeners
occupied roughly 70–93 ms. The final syntax overlay contained 35 lines, 579 runs and 1,508 source characters
from a 3,000-line, 156,491-character source file, so this change reuses the existing viewport.

The synchronous editor path recreated the lexer, all syntax runs and the bracket map for each source revision.
The Studio onChange callback could call `setDiagnostics` and paint before the editor's own subsequent paint;
both invalidated and replaced the same visible markup. This repair extracts the frozen editor renderer and
uses public `SourceText.withChange`, `relexTokens` and `TokenList` APIs. Whole token arrays and runs remain
available to explicit callers, while normal rendering consumes visible runs. Matching queries have a
linear fallback to avoid quadratic work on unmatched or deeply nested delimiter input.

Studio symbol and hidden-outline presentation is a separate coordinated change. The 119.5 ms worker
`HandlePostMessage` frame included roughly 9 ms ParseHTML, 15.5 ms UpdateLayoutTree over 8,972 elements,
and 12.6 ms Layout over 10,656 objects. This editor change alone does not establish that frame's resolution.

## Prepared regression evidence

- `a18-editor-incremental-highlight.test.js`: 3,000-line bounded literal rescan and distant-token identity;
  independent complete lexer comparison; CRLF/UTF-16 line positions; comments, raw strings and conditional
  preprocessing transitions; matching/mismatched delimiters; full snapshot compatibility; invalid hints;
  lexical fallback and URI isolation. A read-only review reproduced quote deletion moving a cached code
  pair into a literal despite equal bracket-kind sequences; its exact regression requires cache endpoints
  to remain outside the complete rescanned window, not merely outside the raw edit span.
- `a18-editor-viewport-lifecycle.test.js`: actual exported CodeEditor with an explicit DOM/input boundary;
  one changed-input paint through reentrant diagnostics; unchanged node identity; live severity and execution
  updates; viewport/scroll/resize, caret and gutter fidelity; offscreen edit reuse; document switching;
  disposal with an already queued ResizeObserver notification.
- Existing `release05-editor-refactoring.test.js` and `release06-editor-refactoring.test.js` remain unchanged
  and cover the released editor operation and source-faithful viewport contracts.

The test fixture records actual assignments at the DOM boundary. It does not replace production syntax,
editor methods, SourceText, callbacks or highlight results. The browser 16 ms assertion and its measured
workload remain unchanged. These new tests, existing regressions and the production source-latency browser
case are **prepared but unrun by this branch**; root owns the serial validation slot and raw receipts.
No passing latency claim or before/after speedup is made here.

## Upstream editor integration

The description above records the original A18 textarea repair. Upstream `7bd1239a` replaces that editor
with a persistent `EditorModel`, hidden native input and `VirtualEditorView`. The integration carries
snapshot identity, incremental lexical reuse and bounded unchanged-row reuse into those components;
the obsolete private textarea renderer and duplicate highlight index/run modules are retired.
The viewport lifecycle test now constructs the actual upstream model/view through an explicit native
DOM and animation boundary. Its assertions cover the new scheduled-presentation contract, current
source/diagnostics, node reuse, global caret/scroll behavior and disposal. See
`packages/editor/docs/a18-integration.md` for the complete mapping and short-lived rollback API.
The historical browser pass at `38ac41a4` qualifies the earlier architecture only. The merged upstream
architecture requires a fresh coordinator-run gate with the unchanged production workload and budget.
