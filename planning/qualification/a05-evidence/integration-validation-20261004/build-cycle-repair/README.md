# Runtime dependency cycle repair validation

The strict browser build failed at `8f6eba479` because runtime modules imported higher-level facades that led back to themselves. The original failure and a read-only static graph diagnostic are retained unchanged beside the successful build log. No bundler rule, dynamic-import allowance, runtime policy, or validation threshold changed.

The repairs use the existing `managed-fault.js` and `suspension.js` leaves, separate delegate call adaptation from binding helpers, and separate async context completion from fault delivery. The extracted function bodies retain their existing behavior and ordering.

Validation ran serially at clean revision `807879f511a877ba7e5e1e0e63d9b9b75ba91319`, with one allowed process slot, one test file at a time, and a 512 MiB V8 heap limit. The actual process exit was **0** for all three commands:

- The complete dependency-free browser application build passed, including the original strict cycle validation.
- Delegate, first-chance policy, and frame-memory retirement regressions passed **78/78**.
- Async completion and continuation-root inventory regressions passed **19/19**.

The `packages`, `packages/runtime`, `apps`, and `scripts` Git trees were verified identical to integration revision `39055a8527e840b4534c45ffca122f3f89466106`. Build revision identity remains specific to the tested commit. This is build and focused behavior evidence; it is not a performance or platform qualification claim.

[manifest.json](manifest.json) records the exact commands, environment overrides, clean pretest revision, source trees, source hashes, raw-log hashes, observed environment, and limitations. Every archived log is a byte-identical copy of the original.

Final root integration `npm run check` also passed with **exit 0** at revision `d1044a1707a6b72b90a5cbf14c8eb45da0b259eb`, tree `5b1b546dd88064cc4a7da1416f16787d7f235ff2`. Its result covers 1,293 assigned Node test files (zero unassigned or duplicate entries), 4,624 JavaScript syntax checks (zero errors), and successful inspection of 4,575 files with 4,612 linked modules. The product source trees listed above remain identical.

The [raw check log](npm-check-pass.log) and [root validation journal](npm-check-journal.json) are retained byte-identically with digests in the manifest. This appended check is static validation at its own recorded revision, not another runtime or platform qualification run. The journal records exact arguments, environment overrides, timestamps and exit status; it does not independently record working-tree cleanliness.
