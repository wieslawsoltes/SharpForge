# Document host transactions

`DocumentService.replace` accepts a synchronous `commitMetadata` contribution. All records, source models, saved baselines,
tabs and active-document state are validated before ownership commits. The contribution installs already prepared project
and workspace metadata as the first effect after ownership changes, before any editor rebind or document reset notification.
It must not perform asynchronous work or additional validation. Callback failures use the existing `DOCUMENT_COMMITTED`
report, and remaining view and cleanup effects still run. Adopted models remain owned by DocumentService.

`DocumentService` also accepts an optional `coordinateSave` contribution, forwarded by `createWorkbenchServices` as
`coordinateDocumentSave`. It receives `{snapshot, prepare, isCurrent}` before editor preparation begins. `prepare({signal})`
performs configured normalization and returns a fresh immutable capture, synchronously when no asynchronous preparation is
needed. The coordinator can acquire a file picker during the original user activation, then prepare and stream that capture.
It returns `{ok, snapshot}`. DocumentService marks only that captured baseline saved, and only while the exact document
record is still owned. An absent coordinator retains the existing prepare-then-`saveDocument` provider behavior.

These are host composition contracts. Their complete save/Explorer integration qualification is recorded with the
corresponding completed host scope; no separate runtime qualification is claimed by this API commit.
