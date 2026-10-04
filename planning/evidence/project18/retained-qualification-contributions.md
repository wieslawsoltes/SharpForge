# Retained Project18 qualification contributions

The final published-parent audit found 151 paths absent from the canonical
implementation tree. None represents a missing product implementation: three
facades are superseded by direct public exports and eight syntax fixtures were
removed by upstream commit `61a3888193c668b73bec750709163a170d3064ff`.
Those obsolete fixtures and the root checkout's untracked copies remain untouched.

Eight published test files contain 18 test scenarios that the canonical
qualification did not retain. This batch preserves that complete identified scope
using known Git blobs, without adding redundant split suites.

| Test file | Retained cases | Scope |
|---|---:|---|
| `a24-provider-files.test.js` | 3 | Public FileList import, rejection before reads, evaluation-input policy |
| `a24-09-wizard-provider.test.js` | 4 | Provider attachment, exact bytes, failure receipts, cancellation, lazy destinations |
| `a24-workspace-reconcile.test.js` | 3 | Text conflict details, merge limits, binary decisions and ownership |
| `a24-disk-scan.test.js` | 1 | File count and import-report entry bounds |
| `a24-reload-coordinator.test.js` | 2 | Atomic host acknowledgment and bounded explicit reload choices |
| `a24-save-locks.test.js` | 1 | Shared file-save and exclusive workspace-transaction ownership |
| `a24-vfs-memory.test.js` | 3 | Recursive quota rollback, cancelled subscriptions, equal-version rejection |
| `a24-vfs-native.test.js` | 1 | Exact opaque bytes through the native client's raw-file boundary |

The first three files are exact complete published blobs. Other files retain
unchanged test bodies, except that the recursive memory quota assertions are
extracted from a larger duplicate case into a new descriptive wrapper. The native
case keeps its original setup and surrounding conflict assertions so its unique
`client.binary` check retains the same context. The provenance JSON records source heads, trees, blobs, line spans and SHA-256
hashes for every retained assertion. `omitted-path-dispositions.json` classifies
all 151 omitted paths and records their published blobs and canonical replacements.

The only imported local fixtures are the existing `tests/support/a24-fsa.js` and
`tests/helpers/a24-directory.js`. The native HTTP fixture remains inline. All
package imports use public entry points. The existing A24 `tests/a24-*.test.js`
manifest pattern includes all eight files, so no duplicate registration is added.

## Qualification boundary

No test or build was run while preparing this batch. These 18 cases are pending
one parent-coordinated combined run after the complete scope is integrated. The
prior 1,877-case canonical result does not claim to have executed these cases.
Published scope evidence remains distinct and is retained through the source
lineage in the JSON companion. Product source and the protected Studio entry are
unchanged.
