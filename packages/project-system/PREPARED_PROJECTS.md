# Prepared project records

`ProjectSystem` accepts ordinary text/binary records, explicitly lazy metadata records,
and immutable source records admitted through the existing workspace-record API.
Array and Map inputs preserve property descriptors and source identity. Discovery
checks source membership without reading a compatibility `text` getter.

`text(path)` remains an explicit text-reading operation. `setBuildFile` admits the
loaded immutable record and replaces its lazy marker while retaining source and
model descriptors. `compilationFiles` forwards original source descriptors and
versions through the public compilation-record contract; executable compilation
still rejects unloaded files. Generated sources and multi-target build contexts
retain the established evaluator behavior.

This port composes the complete portable evaluator with pinned-main prepared
records. It reuses `cloneWorkspaceRecord`, `isTextRecord`, `recordText` and
`compilationRecords`; it adds no alternate snapshot representation or byte encoder.

## Evidence

The unchanged `tests/a20-prepared-source-workspace.test.js` and
`tests/a20-prepared-source-paths.test.js` cases exercise public discovery and
compilation with throwing text getters, descriptor identity and rebased sources.
Their two discovery regressions failed in the completed initial integration run
and passed after `evaluationResult` switched to the shared source-aware predicate.
The implementation here matches corrected source
`7b087e0f0e3105c71ec86e39554358766b45d3bf`. Root owns the consolidated
38-file correction replay; no separate test run was made for this projection.
