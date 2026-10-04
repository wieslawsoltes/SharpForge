# Project 18 static integration review

Reviewed source revision: `108f03b70126a389fb16183ee5fcf4026e498e65`.
The final combined check remains part of the completed integration qualification.

## Module loading

The dynamic-code gate continues to require an exact source hash and operation count
for every reviewed file. This integration adds twelve explicit records; it does not
change the gate, its scan roots, supported operations or mismatch behavior.

| Files | Reviewed loading behavior |
| --- | --- |
| Portable test runtime, data providers and source symbols | Fixed `@sharpforge/compiler`, `@sharpforge/runtime` and `@sharpforge/syntax` imports, deferred until the feature is used. Managed source is compiled and run inside bounded managed sessions. |
| Template catalog generator | Trusted repository `*.template.js` source files, ordinary-file checks, 40 KiB input limits and a bounded template count. Template packages remain data. |
| Build generator runner | Trusted declared repository modules after root-relative source/target validation; at most 4 MiB per generated result. |
| Archive and Explorer benchmarks | Explicit operator-selected trusted Git revisions written into owned temporary modules. These tools are outside the browser product. |
| Catalog discovery test | A generated index in the test's own temporary directory. |
| Four browser component fixtures | Fixed same-origin application module paths only. Transport fixtures are identified separately from actual native/toolchain evidence. |

The native process policy test now imports its existing `node:fs/promises` dependency
statically. The Explorer benchmark now consumes the public project-system entry point.

## Stylesheet baseline

The only new stylesheet relative to upstream is
`apps/studio/styles/explorer-disk-services.css`: 18 lines and nine rules for the disk
service section, scroll bounds, comparison textareas and visible keyboard focus.
The contribution is already registered through the Explorer build contribution.

The reviewed concatenated stylesheet is 112,782 bytes and 1,190 rules, compared with
112,012 bytes and 1,181 rules before the addition. Its whole-file, ordered-rule and
sorted-rule hashes are recorded together in the existing CSS fixture. The exact
stylesheet count changes from 25 to 26. Assertions for complete file declaration,
unique order, byte identity and both rule orderings remain enabled.

## Worker lifecycle and project assembly follow-up

The compiler worker adds the explicit `releaseDocuments` protocol method through the tested lifecycle handler. The existing exact method-count assertion changes from 28 to 30 for `prepareTypeRename` and `releaseDocuments`; no unknown-method or dispatch assertion is removed. The reviewed registry test retains its two executable dynamic imports of fixed Node/trusted repository modules, and its content hash is refreshed.

`tests/support/runtime-project-worker.mjs` adapts only the Node message transport and imports the fixed production runtime worker after `self` exists. Its one dynamic import has an exact source hash; no network, source-text evaluation or input-selected module is admitted. The generated catalog benchmark string is operator-selected code over a local git archive and does not add a production import.

## Compatible native automation additions

The exact automation-key test found 21 declared native context/profile/testing paths absent from its historical lock. The lock appends those explicit paths after all 109 existing entries, preserving every old key and array position. The assertion compares the complete sorted surface and independently rejects duplicate keys; it does not omit, filter or wildcard any method. This retains the contract gate's append-only extension proof without changing a version or weakening the check.

Five host race cases retained their stale-read rejection and no-publication behavior but now receive the shared `FileSystemError` diagnostic. Their assertions check the exact `name`, `code`, `path` and message instead of the retired plain-error text. The original failing cohort and narrow correction logs remain available.

## Editor and text manifest ownership

The complete filesystem cohort exposed a pre-existing discovery assertion that
assumed every A20 test path contained `editor`. The inspected upstream manifest
already assigns four explicitly named `tests/text-*` suites to that area. The
assertion now accepts and requires those exact four suites, while retaining the
editor-name check, unknown-area rejection, unique ownership, and nested-suite
checks. Any existing dynamic-code review hash for this test is refreshed without
changing its operation count or allowlist policy.
