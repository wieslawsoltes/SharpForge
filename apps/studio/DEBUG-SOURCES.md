# Debug source identity

The standalone helpers in `debug-sources.js` keep execution URIs separate from
workspace paths. They accept verified source records with `uri`, `text`, optional
`originalUri`, and optional `assemblyKey`, `project`, and `contextId` provenance.

- `setDebugSources(state, records)` stages the source text, provenance records,
  and original-path index before publishing them together. Conflicting text for
  one execution URI rejects the update without replacing the previous maps.
- `workspaceFileForDebugSource(state, executionUri, point?)` returns a loaded
  workspace record only when its URI, text, and available provenance match.
  Ambiguous generated paths require matching project/context identity.
- `debugSourceForWorkspace(state, workspaceUri, preferredUri?)` maps a workspace
  anchor back to one execution identity, preferring the selected stack frame.
- `workspaceDebugPoint(state, point, workspaceUri)` creates an editor coordinate
  record while preserving the execution URI in `executionUri`.
- `navigateDebugSource(host, point)` opens exact loaded workspace text or invokes
  `showSymbolSource` for the verified source viewer. Unavailable CIL source uses
  the disassembly panel. Loaded-source `openFile` and `getEditor` are synchronous
  host callbacks; this helper does not load unknown files or guess by basename.

The public input and output shapes are tested in
`tests/a23-project-debug-sources.test.js`. This projection retains the five pure
source-model cases from source commit `4a49a23b`; the breakpoint-row integration
case belongs in the dependent debugger editor batch, and worker source publication
belongs in the runtime worker batch. Their assertion bodies remain unchanged.
The complete original test file remains in integration history.

These cases passed within the existing Node 22.23.3 serial qualification at that
source commit. Its aggregate was 788 passed and 6 unrelated failures; this is not
a claim that the whole run passed. No additional broad run was started for this
projection. Actual protected Studio entry wiring and runtime graph publication
are separate application integration batches.
