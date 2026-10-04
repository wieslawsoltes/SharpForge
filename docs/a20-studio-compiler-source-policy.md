# Studio large-file compiler eligibility — SF-A20-T44 / #1513

Hosted qualification a5, run `37178840757`, at public commit
`c13aa0fd9d27df28b3708bb83d914a04c20a5c7c` (tree
`29023ed8b962b6d91671bdb0c0359d905ef2659e`) failed the real 200 MiB File import
with `Studio import: Document exceeds the source size limit`. Chromium
153.0.8010.12 launched; this was an actual application failure. The original
failure remains evidence, and this correction has not yet been executed locally
or in a browser.

The reader and DocumentService had accepted the prepared source. A small sibling
editor could then request language information for the whole project. Its compiler
snapshot read the new lazy document's `.text`, and the compiler's default
2,000,000 UTF-16-unit source limit rejected it. Checking only the current editor's
length or disabling automatic builds above 8 MiB did not cover that path.

`workers/compiler-limits.js` records the unchanged compiler bounds: 2,000,000
UTF-16 units per source and 100 documents per project. Worker construction and
temporary refactoring/design validation use those exact bounds.
`compiler-source-policy.js` checks document count and published-source metadata
before any `.text` access. `StudioProjects.snapshot()` enforces the policy for all
BuildService operations and direct workspace-action snapshots. Refusals are explicit:

| Code | Meaning |
| --- | --- |
| `STUDIO_COMPILER_SOURCE_LIMIT` | A published source exceeds 2,000,000 UTF-16 units. |
| `STUDIO_COMPILER_DOCUMENT_LIMIT` | The project's compilation closure exceeds 100 documents. |
| `STUDIO_COMPILER_SOURCE_METADATA` | A source has no safe size metadata; eligibility cannot be established without reading it. |

The reason includes the owning project or offending URI, actual size/count, and
compiler bound. Editing, saving and local text search remain available. Studio's
256 MiB per-file and 320 MiB workspace ingress limits are unchanged; smaller
explicit reader bounds remain enforced. This does not enable compilation or
semantic providers for 200 MiB sources.

Studio supplies CodeEditor's optional `languageAvailability` callback to refuse
semantic requests with accessible status before invoking even custom providers.
Local document/project lookup remains available. Automatic analysis/build uses
the same project policy without reporting a compiler transport error as an import
error. Explicit compiler requests/builds retain the precise refusal. Scheduling
no longer disables unrelated bounded projects just because some other model is
large. The snapshot boundary always rechecks current published roots, including
silent committed transactions; temporary rename-preview text is not compiler input.

Cross-project rename filters the compiler participants by metadata-only dependency
closure before capturing source. An unrelated oversized project does not block an
independent rename. Linked/dependent projects containing the target declaration
still participate, and an oversized required project or solution Fix All produces
the explicit error rather than silently omitting its edits.

Eligibility is linear in the project's source count and uses constant work per
source's existing snapshot metadata. It does not scan source characters, cache a
possibly stale root, or flatten oversized source. Source URI enumeration retains
the existing ProjectSystem dependency-closure traversal; allowed compiler snapshots
remain bounded by 100 sources of at most 2,000,000 units each. No new timing or
memory claim is made for this correction.

Authored regression scope (not yet run):

- `tests/a19-studio-large-source-composition.test.js`: actual 200 MiB Node File/Blob
  slicing through `importStudioFiles` → workspace loader → DocumentService, automatic
  build/analysis, and the actual Studio provider registry/editor request boundary;
  retained small sibling, no compiler traffic or source materialization, edit/undo,
  cancellation, unchanged ingress budgets and smaller reader bounds. DOM layout is
  doubled. The hosted File-input driver is unchanged.
- `tests/a19-studio-compiler-source-policy.test.js`: exact default/worker limits,
  throwing lazy getters, published preview roots, silent transaction visibility,
  real bounded compiler handlers for independent-project symbols/rename/analysis,
  required linked-project refusal, solution Fix All, and recovery after shrinking.
- `tests/a20-language-availability.test.js`: custom provider refusal/status,
  current URI/explicit project ownership, local lookups, cancellation and disposal.
- `tests/a20-fix-all.test.js`: its test project adapter now supplies metadata-only
  `sourceUris`; all existing dependency/linked rename assertions are preserved.

Browser UI, real operating-system File selection, physical I/O, cross-engine latency
and native-host qualification remain separate. Root owns one serial completed-scope
validation cohort and the next actual hosted File-input run.
