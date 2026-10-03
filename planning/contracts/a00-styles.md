# Studio style ownership

SF-A00-T20 / #438 moves the seven release-named Studio stylesheets into 25 files
owned by tools and shared workbench surfaces. The files are contiguous source
segments, registered in `apps/studio/build.contrib.json` in the original cascade
order. Package editor/controls/WinUI orders use the same spaced ordering scale.
The build contribution reader accepts an optional empty separator between
contiguous fragments; its default newline behavior remains compatible with other
contributors. No release-named CSS file remains in the Studio source tree.

`planning/contracts/fixtures/css/studio-baseline.json` records the reviewed
committed stylesheet's byte hash, rule count, sorted-rule hash and ordered-rule
hash. `scripts/planning/css-rules.js` scans complete top-level CSS rules while
preserving nested at-rules, quoted punctuation and declaration order. It is a
rule-boundary scanner for equivalence evidence, not a CSS syntax/semantics engine.
The stylesheet bytes themselves are also compared, so a parser omission cannot
hide a changed selector or declaration. Negative tests demonstrate that sorted
rules alone cannot detect cascade reversal. Browser validation uses the actual
built stylesheet in Studio.

The historical build registration fixture now names the new owner files while
retaining the reviewed concatenated CSS hash. Golden release locks are updated
separately by the integration owner after the accepted stack is complete.

Historical extraction validation on macOS arm64, Node 24.21.0 and Chromium 143.0.7499.4:

- Built CSS remains **111,841 bytes**, byte-identical to the original, with SHA-256
  `61e8f836530dc95c61fabba5b6476d821ed76a526d629e8dadc1f55b46f05155`.
- All **1,179 source rules** retain both sorted and original cascade fingerprints.
  Chromium parses **1,176 CSSOM rules** before and after, with identical sorted
  and ordered serialization. The engine/scanner counts differ because the browser
  applies its own CSS parsing behavior; neither result changed during extraction.
- All **16 registration/style tests** pass, including invalid separators, malformed
  CSS boundaries, reordered overrides, and missing rules. Each extracted stylesheet
  contains complete independently parsed rules.
- Syntax checks pass for **384 modules**; all 30 manifests cover 83 Node files and
  16 Python suites with zero ownership gaps or duplicates.
- Real core Studio (**29**), designer (**20**) and source-sync (**16**) browser
  checks pass, including light/dark themes, responsive layouts, independent panels,
  source and CIL workers, live designer editing, and mode switching.

`a00-styles-evidence.json` records exact fingerprints and measured browser runs.
Windows/Linux and other browser engines were not executed locally. Style
extraction makes no new runtime or native-platform parity claim.

The later main integration preserves two editor warning rules added by the compiler
workstream: `.sf-line.warning:after` and `.sf-squiggle-warning`. The existing hosted
core run [37139018855](https://github.com/wieslawsoltes/SharpForge/actions/runs/37139018855)
measured **112,012 bytes and 1,181 rules**; the current fingerprint fixtures record
that reviewed 171-byte addition. Original extraction measurements above remain
historical evidence. No new local test, build, or browser run was performed for
this fixture synchronization; see `a00-styles-main-sync-evidence.json`.
